# headroom 使用指南

面向**使用者**，不是开发者。目标是让你在不知道内部实现的前提下把它用好、并且在它出问题时
能自己判断出问题在哪。

如果你要的是"这东西到底怎么实现的""压缩率怎么测的"，看 `README.md`。
如果你要的是"我该怎么用、出错了怎么办"，就是这一份。

---

## 一、它解决什么问题

一次会话里真正吃掉上下文的东西，通常不是你打的字，而是**工具吐出来的东西**：构建日志、
分页 API 响应、大 diff、目录清单、测试输出、锁文件。这些东西有共同点——
**结构值钱，正文不值钱**。日志里你需要知道有哪些级别、哪一行 ERROR、栈从哪来；你不需要读
九千行心跳。

headroom 做的就是：把这类内容按结构压成保留骨架的形式，让模型读精简版；被压掉的部分
**逐字节存在本地**，凭一个 16 位十六进制 token 随时取回。

一句话：**它不是"摘要"，是"可逆的瘦身"**。摘要会骗你，这个不会——原文一直都在。

### 它不做什么

- **不自动压缩。** 它是个工具，模型按需调用。harness 自带的 `dsh-compaction-tool-result-pruner`
  做的是另一件事（确定性裁剪工具结果），两者不冲突。
- **不做语义总结。** 没有 ML 阶段，纯结构启发式。对"语义重复但结构不重复"的内容效果有限。
- **不跨进程持久。** harness 重启，token 全部失效。

---

## 二、最重要的那一件事：文件用 `path`，别用 `content`

如果这一节你只看一句话：**文件交给 `path`，不要自己先读一遍再交给 `content`。**

原因不是风格问题，是**成本差 5 倍**，而且是往错误方向差。

| 用法 | 上下文里最后留下什么 |
| --- | --- |
| `path`：`compress(path: "logs/build.log")` | 只有压缩后的文本。**原文从未进入上下文。** |
| `content`：先读文件、再把内容传进去 | 原文一份（读的结果）+ 压缩副本一份（压缩的结果） |

实测（`bench/probe-context-cost.mjs`）：

| 负载 | `path` 模式 | 先读再传 | 倍数 |
| --- | --- | --- | --- |
| 4 KB | 283 token | 1,170 token | 4.1× |
| 40 KB | 2,154 token | 10,626 token | 4.9× |
| 400 KB | 21,304 token | 106,077 token | **5.0×** |

注意最后一行：原文件 84,731 token，而"先读再传"最终占 **106,077** ——
**比干脆不压缩、只读一遍还多花 25%**。

### 为什么会这样

```
path 模式     :  磁盘 ──► 压缩 ──► 上下文        （原文从未进来）
先读再传      :  磁盘 ──► 上下文 ──► 压缩 ──► 上下文
                          ↑ 第一份          ↑ 第二份
```

压缩把一份副本换成了更小的一份，代价是**多留了一份副本**。
所以：**压缩这个动作本身不省 token，"不读原文"才省。**

### 那为什么会有 `content` 这个参数

因为它对**本来就在上下文里的东西**仍然有用：粘贴的报错、刚拿到的 API 响应、你自己拼的片段。
`content` 不是错的，只是**不该用来处理文件**。

---

## 二·补 模式是手动的还是自动的？

**结论：一半手动（靠你传哪个参数），一半自动（超过阈值工具会强制）。**
这个区别以前没写清楚，现在明确列在这里。

### 手动的那一半：由参数决定

模式**不是**工具去猜你的文本像不像文件，而是由**你传了哪个参数**直接决定：

| 你传的 | 走哪个模式 | 原文会不会进上下文 |
| --- | --- | --- |
| `path: "x.log"` | **path 模式** | 不会——只有压缩后的文本进去 |
| `content: "..."` | **content 模式** | 会——它本来就已经在里面 |
| 两个都传 | **content 模式**（`content` 优先） | 会 |

没有隐式嗅探，没有魔数，没有"看着像文件就自动走 path"。
**想省上下文，就必须传 `path`。**

### 自动的那一半：超过阈值会被拒绝

只靠说明不够——**模型通常在决定压缩之前就已经把文件读进来了**，
那个时刻没有任何东西提醒它"你正要付两遍钱"。所以第二部分是机械强制的：

| 情况 | 工具的行为 |
| --- | --- |
| `content` ≤ 2,000 字符 | 正常压缩，**不啰嗦** |
| `content` 2,000 – 20,000 字符 | 正常压缩，`note` 里**报告**本可以省多少 |
| `content` > 20,000 字符 | **直接拒绝**，并告诉你改用 `path` |
| 任意大小走 `path` | 永远接受 |

