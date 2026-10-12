# 把教材阅读交给 Quarto

用户试读后再次报告公式显示错误，建议使用成熟的开源阅读器。本轮只检查阅读底座，原151集课程的生成和第15章以后的复核保持暂停，没有新模型调用。

**建议采用 Quarto Books，加本地 MathJax。** 它已经提供书籍目录、章节导航、全文搜索、数学排版和交互内容入口。我们的仓库负责把教材和图解生成出来、按段落嵌入、检查交付结果。继续自己维护教材排版，已经消耗了太多精力，也没有得到足够可靠的结果。

官方依据：[Quarto Books](https://quarto.org/docs/books/)、[HTML 数学排版](https://quarto.org/docs/output-formats/html-basics.html)、[交互内容](https://quarto.org/docs/interactive/ojs/)、[开源仓库](https://github.com/quarto-dev/quarto-cli)。这里使用它的书籍发布功能，没有采用新的代理框架。Jupyter Book / MyST 也适合科学教材，不过[当前默认网页主题用 KaTeX](https://mystmd.org/guide/math)；本轮实际验证的是 Quarto，未对其他方案做性能或审美排名。

## 旧页确实存在什么问题

旧阅读器并非没有使用成熟公式引擎：它已经使用 KaTeX。问题之一出在我们自己的样式：`packages/visualbook/theme.css` 将行内公式也设置为 `overflow-x:auto; overflow-y:hidden` 的独立容器。

在线性方程组一章，实际浏览器显示411个公式，其中360个是行内公式；全部360个都使用滚动容器，81个有横向尺寸溢出。一个很短的二分之一分数出现上下裁切，其他短公式出现细小滚动条。这种缺陷不会被“公式数量对了、没有解析错误”的检查发现。旧检查覆盖不足。这个发现不能解释用户遇到的每一个公式问题，也不能据此声称 KaTeX 本身有错。

## 两章真实对照

选用已有的“线性方程组与消元”和“秩、基与坐标”。保留教材原文、原公式和五幅已有图解；没有让模型重新写教材或图。将图解作为独立 HTML 嵌在原段落后，正文与数学排版使用 Quarto 原生输出。

| 核对内容 | 实际结果 |
| --- | --- |
| 原文保持 | 移除插入的图解后，与两章原始 Markdown 逐字相同 |
| 原公式保持 | 原文解析树与 Quarto 输出中的有序 TeX 字符串完全相同，411 + 651 = 1,062处，仅去除两端空白 |
| 公式显示检查 | 两章各375 / 768 / 1280px，共6个浏览器条件；公式数量分别411 / 651，无 MathJax 错误元素 |
| 行内公式 | 六个条件都没有滚动容器；实际查看分数和中文正文截图 |
| 页面宽度 | 六个条件中整页都未横向溢出；375px下两章分别有5 / 13个长独立公式局部滚动 |
| 原有图解 | 五幅 SVG 均实际加载；“不用 w”按钮将系数从(1,2,1)改成(2,3,0)，终点保持(2,3) |
| 全文搜索 | 从第一章搜索“极大线性无关组”，Enter 后跳到第二章对应节，出现10个高亮 |
| 实际渲染 | 两轮官方 Quarto 渲染退出0，约4.17 / 2.76秒；安装检查与渲染结果分开保存 |

这是原文身份、排版与有限功能验证，不是1,062个公式的数学真值证明，也不是教师审阅或学习效果测量。

本地对照入口：<http://127.0.0.1:8768/qiu-quarto-preview-02/systems.html>。原14章试读入口保留，尚未把全部25章迁移。对照页也没有作为公开教材上传 GitHub。

## 仍需要少量适配

Quarto 默认页也有真实失败：375px时，第一章的5个长独立公式把页面宽度从360px撑到439px。第二轮只给独立公式添加局部滚动样式，行内公式保持普通文字流。没有改 upstream 的源码或分布包。

默认输出还包含一个远程 ES6 polyfill 标签。第二轮明确移除这个精确标签，记录两个文件的前后哈希；MathJax 使用本地完整 SVG 包。当前静态页面的脚本和样式引用没有绝对远程地址，不过没有做浏览器断网测试，不宣称完全离线认证。

图解通过 iframe 隔离现有样式，并由带同源、窗口身份和高度边界检查的消息同步高度。这只是两章迁移的试验做法；打印、PDF、触屏、屏幕阅读器和图解里的字体仍需单独检查，不能直接把它当作最终导出协议。

记录中仍有无来源 URL 的 `MutationObserver.observe` 浏览器错误，归属没有确定。已观察的公式、搜索和图解功能可用，但不能声称 JavaScript 零报错。官方渲染还给出 `zh-CN` 翻译数据告警；实际导航和搜索显示中文，不代表完整汉化已核对。没有用 Firefox / Safari 复验，也未检查全部25章。

## 固定依赖与复现

Quarto 使用官方 Linux x86_64 稳定包1.10.19，release commit `2c3c1a35b23f8bff15ca0fc1c881f29af8c885fa`，下载147,020,886字节，SHA256 `8e38c2b2df6a6dbd369ea16e15acded6894545258d13a02f777f81ad18fd7973`。MathJax 使用官方 Git tag3.2.2，commit `600692ad9d3552cc25f85510d5797bc942ecc9f7`，完整 SVG bundle SHA256 `a4354ff94fd868aea0cc6eaaa79a57fda0588646fc46ee3700a349ee0a11cbe6`。上游均未修改，留在忽略的 `work/` 下。

本目录保留[机器记录](RESULTS.json)、[两章准备脚本](prepare-preview.mjs)、[公式身份检查](check-formula-identity.mjs)、[配置样例](quarto-example.yml)、[独立公式样式](reader-adapter.css)与[图解高度适配](widget-resize.html)。这些是本地实验的复现材料，准备脚本需要原工作目录内的两章源文和既有图解计划，不是任意教材的生产导出器。完整教材、生成器账号日志、依赖包和截图没有进 Git。

从仓库根目录运行准备脚本会拒绝覆盖已有输出：

```bash
node evaluation/2026-10-12/reader-selection/prepare-preview.mjs work/reader-evaluation-20261012/rebuild-book
```

再将本目录的配置、样式和高度适配拷入输出目录，将固定 MathJax checkout 的 `es5/` 复制到 `assets/mathjax/`，用固定 Quarto 二进制执行 `render`。受限工作区需给此进程指定可写缓存，例如：

```bash
env XDG_CACHE_HOME="$PWD/work/reader-evaluation-20261012/rebuild-cache" DENO_DIR="$PWD/work/reader-evaluation-20261012/rebuild-deno" work/reader-evaluation-20261012/quarto/quarto-1.10.19/bin/quarto render work/reader-evaluation-20261012/rebuild-book
```

若要得到第二轮本地资产适配版本，还须按 `RESULTS.json` 的记录移除精确的可选 polyfill 标签；这里没有把这一特例包装成通用离线工具。

原输出的公式身份检查可直接重放：

```bash
node evaluation/2026-10-12/reader-selection/check-formula-identity.mjs
```

最初准备脚本的语法错误、两次 npm tarball 的 TLS 传输失败和不存在的 `python` 命令都保留在执行记录中。后续使用官方 Git 取得 MathJax、使用 `python3`，没有关闭证书验证。

后续正式迁移应先定义“教材原文 + 图解计划 → Quarto 项目”的导出接口，再用全书检查验证它。阅读排版交给 Quarto；图解模板、计算、动画、审美与生成可靠性仍是本项目需要改进的工作。

复现材料实际生成了一个新输出目录，但首次官方渲染因默认 Sass 缓存数据库不可写而退出1；随后的身份检查因 HTML 不存在退出1，不能沿用先前原输出的成功结果。原失败单独保留，随后改为本次进程使用工作目录内的缓存，第二次实际渲染退出0、约2.40秒；有输出后重新运行身份检查，1,062处有序TeX逐条相同。它没有重新生成图解，也不替代第二轮浏览器验证。

提交前检查了本轮意向文件、命名的 main 历史和公开提交树，以及 GitHub 的 issues/评论、release/资产元数据、分支、标签、部署、57个CI产物和35次运行的元数据；Pages接口404。固定 GitLeaks 使用仓库既有的精确公开文件哈希允许列表，扫描实际退出0。未配置该列表的首次扫描报告77个已记录哈希命中，原失败保留，未新增或修改过滤规则。本轮没有重新下载扫描这些远程CI产物或运行日志，不声称它们的内容都已审计。教材正文、模型输出、截图和上游依赖仍只在忽略目录中。范围及退出结果见[发布记录](PUBLICATION.json)。
