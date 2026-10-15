#!/usr/bin/env node
/**
 * regex-toolkit-mcp — 正则表达式测试 & 解释 MCP 工具
 * 知微工作室 · Zhiwei Studio · 2026-10-15 · v1.0.0
 *
 * 提供 2 个工具：
 *   regex_test    输入 pattern + flags + 测试文本，返回所有匹配及命名分组
 *   regex_explain 把一条正则翻译成人话（逐段解释作用）
 *
 * 设计原则：
 *   - 零第三方依赖（正则解析 / 匹配全部原生 JS，仅依赖 MCP SDK）
 *   - 完整支持 Unicode / 中文文本
 *   - 不存储、不硬编码任何凭证
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* ===== 正则 tokenizer：把 pattern 字符串拆成结构化 token 数组 ===== */

/**
 * 将正则模式字符串解析为 token 数组
 * 每个 token: { type: string, raw: string, detail?: string }
 *
 * 支持的 token 类型：
 *   anchor         ^ $
 *   quantifier     * + ? {n} {n,} {n,m}
 *   dot            .
 *   charClass      \d \w \s \D \W \S \b \B 及 Unicode 属性转义
 *   group-start    ( (?<name> (?: (?= (?! (?<= (?<!
 *   group-end      )
 *   alternation    |
 *   class-start    [
 *   class-end      ]
 *   backref        \1 \2 ... \k<name>
 *   escape         \n \t \r \f \v \0 \\ \. 等
 *   literal        普通字符
 */