拒绝时的报错：

```
`content` of 46,298 chars is above the 20,000-char limit for storing; passing
`content` means the text is already in context, so compressing it would add a
second copy rather than replace the first. Call again with `path` to keep the
original out of context; if the text did not come from a file, compress a slice
of it instead.
```

被接受但在提示带里时，`note` 末尾会多一句：

```
... (this call sent `content`, so whatever you read to get it is still in context;
passing `path` instead would have kept that copy out and saved about 3,130 more tokens)
```

### 阈值是怎么定出来的

| 阈值 | 值 | 为什么是这个值 |
| --- | --- | --- |
| **拒绝线** | 20,000 字符 | 这么大的负载不可能"顺手"出现。它既然从 `content` 来，调用方手里就已经有一份，**再存一份不可能省上下文，只会多占内存**。 |
| **提示线** | 2,000 字符 | 几百字符的重复副本是舍入误差，每次都唠叨 `path` 只是噪音。 |
| 小负载 | < 2,000 | 直接放行。粘贴的报错和短片段本来就是 `content` 的正当用法。 |

两个阈值都能在 patch 行里改（见第六节）。

### 被拒绝了怎么办

三条路，按推荐顺序：

1. **改用 `path`** —— 绝大多数情况的正确答案。
2. **不是文件、是粘进来的** —— 压其中一段（只粘出错的那个函数、那段堆栈），而不是整个文件。
3. **确实需要存全文** —— 先把内容落到临时文件，再用 `path` 指过去。这样原文**不会**进上下文。

### 为什么不做成"全自动猜"

自然的想法是："既然 `path` 更好，为什么不干脆自动把内容当文件处理？"
因为**做不到**，而且假装做得到会更糟：

- **工具不知道这段文本从哪来。** 传进来的是字符串，没有来源信息。
- **就算检测到"这内容和某个文件一样"，也已经晚了** —— 那份副本已经在上下文里，撤不回来。
  压缩改变不了已发生的事，只能决定**要不要再添一份**。
- **猜错会更贵。** 把 `content` 当文件处理，要么去磁盘上找一个可能不存在的文件，
  要么假装存了其实没存——后者会让模型以为能 `retrieve`，实际取不到。**这比浪费 token 更糟。**

所以自动化的边界划在"**拒绝不该做的事**"，而不是"**猜测你想做什么**"。
前者是确定的，后者是猜的。

### 一句话记住

> **模式由参数决定；工具只负责在你要付两遍钱的时候拦住你。**

---

## 三、四个动作

模型只看到一个工具 `headroom`，它有四个动作。

### 1. `compress` —— 压缩

```jsonc
// 文件（首选）
{ "action": "compress", "path": "logs/build.log" }

// 已在上下文里的文本
{ "action": "compress", "content": "..." }

// 可选：指定类型，跳过自动识别
{ "action": "compress", "path": "x.json", "kind": "json" }

// 可选：压缩力度
{ "action": "compress", "path": "x.log", "ratio": "aggressive" }
```

返回的关键字段：

| 字段 | 含义 |
| --- | --- |
| `compressed` | 压缩后的文本。**模型应该读这个** |
| `token` | 取回凭据（16 位十六进制） |
| `originalTokens` → `compressedTokens` | 用引擎估算器计的前后 token |
| `savedTokens` / `savedPercent` | 省下多少 |
| `kind` | **实际**用了哪个处理器 |
| `detected` / `confident` | 自动识别选了哪个、实际跑的是不是它 |
| `truncated` | 可见文本是否被截断（原件仍然完整） |
| `transforms` | 做了哪些结构变换，例如 `json:records-factored` |
| `note` | 人话说明，含取回方法 |

`kind` 可选值：`auto`（默认）、`json`、`code`、`log`、`text`、`diff`、`lines`。

> **`savedTokens: 0` 不是错误。** 它表示"压了不划算，原样返回"——引擎有 12% 的下限，
  省不到就不压，并在 `note` 里说明。这是设计，不是失败。

### 2. `retrieve` —— 取回

```jsonc
// 完整取回，逐字节
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8" }

// 只取相关片段（比整份原文便宜得多）
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8", "query": "connection reset" }

// 限制片段数
{ "action": "retrieve", "token": "a1b2c3d4e5f6a7b8", "query": "error", "limit": 5 }
```

token 支持**唯一前缀**——记不住 16 位就写前 6 位，只要不撞。

#### 带 `query` 时的两类结果

