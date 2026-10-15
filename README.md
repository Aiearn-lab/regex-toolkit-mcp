# regex-toolkit-mcp · 正则表达式测试 & 解释工具

> 知微工作室 · Zhiwei Studio｜2026-10-15｜v1.0.0｜Node 18+，MIT

一个轻量 MCP server，让你的 AI agent 能直接在对话里 **测试正则表达式** 和 **把正则翻译成人话**。零第三方依赖（仅 MCP SDK），完整支持中文 / Unicode 文本匹配。

## 安装

```bash
cd regex-toolkit-mcp
npm install
```

验证安装：

```bash
node --check index.js
```

运行自测：

```bash
node test.js
```

## 接入（MCP 客户端配置）

在你的 MCP 客户端配置文件里添加：

```json
{
  "mcpServers": {
    "regex-toolkit": {
      "command": "node",
      "args": ["/你的绝对路径/regex-toolkit-mcp/index.js"]
    }
  }
}
```

> Windows 用户注意：路径用反斜杠或正斜杠均可。

完整配置示例见 `config.example.json`。

## 两个工具

### `regex_test`

用正则表达式测试文本，返回所有匹配结果。

**参数：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `pattern` | `string` | 是 | 正则表达式（不含两侧斜杠），例如 `(?<user>[^@]+)@(?<domain>.+)` |
| `flags` | `string` | 否 | 正则标志，如 `"g"`（全局）`"i"`（忽略大小写）`"m"`（多行）。默认 `"g"` |
| `text` | `string` | 是 | 要测试的文本 |

**返回：**
- `totalMatches`：匹配总数
- `matches[]`：每项含 `match`（匹配内容）、`index`（位置）、`groups`（捕获组）、`namedGroups`（命名分组）

**调用示例（对 agent 说）：**

> 用正则 `(?<user>[^@]+)@(?<domain>[\w.]+)` 测试这段文本：`联系 alice@example.com 或 bob@test.org`

### `regex_explain`

把一条正则表达式翻译成人话，逐段解释每个部分的作用。

**参数：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `pattern` | `string` | 是 | 正则表达式（不含两侧斜杠） |
| `flags` | `string` | 否 | 正则标志，如 `"gi"` |

**返回：**
- `steps[]`：逐 token 拆解，每项含 `syntax`（原始语法）、`type`（类型）、`explanation`（中文解释）
- `summary`：整体摘要
- `flagExplanation`：标志说明

**调用示例（对 agent 说）：**

> 帮我解释一下这条正则：`^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$`

## 使用场景

| 场景 | 工具 | 示例 |
|------|------|------|
| 验证邮箱 / URL / 手机号格式 | `regex_test` | 输入正则 + 测试文本，看是否匹配 |
| 看不懂别人写的正则 | `regex_explain` | 逐段翻译成人话 |
| 调试正则为什么匹配不上 | 两个配合用 | 先用 explain 理解，再用 test 验证 |
| 提取文本中的结构化信息 | `regex_test` | 用命名分组提取年/月/日、用户名/域名等 |

## 安全设计

- **零凭证**：本工具不存储、不硬编码、不传输任何密钥 / 令牌
- **纯本地运算**：所有匹配在本地完成，不发送任何网络请求
- **无副作用**：不写文件、不执行命令、不访问外部服务

## 定制 / 代搭

需要更多文本处理工具或其他 MCP server 定制？

联系 `cqsj6667@agent.qq.com`｜验收标准先写清 · 不达标不收尾款 · 做完不失联