function tokenize(pattern) {
  const tokens = [];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    // ---- 转义序列 ----
    if (ch === '\\') {
      if (i + 1 >= pattern.length) {
        tokens.push({ type: 'literal', raw: '\\' });
        i++;
        continue;
      }
      const nx = pattern[i + 1];

      // 命名反向引用 \k<name>
      if (nx === 'k' && i + 2 < pattern.length && pattern[i + 2] === '<') {
        const end = pattern.indexOf('>', i + 3);
        if (end !== -1) {
          const name = pattern.slice(i + 3, end);
          tokens.push({ type: 'backref', raw: pattern.slice(i, end + 1), detail: name });
          i = end + 1;
          continue;
        }
      }

      // Unicode 属性转义 \p{...} \P{...}
      if ((nx === 'p' || nx === 'P') && i + 2 < pattern.length && pattern[i + 2] === '{') {
        const end = pattern.indexOf('}', i + 3);
        if (end !== -1) {
          const prop = pattern.slice(i + 3, end);
          tokens.push({ type: 'charClass', raw: pattern.slice(i, end + 1), detail: prop });
          i = end + 1;
          continue;
        }
      }

      // 两个字符的转义序列
      tokens.push({ type: 'escape', raw: '\\' + nx });
      i += 2;
      continue;
    }

    // ---- 字符类 [...] ----
    if (ch === '[') {
      let j = i + 1;
      // 开头 ^ 表示取反
      if (j < pattern.length && pattern[j] === '^') j++;
      // 开头 ] 视为字面量
      if (j < pattern.length && pattern[j] === ']') j++;
      while (j < pattern.length && pattern[j] !== ']') {
        if (pattern[j] === '\\' && j + 1 < pattern.length) j++; // 跳过转义
        j++;
      }
      if (j < pattern.length) j++; // 包含结尾 ]
      const raw = pattern.slice(i, j);
      const negated = raw.length > 1 && raw[1] === '^';
      tokens.push({ type: 'class-start', raw, detail: negated ? 'negated' : undefined });
      i = j;
      continue;
    }

    // ---- 分组开头 ----
    if (ch === '(') {
      if (pattern.slice(i, i + 2) === '(?') {
        // 命名捕获组 (?<name>...)
        if (pattern[i + 2] === '<' && (i + 3 < pattern.length) && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
          const end = pattern.indexOf('>', i + 3);
          if (end !== -1) {
            const name = pattern.slice(i + 3, end);
            tokens.push({ type: 'group-start', raw: pattern.slice(i, end + 1), detail: name });
            i = end + 1;
            continue;
          }
        }
        // 各种特殊分组 (?: (?= (?! (?<= (?<!
        // 先检查 lookbehind（5 字符：(?<= 或 (?<!）
        const three = pattern.slice(i + 2, i + 5);
        const specialMap3 = {
          '<=': 'positive-lookbehind',
          '<!': 'negative-lookbehind',
        };
        if (specialMap3[three]) {
          tokens.push({ type: 'group-start', raw: pattern.slice(i, i + 5), detail: specialMap3[three] });
          i += 5;
          continue;
        }
        // 再检查单字符特殊分组（4 字符：(?: 或 (?= 或 (?!）
        const ch2 = pattern[i + 2]; // 只看 (? 后面的第一个字符
        const specialMap = {
          ':': 'non-capturing',
          '=': 'positive-lookahead',
          '!': 'negative-lookahead',
        };
        if (specialMap[ch2]) {
          tokens.push({ type: 'group-start', raw: pattern.slice(i, i + 4), detail: specialMap[ch2] });
          i += 4;
          continue;
        }
        // 无法识别的 (? 序列，当普通 ( 处理
        tokens.push({ type: 'group-start', raw: '(' });
        i++;
        continue;
      }
      // 普通捕获组
      tokens.push({ type: 'group-start', raw: '(' });
      i++;
      continue;
    }

    // ---- 分组结尾 ----
    if (ch === ')') {
      tokens.push({ type: 'group-end', raw: ')' });
      i++;
      continue;
    }

    // ---- 量词 ----
    if (ch === '*' || ch === '+' || ch === '?') {
      let raw = ch;
      // 非贪婪修饰
      if (i + 1 < pattern.length && pattern[i + 1] === '?') {
        raw += '?';
        i++;
      }
      tokens.push({ type: 'quantifier', raw });
      i++;
      continue;
    }

    if (ch === '{') {
      const m = pattern.slice(i).match(/^\{(\d+)(,(\d*))?\}/);
      if (m) {
        let raw = m[0];
        // 非贪婪修饰
        if (i + raw.length < pattern.length && pattern[i + raw.length] === '?') {
          raw += '?';
        }
        tokens.push({ type: 'quantifier', raw });
        i += raw.length;
        continue;
      }
      // 不是合法量词，当字面量
      tokens.push({ type: 'literal', raw: '{' });
      i++;
      continue;
    }

    // ---- 锚点 ----
    if (ch === '^' || ch === '$') {
      tokens.push({ type: 'anchor', raw: ch });
      i++;
      continue;
    }

    // ---- 通配符 ----
    if (ch === '.') {
      tokens.push({ type: 'dot', raw: '.' });
      i++;
      continue;
    }

    // ---- 分支 ----
    if (ch === '|') {
      tokens.push({ type: 'alternation', raw: '|' });
      i++;
      continue;
    }

    // ---- 普通字符 ----
    tokens.push({ type: 'literal', raw: ch });
    i++;
  }

  return tokens;
}

/* ===== 单 token → 中文描述 ===== */

// 转义序列 → 中文含义 映射表
const ESCAPE_DESC = {
  '\\d': '任意数字 [0-9]',
  '\\D': '任意非数字',
  '\\w': '任意单词字符 [a-zA-Z0-9_]',
  '\\W': '任意非单词字符',
  '\\s': '任意空白符（空格/制表符/换行等）',
  '\\S': '任意非空白符',
  '\\b': '单词边界',
  '\\B': '非单词边界',
  '\\n': '换行符',
  '\\t': '制表符',
  '\\r': '回车符',
  '\\f': '换页符',
  '\\v': '垂直制表符',
  '\\0': '空字符 (NUL)',
};

