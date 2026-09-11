# 发布文案：headroom for the DeepSeek Harness

> 这份文件是给发布者用的，不是给使用者用的。它包含仓库标题、简介、
> 一段可以直接作为 Release / 公告 / 帖子正文的文本，以及发布前必须
> 确认的授权与出处清单。随手贴出去之前请先读最后一节。

---

## 建议的仓库元信息

**仓库名**

```
dsh-plugin-headroom
```

**Description（GitHub 仓库简介，约 150 字符）**

```
DeepSeek Harness 的上下文压缩插件：按结构压缩冗长的工具输出，原文凭 token 逐字节取回。实测 6 组测试对话、17 个负载，token 减少 79.5%。独立实现，非上游移植。可能不常维护。
```

**Topics**

```
deepseek-harness  dsh-plugin  context-engineering  context-compression
token-budget  ai-agent  llm  mcp-alternative
```

**License**

```
Apache-2.0
```

---

## 正文（可直接发布）

### 标题

**headroom for the DeepSeek Harness：把工具输出压到 1/5，原文随时取回**

### 一段话

这是给 DeepSeek Harness（DSH）写的上下文压缩插件。
它把冗长的工具输出——构建日志、分页 JSON、大 diff、目录清单、测试输出——按结构压成
保留骨架的形式再让模型读，被压掉的部分凭一个 token 随时逐字节取回。实测 6 组测试对话、
17 个负载、911,782 字符，**token 减少 79.5%**，17/17 逐字节往返成功。

### 先说清楚：这个项目大概不会被经常维护

这不是免责套话，是使用前应该知道的事实。

我是一个人用 AI 编码助手（DeepSeek Harness 里的 agent）把这个插件写出来的。发布它，
是因为它在一台真实机器上确实能用、测量方法可复现、过程中挖出的两个真 bug 值得记录——
**不是因为我打算长期经营它**。

请这样预期：

| 事项 | 实际情况 |
| --- | --- |
| Issue / PR | 可能很久没人看，也可能永远不看 |
| 响应时间承诺 | 没有 |
| Roadmap / 发布节奏 | 没有 |
| 验证过的环境 | Windows + 一个固定版本的 DSH，就这一个 |
| 其他平台 / 其他 harness 版本 | 未测试 |
| 代码来源 | 绝大部分由 AI 生成，经人工审阅与逐轮修正 |

**如果你要的是长期可用的东西，请用上游的 [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom)。**
它有 6.8 万 star、有维护者、覆盖 Python 库 / 代理 / MCP 三种形态。本插件只在很窄的场景里
才有理由存在：**你在用 DSH，而且不想或不能跑 Python 或 MCP 服务。**

它坏了而你不想等——**fork 它**比等更新现实得多。

### 关于"由 AI 生成"，值得说的不只是"是 AI 写的"

代码确实主要由 AI 生成。但更值得说的是**它失败的方式**，因为这决定了这个仓库里什么
值得信任。

引擎里前后出现过好几个真 bug：内容处理器错了四次（每一次都是"压缩率看起来不错但结果
没用"）、标记里放了一个指向不存在内容的 token、短键别名把 JSON 花括号一起吃掉，
以及后两轮测出来的这些：

1. **嵌套因子化把内层区域写成了转义字符串。** 语法合法、往返无损，所以一直没被发现——
   但那个区域的值从此不再被遍历，既不生成标记也不掩码，还多付了转义的代价。
2. **键表图例是裸文本而不是标记。** 它被追加在 JSON 收尾花括号之后，于是文档不再可解析，
   而且成了整个负载里唯一没有标记的省略——模型无法把它和"幸存下来的内容"区分开。
3. **空 query 会把整份原文倒进上下文。** `args.query.trim() === ''` 把 `""`、`" "` 和
   "没给 query" 折叠成同一个分支：调用方要 0 个片段，却收到了整份原文——最贵的一种回答。
4. **`limit: 0` 被静默改成默认的 20。** 守卫写成 `args.limit > 0 ? ... : 20`，
   于是"要 0 个"变成"给你 20 个"。
5. **匹配语义不可见。** 检索同时做字面匹配和词语相关匹配，两者结果混在 `matched` 里，
   调用方无法分辨；现在每段带 `match` 字段，另有 `literalMatches` 计数。

3 和 4 是同一个形状——**把"没给"和"给了但是空"当成同一件事**，这是参数校验最常犯的错。
而它们全是被**模糊测试**找出来的，不是被读代码找出来的。所以本仓库里测试和基准的份量
刻意偏重，而且：

