# headroom for the DeepSeek Harness

上下文压缩（context engineering）：把冗长的工具输出压成保留骨架的形式再读，原始内容凭 token 随时取回。

本插件**独立实现**了开源项目 [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) 发表的上下文压缩技术。上游用 Python 实现并通过 MCP 暴露 `headroom_compress` / `headroom_retrieve` / `headroom_stats` 三个工具；这里把同样的技术写成 DSH host 插件。**没有复制或翻译上游任何源码**——共用的是思路与接口词汇，不是代码。详见 [NOTICE](NOTICE)。

**常开安装**：`headroom` 工具在**每个会话**里都可用，无论用哪个 agent preset。

---

## 先跑这个：安装

**在仓库根目录（`headroom/`）执行，不是 `headroom-package/`：**

```bash
node install.mjs --dry-run     # 1. 先看它会改什么，这一步不写盘
node install.mjs               # 2. 确认无误后真正安装（复制 + 自动测试）
```

`headroom-package/` 里的 `install.mjs` 是**给下载包用的**，它从自己的
`plugin/` 取源文件；在仓库里请用仓库根目录那一份。两者做同一件事。

装完会看到**安装后自动测试**的结果，4 个套件都 `ok` 才算成功：

```
  ok      smoke-installed.mjs             111ms   stats: 3 compressions, 6 retrievals, ...
  ok      test/engine.test.mjs           1064ms   145 passed, 0 failed
  ok      test/tool-contract.test.mjs     118ms   111 passed, 0 failed
  ok      test/verify-host.mjs            100ms   29 passed, 0 failed

4 suite(s) passed. The installed copy at ...
```

**安装脚本会做四件事**：识别路径（CLI → 环境变量 → `dsh-paths.json` → 自动探测）→
把 `index.js` / `lib/engine.js` / `dsh-paths.mjs` / `package.json` 复制进安装目录 →
**在子进程里**跑安装后测试（必须是子进程，否则测的是仓库而不是安装产物）→ 报告结果。
它**不会**联网，也**不会**碰 `cordis.patch.yml`，除非你显式传 `--enable-host`。

**装完需要重启 harness** 才保证插件行被加载。要确认装到哪、有没有装好，看下面
「安装状态」一节；每个参数的完整说明在「开发与测试」那张命令表里。

也可以走 npm 脚本（等价）：`npm run install:dry` 先试跑，`npm run install-plugin` 正式装。

---

## 先说清楚：这个项目可能不会经常维护

这是**一个人用 AI 编码助手写出来的插件**，不是有人值班的产品。发布它是因为它在一台真实机器上确实能用、测量方法可复现、过程中发现的两个 bug 也值得记录——不是因为打算长期经营它。

请这样预期：

