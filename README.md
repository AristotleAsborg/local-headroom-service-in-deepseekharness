
本地化的deepseekharness的headroom插件
================================================================================
HEADROOM FOR THE DEEPSEEK HARNESS
================================================================================

上下文压缩（context engineering）：把冗长的工具输出压成保留骨架的形式再读，原始
内容凭 token 随时取回。

本插件实现了开源项目 headroomlabs-ai/headroom
(https://github.com/headroomlabs-ai/headroom) 发表的上下文压缩技术。上游用
Python 实现并通过 MCP 暴露 headroom_compress / headroom_retrieve /
headroom_stats 三个工具；这里把同样的技术写成 DSH host 插件。没有复制或翻译上游
任何源码——共用的是思路与接口词汇，不是代码。详见 NOTICE (NOTICE)。

常开安装：headroom 工具在每个会话里都可用，无论用哪个 agent preset。

================================================================================

如果你想使用，请下载所有文件后

先跑这个：install.mjs
--------------------------------------------------------------------------------

在仓库根目录（headroom/）执行，不是 headroom-package/：

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
node install.mjs --dry-run     # 1. 先看它会改什么，这一步不写盘
node install.mjs               # 2. 确认无误后真正安装（复制 + 自动测试）
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

headroom-package/ 里的 install.mjs 是给下载包用的，它从自己的 plugin/ 取源文件；
在仓库里请用仓库根目录那一份。两者做同一件事。

装完会看到安装后自动测试的结果，4 个套件都 ok 才算成功：

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ok      smoke-installed.mjs             111ms   stats: 3 compressions, 6 retrievals, ...
  ok      test/engine.test.mjs           1064ms   145 passed, 0 failed
  ok      test/tool-contract.test.mjs     118ms   111 passed, 0 failed
  ok      test/verify-host.mjs            100ms   29 passed, 0 failed

4 suite(s) passed. The installed copy at ...
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

安装脚本会做四件事：识别路径（CLI → 环境变量 → dsh-paths.json → 自动探测）→ 把
index.js / lib/engine.js / dsh-paths.mjs / package.json 复制进安装目录 → 在子进
程里跑安装后测试（必须是子进程，否则测的是仓库而不是安装产物）→ 报告结果。 它不
会联网，也不会碰 cordis.patch.yml，除非你显式传 --enable-host。

装完需要重启 harness 才保证插件行被加载。要确认装到哪、有没有装好，看下面「安装
状态」一节；每个参数的完整说明在「开发与测试」那张命令表里。

也可以走 npm 脚本（等价）：npm run install:dry 先试跑，npm run install-plugin 正
式装。

================================================================================

先说清楚：这个项目可能不会经常维护
--------------------------------------------------------------------------------

这是一个人用 AI 编码助手写出来的插件，不是有人值班的产品。发布它是因为它在一台真
实机器上确实能用、测量方法可复现、过程中发现的两个 bug 也值得记录——不是因为打算
长期经营它。(简单来说，我想发出来)

请这样预期：

- Issue 和 PR 可能很久没人看，也可能永远不看。 没有响应时间承诺，没有 roadmap，
  没有发布节奏。
- 代码主要由 AI 生成（见下文"代码是怎么写出来的"）。它能通过本仓库自带的 285 项
  断言，但"通过了自带测试"和"在别人机器上、别人的 harness 版本上也对"是两件事。
- 只在这一个部署上验证过：Windows + 固定版本的 DSH。其他平台、其他 harness 版本
  没有测过。
- 想要长期可用的东西，请用上游的 headroom
  (https://github.com/headroomlabs-ai/headroom)：它有 68k star、有维护者、覆盖
  Python/库/代理/MCP 四种形态。本插件只在"你在用 DSH，且不想或不能跑 Python/MCP"这
  个很窄的场景里才有理由存在。
如果它坏了而你不想等，fork 它比等更新现实得多。

代码是怎么写出来的

- 引擎、插件外壳、测试、基准、这份文档，绝大部分由 AI 编码助手（DeepSeek Harness
  里的 agent）生成，经人工审阅、逐轮修正。
- 值得说明的是它的失败方式：引擎里的几个真 bug（内容处理器前后错了四次、标记指向
  不存在的 token、别名吃掉花括号、以及本文件记录的两个）都是AI 写出来的，而发现它
  们靠的是把它当文档读——解析输出、比对结构、量记录条数——而不是读代码。
- 因此本仓库里测试和基准的份量刻意偏重。测量代码比被测代码更值得信任，这是刻意的
  安排：bench/ 下的东西驱动的是已安装的那份产物，逐字节往返验证，并且不允许只报百
  分比而不报保留率。

为什么是原生插件，而不是安装 MCP 服务器
--------------------------------------------------------------------------------

1. 装不上。 headroom 是 Python 包（headroom-ai），而本机 host 进程出网被禁（PyPI
   、npm、GitHub 全部超时），pip install 无法完成。
2. 值钱的是算法，不是进程边界。 内容类型识别、结构掩码、可逆存储都不需要 Python
   。
3. 原生集成更好。 没有每次调用的 IPC、没有需要常驻的子进程，并且直接复用 harness
   的 tools 注册表和 fs 服务。
顺带说明：本 harness 本身有 MCP 支持（@deepseek-ai/dsh-mcp-client，工具会以
mcp__<server>__<tool> 出现）。一旦网络可达，把 headroom MCP 作为一行配置接进来也
是可行的——本插件不与之冲突。

安装状态
--------------------------------------------------------------------------------

  项目                   路径
  ----------------       ------------------------------------------------------
  profile patch 行       dsh\home\profiles\web\cordis.patch.yml
  
  已安装包               dsh\home\profiles\node_modules\dsh-plugin-headroom\
  
安装位置不是随便选的：host row 用裸包名引用，解析器会从 profile 目录逐级向上找
node_modules。<profiles>\node_modules 正是这一步能到达的位置（
dsh-plugin-token-balance 就装在那里，是有力的旁证）；而 <profile>\node_modules
在向上走的路线上根本不会被查，装在那里等于没装。这一点已用一个放在 profile 目录
里的探针模块实测确认。


profile 的 patch 层配置了 patchReload: live，也就是热加载。首次加载某个插件未必
能在当前进程里生效，重启 dsh 是确定的做法。判断依据很简单：新会话的工具列表里出
现 headroom 即为成功。