- `bench/` 下的东西驱动的是**已安装的那份产物**，不是源码；
- 每个负载都**逐字节往返验证**，失败就整个跑挂；
- **不允许只报百分比而不报保留率**——一个丢掉了大部分记录的小负载不是进步，是删除；
- 两个 fuzzer（`bench/fuzz-engine.mjs`、`bench/fuzz-retrieve.mjs`）用固定种子，
  并且**打印覆盖率矩阵**：第一版 fuzzer 因为 PRNG 太弱，报告"零违规"时其实只碰了
  10 个生成器里的 2 个。这正是"干净的结果看起来像证据"的陷阱，现在会显式提示
  `NOT EXERCISED`。

一句话：**这个仓库里的测量代码比被测代码更值得信任**，这是刻意的安排。

### 它做什么

模型只看到一个工具 `headroom`，四个动作：

```jsonc
{ "action": "compress", "path": "logs/build.log", "ratio": "balanced" }
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8" }
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8", "query": "connection reset" }
{ "action": "stats" }
```

**用 `path`，别用 `content`——这是这个工具最大的一处关键点。** 文件用 `path` 时原文从不进入
上下文，只有压缩后的文本进去；而"先读文件、再把内容传给 `content`"会把原文和压缩副本**各留一份**，
实测比 `path` 贵 **5 倍**，甚至比"干脆不压缩、只读一遍"还贵 25%：

| 负载 | `path` 模式 | 先读再传 | 倍数 |
| --- | --- | --- | --- |
| 4 KB | 283 token | 1,129 token | 4.0× |
| 40 KB | 2,154 token | 10,585 token | 4.9× |
| 400 KB | 21,304 token | 106,035 token | **5.0×** |

原因是：**压缩这个动作本身不省 token，"不读原文"才省。** 模型很容易先读文件再决定压缩——那是
自然的顺序，也是错的顺序，所以工具说明里现在直接写了这一句。

**光写说明不够，所以有一半是强制的**：模式由**参数**决定（`path` 或 `content`，不做内容嗅探），
而 `content` 超过 **20,000 字符**会被**直接拒绝**并告知改用 `path`；2,000–20,000 字符之间正常
压缩、但在 `note` 里报告本可省下多少。两个阈值可配（`contentStoreLimitChars` /
`contentHintMinChars`）。

为什么不做成"全自动猜"：工具不知道那段文本从哪来，而且即使认出"这内容和某个文件一样"也已经
晚了——副本已经在上下文里，撤不回来。猜错还更贵：把 `content` 当文件处理，要么去找一个可能不
存在的文件，要么**假装存了其实没存**，后者会让模型以为能 `retrieve`、实际取不到。
**自动化的边界是"拒绝不该做的事"，不是"猜测你想做什么"。**

`retrieve` 带 `query` 时会返回两类片段：**字面命中**（文本里真的有这段）和**词语相关**（共享词但
没命中）。后者是刻意的——它让 `connection reset` 能找到 `ECONNRESET by peer`；每段都带
`match` 字段，结果里另有 `literalMatches` 计数，需要精确字符串时用它。正则元字符按字面处理。

各内容类型保留什么：

| 类型 | 保留 | 压掉 |
| --- | --- | --- |
| JSON | 全部键（同形记录只写一次）、结构、布尔/null、短字符串、数字、标识符 | 长字符串值、长数组尾部、重复键表 |
| JSONL（每行一个对象） | 全部键（写一次）、每一条记录 | 重复的键；值原样保留，不做掩码 |
| 代码 | import、签名、类/类型定义、装饰器 | 函数体、方法体（含 Python 等靠缩进的块） |
| 日志 | 全部 FATAL/ERROR 永不抽样、其余级别按量抽样、栈回溯 | 重复心跳行、连续相同的错误行折叠成模板 |
| diff | 文件头、hunk 头、每个 hunk 前几行改动 | 大段增删正文 |
| 文本 | 段落开头与结尾 | 段落中段填充 |

### 三条硬性不变量

1. **无损是绝对的。** 从可见文本里删掉的内容，一定逐字节存在于凭据对应的存储中；
   否则根本不会删。
2. **不做亏本压缩。** 任何替换只在比它替代的内容更便宜时才生效；省不下至少 12% token
   就原样返回，`savedTokens` 为 0 并说明原因。
3. **检索失败是诚实的。** token 过期或不存在时明确报错，绝不返回替身内容。

### 实测数据

用两个独立估算器交叉验证（`own` 是引擎自己的，`meter` 是 harness 给消息计价用的那个），
驱动**已安装**的插件：

```
911,782 字符 -> 186,642 字符          (-79.5%)
228,020 meter token -> 46,732         (79.5%)
own 估算器                             76.2%
两把尺子之差                            3.3 个百分点
平均单次压缩                            7-8 ms
逐字节往返                             17 / 17
```

逐对话：构建失败排查 95.4%、规范阅读 81.6%、仓库 onboarding 82.6%、重构 81.1%、
API 导入 68.7%、E2E flaky 67.7%。

