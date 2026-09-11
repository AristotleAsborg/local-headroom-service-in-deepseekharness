# 测试对话压缩效率（实测）

由 `bench/conversations-bench.mjs` 生成。语料由 `bench/conversations/generate.mjs` 确定性生成：
6 组测试对话、17 个负载、911,782 字符。

- 驱动对象：**已安装**的那份插件（`D:/dsh/home/profiles/node_modules/dsh-plugin-headroom/plugin/index.js`），走工具自身的 `execute`。
- ratio 预设：`balanced`。
- token 双估算：`own` = 引擎估算器；`meter` = `@deepseek-ai/dsh-token-meter` 的 `estimateContent`。
- `idents` = 原负载中的标识符（记录 id、哈希、路径、坐标）在压缩文本中仍可读的比例：
  `occ` 按出现次数计，`uniq` 按去重后的标识符计。采样类负载必然丢行，所以 `occ` 才是诚实的那个数。
- json 不按文本计，而按结构计：解出标记后解析两边，比对记录条数与每条记录的键集合。
- 每个负载都逐字节往返验证：全部通过。

## 汇总

| 指标 | 数值 |
| --- | --- |
| 负载数 | 17 |
| 输入字符 | 911,782 |
| 压缩后字符 | 186,642 |
| 字符缩减 | 79.5% |
| token（meter） | 228,020 → 46,732 |
| token（own） | 261,304 → 62,213 |
| **压缩效率（meter）** | **79.5%** |
| **压缩效率（own）** | **76.2%** |
| 两把尺子之差 | 3.3 个百分点 |
| 平均单次压缩耗时 | 7.8 ms |

## 按对话

| 对话 | 负载 | 字符 | token（meter） | 压缩效率（meter） | 压缩效率（own） |
| --- | --- | --- | --- | --- | --- |
| `conv-01-build-failure` | 3 | 168,737 → 7,718 | 42,198 → 1,942 | **95.4%** | 95.4% |
| `conv-02-api-pagination` | 3 | 208,352 → 65,265 | 52,101 → 16,329 | **68.7%** | 60.9% |
| `conv-03-refactor` | 3 | 66,136 → 12,440 | 16,547 → 3,122 | **81.1%** | 80.0% |
| `conv-04-onboarding` | 3 | 84,817 → 14,747 | 21,217 → 3,699 | **82.6%** | 80.7% |
| `conv-05-flaky-e2e` | 3 | 114,898 → 37,041 | 28,738 → 9,274 | **67.7%** | 63.0% |
| `conv-06-spec-reading` | 2 | 268,842 → 49,431 | 67,219 → 12,366 | **81.6%** | 76.3% |

## 按内容类型

| 类型 | 负载 | 字符 | token（meter） | 压缩效率（meter） | 压缩效率（own） | 标识符保留（occ / uniq） |
| --- | --- | --- | --- | --- | --- | --- |
| code | 2 | 55,123 → 8,239 | 13,789 → 2,068 | **85.0%** | 83.7% | 100% / 100% |
| diff | 1 | 15,122 → 1,592 | 3,785 → 402 | **89.4%** | 89.3% | 100% / 100% |
| json | 7 | 470,023 → 161,471 | 117,537 → 40,398 | **65.6%** | 55.6% | 80% / 94% |
| lines | 4 | 74,518 → 8,017 | 18,647 → 2,021 | **89.2%** | 89.1% | 7% / 28% |
| log | 1 | 150,330 → 4,880 | 37,587 → 1,224 | **96.7%** | 96.8% | 3% / 100% |
| text | 2 | 146,666 → 2,443 | 36,675 → 619 | **98.3%** | 98.3% | 100% / 100% |

## 单个负载明细

| 对话 | 负载 | 类型 | 字符 | token（meter） | 压缩效率 | 标识符 occ | 往返 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `conv-01-build-failure` | `ci-build.log` | log | 150,330 → 4,880 | 37,587 → 1,224 | 96.7% | 3.1% | 字节一致 |
| `conv-01-build-failure` | `vitest-output.txt` | lines | 16,446 → 1,584 | 4,116 → 400 | 90.3% | 4.0% | 字节一致 |
| `conv-01-build-failure` | `package.json` | json | 1,961 → 1,254 | 495 → 318 | 35.8% | 100.0% | 字节一致 |
| `conv-02-api-pagination` | `workspaces-page-1.json` | json | 122,577 → 41,907 | 30,649 → 10,481 | 65.8% | 100.0% | 字节一致 |
| `conv-02-api-pagination` | `metrics-dump.json` | json | 62,020 → 16,911 | 15,509 → 4,232 | 72.7% | 0.9% | 字节一致 |
| `conv-02-api-pagination` | `error-report.json` | json | 23,755 → 6,447 | 5,943 → 1,616 | 72.8% | 100.0% | 字节一致 |
| `conv-03-refactor` | `src/cache.ts` | code | 33,944 → 8,072 | 8,490 → 2,022 | 76.2% | 100.0% | 字节一致 |
| `conv-03-refactor` | `resolver.diff` | diff | 15,122 → 1,592 | 3,785 → 402 | 89.4% | 100.0% | 字节一致 |
| `conv-03-refactor` | `grep-resolveNode.txt` | lines | 17,070 → 2,776 | 4,272 → 698 | 83.7% | 10.0% | 字节一致 |
| `conv-04-onboarding` | `repo-listing.txt` | lines | 15,676 → 1,444 | 3,923 → 365 | 90.7% | 6.4% | 字节一致 |
| `conv-04-onboarding` | `docs/architecture.md` | text | 34,004 → 404 | 8,505 → 105 | 98.8% | 100.0% | 字节一致 |
| `conv-04-onboarding` | `pnpm-lock.yaml` | json | 35,137 → 12,899 | 8,789 → 3,229 | 63.3% | 59.1% | 字节一致 |
| `conv-05-flaky-e2e` | `playwright-run.txt` | lines | 25,326 → 2,213 | 6,336 → 558 | 91.2% | 6.2% | 字节一致 |
| `conv-05-flaky-e2e` | `network-har.json` | json | 68,393 → 34,661 | 17,103 → 8,670 | 49.3% | 100.0% | 字节一致 |
| `conv-05-flaky-e2e` | `e2e/specs/checkout.spec.ts` | code | 21,179 → 167 | 5,299 → 46 | 99.1% | 100.0% | 字节一致 |
| `conv-06-spec-reading` | `spec/compaction-protocol.md` | text | 112,662 → 2,039 | 28,170 → 514 | 98.2% | 100.0% | 字节一致 |
| `conv-06-spec-reading` | `spec/conformance-vectors.json` | json | 156,180 → 47,392 | 39,049 → 11,852 | 69.6% | 100.0% | 字节一致 |

生成命令：`node bench/conversations/generate.mjs && node bench/conversations-bench.mjs`
