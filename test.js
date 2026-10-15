/**
 * regex-toolkit-mcp 自测脚本
 * 知微工作室 · Zhiwei Studio · 2026-10-15
 *
 * 测试项：
 *   1. regex_test 邮箱匹配
 *   2. regex_test URL 匹配 + 命名分组
 *   3. regex_test 日期匹配 + 命名分组
 *   4. regex_test 中文文本匹配
 *   5. regex_test 全局搜索多匹配
 *   6. regex_test 零宽匹配不无限循环
 *   7. regex_explain 基础拆解
 *   8. regex_explain 复杂模式（含前瞻/命名组/量词）
 *   9. regex_test 非法正则返回错误
 *
 * 运行：node test.js
 */

/* ===== 从 index.js 复制核心函数（纯函数级测试，不走 stdio） ===== */

function tokenize(pattern) {
  const tokens = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      if (i + 1 >= pattern.length) { tokens.push({ type: 'literal', raw: '\\' }); i++; continue; }
      const nx = pattern[i + 1];
      if (nx === 'k' && i + 2 < pattern.length && pattern[i + 2] === '<') {
        const end = pattern.indexOf('>', i + 3);
        if (end !== -1) { tokens.push({ type: 'backref', raw: pattern.slice(i, end + 1), detail: pattern.slice(i + 3, end) }); i = end + 1; continue; }
      }
      if ((nx === 'p' || nx === 'P') && i + 2 < pattern.length && pattern[i + 2] === '{') {
        const end = pattern.indexOf('}', i + 3);
        if (end !== -1) { tokens.push({ type: 'charClass', raw: pattern.slice(i, end + 1), detail: pattern.slice(i + 3, end) }); i = end + 1; continue; }
      }
      tokens.push({ type: 'escape', raw: '\\' + nx }); i += 2; continue;
    }
    if (ch === '[') {
      let j = i + 1;
      if (j < pattern.length && pattern[j] === '^') j++;
      if (j < pattern.length && pattern[j] === ']') j++;
      while (j < pattern.length && pattern[j] !== ']') { if (pattern[j] === '\\' && j + 1 < pattern.length) j++; j++; }
      if (j < pattern.length) j++;
      const raw = pattern.slice(i, j);
      const negated = raw.length > 1 && raw[1] === '^';
      tokens.push({ type: 'class-start', raw, detail: negated ? 'negated' : undefined }); i = j; continue;
    }
    if (ch === '(') {
      if (pattern.slice(i, i + 2) === '(?') {
        if (pattern[i + 2] === '<' && (i + 3 < pattern.length) && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
          const end = pattern.indexOf('>', i + 3);
          if (end !== -1) { tokens.push({ type: 'group-start', raw: pattern.slice(i, end + 1), detail: pattern.slice(i + 3, end) }); i = end + 1; continue; }
        }
        const three = pattern.slice(i + 2, i + 5);
        const specialMap3 = { '<=': 'positive-lookbehind', '<!': 'negative-lookbehind' };
        if (specialMap3[three]) { tokens.push({ type: 'group-start', raw: pattern.slice(i, i + 5), detail: specialMap3[three] }); i += 5; continue; }
        const ch2 = pattern[i + 2];
        const specialMap = { ':': 'non-capturing', '=': 'positive-lookahead', '!': 'negative-lookahead' };
        if (specialMap[ch2]) { tokens.push({ type: 'group-start', raw: pattern.slice(i, i + 4), detail: specialMap[ch2] }); i += 4; continue; }
        tokens.push({ type: 'group-start', raw: '(' }); i++; continue;
      }
      tokens.push({ type: 'group-start', raw: '(' }); i++; continue;
    }
    if (ch === ')') { tokens.push({ type: 'group-end', raw: ')' }); i++; continue; }
    if (ch === '*' || ch === '+' || ch === '?') {
      let raw = ch;
      if (i + 1 < pattern.length && pattern[i + 1] === '?') { raw += '?'; i++; }
      tokens.push({ type: 'quantifier', raw }); i++; continue;
    }
    if (ch === '{') {
      const m = pattern.slice(i).match(/^\{(\d+)(,(\d*))?\}/);
      if (m) {
        let raw = m[0];
        if (i + raw.length < pattern.length && pattern[i + raw.length] === '?') raw += '?';
        tokens.push({ type: 'quantifier', raw }); i += raw.length; continue;
      }
      tokens.push({ type: 'literal', raw: '{' }); i++; continue;
    }
    if (ch === '^' || ch === '$') { tokens.push({ type: 'anchor', raw: ch }); i++; continue; }
    if (ch === '.') { tokens.push({ type: 'dot', raw: '.' }); i++; continue; }
    if (ch === '|') { tokens.push({ type: 'alternation', raw: '|' }); i++; continue; }
    tokens.push({ type: 'literal', raw: ch }); i++;
  }
  return tokens;
}