- **Issue 和 PR 可能很久没人看，也可能永远不看。** 没有响应时间承诺，没有 roadmap，没有发布节奏。
- **代码主要由 AI 生成**（见下文"代码是怎么写出来的"）。它能通过本仓库自带的 285 项断言，但"通过了自带测试"和"在别人机器上、别人的 harness 版本上也对"是两件事。
- **只在这一个部署上验证过**：Windows + 固定版本的 DSH。其他平台、其他 harness 版本没有测过。
- **想要长期可用的东西，请用上游的 [headroom](https://github.com/headroomlabs-ai/headroom)**：它有 68k star、有维护者、覆盖 Python/库/代理/MCP 四种形态。本插件只在"你在用 DSH，且不想或不能跑 Python/MCP"这个很窄的场景里才有理由存在。

如果它坏了而你不想等，**fork 它**比等更新现实得多。

### 代码是怎么写出来的

- 引擎、插件外壳、测试、基准、这份文档，**绝大部分由 AI 编码助手（DeepSeek Harness 里的 agent）生成**，经人工审阅、逐轮修正。
- 值得说明的是它的失败方式：引擎里的几个真 bug（内容处理器前后错了四次、标记指向不存在的 token、别名吃掉花括号、以及本文件记录的两个）都是**AI 写出来的**，而发现它们靠的是把它当文档读——解析输出、比对结构、量记录条数——而不是读代码。
- 因此本仓库里测试和基准的份量刻意偏重。**测量代码比被测代码更值得信任**，这是刻意的安排：`bench/` 下的东西驱动的是**已安装的那份产物**，逐字节往返验证，并且不允许只报百分比而不报保留率。

## 为什么是原生插件，而不是安装 MCP 服务器

1. **装不上。** headroom 是 Python 包（`headroom-ai`），而本机 host 进程出网被禁（PyPI、npm、GitHub 全部超时），`pip install` 无法完成。
2. **值钱的是算法，不是进程边界。** 内容类型识别、结构掩码、可逆存储都不需要 Python。
3. **原生集成更好。** 没有每次调用的 IPC、没有需要常驻的子进程，并且直接复用 harness 的 `tools` 注册表和 `fs` 服务。

顺带说明：本 harness 本身**有** MCP 支持（`@deepseek-ai/dsh-mcp-client`，工具会以 `mcp__<server>__<tool>` 出现）。一旦网络可达，把 headroom MCP 作为一行配置接进来也是可行的——本插件不与之冲突。

## 安装状态

| 项目 | 路径 |
| --- | --- |
| profile patch 行 | `D:\dsh\home\profiles\web\cordis.patch.yml` |
| 已安装包 | `D:\dsh\home\profiles\node_modules\dsh-plugin-headroom\` |
| 源码（本目录） | `D:\deepseek harness\headroom\` |

安装位置不是随便选的：host row 用**裸包名**引用，解析器会从 profile 目录**逐级向上**找 `node_modules`。`<profiles>\node_modules` 正是这一步能到达的位置（`dsh-plugin-token-balance` 就装在那里，是有力的旁证）；而 `<profile>\node_modules` 在向上走的**路线上根本不会被查**，装在那里等于没装。这一点已用一个放在 profile 目录里的探针模块实测确认。

### 重启一次以确认

profile 的 patch 层配置了 `patchReload: live`，也就是热加载。首次加载某个插件未必能在当前进程里生效，**重启 dsh 是确定的做法**。判断依据很简单：新会话的工具列表里出现 `headroom` 即为成功。

## 用法

模型只看到一个工具 `headroom`，四个动作：

```jsonc
// 1. 压缩。给 content，或者给 path 直接读文件压缩（不先进上下文）
{ "action": "compress", "path": "logs/build.log", "ratio": "balanced" }
// 返回：compressed（压缩后的文本）、token（取回凭据）、savedTokens、savedPercent、kind
//       detected / confident：实际用的处理器，以及它是否与自动识别一致

// 2. 完整取回（无损）
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8" }

// 3. 只取相关片段，比整份原文更便宜
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8", "query": "connection reset" }
//    返回 results[]（每段带 match: "literal" | "related"）与 literalMatches 计数
//    缺省 query → 整份原文；给了但为空 → 0 个片段（不是整份原文）

// 4. 统计 / 丢弃条目
{ "action": "stats" }
{ "action": "forget", "token": "a1b2c3d4e5f6a7b8" }   // 省略 token 则清空
```

token 支持**唯一前缀**，不必记全 16 个字符。

### 期望的工作流

模型先压缩、**然后对返回的 `compressed` 文本推理**，需要细节时再 `retrieve`。压缩本身不省 token——省的是"让模型读精简版而不是全文"这件事。工具返回给模型的文本是这个形状：

```
<<<HEADROOM:BEGIN action="compress" kind="code" tokens=812->488 saved=324 (39.9%) token="6540e55e9d91c28f" >>>

def process_data(items: List[str]) -> Dict[str, int]:
<<hr:body:6540e55e9d91c28f:hidden=239:b2dac76e>>

<<<HEADROOM:END>>>
```

首尾标记让模型能从对话记录里原样取出负载，不必猜边界；标记里的 `hidden=` 与摘要哈希说明被替换内容的规模与标识。

## 各内容类型保留什么

| 类型 | 保留 | 压缩 |
| --- | --- | --- |
| JSON | 全部键、结构、布尔/null、短字符串、数字、UUID/哈希/路径等标识符 | 长字符串值、长数组尾部、超深子树 |
| 代码 | import、签名、类/类型定义、装饰器 | 函数体、方法体（含 Python 等靠缩进的块） |
| 日志 | **全部 FATAL/ERROR 永不抽样**、WARN/INFO/DEBUG 按级别抽样、栈回溯 | 重复心跳行、连续相同的错误行折叠成模板 |
| diff | 文件头、hunk 头、每个 hunk 前几行改动 | 大段增删正文 |
| 文本 | 段落开头与结尾 | 段落中段填充 |

实测压缩率（见 `test/engine.test.mjs`）：

| 类型 | 省下 |
| --- | --- |
| JSON（40 条对象的数组） | 93.8% |
| 日志（300 行） | 78.7% |
| diff | 80.8% |
| 文本 | 82.5% |
| Python 代码 | 39.6%（代码保留骨架，压缩率天然最低） |

## 实测压缩效率

`bench/compression-bench.mjs` 驱动**已安装的那份**插件，对五类真实形态的内容测量，并用两个独立估算器交叉验证：

- `own` — 引擎自己的估算器（标识符类 ASCII 按约 3 字符/token 计价，偏保守）
- `meter` — `@deepseek-ai/dsh-token-meter` 的 `estimateContent`，harness 给消息计价用的那个

| 内容 | 类型 | token（own） | 省下（own） | 省下（meter） | 记录保留 |
| --- | --- | --- | --- | --- | --- |
| 调试日志（400 行心跳 + 栈回溯） | log | 17641 → 1361 | 92.3% | 92.2% | — |
| 批量 JSON（120 条记录） | json | 16127 → 6866 | 57.4% | 65.0% | **100%** |
| TypeScript 源码（41 个方法） | code | 3994 → 1300 | 67.5% | 70.7% | — |
| git diff（两个 hunk） | diff | 3612 → 433 | 88.0% | 88.0% | **100%** |
| 长文档（30 节） | text | 6323 → 594 | 90.6% | 90.6% | — |
| **合计** | | **47697 → 10554** | **77.9%** | **79.8%** | |

两个估算器相差 1.9 个百分点，说明这些比例不是"只在本工具自己的尺子下成立"。

**这组数字是"安装版与源码一致"之后测出来的**，第五轮刚修好那条比对断言时它们还更好看
（78.7% / 80.8%）——那时的安装版是旧的，两个 fixture 的可见文本更小。同步之后数字下降了
**0.8 个百分点**，原因是两处**刻意的**保留：

- 「长文档」从 233 → 594 token：第五轮恢复了**标题骨架**（30 个节标题重新出现在可见文本里），
  省下从 96.3% 降到 90.6%。少省的 token 换来的是"这份文档有哪几节"这个信息不再丢失。
- 「TypeScript 源码」从 1254 → 1300 token：第五轮修好了**成员声明的保留**，
  类字段不再被当成局部变量藏进正文。

两处合计 **1491 个字符**，正是 30115 → 31606 的全部差额。**更小不等于更好**：
这两个数字是拿 0.8 个百分点的压缩率换"输出还能用"。

**"记录保留"是与 head/tail 切片器的分界线。** 结构化数据必须保住每一条记录，所以基准同时报告它、
并对 `json`/`diff` 断言必须为 100%。早先的版本在这栏会显示 3%：批量 JSON 只留 3 条记录换来
98.5% 的"省下"——数字更漂亮，内容已经没了。现在的数字是**保住全部 120 条**之后的成绩。

代码 67.5% 是**刻意**的：保留签名、类型定义和成员声明，只压缩方法体。

五个 fixture 全部逐字节往返验证。

## 测试对话压缩效率（6 组对话 × 17 个负载）

上面那组是按内容类型逐个测的。这一组测的是**一次会话整体**：`bench/conversations/generate.mjs`
确定性生成 6 组测试对话——每组带 2–3 个真实形状的负载（工具输出、文件读取、diff、清单、锁文件），
共 911,782 字符。`bench/conversations-bench.mjs` 把每个负载喂给已安装的插件。

| # | 测试对话 | 负载 | 内容 |
| --- | --- | --- | --- |
| 1 | CI 构建失败排查 | 3 | 900 行心跳 + 栈回溯的构建日志、vitest 输出、`package.json` |
| 2 | 分页 API 导入 | 3 | 140 条记录的分页响应、180 条序列的指标 dump、60 条错误报告 |
| 3 | 大 diff 重构 | 3 | 45 个方法的 TypeScript 模块、三 hunk 的 diff、210 行 grep 结果 |
| 4 | 仓库 onboarding | 3 | 422 行目录清单、34 节架构文档、90 个包的锁文件 |
| 5 | E2E flaky 排查 | 3 | Playwright 运行输出、110 条请求的 HAR、38 个用例的 spec |
| 6 | 长规范阅读 | 2 | 40 节协议规范、80 条一致性向量 |

| 指标 | 数值 |
| --- | --- |
| 输入 → 可见字符 | 911,782 → 191,811（**-79.0%**） |
| token（meter） | 228,020 → 48,025 |
| **压缩效率（meter）** | **78.9%** |
| **压缩效率（own）** | **75.6%** |
| 两把尺子之差 | 3.3 个百分点 |
| 平均单次压缩耗时 | 7–8 ms（170 万字符/秒量级） |
| 逐字节往返 | 17/17 通过 |

> 这组数字随安装版同步而更新：同步前（安装版仍是旧引擎）是 79.5% / 76.2%。
> 差 **0.6 个百分点**来自第五轮两处刻意的保留——标题骨架与成员声明可见，
> 也就是**用少量压缩率换"压缩后的文本还能用"**。变化原因与上面五类内容基准相同。

逐对话与逐类型的完整表格、以及每个负载的明细，见
[`bench/conversations/RESULTS.md`](bench/conversations/RESULTS.md)。

| 对话 | 负载 | 压缩效率（meter） |
| --- | --- | --- |
| `conv-01-build-failure` | 3 | 95.4% |
| `conv-02-api-pagination` | 3 | 68.7% |
| `conv-03-refactor` | 3 | 81.1% |
| `conv-04-onboarding` | 3 | 82.6% |
| `conv-05-flaky-e2e` | 3 | 67.7% |
| `conv-06-spec-reading` | 2 | 81.6% |

| 内容类型 | 负载 | 压缩效率（meter） | 标识符保留（occ / uniq） |
| --- | --- | --- | --- |
| text | 2 | 98.3% | 100% / 100% |
| log | 1 | 96.7% | 3% / 100% |
| diff | 1 | 89.4% | 100% / 100% |
| lines | 4 | 89.2% | 7% / 28% |
| code | 2 | 85.0% | 100% / 100% |
| json | 7 | 65.6% | 80% / 94% |

**保留率这栏要按类型读，这也是它分两列的原因。** `occ` 按出现次数计，`uniq` 按去重后的标识符计：

- `text` / `code` / `diff` / `log`：**每个不同的标识符都还在**（uniq 100%）。日志的 `occ` 只有 3%，
  是因为心跳行本身被采样了——但所有 FATAL/ERROR（永不抽样）、栈回溯、以及每个不同的事件都留着；
  WARN 及以下按级别抽样。
- `lines`（目录清单、grep 结果、测试输出）**按设计丢整行**：保留首尾与等距抽样，所以出现次数必然下降。
  断言因此只要求"每个区间都还有标识符"+"省略处有标记"+"transforms 里有说明"。
- `json` 的 94% uniq 不是缺陷：同形记录被因子化成"键表写一次 + 值按位置排列"，
  文本里的 `"route":` 消失了，但记录一条不少。

**json 因此不按文本计，而按结构计。** 基准解出标记后解析两边，比对记录条数与每条记录的键集合：

| 负载 | 记录 | 键集合 | 键表声明 |
| --- | --- | --- | --- |
| `workspaces-page-1.json` | 140/140 | 一致 | 12 个键 |
| `metrics-dump.json` | 180/180 | 一致 | 8 个键 |
| `spec/conformance-vectors.json` | 80/80 | 一致 | 4 个键 |
| `network-har.json` | 110/110 | 一致 | 5 个键 |
| `error-report.json` | 60/60 | 一致 | 6 个键 |

### `ratio` 是安全阀，不是旋钮

三档预设（`light` / `balanced` / `aggressive`）在这个语料上给出**完全一样**的输出：
`bench/ratio-sweep.mjs` 实测三档合计都是 79.5%，逐对话、逐类型也全部相同。

原因是处理器本身是确定性的，`targetRatio` 只在**压缩结果仍然超过 `MAX_VISIBLE_CHARS`（120,000 字符）**
时才被查一次，用来决定是否截断。用一个 934,903 字符、2600 条记录的负载就能看到差别：

| ratio | 可见字符 | 是否触顶 |
| --- | --- | --- |
| light | 205,462 | 否 |
| balanced | 205,462 | 否 |
| aggressive | 120,039 | **是** |

也就是说：**想少留内容，现在得靠 `kind` 和调用时机，`ratio` 只在超大负载上起作用。**

### 这一轮测试对话暴露并修掉的两个真 bug

两个都是"看起来在压缩、其实有内容没被压到"的类型，而且都**不影响无损往返**——原件始终在存储里
逐字节可查，所以只有把输出当文档读（解析它、看它的结构）才会暴露。

1. **嵌套因子化把内层区域写成了转义字符串。** `factorRecords` 在遍历还在进行时就序列化行，
   用的是 `JSON.stringify`——而 `walk` 对已经因子化的区域返回 `{__hrRaw: <json文本>}`。
   `JSON.stringify` 不认识这个哨兵，于是把它写成一个"内容是被转义的 JSON 的字符串"：

   ```
   {"events":{"__hrRaw":"[\"<<hr:schema:...>>\",[1,\"user/message\",...]]"}}
   ```

   语法合法（所以平坦形状的 parseable 断言一直通过），但**这个区域的值从此不再被遍历**：
   不生成标记、不再掩码，文本还多付了转义的代价。修法是在 `factorRecords` 里用同一个
   会原样输出哨兵的序列化器（`serializeWalks`），并且"收益比较"的两边都用它——否则带嵌套区域的
   行会显得比它替代的记录更贵，因子化会因为错误的理由被拒绝。

   实测影响：`spec/conformance-vectors.json` 36,353 → 17,421 token（66.5%）变成 → 15,799（69.6%）。

2. **键表图例是裸文本，不是标记。** 提升后的键表原本追加成 `K1 = id|name` 这样的裸行，
   落在 JSON 文档的收尾花括号**之后**。结果是两件事：文档不再是可解析的 JSON（尾随正文），
   而且整个负载里唯一没有标记的省略就是它——模型无法把它和"幸存下来的内容"区分开。
   现在它是标记：`<<hr:keys:hidden=2:10b58f0b:K1=accepted>>`，键表照样直接可读，
   但形态与其它省略一致。

两个 bug 都补了回归断言（`test/engine.test.mjs`）：嵌套因子化的 parseable、`__hrRaw` 不得出现在输出里、
图例必须是标记且不得留下裸行。`bench/probe-json-structure.mjs` 是独立的诊断探针，
对 9 个负载（含两个专门构造的回归形状）核对解析、记录数、键集合与哨兵泄漏。

## 这一轮对话的实测数据

`bench/session-savings.mjs` 把**本次会话真实拉进上下文的负载**跑一遍已安装的插件。
其中两个是 harness 因过大而落盘的工具结果（`dsh-spill`），属于逐字节原样：

| 负载 | 来源 | 类型 | meter token | 省下 |
| --- | --- | --- | --- | --- |
| grep 结果 | 本会话 spill（25,824 字符） | text | 6457 → 1485 | 77.0% |
| Service 目录 | 本会话 spill（64,446 字符） | json | 16115 → 5316 | 67.0% |
| 目录清单 | 会话中的真实形状 | lines | 3533 → 598 | 83.1% |
| 包锁文件 | 会话中的真实形状 | json | 9042 → 3480 | 61.5% |
| 包 README | 本会话逐字读过 | text | 774 → 158 | 79.6% |
| 测试输出 | 会话中的真实形状 | lines | 5323 → 708 | 86.7% |
| **合计** | 164,872 字符 | | **41244 → 11745** | **71.5%** |

六个负载全部逐字节往返成功，**没有一次失败**。

**必须说清楚**：这 29,499 个 token 是**追溯测量**，不是真实节省。插件是在本会话中途才装上的，
所以它从未参与过本次对话——在运行中的进程里查 `stats` 只会看到 0（我在一个独立进程里确认了这一点）。
这个数字回答的是"如果它从一开始就在，同样的负载会便宜多少"。

按量算：41,244 input token 的 71.5% 约合 ¥0.0044（¥0.15/M）到 ¥0.0088（¥0.30/M）。
**真正的价值不在这点钱，而在于一次工具调用少占 71.5% 的上下文**——那是能多塞几轮对话、
少触发几次 compaction 的余量。

## 三条硬性不变量

1. **无损是绝对的。** 从可见文本里删掉的内容，一定逐字节存在于凭据对应的存储中；否则根本不会删。
2. **不做亏本压缩。** 任何替换（标记、别名、键表）只在比它替代的内容更便宜时才生效；
   省不下至少 12% token 就原样返回，`savedTokens` 为 0 并说明原因。
3. **检索失败是诚实的。** token 过期（默认 60 分钟）或不存在时明确报错，绝不返回替身内容。

## 与上游的差异

| 上游 headroom | 本插件 |
| --- | --- |
| Magika ML 识别内容类型 | 结构化启发式识别（离线、可复现） |
| Kompress ML 压缩 | 确定性结构掩码 + 骨架保留 |
| MCP 服务器（子进程） | 原生 host 插件，单工具四动作（工具目录更省 token） |
| 代理层自动压缩全部流量 | 模型按需调用（不接管 HTTP 流量） |

## 文件

```
headroom/
├─ index.js                    # host 插件：注册 headroom 工具、四个动作、输出契约
├─ lib/engine.js               # 引擎：识别、掩码、处理器、可逆存储、检索
├─ dsh-paths.mjs               # 路径识别：四层覆盖，报告每个答案的来源
├─ install.mjs                 # 识别 → 复制 → 可选写入 patch 行 → 自动跑一轮测试
├─ smoke-installed.mjs         # 对已安装那份做端到端冒烟测试并打印压缩率
├─ corpus/                     # 合成负载（build-corpus.mjs 生成，不含第三方内容）
├─ tools/
│  ├─ md-to-text.mjs           # README.md → README.txt（CJK 宽度、折行、表格降级）
│  └─ check-txt.mjs            # 校验派生的 txt 没丢内容
├─ bench/
│  ├─ lib/measure.mjs          # 共用的测量：驱动已安装插件、双估算、结构比对
│  ├─ compression-bench.mjs    # 五类内容实测（双估算器 + 记录保留率）
│  ├─ conversations/           # 6 组测试对话（generate.mjs 生成，17 个负载）
│  │  ├─ generate.mjs          # 确定性生成器
│  │  ├─ index.json            # 对话/负载清单
│  │  └─ RESULTS.md            # 测试对话压缩效率报告（本文件的表格来源）
│  ├─ conversations-bench.mjs  # 测试对话实测（逐对话 + 逐类型 + 断言）
│  ├─ ratio-sweep.mjs          # 三档 ratio 对比，含"旋钮何时才有用"的实测
│  ├─ probe-json-structure.mjs # json 结构诊断探针（解析/记录数/键集合/哨兵泄漏）
│  ├─ probe-tool-edges.mjs     # 工具边界诊断（token 前缀、空内容、参数类型、淘汰）
│  ├─ probe-token-identity.mjs # token 身份诊断（去重/前缀歧义/畸形写入/ttl 边界）
│  ├─ probe-estimator.mjs      # 估计器性质诊断（单调性/有限性/整数/账目一致）
│  ├─ probe-bookkeeping.mjs    # stats / forget / render 诊断（27 项）
│  ├─ probe-json-edges.mjs     # JSON 结构边界诊断（34 项：记录数/键数/深度/数组尾）
│  ├─ probe-log-edges.mjs      # 日志保证诊断（26 项：错误不抽样/重复折叠/非日志误判）
│  ├─ probe-detection.mjs      # 内容识别诊断（28 项：形状/JSON 变体/花括号语言/JSONL）
│  ├─ probe-structure-loss.mjs # 检测 vs 实际处理器，以及结构足迹保留率（全语料）
│  ├─ probe-dispatch-cost.mjs  # 派遣成本实测（六处理器 vs 快路径）
│  ├─ probe-dispatch-diff.mjs  # 派遣差分验证（fullScan 对照，逐字段比对）
│  ├─ probe-context-cost.mjs   # path vs content 的上下文成本 + 工具定义固定开销
│  ├─ fuzz-engine.mjs          # 引擎差分模糊（10 生成器 × 不变量，可复现种子）
│  ├─ fuzz-retrieve.mjs        # 检索模糊（24 个刁钻 query × 6 个 limit）
│  ├─ corpus-bench.mjs         # 语料负载实测
│  └─ session-savings.mjs      # 会话负载的节省量（spill 目录由参数给出）
├─ USAGE.md                    # 使用指南（面向使用者：怎么用、出问题怎么判断）
├─ USAGE.txt                   # 同上，纯文本版
├─ CHANGELOG.md                # 更新日志（按版本倒序，面向遇到问题的人）
├─ CHANGELOG.txt               # 同上，纯文本版
└─ test/
   ├─ engine.test.mjs          # 引擎（127 项）
   ├─ tool-contract.test.mjs   # 工具契约，用 harness 自己的校验器（111 项）
   └─ verify-host.mjs          # 已安装 host plane 端到端（29 项）
```

## 路径识别与手动覆盖

仓库里**没有任何一处写死机器布局**。所有位置由 `dsh-paths.mjs` 解析一次，并且**报告每个答案
来自哪一层**——因为"我正在测的是哪一份副本"这个问题，一个没有出处的答案是没法核对的。

四层覆盖，优先级从高到低：

| 层 | 用法 | 说明 |
| --- | --- | --- |
| 1. 命令行 | `--dsh-home <path>`、`--profile <name>`、`--runtime-root <path>` | 最临时、优先级最高 |
| 2. 环境变量 | `DSH_HOME`、`HEADROOM_PROFILE`、`HEADROOM_RUNTIME_ROOT`、`HEADROOM_PACKAGE_DIR`、`HEADROOM_PROFILE_DIR`、`HEADROOM_METER_ENTRY`、`HEADROOM_TOOLS_ENTRY` | 适合 CI 与多环境切换 |
| 3. 覆盖文件 | `dsh-paths.json`（本模块旁）或 `package.json` 的 `dshPaths` 字段 | **留给手动写入的空间**；相对路径按该文件所在目录解析 |
| 4. 自动识别 | 无 | 从本文件位置、node 可执行文件、已知安装位置推导 |

```bash
node install.mjs --print-paths        # 打印完整解析报告（含每个值的来源）
node install.mjs --print-paths --json # 机器可读
node install.mjs --write-paths        # 把探测结果写进 dsh-paths.json，作为手改起点
node install.mjs --profile staging    # 临时换 profile
```

`--write-paths` **只写 `profile` / `dshHome` / `runtimeRoot` 三个根**，其余位置都是从它们派生的：
把派生值也写死，等于用一份可能过期的快照覆盖掉本来还能算对的探测。

自动识别做的事情，值得说清楚，因为它决定报告可不可信：

- `RUNTIME_ROOT` 从本文件位置、node 可执行文件位置、`DSH_HOME` 一路向上找带
  `package.json` + `node_modules/@deepseek-ai` 的目录，再退回几个已知安装位置；
- `PACKAGE_PARENT` **复刻 harness 自己的向上 `node_modules` 查找**（从 profile 目录开始往上走，
  找第一个含目标包的 `node_modules`），所以它报告的位置就是 loader 真正会到达的位置——
  而不是"应该是哪里"。

### 覆盖文件的样子

```json
{
  "profile": "web",
  "dshHome": "D:/dsh/home",
  "runtimeRoot": "D:/dsh/runtime/dsh"
}
```

`dsh-paths.example.json` 就是这份模板，拷成 `dsh-paths.json` 即可。删掉某个键就退回探测——
**通常只写 `dshHome` 和 `runtimeRoot` 就够了**，其余位置都是从它们派生的，把派生值也写死，
等于用一份可能过期的快照覆盖掉本来还能算对的探测。

文件里的相对路径按文件所在目录解析，所以整个 checkout 可以搬走而不用改内容。
文件带 UTF-8 BOM 也能读——PowerShell 的 `Set-Content -Encoding utf8` 和不少 Windows 编辑器都会写 BOM，
而 `JSON.parse` 会直接拒绝它，于是手改过的文件会"看起来完全正确"却静默退回探测。这个坑踩过，现在容错。

万一某个派生位置在本机上确实是另一套（比如有人把 `node_modules` 拆到了别处），
也可以直接覆盖派生键：`profilesRoot`、`profileRoot`、`presetsRoot`、`packageParent`、
`installedRoot`、`meterEntry`、`toolsEntry`、`yamlEntry`。解析器不会因为它们存在就假设它们对，
但如果写错了，`--print-paths` 会立刻显示它落在哪一层、以及在不在盘上。

## 开发与测试

```bash
cd "D:\deepseek harness\headroom"
node test/engine.test.mjs              # 压缩率、无损往返、存储、检索
node test/tool-contract.test.mjs       # 注册契约 + 每个动作的规范值校验
node test/verify-host.mjs              # patch 层解析、解析路径、已装模块行为
node corpus/build-corpus.mjs           # 重新生成合成语料
node bench/compression-bench.mjs       # 五类内容实测（含记录保留率）
node bench/conversations/generate.mjs  # 生成 6 组测试对话
node bench/conversations-bench.mjs --markdown bench/conversations/RESULTS.md
node bench/ratio-sweep.mjs             # light/balanced/aggressive 对比
node bench/probe-json-structure.mjs    # json 结构诊断
node bench/probe-tool-edges.mjs        # 工具边界诊断（33 项）
node bench/probe-token-identity.mjs    # token 身份诊断（19 项）
node bench/probe-estimator.mjs         # 估计器性质诊断（14 项）
node bench/probe-bookkeeping.mjs       # stats / forget / render 诊断（27 项）
node bench/probe-json-edges.mjs        # JSON 结构边界诊断（34 项）
node bench/probe-log-edges.mjs         # 日志保证诊断（26 项）
node bench/probe-detection.mjs         # 内容识别诊断（28 项）
node bench/probe-code-edges.mjs        # 代码处理器成员识别诊断（26 项）
node bench/probe-newlines.mjs          # 换行与 Unicode 对抗诊断（864 次压缩调用）
node tools/probe-converter.mjs         # md→txt 转换器的保真诊断（14 项，改转换器后必跑）
node tools/check-txt.mjs README.md README.txt   # README.txt 与 README.md 是否一致
node tools/check-txt.mjs USAGE.md USAGE.txt     # USAGE.txt 与 USAGE.md 是否一致
node bench/probe-structure-loss.mjs    # 结构足迹保留率（全语料）
node bench/probe-dispatch-cost.mjs     # 派遣成本实测
node bench/probe-dispatch-diff.mjs     # 派遣差分验证（改派遣后必跑）
node bench/probe-context-cost.mjs      # path vs content 成本 + 固定开销
node bench/fuzz-engine.mjs             # 引擎差分模糊（默认 400，--count/--seed/--only）
node bench/fuzz-retrieve.mjs           # 检索模糊（--count）
node bench/corpus-bench.mjs            # 语料负载实测
node bench/session-savings.mjs         # 会话负载的节省量
node smoke-installed.mjs               # 按绝对路径加载已安装那份，跑压缩+取回
node install.mjs --dry-run             # 只报告会改什么，不写盘
node install.mjs                       # 识别 → 复制 → 自动测试（需要工作区外的写权限）
node install.mjs --enable-host         # 顺便追加 patch 行（已追加过则不会重复）
node install.mjs --no-test             # 只复制，跳过安装后测试
node install.mjs --print-paths         # 只看路径识别报告
```

### 安装后自动测试

`node install.mjs` 现在**默认在装完后跑一轮测试**，而且是在**子进程**里跑：

```
post-install test (child processes, against the installed copy)

  ok      smoke-installed.mjs              94ms   stats: 3 compressions, 6 retrievals, ...
  ok      test/engine.test.mjs             82ms   145 passed, 0 failed
  ok      test/tool-contract.test.mjs      88ms   111 passed, 0 failed
  ok      test/verify-host.mjs             87ms   29 passed, 0 failed
```

为什么必须是子进程：安装脚本自己已经 import 了自己的源码，任何在**本进程内**做的验证描述的
都是仓库，不是安装产物。子进程里每个套件都是按**绝对路径**加载已安装那份，或者通过解析器找到它。

某个套件因为**缺 harness 的包**（`dsh-tools` / `dsh-token-meter` / `js-yaml`）而跑不起来时，
报的是 `skip` 而不是 `FAILED`：那些包不属于本插件，它们缺失说明不了插件有问题。
但插件自己的断言失败一律是失败，并且会把最后十几行输出打出来。

**独立安装包**在同级的 `headroom-package/`，可整体拷走。它自带一份 `dsh-paths.mjs`，
所以**离开本仓库也能自行识别路径**：

```bash
node install.mjs                 # 识别路径 → 复制 → 询问是否写 patch 行 → 自动测试
node install.mjs --yes --no-test # 无人值守安装，跳过测试
node install.mjs --print-paths   # 只看它识别到了什么
node install.mjs --write-paths   # 把探测结果写成 dsh-paths.json，供手改
node verify.mjs                  # 单独验证已安装的那份
```

安装包里的 `smoke-installed.mjs` 会在三个位置里找 `dsh-paths.mjs`（同目录、`plugin/` 子目录、
上一级），所以它在源码仓库、安装根目录、`plugin/` 三种布局下都能工作——这正是"在一台从没有过
这个 checkout 的机器上就地复验安装产物"所要求的。

`smoke-installed.mjs` 故意用**绝对路径**加载已安装那份，而不是包名：本工作区的 `package.json`
与已安装包同名（`dsh-plugin-headroom`），在工作区内用包名解析会解析到自己，那样测的就不是安装产物了。

`tool-contract.test.mjs` 直接调用 `@deepseek-ai/dsh-tools` 导出的 `assertSupportedJsonSchema` 与
`validateJsonSchemaValue`，并把 `tools.register()` 的准入检查原样复刻一遍。初版插件正是因为缺了
`output { schema, render }` 而在挂载时被拒——现在这类问题在测试里就会暴露，不用等会话启动。

### 这一轮优化做了什么（以及修掉的两个真 bug）

1. **JSON 同形记录因子化** — 一个 API 页或锁文件把同一组键重复 N 次，而键比值还贵。
   现在键写一次（写进 schema 标记里，可见），值按位置排列。
2. **键表提升** — 同一组键在文档里重复出现时，写一次 `K1 = <键表>`，其余用别名引用。
3. **行前缀因子化** — 一段同形文本（目录清单、测试输出）写法从"每行一份前缀"变成"前缀一次 + `<v>`"。

修掉的两个真 bug，都是"压得更狠但内容坏了"：

- **标记里的 token 指向不存在的东西。** 早先标记写作 `<<hr:schema:afb5b28b...>>`，那个 token 是由
  *被替换文本* 算出来的，但从来没有谁把那段文本存进那个键——模型拿到标记也无法解析。现在标记只带
  digest 和规模，键表这类"本身就是重点"的内容直接写在标记里。
- **短键别名把 JSON 弄坏了。** `{"seats":` 被替换成 `"K1":`，连花括号一起吃掉——那不是 JSON 对象，
  文档静默损坏却仍然"压缩成功"。现在别名保留花括号，并且太短的键（付不起别名）直接跳过。

两个 bug 都补了守卫断言：标记必须自描述、别名后必须仍能 `JSON.parse`。

### 早先几轮修掉的代码处理器错误

代码处理器前后错了四次，每次都是"压缩率看起来不错但结果没用"：

1. **保留 brace depth 0 的所有行** → 类体里每一行都是嵌套的，等于什么都没压。
2. **把 `const x = 1` 当成成员签名** → 关键字表匹配的是*语句*而不是*签名*，函数体全部原样保留。
3. **把 `)` 当成作用域结束** → `const x = f(y)` 会让外层作用域的"欠账"减一，函数体永远不 flush。
4. **把 `for (const x of y) {` 当成成员签名** → 它和 `name(args) {` 形状完全一样，于是压入重复作用域，整个类都不再被压缩。

现在的规则是：**body 就是比它的 opener 缩进更深的那些行**；例外只有"成员签名"（关键字成员，或 `name(args) {` 形状且不是控制流）要留下当骨架。

`test/engine.test.mjs` 里的 `ts:` 与 `json:` 系列断言就是为这些错误加的守卫。

## 配置

patch 行里可覆盖：

```yaml
- id: headroom
  name: 'dsh-plugin-headroom'
  config:
    ttlMinutes: 60      # 原文保留时长
    storeMax: 256       # 最多保留条目数（超出淘汰最旧）
    minSavings: 0.12    # 低于此节省比例就不压缩
    shortValueChars: 20 # JSON 中"短值"阈值，短于此不改
    maxArrayItems: 3    # JSON 长数组保留前 N 项
    spread: 8           # 日志/行采样保留条数
```

`ratio` 三档：`light`（保留 70%）、`balanced`（45%）、`aggressive`（20%）——但**它只在压缩结果仍超过
`MAX_VISIBLE_CHARS`（120,000 字符）时才生效**，用来决定是否截断可见文本。普通负载上三档输出完全一致，
原因是处理器本身是确定性的；实测数据见上文"`ratio` 是安全阀，不是旋钮"。

### 关掉它

删除 `cordis.patch.yml` 里的 `headroom` 行即可。`--enable-host` 不会重复追加。

## 第十轮（收尾）：换行与 Unicode，以及两个"说得比做得好"的探针

这一轮的目标是**收尾并同步安装版**。新增的探针没有在引擎里找到 bug，倒是把**两个探针自己**
的问题暴露了出来——和第六轮同一类：**报告比实际好**。

### 新增 `bench/probe-newlines.mjs`：864 次压缩调用，零发现

此前所有探针都用 `\n` 造负载。真实负载不长这样：Windows 上读出来的文件是 CRLF，
API 响应可能带 BOM，从终端拷出来的日志可能夹着 NUL 或 emoji，编辑器可能用制表符缩进。
处理器都是按 `\n` 切、再用 `\n` 拼，所以风险**不是崩溃，而是一次看起来正常、报了节省、
但取回来的不是原来那份的变换**。

探针用 7 类负载 × 16 种变体 × 8 种 kind（含 `auto`），逐次核对四件事：

| 性质 | 为什么是它 |
| --- | --- |
| 原文**逐字节**取回 | 这是 `retrieve` 的承诺，也是整个可逆设计的地基 |
| 可见文本永不比原文长 | `visible.length >= original.length` 时就该拒绝 |
| 不引入原文没有的 U+FFFD | 另一种更隐蔽的损坏 |
| marker 形状合法（不嵌套、名字合法） | marker 是模型的唯一线索 |

**结果：864 次调用，无崩溃、无损坏、无损坏性 marker。** 拒绝也算通过——
`stored: false` 并原样返回，对压不动的负载是正确答案。

76 条 WARN 是**预期行为**，不是缺陷：CRLF 负载被按行抽样后，可见文本的行尾变成 LF
（如 `4/5・\r\n` 被采样的行保留数据，只是行尾规范化），NUL 不在可见文本里出现。
两种情况下**原文都能逐字节取回**，所以是"显示规范化"而不是"数据损坏"。
另外确认 `detectKind` 把 CRLF 负载判成 `text`（不是 `lines`），路由正确。

### 顺带补上的 `jsonl` 覆盖

`jsonl` 处理器**检测永远不会路由到它**：JSONL 流形状是 JSON，所以 `detectKind` 报 `json`，
只有当 JSON 处理器拒绝这份文档时才会走到它。这种"没有入口的处理器"最容易悄悄坏掉，
所以探针按名字断言它：120 条记录的流经 `auto` 后确实由 `jsonl` 处理，
**120 个记录 id 一个不少**，39% 节省，逐字节往返。

### 探针 bug 1：`probe-dispatch-cost.mjs` 还在描述已经不存在的行为

它的输出里写着：

```
six handlers run for every call; one is kept.
When detection is right and its output clears the floor — the common case —
the other five are pure waste
```

**这段话在第五轮加上快速路径之后就不成立了。** 它的计时循环其实跑的是新路径
（没有传 `fullScan`），所以**数字是对的、叙述是错的**——读者会以为自己在看一个"待优化"
的基线，实际上看的是优化后的结果。

现在它同时测两条路径（`fullScan: true` 就是被替换掉的旧顺序），把节省**测出来**而不是声称：

| 负载 | 快速路径 | 全扫描 | 节省 |
| --- | --- | --- | --- |
| log 150 KB | 3.28 ms | 4.14 ms | 21% |
| json 120 KB | 5.46 ms | 9.18 ms | 41% |
| code 34 KB | 1.73 ms | 2.03 ms | 15% |
| text 113 KB | 6.01 ms | 9.05 ms | 34% |
| diff 15 KB | 0.31 ms | 0.82 ms | 63% |
| **合计 224 KB** | **16.79 ms** | **25.23 ms** | **33%** |

括号里补了一句边界：**节省 0% 的那些负载，是检测到的处理器没过 12% 底线、必须跑全扫描
去找替补**——快速路径省不掉那份工作，这是设计如此，不是没生效。

### 探针 bug 2：`bench/lib/measure.mjs` 的注释和实现相反

`compressPayload` 的文档说"小负载留在 `content` 模式，那是它们的正当用法"，
而函数体**永远走 `path`**，`content` 参数只被写进虚拟文件系统。它还返回一个
`viaPath: true` —— 四个调用点全部只取 `result`，**没有任何地方读它**。

注释和实现相反是比没有注释更糟的情况：下一个人会按注释去推理。现在注释说的是实现做的事
（永远 `path`，因为五个 fixture 里有四个超过内容上限，走 `content` 会在引擎运行前就被拒），
死字段 `viaPath` 已删除。

### 一处顺手清理

删掉了一个遗留的调试产物 `lib/engine.tr2.mjs`（早先定位字段 bug 时留下的引擎副本，
它会让"搜索 `maskedLines`"这种排查得出错误的结论：看起来有人用，其实是这个副本）。

同时确认 `maskedLines` 目前是**处理器返回但无人读取**的字段（7 处返回，`runHandler`
只取 `.content` 与 `.transforms`）。它没有害处，本轮**刻意不动**：删掉要改 7 个处理器、
而它是一份将来可能对诊断有用的元数据，收益不抵改动风险。这里记录在案，避免下一个人
再从"搜索无结果"重新发现一遍。

### 同步安装版之后：数字降了 0.8 个百分点，这是诚实的代价

安装版同步之后，同一个 `compression-bench` 从 **78.7% / 80.8%** 变成 **77.9% / 79.8%**，
`conversations-bench` 从 79.5% / 76.2% 变成 **78.9% / 75.6%**，`session-savings` 从 73.3% 变成 **73.1%**。
`corpus-bench` 不变（**72.1% / 73.1%**）。

**这不是回归，而且恰好是第五轮那条断言的用处所在。** 在同步之前，基准测的是**旧的安装版**，
它有两个 fixture 的可见文本更小：

| fixture | 旧安装版 | 同步后 | 差额来自 |
| --- | --- | --- | --- |
| 长文档 | 819 字符 | 2145 字符 | 标题骨架被恢复（30 个节标题回到可见文本） |
| TypeScript 源码 | 3396 字符 | 3561 字符 | 类字段不再被当成局部变量藏进正文 |

两处合计 **1491 字符**，正是 `compression-bench` 合计 30115 → 31606 的**全部差额**，
一分不多一分不少。换句话说：**压缩率下降的 0.8 个百分点，精确等于"输出还能用"所必需的那点字节。**

如果那条断言还是老样子（只检查入口能调用），这次同步**什么都不会被发现**——
基准会继续报 78.7%，而实际运行的代码给的是 77.9%，两个数字谁也不对。

`corpus-bench` 不变也说明改动是**定向**的：语料里没有"标题骨架"和"类字段"这两类形状，
所以它一分未动——受影响的是源码与文档这两种负载，不是所有内容。

### 这一轮的产出

- **新增 `bench/probe-newlines.mjs`：864 次压缩调用，零发现**
- `probe-dispatch-cost.mjs` 重写为**双路径对比**，首次把快速路径的收益测出来：**224 KB 上省 33%**
- 修掉 `measure.mjs` 一处与实现相反的注释 + 死字段
- 清理遗留调试产物 `lib/engine.tr2.mjs`
- 引擎代码**本轮未改动**（285 项断言、14 个探针、2 个模糊器全绿）
- **安装版已同步**：`plugin/lib/engine.js` 已复制，安装后 4 个套件全绿，
  源码与安装版 SHA256 **逐字节一致**；那条对比断言由 FAIL 转 **PASS**（26/26）
- 文档按同步后的真实数字更新，并把 0.8 个百分点的来由写清楚

## 第九轮：`code` 处理器把成员声明一起藏进了正文

`code` 处理器的承诺是"保留结构、隐藏实现"：留下导入、类型、成员签名，把函数体压成
`<<hr:body:hidden=…>>`。它一直是压缩率最高的处理器，所以它坏掉的方式也最不显眼——
**输出依然无损往返、依然报 90% 的节省，只是里面已经没有成员名了。**

新增 `bench/probe-code-edges.mjs`（26 项）专门问一个问题：**压缩之后，每个成员的名字还在不在？**
它给 9 种语言变体（TypeScript / Java / Rust / Go / Python / Kotlin 的括号同行与次行两种写法）
各造一个两成员类型，检查两件事：名字仍在，且函数体确实被藏起来了。

### bug 1：多词返回类型的签名被当成实现

`METHOD_SIGNATURE` 只认"参数表后面跟着一个词"的形状，于是下面这些**整行都不匹配签名**，
被当作实现吞进正文：

| 语言 | 被吞掉的签名 |
| --- | --- |
| Rust | `pub fn insert(&mut self, key: u32) -> Option<Entry>` |
| Java | `public int alpha(int x)` |
| Kotlin | `fun find(key: String): Entry?` |
| Go | `func (s *Store) Get(key string) *Entry` |

修法是让签名由**已有常量拼出来**，而不是手写一条正则：`MODIFIERS`（访问修饰符 + `pub`
+ `unsafe` / `extern` / `static` 等）加 `DECLARED_NAME`，再要求参数表后面允许"两个词的返回类型"。
拼装的好处是修饰符表只有一份，以后加 `pub(crate)` 这类写法不用同步改两处正则。

### bug 2：作用域开启行被它的第一个成员弹掉

`class C {` 压出一个作用域，随后**第一个成员**在同样的缩进上出现，作用域就被弹掉了，
后面的成员全部落进"实现"里。修法是只在遇到真正的闭括号或**新的开启行**时才弹栈，
而不是"缩进回到同一层就弹"。同时补上 C / Java / Go 那种**花括号写在下一行**的写法识别——
用 `lines[index - 1]` 回看上一行判断。

修完之后 9 个语言变体全部 `names 2/2, bodies masked=true`，约 90% 节省，压缩率没有下降。

### bug 3：类字段被当成局部变量藏掉——以及一个永远为假的判断

`private readonly entries = new Map<string, Entry>()` 属于成员，应当保留；
`const found = this.entries.get(key)` 属于实现，应当隐藏。两者形状几乎一样，
第一版想用"缩进等于开启行缩进"来区分，写成：

```js
if (openerIsType && indent === openerIndent && FIELD_DECLARATION.test(trimmed)) return true
```

**这个条件在任何输入下都不可能成立。** 类正文里最内层的开启行**就是类本身**，
字段总是在 `indent > openerIndent` 上，所以 `===` 永远假——字段从未被保留过。

这个 bug 最难查的地方在于**每次加日志都"看不到问题"**：我一度怀疑是模块缓存拿到了旧的
补丁版本。真正定位靠的是把断点式日志**插进函数体内部**，把 `line / indent / openerIndent /
openerIsType` 四个值连同四条正则各自的判定一起打出来，一眼就看到
`guard=false control=false head=false sig=false field=true` ——
**守卫通过了、字段正则也命中了，函数却仍然返回 false**，那只可能是最后那行等式。

修法是用**真正能区分二者的判据**：绑定关键字。`const` / `let` / `var` / `:=` 在任何位置都是
局部变量，而类型正下方一个不带这些关键字的 `T name = …` 就是字段。仓库里本来就有
`LOCAL_VAR` 这条正则，它此前被定义却没用在这个判断上：

```js
if (openerIsType && !LOCAL_VAR.test(trimmed) && FIELD_DECLARATION.test(trimmed)) return true
```

### bug 4：一条"报告说得比实际好"的基准断言

`bench/compression-bench.mjs` 里有一条注释写着"源与已安装两份必须行为一致，
否则测的是一个没人运行的文件"，而它的实现是：

```js
check('source and installed copies agree', typeof source.apply === 'function')
```

**它只检查了入口能被调用，从没比较过行为。** 两份 `engine.js` 早就不同（本轮改动尚未同步到
安装版），这条断言照样报 PASS——**它是一处会掩盖真实分歧的假绿灯**，而且掩盖的恰好是它自己
声称要防的那件事。

现在它真的跑了：每个 fixture 同时过两份拷贝，逐字节比较 `compressed` 与 `kind`，
不一致就把差异列出来。实测立刻变红并给出准确信息：

```
FAIL  the installed copy runs the same engine as the source :: stale install on 2/5 fixtures:
      source file (installed 3396 vs source 3561 chars), document (installed 819 vs source 2145 chars)
```

两条差异都**正是本轮改动的预期结果**：源文件变大是因为字段声明不再被藏起来，
文档变大是因为标题骨架被恢复了。**它会一直红到第七轮把安装版同步过去为止**——
这是准确的报告，不是待修的故障。

### bug 5：转换器把代码段里的 `*` 当成了 Markdown 强调

`README.txt` / `USAGE.txt` 是由 `tools/md-to-text.mjs` 生成的，而校验脚本
`tools/check-txt.mjs` 是**拿 .txt 和 .md 对照**，所以它能发现"转换时丢了内容"。
这一轮它抓到的就是这个：

```
FAIL  no table cell text was lost :: func (s *Store) Get(key string) *Entry
```

上面表格里那行 Go 签名，在 `.txt` 里变成了 `func (s Store) Get(key string) Entry`——
**两个指针星号被吃掉了**。原因不是表格，是内联转换的顺序：反引号被**先**剥掉，
随后 `*` 强调规则才跑，于是 `*Store) Get(key string) *` 被读成了一对强调标记。

修法是让代码段对强调规则**不可见**：反引号内容先换成占位符，跑完规则再放回去。
代码段是字面文本，里面任何东西都不是 Markdown——这正是反引号的含义。

#### 这个修法我自己第一版又写错了

第一版我用 `split` 按正则把一行切成片段，逐段处理：

```js
line.split(/(`[^`]*`)/g).map(convertFragment).join('')
```

它**修好了星号**，却在别处制造了同类问题：一段强调**跨过**代码段时（比如
**然后对返回的 compressed 文本推理**），开头和结尾的标记被切进了**不同片段**，
谁也配对不上，于是 6 行**把标记原样留在了输出里**。

这不是靠人眼发现的，是 `check-txt.mjs` 的 `no Markdown syntax left behind` 报出来的。
我随后做了一次**对照实验**：把改动前的 `inline()` 还原到一份副本里，用同一个校验脚本跑同一份
`README.md`——旧版是表格失败、标记检查通过，新版是表格通过、标记检查失败，**两边的失败
互相独立，所以那 6 行确实是我这次改出来的**，不是原先就有的。

正确做法是**占位符**而不是切分：整行保持完整，强调规则才能看到**完整的一对标记**。
新增 `tools/probe-converter.mjs`（14 项）把两组要求同时钉住：代码段里的 `*`、`**`、`_`
必须原样保留，而真正的强调必须照旧剥掉——**只关掉强调规则的"修复"会通过前一组、挂在后一组**。
其中两项专门覆盖"强调跨代码段"这个我踩过的坑。

#### 转换器还剩一个已知限制

`inline()` 在**折行之前**运行，而折行不知道强调的存在。于是一段很长的强调被折到两行时，
两半各持一个落单的标记，`txt` 里就会出现字面的 `**`。本轮只在**新写的正文**里绕开了这个形状
（把标记放在代码段外面），没有去改折行逻辑：那需要让折行理解强调，属于另一个量级的改动，
而现有文档的正文没有触发它。`check-txt.mjs` 的 `no Markdown syntax left behind` 会在触发时报出来。

### 这一轮的产出

- 3 个测试套件 **285 项**断言全绿（145 + 111 + 29）
- 探针全部无发现，本轮新增 `probe-code-edges.mjs` 26 项
- 新增 `tools/probe-converter.mjs` **14 项**，`README.txt` 与 `USAGE.txt` 校验通过
- 2 个模糊器无违例（400 个负载 / 1200 次检索）
- 压缩率**没有下降**：`compression-bench` 78.7%（own）/ 80.8%（meter），
  `corpus-bench` 72.1% / 73.1%，`session-savings` 73.3%，与上一轮逐位一致

> **这一条当时就被自己的基准骗了。** 上面三个数字是拿**旧的安装版**测的，
> 而我这一轮恰好改的就是"输出里保留什么"，所以"逐位一致"其实是**两次旧测量的对比**。
> 第十轮同步安装版之后，同一组基准给出 77.9% / 79.8%、72.1% / 73.1%、73.1%——
> `corpus-bench` 确实没变，另两个降了，因为**输出里多留了本该留的东西**。
> 教训与那条假绿灯是同一个：**测的不是要发的东西，数字再稳也没有意义。**
- `compression-bench` 由 25 项变 **26 项**：那条假绿灯换成真的逐字节比对。
  它在本轮会报 FAIL——那份差异是**准确报告**（安装版当时确实还没同步），
  第十轮同步安装版后转绿

## 第八轮：内容识别第一次被单独测——JSONL 被整体拒绝

`detectKind` 是路由：它决定六个（现在是七个）处理器里哪个来跑。它是最后一个没有专门探针的
主要组件，而它的错误很安静——误判的负载照样压缩、照样无损往返、照样报一个百分比，
**只有检查"输出还能用来干什么"才会发现不对**。

新增 `bench/probe-detection.mjs`（28 项）。这一轮它找到两件事。

### bug：被截断的 JSON 被交给 `code` 处理器，压成一个花括号

上一轮加的守卫只覆盖**能解析**的 JSON。而真实世界里最常见的畸形 JSON 是**传了一半**的
API 分页响应——它以 `{` 开头、`JSON.parse` 失败，于是守卫不触发，`code` 处理器接手：

```
400 字符的分页前缀   ->  ran=code  saved=88.1%
输出                 ->  {\n<<hr:body:hidden=397:9f95c52d>>
```

**只剩一个左花括号和一段被隐藏的正文。** 键没了、记录没了，连一个能对上号的形状都没有。

修法是让守卫覆盖**"形状像 JSON"**而不只是"是合法 JSON"：以 `{` 开头且出现带引号的键
（`"key":`），或者以 `[` 开头且括号配平。实测修复后：

| 变体 | 修复前 | 修复后 |
| --- | --- | --- |
| 合法 JSON | json 44.9% | 不变 |
| 截断到 90% | **code，输出只剩花括号** | **拒绝压缩**（原样返回） |
| 截断到 400 字符 | **code，输出只剩花括号** | **拒绝压缩** |
| 带 BOM | lines 38.6% | **拒绝压缩** |
| 带尾随说明行 | lines 45.7% | **拒绝压缩** |
| 带前置说明行 | lines 34.8% | lines 34.8%（不以 `{` 开头，不受影响） |

**"拒绝压缩"在这里是正确答案**：这些负载的"节省"要么来自把内容藏起来，要么来自把它当行来抽样
（丢掉大部分键与记录）。原样返回 + `note` 说明，比一个看起来漂亮但没法用的输出诚实。

括号**配平与否刻意不作为条件**——被截断正是我们最需要键名的情形，而配平恰好把这种情况排除掉了。
改成"是否出现带引号的键"。误判的代价只有一个方向：**守卫只会拒绝变换，不会改动内容**，
所以一个"看起来像 JSON 的 C 文件"最坏也只是不被压缩，不会被弄坏。实测四种花括号语言
（C / Java / JavaScript / CSS）识别与压缩**全部不变**。

#### 这条守卫我自己先写错了一版

第一版的判据是"回退候选的叶子值不得少于 json 处理器"。它在**合法 JSON 上正确**，
在**畸形 JSON 上把一切都拒了**：JSON 处理器对畸形输入返回 null，于是 `jsonFloor` 是 0，
而 `leavesOf(原文)` 因为原文不解析返回 −1，`0 > 0 && -1 >= 0` 恒假——**所有候选都不可采纳**。
后果是一个带尾随注释的 40 条记录分页（压缩率 59.7%）**从此完全不再压缩**。

是 `probe-token-identity.mjs` 把它抓出来的：它构造 42 个必须互不相同的负载，
第一版用"追加一行 `// distinct N`"制造差异，而那恰好就是畸形 JSON——
探针于是报"只产出 2 个 token"。**看起来像 token bug，实际是我刚写的守卫误杀。**

现在规则是**对胜者施加的门**，而不是对候选的过滤器：形状像 JSON 的负载只允许由 `json` 或
`jsonl` 表示（它们的输出仍能解析）；否则退回 JSON 处理器自己的结果，没有就拒绝。
实测合法分页恢复 59.7%，畸形变体仍被诚实拒绝。

这也说明为什么每次改守卫都要跑全部探针：**上一轮刚修好的问题，这一轮自己又制造了一个同类的。**

### 顺带修掉一处不诚实的 transform

`text:headings-kept` 在上一轮被修好之后，**拼接骨架这个动作本身没有被报告**。现在
补上 `text:skeleton-added`：变换列表应该说明"做了什么"，而不是只描述"结果如何"——
上一轮那个 bug 之所以能长期存在，正是因为列表描述结果、不描述过程。

### 优化：JSONL（每行一个 JSON 对象）此前被整体拒绝

这是探针顺带发现的：**JSONL 完全没有处理器**。它是主流格式——日志采集器、批量导出、
流式 API 都在用——但 `JSON.parse` 会因为"这是很多份文档"而拒绝整个文档，于是 JSON 处理器
返回 null，负载被**原样拒绝**：

```
200 条结构化记录  ->  refused（什么都没做）
```

而这恰恰是 `factorRecords` 最擅长的形状：一组同形记录，键重复两百遍。新增 `jsonl` 处理器
（排在 `json` 之后，**不参与自动识别**——检测本来就把这种内容报成 `json`，它是"JSON 处理器
拒绝了这份文档，而它其实是很多份文档"时的第二选择）。值**原样保留不做掩码**：
JSONL 流里键重复但每行是不同的事件，该去掉的重复是键，掩掉值等于掩掉事件本身。

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 200 条 JSONL | refused | **37.0%**，schema 只写一次，往返逐字节一致 |
| 含空行的 NDJSON | refused | 24.6% |
| 3 条记录（低于下限） | refused | refused（不变） |
| 键集不一致的流 | refused | refused（不写成位置行） |
| 每行一个标量 | refused | refused（没有键可因子化） |

### 语料级影响：零

三个基准的数字**完全不变**（79.5%/76.2%、78.7%/80.8%、72.1%/73.1%），因为语料里既没有
JSONL 也没有被截断的 JSON。**这一轮的全部收益都在语料之外的真实形状上**——
这是探针存在的意义：基准测的是平均值，探针测的是边界。

### 新增探针

`bench/probe-detection.mjs`（28 项）：六种无歧义形状的识别、六种 JSON 变体（含三种畸形）、
四种花括号语言（既不误判为 JSON，也仍能正常压缩）、三种清单形状、两种 diff、
以及 JSONL 的现状。

## 第七轮：日志处理器没有做到它承诺的事

README 从第一版起就写着"各级别抽样、**全部 FATAL/ERROR/WARN**、栈回溯"。
这一轮实测发现**它没做到**——而把承诺兑现之后，又暴露出一个更大的低效。

### bug：ERROR 行和普通行一样被抽样掉了

抽样是按**级别各自**套用 `spread` 的，完全不看这个级别意味着什么。实测：

| 输入 | 严重行（前 → 后） | 压缩率 |
| --- | --- | --- |
| 300 行 ERROR | 300 → **24** | 89.4% |
| 300 行 FATAL | 300 → **24** | 89.4% |
| 200 行 WARN + 200 行 DEBUG | 200 → **24** | 84.5% |

**丢掉 92% 的报错行，却在文档里承诺"全部保留"。** 这是整个处理器里唯一一条读者会
**不检查就依赖**的承诺——"报错都在这里"正是压缩后的日志还有用的原因。

修法：`FATAL` / `ERROR`（含 `CRITICAL` / `SEVERE`）**永不抽样**，有多少留多少；
`WARN` / `INFO` 照常按 `spread` 抽样；`DEBUG` / `TRACE` 抽得最狠。

`WARN` 刻意**不在**保证之列：它在健康系统里本来就很密，抽掉大部分是正常取舍；
抽掉大部分 ERROR 不是。这个区别现在写进了代码注释、测试和文档三处。

### 兑现承诺之后暴露的低效：重复的错误行没有被折叠

保证一落实，`300 行完全相同的 ERROR` 全都留了下来，而它们的压缩率只有 **17.1%**。

原因是一个一直存在的盲点：折叠重复行的 `factorLineRun` **只作用于被省略的行**。
在"所有级别都会被抽样"的年代这看不出来——被抽掉的行很多，重复的也大多在其中。
一旦错误行必须全留，它们就绕过了唯一的折叠路径。

而**重复的报错恰恰是这个处理器最该折叠的东西**：信息是"消息 + 出现次数"，
不是同一行抄三百遍。修法是把**保留下来的**连续相同行也送进同一个模板化函数
（连续 ≥6 行才试，`factorLineRun` 自己会在不划算时拒绝）。

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 300 行相同 ERROR | 17.1% | **99.3%**（折叠成一个模板） |
| 300 行相同 WARN | — | 90% |
| 300 行相同 DEBUG | — | 90% |
| 913 行真实混合日志 | — | 88%，11 个严重行全部保留，栈回溯完整 |

阈值定在 6 行而不是 `factorLineRun` 自带的 3：连续三行相同去重省不下什么，读起来还更差——
**重复本身就是信号**。4 行的相同 ERROR 序列实测不会被折叠，这条也有断言。

### 语料级影响：诚实的不对称

`corpus-bench` 从 73.3% 变为 **73.1%**——这是兑现承诺的**诚实代价**：多留了 22 个 token
的报错行。`compression-bench`（78.7%/80.8%）与 `conversations-bench`（79.5%/76.2%）
**完全不变**，因为它们的日志里错误行占比很低。这正是这类改动该有的形状：
**代价落在错误密集的负载上，收益也落在那里**。

### 新增探针

`bench/probe-log-edges.mjs`（26 项）：ERROR 计数 1/2/5/16/17/50/200/1000（跨越抽样阈值）、
FATAL/CRITICAL/SEVERE × 计数 8/16/17/100、913 行真实混合日志、三种级别的相同行洪泛、
变化 id 的近似相同行、**三种不该被当成日志的散文**（无级别、含一次 ERROR 提及的文档）、
CRLF 与 CJK 的逐字节往返。

## 第六轮：两个"报告说得比实际好"的 bug

这一轮找到并修掉两个真 bug，共同点是**输出的自述比实际做到的多**：
一个声称保住了标题而没保住，另一个把整份 JSON 的骨架压成一对括号却报 90% 的节省。

### bug 1：`text:headings-kept` 在标题被丢掉时仍然这么报

文档处理器有一条"整篇折叠"路径：非空块多于 6 个时，它可能把**首两块 + 尾两块**留下，
中间全部塞进一个 `<<hr:para:...>>`。而**标题往往黏在它下面那段文字里属于同一个块**，
于是折叠把它一起带走了。

在一份 20 节的记录上实测：

```
折 叠 前 : 20 个标题
折 叠 后 :  1 个标题        ← 19 个进了那个 marker
transforms: text:headings-kept, text:filler-masked
```

**一份文档丢掉 95% 的导航，却仍然声明"标题已保留"。** 折叠本身是合理取舍，
但"边丢边声明保住"不是。

修法：把全文的标题行抽出来作为骨架无条件写在最前面（只补上输出里缺的那些，
所以标题本来就都在的文档结果不变），并且逐块压缩时不再重复保留标题。
实测修复后：

| 场景 | 标题（前 → 后） | 压缩率 |
| --- | --- | --- |
| 5 块带标题 | 5 → **5** | 65.9% |
| 20 节文档 | 21 → **21** | 94% → **80.2%** |
| 无标题文档 | 0 → 0 | 48.2% |

20 节文档从 94% 降到 80.2%——**这 14 个百分点的代价换回了全部 21 个标题**，
是可读性与大小的正确取舍：折叠掉 19 节内容省不了多少，丢掉全部导航却让结果没法用。

### bug 2：合法 JSON 被交给 `code` 处理器，压成一对括号

选择规则是"检测到的处理器过了 12% 下限就用它，否则取**留下文本最多**的候选"。
问题在于"文本最多"量的是**大小**，分不出**保守**与**破坏性**。

584 字符的 JSON 数组实测：

```
json 处理器 : 保留键结构与全部 6 条记录，149/165 token = 9.7%   ← 差 2.3 点没过下限
code 处理器 : 把整个 body 掩码掉，      saved = 90.9%          ← 被选中
最终输出    : [
              <<hr:body:hidden=580:7bba849d>>
              ]
```

**只剩一对括号；每个键、每条记录都在 digest 后面。** 对纯文本这样做是合理的掩码，
对 JSON 不是——**留下的东西已经不是合法 JSON 了**，读的人拿不到任何键名或记录。

修法加一条窄规则：当原文是 JSON、且检测到的就是 `json` 处理器时，
**回退候选必须至少保留与 json 处理器一样多的叶子值**，否则不予采纳。
比 json 保留得更多的回退（真的丢了更少）不受影响。

实测修复后：

| 负载 | 修复前 | 修复后 |
| --- | --- | --- |
| 6 条记录数组 | `code`，输出非法 JSON，90.9% | `json`，**拒绝压缩**（原样返回） |
| 4 个数字 | `code`，输出非法 JSON，26.3% | `json`，**拒绝压缩** |
| 20 条记录分页 | `json` 44.9% | `json` 44.9%（不变） |
| 目录清单（非 JSON） | `lines` 采样 | `lines` 采样（不变） |
| TypeScript 源码（非 JSON） | `code` 掩码方法体 | 不变 |

"拒绝压缩"是正确答案而不是退步：这时的"节省"全部来自把内容藏起来，
而负载本身只有 165 token——让调用方直接读它更便宜，也更诚实。
工具会把原文原样返回并在 `note` 里说明。

### 语料级影响：零

两个修复对已发布的数字**没有任何影响**（79.5% / 76.2%、78.7% / 80.8% 全部不变），
因为语料里的文档与 JSON 本来就走在这两条路径的正确一侧。
这正是回归断言的用处：它们锁住的是**边界形状**，不是平均值。

### 新增探针

| 探针 | 规模 | 作用 |
| --- | --- | --- |
| `bench/probe-json-edges.mjs` | 34 项 | JSON 结构边界：记录数 2/3/4、键数 24/25、SAFE_KEY 32/33 字符、数组 3/4/100、嵌套深度 1–40、unicode/空/数字键、值里含 marker 与 JSON、嵌套因子化、map 分支 |
| `bench/probe-structure-loss.mjs` | 全语料 | 检测到的处理器 vs 实际运行的处理器，以及**键/标识符足迹**的保留率 |

`probe-structure-loss.mjs` 还纠正了我自己的一个误判：语料上三处 `text → lines`
被它的第一版标成"丢失结构"，实际是**行采样本来就该如此**——目录清单、grep 结果、
测试输出是行导向的，检测因为没有更强信号而叫它散文，采样整行才是对的。
探针现在把这种情形标为 `fell back (sampling: expected)`，并把"真正的结构丢失"单独计数。

## 第五轮：派遣优化（并发掘出三处探针自身的错）

这一轮的目标是找 bug。结果：**引擎与工具的账目是对的**，但过程中把**派遣**（handler dispatch）
改成了一条真实存在的快路径，并把三处**探针自己的错误**挖了出来。

### 优化：检测到的处理器一旦合格，其余五个不再运行

`compress` 原本无条件运行全部六个处理器，然后只留一个。而当检测正确、且它的输出已经过了
12% 下限时——**这是绝大多数情况**——另外五次是纯浪费：每一次都是对整份负载的完整遍历，
外加一次 `estimateTokens`。

改动是：先只跑检测到的那个；它合格就直接用它，不合格才回到完整扫描。
不合格的分支必须保留，因为"差多少"要对着其它可能生效的处理器来量。

实测（`bench/probe-dispatch-cost.mjs`，224 KB 五个样本）：

| 样本 | 优化前 | 优化后 | 提升 |
| --- | --- | --- | --- |
| log 150 KB | 3.92 ms | 3.40 ms | 13% |
| json 120 KB | 8.33 ms | 5.45 ms | 35% |
| code 34 KB | 1.85 ms | 1.56 ms | 16% |
| text 113 KB | 8.96 ms | 5.72 ms | 36% |
| diff 15 KB | 0.77 ms | 0.30 ms | 61% |
| **合计** | **23.84 ms** | **16.42 ms** | **31%** |

单位成本从 **106 µs/KB 降到 73 µs/KB**。

**这类优化只有在"什么都没变"时才算优化**，所以它有个专门的差分验证：
`bench/probe-dispatch-diff.mjs` 用 `fullScan: true` 让同一份代码走未优化顺序，
再把两次调用**每一个可观察字段**逐项对比。430 个负载（语料 + 合成 + 极端输入）×
7 种配置（自动 + 六种强制 kind），**零差异**，且两次相同调用结果一致。

引擎测试里也钉了两条：报告内容必须一致，以及**快路径必须真的在省工作**
（615 KB 负载上慢路径应显著更慢，比值断言 1.15× 起步，实测 1.5×）。后者防的是
"快路径悄悄不再被走到"——那种情况下正确性毫无变化，只有性能测试能发现。

### 探针自身的三个错（都不是产品的 bug）

1. **估计器探针的容差比文档精度小 50 倍。** 它断言 `savedPercent` 与精确比值误差 < 0.001
   个百分点，而代码是**刻意**四舍五入到一位小数的（`Math.round(savedRatio * 1000) / 10`）。
   于是它报了一个假 bug。正确的断言是误差不超过那一步舍入（0.05 个百分点）。

2. **账目探针共用了同一个引擎实例。** 它以为每次调用 `apply` 都拿到新存储，实际
   `getEngine` **按配置缓存**（这是刻意的：热重载后旧 token 仍要能取回），所以四组配置
   相同 → 共用一份存储 → 报出"存了 2 条却有 8 条"。给每次调用不同 `storeMax` 后即通过。

3. **`forget` 专项测试的负载根本压不动。** 测试里现有的 `jsonFixture` 字段太短，
   即便三倍展开，每个值都比替代它的标记还小，引擎**正确地**拒绝压缩。于是
   "两条不同条目"这条断言失败——失败原因是负载不可压，与 `forget` 毫无关系。
   改成现场构造带长值的负载后通过。

三次都是同一个教训的不同面：**探针报 BUG 时先怀疑探针**。前几轮已经栽过两次
（弱 PRNG 造出"零违规"、`getEngine` 缓存导致 ttl 检查失败），这一轮又栽了三次，
所以这条现在写进了每一处相关注释。

### 顺带确认没问题的

- `bench/probe-estimator.mjs`（新增，14 项）：估计器在 10,400 个追加样本上**单调不减**、
  任意输入有限非负、非字符串不抛异常、报告出来的 token 计数是整数、`savedTokens` 与
  `savedPercent` 与实际返回文本一致且在 [0,100] 内。
- `bench/probe-bookkeeping.mjs`（新增，27 项）：`stats` 计数、`tokensSaved` 与差值一致、
  拒绝不计入压缩数、`recentEvents` 有界、`forget` 只删指名的那条、`forget` 无参清空、
  `render` 对大结果仍带 token 与首尾标记、**`render` 不修改传入的结果对象**。
- 工具契约新增 4 项：`forget` 只删指名条目，且**未被指名的条目必须存活**
  （此前只断言了 `dropped === 1`，没断言另一个还在）。

### 一处刻意的"不报告"

快路径的走没走**没有**暴露在 `transforms` 里。`transforms` 描述的是内容的变换，
而"跑了几个处理器"是内部调度细节；混进去会让调用方以为输出形状发生了变化。
它由差分测试与定时断言来保证，不由输出契约承担。

## 第四轮：存储的身份与时间

第三轮把检索路径翻了一遍，这一轮转向**token 与存储**——token 是模型握有存储内容的唯一把手，
而它的身份问题（去重、前缀歧义、时间）此前只被间接测过。

新增 `bench/probe-token-identity.mjs`（19 项），确认了这些**本来就应该成立**的事：
同一内容得到同一 token、只存一份、第二个引擎为同一文本推导出相同 token、
不同内容绝不撞 token、完整 token 永远解析到自己那条、**前缀歧义会明确拒绝而不是猜**、
空前缀永不解析。

### 修掉的两个真 bug

1. **存储的时间参照不一致。** `put()` 在写入同一次调用里做过期清理，却**用墙上时钟**去比，
   而条目带的是调用方传来的 `createdAt`。后果是：**用显式 `now` 写入的条目在插入的瞬间就被判定过期删除**。

   ```js
   store.put(token, entry, now)   // 现在：写入与清理用同一个时刻
   store.find(token, now)         // 现在：读取也接受同一参照
   ```

   在真实会话里两者都是 `Date.now()`，所以一直没暴露；只有固定时间参照时才现形——
   而那正是 `compress({ now })` 存在的意义。`find` / `forget` / `describe` 现在都接受 `now`，
   使读写双方对"现在几点"达成一致。

2. **一次畸形写入可以直接弄瘫整个存储。** `TokenStore` 是**导出的**（包的 `./engine` 导出映射），
   所以 `put` 可以被手工构造的条目调用。缺 `createdAt` 的条目会让 `expire()` 在 `undefined` 上抛错——
   而那条坏条目**留在 map 里**，于是此后该存储的**每一次操作都抛错**。
   一个错误的写入废掉一个本来健康的存储，代价与过失完全不成比例。现在 `put` 会补上缺失的时间戳；
   `find` 对非字符串 token 返回"未命中"而不是抛 `TypeError`。

   两者都补了回归断言（引擎测试 111 → **116** 项）。

### 一处按"结果"而不是"建议"传达的优化

工具描述里已经写了"文件用 `path`，别用 `content`"，但**已经读过文件的模型不会在决定压缩的那一刻
去重读描述**。所以现在 `content` 模式的压缩结果会**顺带report**这次调用本可以省下多少：

```
... for the full original (this call sent `content`, so whatever you read to get it is
still in context; passing `path` instead would have kept that copy out and saved about
3,130 more tokens)
```

按"结果"教比按"说明"教有效：它出现在决策点上，且是这次调用的真实数字。
代价只落在"用 `content` 且确实存下了东西"的调用上——`path` 模式与拒绝压缩都不带这句，
所以常见路径零开销。

### 一次被我自己的探针证伪的怀疑

第一版探针把"存储能扛住畸形写入"报成 BUG，实测发现是**探针自己的问题**：
它复用了前一组测试已经把 8 个名额占满的存储，于是"旧条目被淘汰"被误读成"畸形写入弄坏了存储"。
第二版又踩了 `getEngine` **按配置缓存**这个坑：`ttlMs: 1000` 的请求静默返回了前一组
`ttlMs: 60000` 的存储实例。

这两次都写进了探针注释。**探针报 BUG 时，先怀疑探针**——这一轮和上一轮（PRNG 太弱导致
"零违规"的假象）都是同一个教训的不同面。

## 第三轮：差分模糊测试，以及它暴露的三个检索 bug

前两轮的探针都是**手写用例**——检查的是"我想得到的形状"。这一轮改成**随机差分模糊测试**，
因为对机器生成的代码来说，"我想不到的形状"才是盲区。

两个 fuzzer，都用固定种子、可复现：

| 文件 | 作用 | 规模 |
| --- | --- | --- |
| `bench/fuzz-engine.mjs` | 压缩引擎：10 个生成器 × 不变量断言 | 3000 个负载 |
| `bench/fuzz-retrieve.mjs` | 检索：24 个刁钻 query × 6 个 limit | 1800 次检索调用 |

生成器覆盖真实会话会产生的形状及其**混合**：嵌套 API 页、锁文件、交错栈回溯的日志、
多 hunk diff、目录清单、文档、TypeScript、**键名刁钻的 JSON**（unicode / 空键 / 含引号换行）、
内嵌 JSON 的文本、原始类型数组。每个负载都断言：无损往返、永不膨胀、`savedTokens` 与实际一致、
json 仍可解析、`truncated` 只在真截断时为真、`confident` 名副其实、CRLF 逐字保留、
标记声明的 `hidden` 不超过实际丢弃量、内部哨兵不泄漏、二次压缩仍然无损。

**3000 + 1800 次调用，零违规。** 但这一轮的价值不在"通过"，而在下面这些。

### 先修掉 fuzzer 自己的 bug：一个会伪造"通过"的 PRNG

第一版 fuzzer 用普通 LCG，跑完报告**"零违规"**——而覆盖率矩阵显示它**只碰了 10 个生成器里的 2 个**。

原因是 LCG 的第一个输出是种子的近似线性函数：相邻种子的首值分别是 `0.236455`、`0.236843`、
`0.274823`……于是 `floor(r * 10)` 永远返回 2 或 3。**这是 fuzzer 最坏的失败模式：干净的结果看起来
像是证据。** 换成 mulberry32（首值前先做多轮混合）后立刻铺满全部 6 个处理器。

这条教训写进了代码注释，也写在这里：**覆盖率矩阵必须和不变量断言一起看**，否则"通过"没有意义。
现在 fuzzer 会显式打印 `NOT EXERCISED:` 并在有处理器没被触及时提示。

### 检索路径的三个真 bug

前两个是同一个形状：**把"没给"和"给了但是空"当成同一件事**。

1. **空 query 会把整份原文倒进上下文。** `args.query.trim() === ''` 把 `""`、`" "`、`"\n"` 和
   "没给 query" 全部折叠成同一个分支，于是**调用方要 0 个片段，却收到了整份原文**——
   这是最贵的一种回答。现在"缺省"返回全文，"给了但空白"返回 0 个片段。

   ```
   (没给 query)  -> 整份原文 (1259 token)
   ""            -> 0 个片段      ← 原来是整份原文
   "   "         -> 0 个片段      ← 原来是整份原文
   ```

2. **`limit: 0` 被静默改成默认的 20。** 原来的守卫是 `args.limit > 0 ? ... : 20`，
   于是"要 0 个"变成了"给你 20 个"。现在显式值一律尊重，缺省才用默认，负数与非有限值仍回退
   （它们不可能是字面意思），并保留 200 的上限。

3. **匹配语义不可见：`matched` 里混着"字面命中"和"词语相关"。** 实现里有两套匹配：
   字面子串（`includes`）和按词的 overlap 打分。后者是有意为之——它让
   `connection reset` 能找到 `ECONNRESET by peer`，这正是自然语言 query 有用的原因。
   问题是**两者结果混在一起，调用方无法分辨**：搜 `^2026` 会拿回不含 `^2026` 的片段。

   修法不是砍掉相关匹配（那会毁掉自然语言查询），而是**把区别报出来**：每个片段带
   `match: "literal" | "related"`，结果里多一个 `literalMatches` 计数。工具参数说明也写明
   "需要精确字符串就检查 `literalMatches`"。

   顺带确认：**正则元字符是安全的**——字面匹配走 `String.includes`，没有 `RegExp`。
   我一开始怀疑 `^2026` 被当成锚点，实测排除了这个可能。

### 一次被数据支持的"不做"

模糊测试顺手量了 **12% 压缩下限是否在拒绝本该接受的压缩**：3000 个负载里有 135 次拒绝，
其中 38 次存在候选方案，**最高的被拒比例正好是 12.0%**——即刚好卡在下限上。
结论：下限没有系统性误杀，不需要调整。这条记下来，免得下次凭直觉去调它。

## 模式是手动的还是自动的？

**一半手动，一半自动。** 这个问题以前没写清楚，现在明确：

### 手动的那一半：由参数决定

模式**不是**靠嗅探文本内容猜测，而是由**调用方传了哪个参数**直接决定：

| 传的 | 模式 | 原文是否进上下文 |
| --- | --- | --- |
| `path` | path 模式 | 否 |
| `content` | content 模式 | 是（它本来就在里面） |
| 两个都传 | content 模式（`content` 优先） | 是 |

### 自动的那一半：超过阈值会被拒绝

`content` 超过 **20,000 字符**直接报错并告知改用 `path`；2,000–20,000 字符之间正常压缩、
但在 `note` 里报告本可省下多少；2,000 字符以下不啰嗦。两个阈值分别用
`contentStoreLimitChars` / `contentHintMinChars` 覆盖。

**为什么只做"拒绝"而不做"全自动猜测"**：工具不知道那段文本从哪来，传进来的只是字符串。
即使检测到"这内容和某个文件一样"也已经晚了——副本已经在上下文里，撤不回来；压缩改变不了
已发生的事，只能决定**要不要再添一份**。而猜错会更贵：把 `content` 当文件处理，要么去找一个
可能不存在的文件，要么**假装存了其实没存**，后者会让模型以为可以 `retrieve`、实际取不到。
所以自动化的边界划在"拒绝不该做的事"，而不是"猜测你想做什么"。

用户视角的完整说明见 [`USAGE.md`](USAGE.md) 的"二·补"节。

## 用 `path` 还是 `content`：这是最大的一处损耗

工具能给出 65%–98% 的压缩率，但**压缩本身不省 token**——省的是"让模型读精简版"。所以真正
决定成败的是**原文有没有在压缩之前就已经进了上下文**。这一点值得单独讲，因为它是本插件目前
最大的一处可避免损耗，实测约 **5 倍**：

| 用法 | 上下文里最后有什么 | 相对原始文件 |
| --- | --- | --- |
| **A. `path` 模式** | 只有压缩后的文本，原文从未进入上下文 | **小 66%–75%** |
| **B. 先读文件、再把内容传给 `content`** | 原文一次（读的结果）+ 压缩副本一次（压缩的结果） | **大 25%–34%** |

同一份文件，两种用法实测（`bench/probe-context-cost.mjs`）：

| 负载 | A：`path` | B：先读再传 | B 是 A 的 |
| --- | --- | --- | --- |
| 4 KB | 283 token | 1,129 token | 4.0× |
| 40 KB | 2,154 token | 10,585 token | 4.9× |
| 400 KB | 21,304 token | 106,035 token | **5.0×** |

关键在于 **B 比"干脆不压缩、只读一遍"还要差**：原文件 84,731 token，B 最终占 106,035 token。
压缩把一份副本换成了更小的一份，但代价是多留了一份副本。**"压缩"这个动作本身不产生节省，
"不读原文"才产生节省。**

因此：**文件一律用 `path`**。工具说明里现在也写明了这一点，因为模型很容易先读文件再决定压缩——
那是自然的顺序，也是错的顺序。

## 工具定义本身的固定开销

工具定义是**每个请求**都要付的，压不压缩都一样（同一探针实测）：

| 组成 | token |
| --- | --- |
| description | 227 |
| parameters | 464 |
| output schema | 981 |
| **合计** | **1,672** |

这三个数字会随工具说明和输出模式的改动而变——本轮因为给 `kind` 补上 `diff`/`lines`
两个枚举值、并加入 `literalMatches` 计数而上涨。**改说明或改 schema 时应该重跑这个探针**，
因为这是全仓库唯一一处"每个请求都付"的成本。

这条数字解释了两个设计取舍，两者都是刻意的：

- **不做批量 `items` 数组。** 批量能省下每次调用的框架开销，但会给**每个请求**的 schema 增加
  约 78 token。而框架开销相对调用省下的量很小：即使在 4 KB 负载上，一次调用省 626 token，
  框架只占 979 token 中的一小部分——真正的杠杆是上面那条"别读原文"，不是调用次数。多留 78 token
  的固定成本，去换一个用不上的优化，是亏的。
- **description 保持短。** 它从 172 token 涨到 204 token（加进了 `path` 建议与实测比例），
  这是这次唯一接受的固定成本增长：一句话能避免上面那 5 倍损耗，值。曾经写成 224 token 的
  长版本，被压回来了——每个请求都付的钱，要按每个请求来审。

## 第二轮查找与优化（本轮改动）

### 修掉的真 bug

1. **解析器把手写路径当字面量。** 三种从 shell 传进来的形状都不是路径本身，而原来全部照收：

   | 输入 | 原来 | 现在 |
   | --- | --- | --- |
   | `"D:\dsh\home"`（带引号） | 解析成 `<cwd>\"D:\dsh\home"` → absent | 剥掉成对引号 |
   | `~/dsh/home` | 解析成 `<cwd>\~\dsh\home` → absent | 展开为 home 目录 |
   | 正常值 | 正确 | 正确 |

   前两种的失败**看起来像"没装好"，而不是"引号写错了"**——这是它值得修的原因。
   Windows 上 `set DSH_HOME="D:\dsh\home"` 会把引号留在值里，POSIX 的 `~` 在非 shell 环境也不会展开。

2. **`path` 模式的失败原因被归错。** 原来 `fs.resolve` 缺失时会报
   `could not read <路径>`，把人引去找权限问题。现在会逐一检查 `fs` 服务的方法是否可用：

   ```
   没有 fs 服务        the fs service is not mounted, so `path` input is unavailable
   没有 resolve        the fs service has no `resolve` method, ...; pass `content` instead
   resolve 返回空      the fs service resolved x.json to nothing, which is not a readable target
   stat 说是目录       x.json is a directory, not a regular file; `path` reads text files only
   stat 说文件不存在   x.json does not exist
   超过 64 MB          x.json is 200 MB, above the 64 MB cap for `path`; read a slice and pass `content`
   真的读不动          could not read x.json: EACCES
   ```

   最后一行的"could not read + EACCES"是**正确的**，不是含糊——原因被指名了。

3. **测试里的 fs 假件形状是错的，因此漏过了上面这条。** 契约测试的 `fs` 假件返回 `{ path }`，
   而真实的 DSH `fs.resolve` 返回 `FsTarget`（`{ targetKey, displayPath }`）——任何后端都不会
   返回 `{ path }`。旧代码把这个对象直接交给 `readText`，所以假件再离谱也照样通过。
   现在假件按真实形状构造，并补了 5 条断言覆盖上面那张错误表（契约测试 75 → **84** 项）。

   顺带一个设计原则被写进了代码注释：守卫**只拒绝明显不可能是 target 的东西**（`undefined`、
   原始类型），**不去检查 `targetKey` 这类字段名**——target 的形状属于 fs 契约，它同时也负责
   `readText` 的校验；在这里硬编码字段名会让插件拒绝一个字段拼法不同的后端。

### 补上的能力

4. **`kind` 现在能强制 `lines` 与 `diff`。** 这两个处理器一直存在、也一直会被自动探测**兜底**
   使用（目录清单、grep 结果、测试输出最终都是 `lines` 在压，实测 89%），但 enum 里没有它们，
   所以模型无法显式要求。现在可以了：

   ```
   kind=auto   -> ran=lines  confident=false   90.2%
   kind=lines  -> ran=lines  confident=true    90.2%
   ```

   代价是 enum 增长约 5 token/请求，换来的是模型对"这份负载我知道是什么"的表达能力。

### 一次被数据否掉的优化

**批量 `items` 数组：不做。** 推理见上文"工具定义本身的固定开销"——测量结果表明真正的杠杆是
`path` 模式（5×），而不是调用次数；为一个用不上的优化付每个请求的固定成本是亏的。这条记在这里，
是为了下次有人（包括我自己）再想到它时，先看到数字。

## 已知限制

- **存储是进程内的。** harness 重启后 token 失效；跨会话共享同一个存储（`stats` 因此报的是本进程累计值，工具说明里也这么写）。
- **`ratio` 在普通负载上没有作用**，只充当超大压缩结果的截断安全阀（见上文"`ratio` 是安全阀，不是旋钮"）。想更狠地压，目前只能靠 `kind` 与调用时机。
- **`path` 模式上限 64 MB。** 超过就报错并建议自己切一段用 `content`——引擎本来也会在 120,000 字符处截断可见文本，读一个更大的文件没有收益。若 `fs` 服务不提供 `stat`，这个上限无法预检，会在读完之后才截断。
- **`retrieve` 的 query 会返回两类结果**：字面命中（文本里真的有这段）与词语相关（共享词但未命中文）。
  后者是刻意的，它让自然语言查询有用；需要精确字符串时请看 `literalMatches` 或逐段看 `match` 字段。
  正则元字符按字面处理，`^`、`.`、`(` 都只是普通字符，不会被当成模式。
- **key-hoisted 的 json 后面会跟一行键表标记**，所以整体文本不是可直接 `JSON.parse` 的；标记之前的部分是完整 JSON，键表本身也写在标记里而不是藏在 token 后面。
- **不做自动压缩。** 目前是模型按需调用。harness 已有 `dsh-compaction-tool-result-pruner` 做工具结果的确定性裁剪，那是另一条轴，二者可共存。
- **无 ML 阶段**，因此对"语义上冗余但结构上不冗余"的内容压缩有限。
- **不要再为它建 agent preset。** 初版曾同时提供 preset，但 preset 在自身 scope 注册工具、host row 在全局注册，`tools.register()` 对重名直接抛错，选中该 preset 会失败。常开方案已取代它，那个 preset 也因此被删除；install.mjs 退役它时会一并清掉指向它的用户默认 preset——默认 preset 是会话未显式选择时的解析目标，留着一个已不存在的名字会让每个新会话创建失败。

## 授权与出处（请务必读这一段）

**许可证：Apache License 2.0**（`LICENSE`）。仓库同时提供 `NOTICE` 记录出处与第三方声明。

### 与上游 headroom 的关系

技术源自 [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom)，该项目的许可为
**Apache-2.0**（Copyright 2025 Headroom Contributors），压缩技术描述见其仓库 `wiki/compression.md`。

本仓库**没有复制、翻译或机械移植上游任何一行代码**。Python 与 JavaScript 之间不存在代码继承关系；
这里取用的是**思路与接口词汇**——识别内容类型、保留骨架、用标记替代冗长部分、原文可凭 token 取回，
以及 `compress` / `retrieve` / `stats` 这组动作名。实现方式也不同：上游用 Magika 做识别、Kompress 做压缩，
本插件是纯结构化启发式，离线且确定性。

尽管如此，**本项目的许可证按 Apache-2.0 而非 MIT 发布**，理由是这样最稳妥：它既然声明"技术源自上游"，
就不该在一个比上游更宽松的许可下分发。`NOTICE` 里写明了取了什么、没取什么。

### 独立性声明

本项目与 headroom 项目、headroomlabs-ai、DeepSeek **均无隶属、赞助或背书关系**。
"headroom" 在这里是描述性使用，指它所实现的那套技术；"DeepSeek Harness" 与 `@deepseek-ai/*`
包名用于说明本插件的集成对象。上游的商标不因本许可证被授予任何使用权（Apache-2.0 第 6 条）。

运行时依赖：本插件在 DSH 进程内运行，但它**不 import 任何 `@deepseek-ai/*` 代码**——只用 harness 暴露的
`tools` 注册表与 `fs` 服务接口。仅 `bench/` 里引用 `@deepseek-ai/dsh-token-meter`（用于双估算交叉验证），
`test/tool-contract.test.mjs` 引用 `@deepseek-ai/dsh-tools`（用 harness 自己的校验器）。这些引用不附带
其源码，也不改变其许可。

### 语料与第三方内容

`corpus/` 与 `bench/conversations/` 下的**所有负载都是合成的**，由目录内的脚本确定性生成，
不含任何第三方文档、会话记录或专有文件。这一点是刻意的：`corpus/build-corpus.mjs` 的早期版本内嵌过一份
从 `node_modules` 里抄出来的真实包 README，那属于他人的受版权保护文档，**发布前已删除**，
现在该文件顶部有明确警告不要重新引入真实负载。

### AI 生成与免责

本仓库代码主要由 AI 编码助手生成（见文首"代码是怎么写出来的"）。软件按 Apache-2.0 第 7、8 条
**"AS IS" 提供，不附带任何明示或默示担保**；使用者自行判断其适用性并承担全部风险。