逐类型：text 98.3% > log 96.7% > diff 89.4% > lines 89.2% > code 85.0% > json 65.6%。

**每个比例都配保留率**，因为一个丢掉了记录的小负载不是进步。json 不按文本计而按结构计：
解出标记后解析两边，比对记录条数与每条记录的键集合——`workspaces-page-1.json` 140/140、
`metrics-dump.json` 180/180、`conformance-vectors.json` 80/80，一条不少。

### 安装

```bash
node install.mjs          # 识别路径 → 复制插件 → 询问是否写入 patch 行 → 自动跑一轮测试
node install.mjs --yes    # 无人值守
node verify.mjs           # 单独验证已安装的那份
```

装完后会**在子进程里自动跑一遍测试**（引擎 111 项、工具契约 75 项、host plane 29 项、
冒烟测试 1 组），任何一项失败安装即以非零码退出。路径不需要预先配置：四层识别与覆盖机制
（命令行 / 环境变量 / `dsh-paths.json` / 自动探测）见仓库 README 的"路径识别与手动覆盖"一节。

需要重启 harness，然后在新会话的工具列表里应能看到 `headroom`。无需 Python、无需 MCP
子进程、无需出网。

### 已知限制

- **存储是进程内的**，harness 重启后 token 失效。
- **`ratio` 只对超大负载生效**（压缩结果超过 120,000 字符时才用来决定是否截断）。
  普通负载上三档输出完全一致——实测过，不是猜的。
- **`path` 模式上限 64 MB**，超过会明确报错并建议切一段用 `content`。
- **无 ML 阶段**，所以"语义冗余但结构不冗余"的内容压缩有限。
- **不要为它建 agent preset**，注册会重名失败，常开安装已取代。
- **工具定义本身占约 1,672 token/请求**（description 227 + parameters 464 + output schema 981，
  实测值，`bench/probe-context-cost.mjs`）。压不压缩都要付。批量 `items` 数组曾被评估后否掉：
  它给每个请求加约 78 token，而真正的杠杆是 `path` 模式，不是调用次数。
- **派遣已优化**：检测到的处理器一旦过 12% 下限就直接采用，其余五个不再运行
  （实测 106 → 73 µs/KB，合计快 31%）。这由差分验证保证"什么都没变"——
  同一份代码走 `fullScan: true` 的未优化顺序，430 个负载 × 7 种配置逐字段比对，零差异。

---

## 发布前必须确认的授权与出处事项

这一节是给自己看的清单，**建议逐条核对后再公开**。

### 1. 许可证已从 MIT 改为 Apache-2.0 —— 这是必须的修正

上游 `headroomlabs-ai/headroom` 的许可证是 **Apache-2.0**（Copyright 2025 Headroom
Contributors），**不是 MIT**。本项目此前的 `package.json` 与 README 都写着 MIT，那是错的，
已经改掉：

- `LICENSE` 放 Apache-2.0 全文；
- `NOTICE` 写明取了什么、没取什么、以及独立性声明；
- `package.json` 的 `license` 字段改为 `Apache-2.0`；
- `index.js` 与 `lib/engine.js` 的头部加了 SPDX 标识与出处说明；
- README 的"授权与出处"一节重写。

即便本实现没有复制上游任何一行代码（Python → JavaScript 之间不存在代码继承，取用的是
思路与接口词汇），**按与上游同级的许可证分发也是最稳妥的选择**：既然声明"技术源自上游"，
就不该在一个比上游更宽松的许可下发布。

### 2. 已删除的第三方内容（重要）

`corpus/build-corpus.mjs` 的早期版本内嵌了一份**从 `node_modules` 抄出来的真实包 README**
（`@deepseek-ai/dsh-mcp-client` 的文档），那是他人的受版权保护文档，**已在发布前删除**。
核对过：与 DSH 包文档逐行比对，当时有 27 行、约 836 字符是逐字复制。

现在 `corpus/` 与 `bench/conversations/` 下的**所有负载都是合成的**，由目录内脚本确定性
生成，不含任何第三方文档、会话记录或专有文件。`build-corpus.mjs` 顶部加了明确警告，
**不要重新引入真实负载**。

### 3. 已删除的个人信息

`bench/session-savings.mjs` 里曾硬编码了一条个人绝对路径：

```
C:\Users\<用户名>\AppData\Local\Temp\dsh-spill-XXXX\session-XXXX
```

已改为从 `--spill <dir>` 或环境变量 `HEADROOM_SPILL_DIR` 读取，无默认值。发布前建议再
全文搜一遍 `C:\Users`、`AppData`、用户名、以及任何内网主机名。

### 4. 商标与独立性