function describeToken(tok) {
  switch (tok.type) {
    case 'anchor':
      return tok.raw === '^' ? '匹配字符串开头' : '匹配字符串结尾';

    case 'quantifier': {
      const lazy = tok.raw.endsWith('?');
      const base = lazy ? tok.raw.slice(0, -1) : tok.raw;
      let desc;
      switch (base) {
        case '*':  desc = '出现 0 次或多次'; break;
        case '+':  desc = '出现 1 次或多次'; break;
        case '?':  desc = '出现 0 次或 1 次'; break;
        default: {
          const m = base.match(/^\{(\d+)(,(\d*))?\}$/);
          if (m) {
            const min = m[1];
            const hasComma = m[2] !== undefined;
            const max = m[3];
            if (!hasComma) desc = `恰好出现 ${min} 次`;
            else if (max === '' || max === undefined) desc = `至少出现 ${min} 次`;
            else desc = `出现 ${min} 到 ${max} 次`;
          } else {
            desc = `量词 ${base}`;
          }
        }
      }
      return lazy ? desc + '（非贪婪模式）' : desc;
    }

    case 'dot':
      return '匹配任意单个字符（除换行符外）';

    case 'charClass':
      return ESCAPE_DESC[tok.raw] || `字符类 ${tok.raw}`;

    case 'class-start': {
      const inner = tok.raw;
      const negated = inner.length > 1 && inner[1] === '^';
      const content = negated ? inner.slice(2, -1) : inner.slice(1, -1);
      return negated
        ? `匹配不在 ${content} 中的任意字符`
        : `匹配 ${content} 中的任意字符`;
    }

    case 'group-start':
      switch (tok.detail) {
        case 'non-capturing':        return '开始非捕获分组';
        case 'positive-lookahead':   return '正向前瞻（后面必须是…）';
        case 'negative-lookahead':   return '负向前瞻（后面不能是…）';
        case 'positive-lookbehind':  return '正向后顾（前面必须是…）';
        case 'negative-lookbehind':  return '负向后顾（前面不能是…）';
        default:                     return `开始命名捕获组「${tok.detail}」`;
      }

    case 'group-end':
      return '分组结束';

    case 'alternation':
      return '或（二选一）';

    case 'backref':
      return `反向引用组「${tok.detail}」的内容`;

    case 'escape':
      return ESCAPE_DESC[tok.raw] || `转义字符 ${tok.raw}`;

    case 'literal':
    default:
      return `匹配字面字符 "${tok.raw}"`;
  }
}

/* ===== 生成整体摘要 ===== */

function generateSummary(pattern, tokens) {
  const hasAnchorStart = tokens.length > 0 && tokens[0].raw === '^';
  const hasAnchorEnd = tokens.length > 0 && tokens[tokens.length - 1].raw === '$';
  const hasGroup = tokens.some(t => t.type === 'group-start' && !t.detail?.includes('look'));
  const hasNamedGroup = tokens.some(t => t.type === 'group-start' && t.detail && !['non-capturing', 'positive-lookahead', 'negative-lookahead', 'positive-lookbehind', 'negative-lookbehind'].includes(t.detail));
  const hasAlternation = tokens.some(t => t.type === 'alternation');
  const hasQuantifier = tokens.some(t => t.type === 'quantifier');

  const parts = [];
  if (hasAnchorStart && hasAnchorEnd) parts.push('完整匹配整行');
  else if (hasAnchorStart) parts.push('从字符串开头匹配');
  else if (hasAnchorEnd) parts.push('到字符串结尾匹配');
  if (hasNamedGroup) parts.push('含命名捕获组');
  else if (hasGroup) parts.push('含捕获组');
  if (hasAlternation) parts.push('含分支选择');
  if (hasQuantifier) parts.push('含量词');

  if (parts.length === 0) return `匹配模式：${pattern}`;
  return `正则特征：${parts.join('、')}`;
}

/* ===== MCP Server ===== */