这是最容易误解的地方，值得说清楚。带 `query` 的检索会返回**两类**片段：

| `match` 字段 | 含义 |
| --- | --- |
| `"literal"` | 片段里**真的有**你查的那段文字 |
| `"related"` | 片段**共享了词**，但没有原样包含 |

第二类是有意为之：它让你能用自然语言查——
**`connection reset` 能找到 `ECONNRESET by peer`**，而字面匹配找不到。

结果里另有 `literalMatches` 计数，告诉你几个片段是真命中。
**需要精确字符串时看它**，不要假设 `matched` 全是真命中。

正则元字符（`^`、`.`、`(`、`*`）**按字面处理**，不会被当成模式，也不会抛错。

#### 三种"什么都没给"的区别

| 调用 | 结果 |
| --- | --- |
| 不给 `query` | 返回**整份原文**（最贵） |
| `query: ""` 或 `"   "` | 返回 **0 个片段**（便宜） |
| `limit: 0` | 返回 **0 个片段** |

### 3. `stats` —— 统计

```jsonc
{ "action": "stats" }
```

报的是**本进程累计值**（所有会话共享），不是本次会话。harness 重启归零。

### 4. `forget` —— 丢弃

```jsonc
{ "action": "forget", "token": "a1b2c3d4e5f6a7b8" }   // 丢一条
{ "action": "forget" }                                  // 全清
```

---

## 四、各内容类型保留什么

| 类型 | 保留 | 压掉 |
| --- | --- | --- |
| **JSON** | 全部键（同形记录只写一次）、结构、布尔/null、短字符串、数字、标识符 | 长字符串值、长数组尾部、重复键表 |
| **JSONL**（每行一个对象） | 全部键（写一次）、每一条记录 | 重复的键；值原样保留，不做掩码 |
| **代码** | import、签名、类/类型定义、装饰器 | 函数体、方法体（含 Python 等靠缩进的块） |
| **日志** | **全部 FATAL/ERROR 永不抽样**、WARN/INFO/DEBUG 按级别抽样、栈回溯 | 重复心跳行、连续相同的错误行折叠成模板 |
| **diff** | 文件头、hunk 头、每个 hunk 前几行改动 | 大段增删正文 |
| **文本** | 段落开头与结尾 | 段落中段填充 |
| **行清单** | 首尾与等距抽样 | 中间整行（位置有标记） |

实测压缩率（6 组测试对话、17 个负载、911,782 字符，token 减少 **78.9%**）：

| 类型 | 压缩效率 |
| --- | --- |
| text | 98.3% |
| log | 96.7% |
| diff | 89.4% |
| lines | 89.2% |
| code | 85.0% |
| json | 65.6% |

**json 最低是正常的**：它保住每一条记录和每一个键，只压正文。丢掉记录能换来好看的百分比，
但那样压缩就变成删除了。

> 代码 85% 也是**刻意**的：签名、类型、成员声明全部保留，只压方法体。读骨架足够判断
> "这段在干什么""该改哪里"，需要细节再 `retrieve`。

### 标记怎么读

压缩后的文本里会出现这些标记：

```
<<hr:body:hidden=239:b2dac76e>>                      方法体等实现被替换
<<hr:str:hidden=180:1a2b3c4d>>                       一个长字符串值被替换
<<hr:schema:hidden=77:5ccb40f1:id|name|email>>       同形记录：键写一次，值按位置排列
<<hr:keys:hidden=2:10b58f0b:K1=accepted|reason>>     提升的键表：K1 代表这组键
<<hr:log:hidden=16010:b1b346e5>>                     一段日志行被采样省略
<<hr:lines:hidden=383:ee72e548>>                     一段清单/输出行被采样省略
<<hr:para:hidden=2772:b78e9bc8>>                     文档段落的中段填充被省略
<<hr:items:hidden=32:564edd8a>>                      长数组的尾部被省略
<<hr:run:hidden=...>> / <v>                          同形文本里各行的差异部分
```

**标记不含取回 token。** 能取回整份原文的 token 只有工具头部给的那一个。
标记里的 `hidden=N` 是被省略的规模，`digest` 是那段内容的稳定标识——用来看"省的还是不是同一段"，
不是用来取回的。

---

## 五、典型用法

### 排查一个大日志

```
你:  nightly build 挂了，看看为什么
模型: compress(path: "logs/ci-build.log")        ← 原文从不进上下文
      读 compressed：ERROR ... connection reset by peer，后面 420 次重试全部失败
模型: retrieve(token, query: "connection reset")  ← 需要细节时只取那几行
```