- "headroom" 在本项目中是**描述性使用**，指它所实现的那套技术，不是在主张上游的品牌。
- 已在 NOTICE 与 README 中写明：**本项目与 headroom 项目、headroomlabs-ai、DeepSeek
  均无隶属、赞助或背书关系。**
- Apache-2.0 第 6 条明确不授予商标使用权，这一点已在文档中引用。
- 不要把本项目说成"官方"、"移植版"或"DeepSeek 出品"。早期 README 用过"原生移植"
  的说法，已改为"独立实现"——前者容易被读成代码层面的移植。

### 5. 运行时依赖与 DSH 内部引用

- 插件本身运行在 DSH 进程内，但**不 import 任何 `@deepseek-ai/*` 代码**，只用 harness
  暴露的 `tools` 注册表与 `fs` 服务接口。
- 仅 `bench/` 引用 `@deepseek-ai/dsh-token-meter`（双估算交叉验证），
  `test/tool-contract.test.mjs` 引用 `@deepseek-ai/dsh-tools`（用 harness 自己的校验器）。
- **发布前请确认**：这些引用不附带其源码，也没有把 DSH 的内部实现细节写进文档。
  如果对再分发条款有疑虑，最保守的做法是**不把 `test/` 与 `bench/` 一起发布**，
  或把它们放到单独的分支。这一步需要你自己判断，我没有替你决定。

### 6. 路径已全部改为识别（原为"硬编码"警告，现已解决）

**历史问题**：早期版本在 7 个文件里写死了本机 DSH 绝对路径，别人 clone 下来跑测试大概率直接失败。

**现状：已全部消除。** 所有位置由 `dsh-paths.mjs` 解析，四层覆盖、优先级从高到低：

| 层 | 用法 |
| --- | --- |
| 命令行 | `--dsh-home <path>`、`--profile <name>`、`--runtime-root <path>` |
| 环境变量 | `DSH_HOME`、`HEADROOM_PROFILE`、`HEADROOM_RUNTIME_ROOT`、`HEADROOM_PACKAGE_DIR`、`HEADROOM_PROFILE_DIR`、`HEADROOM_METER_ENTRY`、`HEADROOM_TOOLS_ENTRY` |
| 覆盖文件 | `dsh-paths.json`（模块旁）或 `package.json` 的 `dshPaths` 字段 |
| 自动识别 | 从模块位置、node 可执行文件、已知安装位置推导 |

剩余唯一一处绝对路径字面量在**解析器自己的最后兜底探测列表**里
（`['D:/dsh/runtime/dsh', 'C:/dsh/runtime/dsh', '/opt/dsh/runtime/dsh']`），那是一个
"先向上找、找不到再试这几个常见位置"的探测，不是假设。这是刻意的，写在了它的注释里。

**发布前建议自己验一遍**（一条命令即可）：

```bash
node install.mjs --print-paths        # 应显示每个值的来源，且 DSH_HOME 来自 env 或 auto
node install.mjs --dsh-home /nonexistent --print-paths   # 应显示 absent 而不是崩溃
```

第二行的意义是：识别失败时应当**说清楚哪里失败、试过哪些层、怎么覆盖**，而不是抛一个
从 `readFileSync` 深处冒出来的栈。这一点已在四种覆盖层上分别实测过。

### 8. 仓库该放什么

建议**公开**：

```
index.js, lib/, dsh-paths.mjs
install.mjs, smoke-installed.mjs
bench/, corpus/, tools/
test/
README.md, README.txt, USAGE.md, USAGE.txt, CHANGELOG.md, CHANGELOG.txt,
PUBLISHING.md, LICENSE, NOTICE, package.json
```
`headroom-package/`（独立安装包）是插件与安装脚本的副本，可以一起放，但要注意**同步**——
两份 `engine.js` 曾经漂移过。现在有 `install.mjs --dry-run` 和文件哈希可以核对，
两边的 `install.mjs` 也都会在装完后自动复验。

### 9. 文案语气

这份文案刻意反复强调"可能不常维护"和"由 AI 生成"。如果你想弱化这两点，可以，但建议
**至少保留一处明确说明**：使用者据此决定要不要依赖它，这比事后来一句"仅供参考"诚实，
也更省事。

---

## 短版（如果只发一条动态 / 一句话）

> 给 DeepSeek Harness 写了个上下文压缩插件：把工具输出按结构压到 1/5，原文凭 token
> 逐字节取回。6 组测试对话实测 token 减少 79.5%，17/17 往返无损。
>
> 说清楚：**一个人用 AI 写的，不保证经常维护**，只在一个 Windows + 固定 DSH 版本上验证过。
> 技术思路来自 Apache-2.0 的 headroomlabs-ai/headroom（独立实现，非代码移植）。
> 要长期可用的东西请用上游。