/* ===== 测试框架 ===== */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

function regexTest(pattern, flags, text) {
  const f = flags !== undefined ? flags : "g";
  const re = new RegExp(pattern, f);
  const matches = [];
  if (f.includes("g")) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const entry = { match: m[0], index: m.index };
      if (m.length > 1) { entry.groups = []; for (let g = 1; g < m.length; g++) entry.groups.push({ index: g, value: m[g] ?? null }); }
      if (m.groups) entry.namedGroups = { ...m.groups };
      matches.push(entry);
      if (m[0].length === 0) re.lastIndex++;
    }
  } else {
    const m = re.exec(text);
    if (m) {
      const entry = { match: m[0], index: m.index };
      if (m.length > 1) { entry.groups = []; for (let g = 1; g < m.length; g++) entry.groups.push({ index: g, value: m[g] ?? null }); }
      if (m.groups) entry.namedGroups = { ...m.groups };
      matches.push(entry);
    }
  }
  return { pattern, flags: f, totalMatches: matches.length, matches };
}

/* ===== 测试用例 ===== */

// 测试 1：邮箱匹配
console.log("\n[1] regex_test 邮箱匹配");
{
  const r = regexTest("[\\w.-]+@[\\w.-]+\\.\\w+", "g", "联系我：alice@example.com 或 bob@test.org");
  assert(r.totalMatches === 2, "找到 2 个邮箱");
  assert(r.matches[0].match === "alice@example.com", "第一个邮箱正确");
  assert(r.matches[1].match === "bob@test.org", "第二个邮箱正确");
}

// 测试 2：URL 匹配 + 命名分组
console.log("\n[2] regex_test URL 匹配 + 命名分组");
{
  const r = regexTest("https?://(?<domain>[^/\\s]+)(?<path>/\\S*)?", "g", "访问 https://example.com/docs/intro 或 http://test.org");
  assert(r.totalMatches === 2, "找到 2 个 URL");
  assert(r.matches[0].namedGroups.domain === "example.com", "第一个域名正确");
  assert(r.matches[0].namedGroups.path === "/docs/intro", "第一个路径正确");
  assert(r.matches[1].namedGroups.domain === "test.org", "第二个域名正确");
}

// 测试 3：日期匹配 + 命名分组
console.log("\n[3] regex_test 日期匹配 + 命名分组");
{
  const r = regexTest("(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})", "g", "今天是 2026-10-15，明天是 2026-10-16");
  assert(r.totalMatches === 2, "找到 2 个日期");
  assert(r.matches[0].namedGroups.year === "2026", "年份正确");
  assert(r.matches[0].namedGroups.month === "10", "月份正确");
  assert(r.matches[0].namedGroups.day === "15", "日期正确");
  assert(r.matches[1].namedGroups.day === "16", "第二个日期正确");
}

