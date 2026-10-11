# 怎样复查本轮结果

公开 Git 不包含用户的教材全文。重建候选需要用户拥有的原九册文件与 `selection.json` 中相同的完整文件SHA；正文有变化会明确拒绝，不默默适配新书。工具源码重建和数学复算不需要教材或模型账号。

从仓库根目录执行。所有输出目录必须新建且不存在，失败也保留。先用 `python3 tools/setup_visualbook.py --install` 安装已有锁文件固定的依赖。

重建工具04（实际五章版本，219个自有文件）或05（最新实现，222个自有文件）：

```bash
python3 tools/reproduce_visualbook_snapshot.py evaluation/2026-10-11/harness-v4-cs336/toolchain-04.json work/cs336-tool04-rebuild
python3 tools/reproduce_visualbook_snapshot.py evaluation/2026-10-11/harness-v4-cs336/toolchain-05.json work/cs336-tool05-rebuild
```

初始工具01处于未提交状态，因此需基线提交加精确补丁。补丁SHA为 `4280248d6c8a25e0ae3a102e1cb0f43ece86e8c253837c4d28f3ada710ac8cb4`，实际198/198文件重建一致。补丁内空白上下文行是Git格式的一部分，不能为了消除diff-check告警而改它。

```bash
python3 tools/reproduce_visualbook_snapshot.py evaluation/2026-10-11/harness-v4-cs336/toolchain-01.json work/cs336-tool01-rebuild --patch evaluation/2026-10-11/harness-v4-cs336/snapshot-01.patch
```

实际核对结果保留在 `reconstruction-results.json`。这些只重建自有源码；依赖链接、浏览器、字体、账号、模型随机输出和教材均不是源码快照的一部分。

复算公开捕获的有限数值，用独立标准库脚本，输出到 ignored work：

```bash
python3 evaluation/2026-10-11/harness-v4-cs336/verify-figures.py evaluation/2026-10-11/harness-v4-cs336/math-captured-04.json evaluation/2026-10-11/harness-v4-cs336/plans work/cs336-math-recheck.json
```

实际执行9379项通过；这是复算已捕获数值，不是重跑模型，也不是新渲染。

新增批量曲线三数据变体的11状态另有独立663项核对：`python3 evaluation/2026-10-11/harness-v4-cs336/verify-batch-sweep.py evaluation/2026-10-11/harness-v4-cs336/batch-sweep-states.json work/cs336-batch-recheck.json`。这个样本由维护者编写，不能混入正式生成分母。

持有原教材时，以下命令实际已重建五个 raw candidate HTML，逐份与 `candidate-identities.json` 的 `rawHtmlSha256` 相同，零模型调用：

```bash
node evaluation/2026-10-11/harness-v4-cs336/rebuild-candidates.mjs /home/yang-zhi/桌面/Stanford-CS336-从头构建大语言模型/textbooks work/cs336-candidate-rebuild
```

脚本重建工具04、检查九册中用到的文件SHA、按既定行区间提取原选章、载入原计划，生成原始候选。新位置的source.json绝对路径元数据不同，不宣称其字节相同；raw HTML已实际相同。结果见 `candidate-rebuild-results.json`。

如需新浏览器预览，可对重建的单章用 `node work/cs336-candidate-rebuild/toolchain/tools/visualbook.mjs preview work/cs336-candidate-rebuild/position/book.html work/cs336-new-preview`。预览会产生新的证据，不替代旧的作者/维护者评审。原生导航组装和最终离线ZIP还须走共用成书检查，不能把raw HTML哈希相同直接当成交付质量。

最终本地ZIP包含11项，5,875,858字节，SHA256 `d7de6e1f34afcd24f12a7965daaea13ccab8034405ce7d8694ff443ddcf36d53`；正文导航HTML与raw HTML是两个分别登记的版本。原正式生成记录仍在 `primary-results.json` 和 `replay-results.json`，重建不能改变3/8原分母。