### 读一个不熟的仓库

```
模型: compress(path: "repo-listing.txt")     → 拿到结构、首尾和抽样
      compress(path: "docs/architecture.md") → 拿到每节的开头结尾
你:  直接依赖有哪些？
模型: 需要精确清单 → retrieve(token) 或 retrieve(token, query: "dependencies")
```

### 处理一个已经粘进来的报错

```
你:  [粘贴 300 行堆栈]
模型: compress(content: "...")     ← 这份本来就在上下文里，content 是对的用法
```

### 不该这样做

```
✗ 模型: read("logs/ci-build.log")                  ← 原文进上下文了
        compress(content: <刚读到的东西>)          ← 又进了一份，而且超过 2 万字符会被直接拒绝
```

正确做法是一步：`compress(path: "logs/ci-build.log")`。

---

## 六、配置

在 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 的 `headroom` 行里覆盖：

```yaml
- id: headroom
  name: 'dsh-plugin-headroom'
  config:
    ttlMinutes: 60              # 原文保留时长（分钟）
    storeMax: 256               # 最多保留条目数，超出淘汰最旧
    minSavings: 0.12            # 低于此节省比例就不压缩
    shortValueChars: 20         # JSON 中"短值"阈值，短于此不改
    maxArrayItems: 3            # JSON 长数组保留前 N 项
    spread: 8                   # 日志/行采样保留条数
    contentStoreLimitChars: 20000  # 超过此长度的 `content` 直接拒绝（见第二·补节）
    contentHintMinChars: 2000      # 超过此长度的 `content` 在 note 里提示用 `path`
```

改完重启 harness。

### 调参建议

| 你想要 | 怎么调 |
| --- | --- |
| 原文留久一点 | `ttlMinutes: 240` |
| 同时留更多份原文 | `storeMax: 512`（内存换取的，注意进程内存） |
| 压得更狠 | 目前只能靠 `kind`；**`ratio` 对普通负载无效**（见下） |
| 少压一点、多留正文 | `minSavings: 0.05` |
| 允许更大的 `content` | 调高 `contentStoreLimitChars` |
| 完全不想要 `content` 拦截 | `contentStoreLimitChars: 0`（**不推荐**，等于关掉这层保护） |
| 不想看到 `path` 提示 | 把 `contentHintMinChars` 调得比拒线还高 |

### 关于 `ratio`：它是个安全阀，不是旋钮

`light` / `balanced` / `aggressive` 三档在**普通负载上输出完全一致**（实测三档都是 78.9%，
逐对话逐类型都相同）。原因是处理器本身是确定性的，`ratio` 只在压缩结果**仍超过 120,000 字符**
时才被查一次，用来决定是否截断可见文本。

只有超大负载才看得到区别（实测 934,903 字符的负载）：

| ratio | 可见字符 | 是否触顶 |
| --- | --- | --- |
| light | 205,462 | 否 |
| balanced | 205,462 | 否 |
| aggressive | 120,039 | **是** |

**想少留内容，靠 `kind` 和调用时机，别指望 `ratio`。**

---

## 七、出问题了怎么判断

### 先跑这条

```bash
node install.mjs --print-paths
```

它会打印每个路径**以及这个答案来自哪一层**（命令行 / 环境变量 / 覆盖文件 / 自动探测）。
路径类问题九成在这里就能看出来。

### 常见症状对照

| 症状 | 大概原因 | 怎么办 |
| --- | --- | --- |
| 会话里没有 `headroom` 工具 | patch 行没写，或没重启 | 看 `cordis.patch.yml` 有没有 `- id: headroom`；重启 harness |
| `the fs service is not mounted` | 环境没挂 `fs` 服务 | 改成把内容用 `content` 传（路径模式用不了） |
| `the fs service has no 'resolve' method` | `fs` 服务实现不完整 | 同上 |
| `... is a directory, not a regular file` | 传了目录 | 传具体文件 |
| `... is 200 MB, above the 64 MB cap` | 文件太大 | 切一段再压，或先把无关部分去掉 |
| `does not exist` | 路径写错或相对路径基准不是你想的 | 用绝对路径；`--print-paths` 看基准 |
| `... is above the 20,000-char limit for storing` | 用 `content` 传了超过 2 万字符 | **改用 `path`**；或压其中一段 |
| `no stored entry for "..."` | token 过期（默认 60 分钟）或 harness 重启过 | 重新 `compress` |
| `"..." matches 2 entries; use more characters` | token 前缀不够长 | 多写几位 |
| `savedTokens: 0` | 压了不划算，正常行为 | 看 `note` 里的原因 |
| 压缩了反而更占上下文 | **先读文件再传 `content`** | 改用 `path` |
| 新建对话时选了工作区又弹回未选择 | `settings.yaml` 里的默认 agent preset 指向一个已经不存在的 preset（早期版本装过同名 preset，后来退役了） | 跑一次 `node install.mjs`（会清掉那条悬空默认值）；或手动删掉 `agent-presets.default` 那一行。默认回落到随包的 `standard`，热重载，不必重启 |