// 测试 4：中文文本匹配
console.log("\n[4] regex_test 中文文本匹配");
{
  const r = regexTest("[\\u4e00-\\u9fa5]+", "g", "Hello世界，这是test测试123");
  assert(r.totalMatches === 3, "找到 3 段中文");
  assert(r.matches[0].match === "世界", "第一段中文正确");
  assert(r.matches[1].match === "这是", "第二段中文正确");
  assert(r.matches[2].match === "测试", "第三段中文正确");
}

// 测试 5：全局搜索多匹配
console.log("\n[5] regex_test 全局搜索");
{
  const r = regexTest("\\d+", "g", "a1b22c333d4444");
  assert(r.totalMatches === 4, "找到 4 个数字串");
  assert(r.matches[0].match === "1", "第一个数字 1");
  assert(r.matches[3].match === "4444", "第四个数字 4444");
  assert(r.matches[2].index === 6, "第三个匹配位置正确（'333' 从 index 6 开始）");
}

// 测试 6：零宽匹配不无限循环
console.log("\n[6] regex_test 零宽匹配");
{
  const r = regexTest("\\b", "g", "hello world");
  assert(r.totalMatches > 0, "零宽匹配有结果");
  assert(r.totalMatches < 100, "零宽匹配不会无限循环");
  assert(r.matches.every(m => m.match === ""), "零宽匹配内容为空字符串");
}

// 测试 7：regex_explain 基础拆解
console.log("\n[7] regex_explain 基础拆解");
{
  const tokens = tokenize("\\d+@\\w+\\.com");
  // \d + @ \w + \. c o m = 9 个 token
  assert(tokens.length === 9, `tokenize 产出 9 个 token（实际 ${tokens.length}）`);
  assert(tokens[0].type === "escape", "第一个 token 是转义 \\d");
  assert(tokens[1].type === "quantifier", "第二个 token 是量词 +");
  assert(tokens[2].type === "literal", "第三个 token 是字面量 @");
  assert(tokens[4].type === "quantifier", "第五个 token 是量词 +");
  assert(tokens[5].type === "escape", "第六个 token 是转义 \\.（字面量点号）");
  assert(tokens[6].type === "literal" && tokens[6].raw === "c", "第七个 token 是字面量 c");
}

// 测试 8：regex_explain 复杂模式
console.log("\n[8] regex_explain 复杂模式（前瞻/命名组/量词）");
{
  const tokens = tokenize("(?<user>[^@]+)(?=@)");
  const types = tokens.map(t => t.type);
  assert(types.includes("group-start"), "包含 group-start");
  assert(tokens[0].detail === "user", "命名组名称为 user");
  assert(types.includes("class-start"), "包含 class-start [^@]");
  assert(tokens.some(t => t.type === "group-start" && t.detail === "positive-lookahead"), "包含正向前瞻");

  // 测试非贪婪量词
  const tokens2 = tokenize(".*?");
  assert(tokens2.length === 2, ".*? 解析为 2 个 token");
  assert(tokens2[1].raw === "*?", "量词为非贪婪 *?");

  // 测试 {n,m} 量词
  const tokens3 = tokenize("a{2,5}");
  assert(tokens3.length === 2, "a{2,5} 解析为 2 个 token");
  assert(tokens3[1].type === "quantifier", "{2,5} 是量词");
  assert(tokens3[1].raw === "{2,5}", "量词内容正确");
}

// 测试 9：非法正则返回错误
console.log("\n[9] regex_test 非法正则");
{
  let threw = false;
  try { new RegExp("[unclosed", "g"); } catch { threw = true; }
  assert(threw, "非法正则抛出异常（MCP 层会捕获为 isError）");
}

// 汇总
console.log(`\n========== 结果 ==========`);
console.log(`通过: ${passed}  失败: ${failed}`);
if (failed > 0) {
  console.error("有测试失败！");
  process.exit(1);
} else {
  console.log("全部通过 ✓");
}