const server = new Server(
  { name: "regex-toolkit-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "regex_test",
      description: "用正则表达式测试文本。返回所有匹配结果，包括完整匹配、捕获组、命名分组、匹配位置。支持全局搜索和多行模式。",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式模式（不含两侧斜杠），例如 \"(?<user>[^@]+)@(?<domain>.+)\"" },
          flags:   { type: "string", description: "正则标志，例如 \"g\"（全局）\"i\"（忽略大小写）\"m\"（多行）。默认 \"g\"" },
          text:    { type: "string", description: "要测试的文本" },
        },
        required: ["pattern", "text"],
      },
    },
    {
      name: "regex_explain",
      description: "把一条正则表达式翻译成人话。逐段拆解并解释每个部分的作用，最后给出整体摘要。",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式模式（不含两侧斜杠）" },
          flags:   { type: "string", description: "正则标志，例如 \"gi\"" },
        },
        required: ["pattern"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a } = req.params;
  try {
    /* ---------- regex_test ---------- */
    if (name === "regex_test") {
      const flags = a.flags !== undefined ? a.flags : "g";
      let re;
      try {
        re = new RegExp(a.pattern, flags);
      } catch (err) {
        return { content: [{ type: "text", text: `正则语法错误: ${err.message}` }], isError: true };
      }

      const text = a.text;
      const matches = [];

      if (flags.includes("g")) {
        // 全局搜索：迭代所有匹配
        let m;
        while ((m = re.exec(text)) !== null) {
          const entry = {
            match: m[0],
            index: m.index,
          };
          // 捕获组（排除 index / input / groups / indices 等非数字键）
          if (m.length > 1) {
            entry.groups = [];
            for (let g = 1; g < m.length; g++) {
              entry.groups.push({ index: g, value: m[g] ?? null });
            }
          }
          // 命名分组
          if (m.groups) {
            entry.namedGroups = { ...m.groups };
          }
          matches.push(entry);
          // 防止零宽匹配无限循环
          if (m[0].length === 0) re.lastIndex++;
        }
      } else {
        // 单次搜索
        const m = re.exec(text);
        if (m) {
          const entry = { match: m[0], index: m.index };
          if (m.length > 1) {
            entry.groups = [];
            for (let g = 1; g < m.length; g++) {
              entry.groups.push({ index: g, value: m[g] ?? null });
            }
          }
          if (m.groups) {
            entry.namedGroups = { ...m.groups };
          }
          matches.push(entry);
        }
      }

      const result = {
        pattern: a.pattern,
        flags,
        totalMatches: matches.length,
        matches,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    /* ---------- regex_explain ---------- */
    if (name === "regex_explain") {
      const pattern = a.pattern;
      const flags = a.flags || "";
      const tokens = tokenize(pattern);

      // 逐 token 生成解释
      const steps = tokens.map((tok, idx) => ({
        step: idx + 1,
        syntax: tok.raw,
        type: tok.type,
        explanation: describeToken(tok),
      }));

      const summary = generateSummary(pattern, tokens);

      // 标志说明
      const flagExplain = [];
      if (flags.includes('g')) flagExplain.push('g = 全局搜索（找出所有匹配）');
      if (flags.includes('i')) flagExplain.push('i = 忽略大小写');
      if (flags.includes('m')) flagExplain.push('m = 多行模式（^/$ 匹配每行开头/结尾）');
      if (flags.includes('s')) flagExplain.push('s = 单行模式（. 匹配换行符）');
      if (flags.includes('u')) flagExplain.push('u = Unicode 模式');

      const result = {
        pattern,
        flags: flags || "(无)",
        flagExplanation: flagExplain.length > 0 ? flagExplain : undefined,
        steps,
        summary,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    return { content: [{ type: "text", text: "未知工具: " + name }], isError: true };
  } catch (e) {
    return {
      content: [{ type: "text", text: "错误: " + (e && e.message ? e.message : String(e)) }],
      isError: true,
    };
  }
});

// 启动 stdio 传输
const transport = new StdioServerTransport();
await server.connect(transport);