### 想确认装的是哪一份

```bash
node install.mjs --dry-run     # 报告仓库与已安装副本的差异，不写盘
node smoke-installed.mjs       # 按绝对路径加载已安装那份并跑通
```

### 想自己验证压缩率

```bash
node bench/compression-bench.mjs      # 五类内容，双估算器交叉验证
node bench/conversations-bench.mjs    # 6 组测试对话，逐对话逐类型
node bench/ratio-sweep.mjs            # 三档 ratio 对比
```

---

## 八、故障排查清单（装不上时）

1. **`node install.mjs --print-paths`** —— 先看它识别到了什么、每个值的来源。
2. **`DSH_HOME` 对不对？** Windows 上 `set DSH_HOME="D:\dsh\home"` 会把引号留在值里，
   解析器现在会剥掉引号，但确认一下更省事。
3. **profile 名字对不对？** 默认 `web`；`--profile <name>` 覆盖。
4. **包是不是装在了对的地方？** 必须是 `<DSH_HOME>/profiles/node_modules/`，
   **不是** `<profile>/node_modules/`——后者不在解析器的向上查找路径上，装了等于没装。
   `--print-paths` 里的 `PACKAGE_PARENT` 就是它实际会用的位置。
5. **patch 行有没有？** 没有就 `node install.mjs --enable-host`。
6. **重启了吗？** 首次加载某个插件不一定能在当前进程生效，重启是确定的做法。
7. **还是不行？** `node install.mjs` 会在子进程里自动跑一遍测试；
   哪一项失败它会打出来，直接看输出比重读文档快。

路径确实和默认不一样时，可以写一份覆盖文件（`dsh-paths.json`，模板见 `dsh-paths.example.json`）：

```json
{
  "profile": "web",
  "dshHome": "D:/dsh/home",
  "runtimeRoot": "D:/dsh/runtime/dsh"
}
```

删掉某个键就退回自动探测。**通常只写 `dshHome` 和 `runtimeRoot` 就够**——
其余位置都是从它们派生的，把派生值也写死，等于用一份可能过期的快照覆盖掉本来还能算对的探测。

---

## 九、这套东西可信到什么程度

诚实地说：

- **代码主要由 AI 生成**，经人工审阅与多轮修 bug。当前通过 145 + 111 + 29 = **285 项断言**，
  两个模糊测试（3000 + 1800 次调用）零违规，八个诊断探针（估计器、账目、JSON 边界、日志保证、内容识别、
  结构足迹、token 身份、上下文成本）全过。
- **只在一个部署上验证过**：Windows + 固定版本的 DSH。其他平台、其他 harness 版本没测过。
- **项目可能不会经常维护**（见 `README.md` 文首）。要长期可用的东西，用上游的
  [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom)。
- **它坏掉时的表现值得知道**：这一路修过的 bug 大多是"看起来在压、其实有内容没压到"或
  "该省的地方没省"（例如空 query 返回全文、`limit: 0` 被改成 20）。
  共同点是**不影响无损往返**——原件一直在。所以判断它有没有出问题时，
  比起担心"内容会不会丢"，更该看的是**上下文占用有没有变小**。
- **无损是硬保证。** 从可见文本里删掉的东西，一定逐字节在存储里；否则根本不会删。
  这条从第一版到现在没破过，也是所有测试里断言最严的一条。

### 最后的建议

把它当成一个**好用的省上下文工具**，别当成关键依赖：

- 它坏了，你会看到上下文变大 —— 这是安全的失败方向。
- 需要精确内容时，`retrieve` 永远给你原件。
- 拿不准就先 `stats` 看它这一路到底省了多少。

---

## 相关文档

| 想看什么 | 去哪 |
| --- | --- |
| 实现细节、压缩率怎么测、修过哪些 bug | `README.md` |
| 发布与授权、出处声明 | `README.md` 末节 / `NOTICE` / `PUBLISHING.md` |
| 独立安装包 | `headroom-package/`（自带解析器与冒烟测试，可整体拷走） |
| 只要一行安装 | `node install.mjs --yes` |
