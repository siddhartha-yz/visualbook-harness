# VisualBook 工具运行方式

这是可调用的教材生成工具，不是优质教材已经稳定批量生产的承诺。它使用官方 Codex 的现有 ChatGPT 登录，逐章串行调用；不提取凭据，也不调用额外代理。

## 安装与导入

要求 Node 22+、Python 3、官方 Codex CLI、Chromium。依赖和第三方固定源码放在忽略的 work/。

```bash
python3 tools/setup_visualbook.py --install
codex login status
```

setup会核对lockfile、13个直接依赖的实际版本及真实导入，后续不加--install即可复查。它不写outputs/、不下载D2L、不运行模型，也不安装浏览器。

如果 Chromium 未安装，使用 Playwright 官方安装入口。可用环境变量 CHROMIUM_PATH 指定实际可执行文件，不用绕过浏览器安全检查。

```bash
npm exec --prefix work/visualbook/runtime -- playwright-core install chromium
```

普通 Markdown 可直接输入。保留段落、代码、公式和本地图片；不默默下载远程图片，不忽略未知数学命令，不擅自删除原始HTML。D2L 的 Sphinx 宏、PyTorch标签和原图用固定源码适配器处理，不能当成普通Markdown直接扔进去。

```bash
python3 tools/run_visualbook.py my-chapter.md work/my-book --source-url https://example.com/original
```

D2L固定章节列表包含 upstream_commit、原文件哈希和 selected 路径。复现旧D2L样本需要先运行 experiments/visualbook/bootstrap.py --fetch；这个旧实验入口会重建outputs/visualbook示例页，应先保留正在审查的书。固定源码准备后可这样导入：

```bash
node tools/visualbook.mjs import evaluation/2026-10-10/harness-v2/sampling.json work/new-sources
python3 tools/run_visualbook.py work/new-sources/programming.source.json work/programming-book
```

原始教材、模型事件与中间HTML都留在忽略目录。source.json是导入后的内容，不是任意网页代码的上传格式。

## 生成与交付

每章一次独立会话，最长1200秒，最多3轮候选预览；模型可以自己写计划、调用绘图工具、看真实桌面与手机PNG、修改后重试。没有用户逐轮反馈。共享设计负责稳定对象、坐标、字体测量、矩阵等布局；选什么关系、怎么解释仍需要模型判断。

输入可为普通Markdown、单章source.json、多章manifest。manifest各章可以直接引用.md，不必先手动导入：

```json
{"title":"我的教材","chapters":[{"id":"chapter-one","source":"chapter-one.md"},{"id":"chapter-two","source":"chapter-two.md"}]}
```

```bash
python3 tools/run_visualbook.py chapters.json work/my-book --max-chapters 3
# 可先准备整本输入，不启动模型；之后--resume继续同一本：
python3 tools/run_visualbook.py chapters.json work/prepared-book --prepare-only
python3 tools/run_visualbook.py chapters.json work/prepared-book --resume
```

最后预览与最终问题记录必须匹配最终HTML和绘图计划哈希，公式完整，源文件和工具未被改动，图片确实返回给模型、起点终点已通过工具查看、最终问题记录没有已知遗留问题，渲染没有待处理问题，否则停止导出并保存 export-gate.json。停在诊断不等于教材完成；通过这些检查也不证明美观、严谨、易学。

成功后自动检查组装后的最终阅读页，检查通过才生成delivery/attempt-NNN/book.zip；失败保留诊断。book/index.html、各章HTML和许可证可以离线阅读。生成入口自动加入原生上一章/下一章链接；旧--resume不重写已有交付。禁用脚本时显示真实渲染的初始图，控制检查要求图片实际解码；它不能替代全部交互状态。完整正文保留，图解可以拖动、单步或主动播放一次，滚动页面会暂停演示。默认最多3章，显式调整 --max-chapters 才扩大调用范围；目前不支持直接输入PDF/EPUB。

整本Markdown可加`--split-level 2`或`3`，在原有H2/H3处拆分，前言与最后内容均保留，每个原文块只出现一次。拆分后章节数仍受`--max-chapters`限制；超预算在模型启动前拒绝。普通引用式图片/链接支持，脚注语法目前显式拒绝，需对应的来源适配器；不会悄悄吞掉脚注。部分多行`$$`与引用容器会只在渲染时适配，原文及位置映射保持原始字节。

所有章节先完成导入并封存输入，在真实Chromium检查375/1280宽度、禁用脚本的公式覆盖和本地图解码，再启动第一场模型会话。reader-preflight每次另存；原文宽度或解码失败不会消耗模型额度。--prepare-only也会检查原文阅读版。后面章节的坏公式或缺图会在消耗模型额度前停止。封存也包含本地图片内容；只改图片不改Markdown，--resume同样会拒绝旧输入。每次准备的成功与失败留在preparation/，不覆盖旧快照。

--resume只复用已有会话，不覆盖、不因为不满意而偷偷重复调用；原文改变必须另起目录。输入身份、调用用量、真实图片反馈、预览发现、失败和修订都留在会话目录。

长批次可以另开终端查看只读快照：

```bash
python3 tools/inspect_visualbook_run.py work/my-book
```

它逐章重新核对最终计划、HTML、预览和问题记录的身份，不信任旧`export-gate.json`。`candidate_gate_ready`只表示当前候选的工程检查通过，不能代表整书已交付；`authoring_or_interrupted`只表示目录存在但没有结束记录，不能据此推断进程仍活着。快照不读取提供方日志、不调用模型，也不恢复或修改任务；作者写文件期间可能暂时出现不可读状态。

视频上游的教材作者入口`tools/write_course_textbook.py`现在在会话退出后独立调用同一个只读公式检查，并按最终文件哈希核对结果。`node tools/check_textbook_math.mjs chapter.md`也可由作者在定稿前使用；不改公式、不调用模型，不把显示通过称为数学证明。后置检查最长90秒；错误、无效响应、身份不符、计数不一致或超时都会拒绝接纳，逐次证据保留在该任务的`formula-preflight/`。本轮原25章写作结束后才接入，[真实旧稿与修正副本验证](../../evaluation/2026-10-12/qiu-algebra-workflow/textbook-producer-gate-result.json)不能冒充原25章已经使用这个入口。

显示公式末尾的简单指标范围，例如`\qquad k=1,\ldots,r`，现在在渲染树中作为一个整体，允许在其前面换行，避免手机把等号和值拆开。原文不改；MathML/TeX显示结构的适配有记录。[全25章实际重编译和第二章修复记录](../../evaluation/2026-10-12/qiu-algebra-workflow/visual-source-repair-result.json)保留原作者拒绝导出结果，不把维护者修复称为自动生成成功。

独立计算检查器现支持19种操作。新增`dense`核对矩阵乘法、偏置、输入回显、形状及四种激活的有限数值输出；不认证权重经过训练或梯度正确。[真实记录重放与定向失败控制](../../evaluation/2026-10-12/qiu-algebra-workflow/dense-certificate-result.json)分别列出新增覆盖和仍未核验的操作。

## 不调用模型也能重建

```bash
node tools/visualbook.mjs build source.json book.json book.html
node tools/visualbook.mjs preview book.html preview-01
node tools/visualbook.mjs export book.html preview-01 offline.html
node tools/build_visualbook_catalog.mjs work/design-gallery
```

CLI构建book.html继续使用resolved-plan.json；其它输出如chapter-one.html对应chapter-one.resolved-plan.json，方便在同一目录保留多章计划。返回结果包含真实路径和哈希。

[接口和设计限制](API.md)给出完整方法。[本轮报告](../../evaluation/2026-10-11/harness-v3/REPORT.md)区分编译、实际渲染、模型生成、维护者复核和未做的用户审评。

迁移说明：v03–v05旧会话没有新的review.json。保留它们作证据或用单独组装工具复查，不会在--resume中默默赋予新的最终检查资格。当前最终检查已在真实会话中使用，已知问题确实阻止两次候选导出；这仍不能保证未知审美或教学问题会自动发现。

## 让模型使用已有设计

默认--composition-policy prefer-library：先检索并调用设计/组件，使用原生组合或put_design；缺少必要关系时仍允许自写，必须留下缺口说明和对应代码哈希，方便后续补工具。--composition-policy open保留开放绘图模式供对照；两个政策不能混作同一试验。这个记录不是质量评分或安全沙箱。

当前60组件、111设计、56数值操作。相同state/param可以连接多幅视图，$result连接之前计算的输出。除优化、张量与程序状态外，新增分词边界条带、按数量绘制的流带、RoPE、GEMM/单步decode访存、KV账本、紧凑通信矩阵和top-k路由。所有示例都有具体边界，手选参数不冒充训练。

阅读默认收起探索，复杂图可占用宽幅，小图与短说明可贴在当前段落左侧/右侧。静态图不带按钮，演示主动看一遍；典型情况按钮同时切换实际参数，避免多个滑块之间来回调整。具体声明见[生成入口](AUTHOR_API.md)。

原图使用懒加载，但preview会在截图DOM中主动加载并等待解码/绘制再采图，原文和候选HTML字节不改。这解决整页截图把未加载原图拍成空白的问题；解码通过仍不能判定图片的语义或艺术品质。

## 组装后的阅读检查与打包

```bash
python3 tools/deliver_visualbook.py work/my-book/book work/final-delivery
# 也可独立检查：
node tools/check_visualbook_collection.mjs work/my-book/book work/reader-check
python3 tools/package_visualbook.py work/my-book/book work/my-book.zip
```

检查器实际打开最终HTML，在375/1280/1920宽度、脚本开/关时核对正文块、公式数量、图片解码和章节跳转。它绑定成书哈希，拒绝被改动的章节；检查通过不等于数学、审美或教学认证。可选末尾参数firefox另用真实Firefox复查。

打包只收录阅读HTML、运行库许可证和去除本地路径的来源记录，不收录原始教材文件、会话日志或中间图。ZIP文件顺序和时间固定；相同交付可复现相同归档哈希。旧组装入口可在manifest指定navigation:true，新生成入口默认启用。

已有失败候选可用`node tools/rebuild_visualbook.mjs original.source.json unchanged-book.json work/fresh-rebuild`复编译。它先重导入原始Markdown，检查正文、公式、图片和计划身份，再实际预览；结果停在awaiting-review，不把维护者修复算成新的模型生成成功。

生成入口和--resume都会调用最终交付检查，旧记录保留，新的交付在新attempt目录。一次交付检查通过才创建ZIP；书文件被改动则拒绝，也不会补跑模型。无脚本时保存实际图片PNG，避免Firefox禁用页面Promise造成检查无限等待；有脚本时使用原生decode与宿主上限。

## 几乎重合的列与精确计算

`column-shear`输入二维列矩阵和减去的倍数，输出变换后的平行四边形、残余向量及面积。淡线保留原第二列，两个轴等比例。主图中非零残余短于14px时，另给一个明确只示方向的12px箭头；它不用于比较长度或面积。输入换数据、倍数可接参数，实例可以接进`columns`或分别接在原文例子旁。

`exact-matrix-product`对小矩阵用分数计算。后续精确运算使用`outputExact`，绘图使用`output`；矩阵、字面量和显示空间仍有界。普通`matmul`保持原来的数值计算接口，独立检查器也已补核。十进制共线反例曾在浮点残差传入后触发分数解析失败，原记录保留；精确版得到严格零残差。[实际来源案例、六种变体与失败边界](../../evaluation/2026-10-12/qiu-algebra-workflow/column-shear-result.json)区分模型生成、维护者修订、机械检查和画面审查。

结构化 `columns` 在375px肯定会上下排列时，构建器会拒绝部分“左图/右图”等成对定位图注。请使用可见标题或变量名称。这个检查只覆盖已识别的表达和结构，不判断任意自定义图或整段文意。实际课程失败与三个目录模板的修订、重渲染和未覆盖计算记录见[响应式图注证据](../../evaluation/2026-10-12/qiu-algebra-workflow/responsive-caption-result.json)。

自写图中的 `VisualBook.matmul(a,b)` 保留返回二维数组的接口，在同步绘图帧内也会记录输入和输出，接受同一独立矩阵检查。记录不会变成任意自写算式的证明；例如直接算的子式与符号仍需另核。两章真实重建的255保存状态、15阅读PNG与原版相同，并补上了原来缺失的乘法记录，见[实际调用记录证据](../../evaluation/2026-10-12/qiu-algebra-workflow/drawing-matmul-result.json)。

公式渲染现在能把矩阵旁的`(j=1,\ldots,n)`保持为一组。它只改变HTML渲染树，原文与锚点不变；显式作者分行环境保留。全25章的源码身份和实际手机/桌面公式覆盖另有证据，不等于所有公式的数学证明或最终图书验收。

## 长批次进程记录

```bash
python3 tools/start_visualbook_run.py work/source/manifest.json work/campaign/run work/campaign/process-01 --toolchain work/frozen-tools --campaign work/campaign --max-chapters 25 --attempt-limit 32 --timeout 1800 --resume
python3 tools/start_visualbook_run.py --status work/campaign/process-01
```

入口只启动已有串行生成器，使用自有冻结工具链与已有官方登录。进程记录目录必须新建；独立进程会保存实际退出码，PID与Linux启动时刻一起核对，防止旧PID被复用后误报存活。相同campaign的第二个入口会拒绝；已经启动却没有结束记录的作者会话也会拒绝自动恢复，需要先查真实进程并保留诊断。`live`只说明进程身份，不说明教材完成。原文、工具文件被改变会停止；这些限制也不代替官方作者的串行锁、模型用量上限和导出门禁。

本轮实际中断时，第15章作者父进程先结束、官方会话稍后完成，退出码无法取回。恢复记录明确写null，原自动门禁保持失败，再由维护者单独复核候选；没有重复模型调用。此入口已有真实脱离终端及退出码17的合成进程检查，整套课程恢复仍在运行，不能据此称为整书自动成功。

## Quarto 整书阅读导出

`tools/export_quarto_book.mjs` 接受标准Markdown或现有Markdown来源JSON、每章图解计划，以及按原顺序覆盖所有章节的分组。使用本地固定Quarto和完整MathJax SVG发行目录：

```bash
node tools/export_quarto_book.mjs work/book/manifest.json work/book/reader-01 --quarto work/pinned-quarto/bin/quarto --mathjax work/pinned-mathjax/es5
```

Manifest的`chapters`为`{id,source,plan,review}`，`groups`为`{title,chapters:[id,...]}`。正式导出要求每份review的`readyForReader:true`、`sourceFileSha256`、`planFileSha256`和`blockingIssues:[]`对应输入文件。`--draft`可省验收，仅用于明确标记的检查稿；`--prepare-only`不运行Quarto，不算实际渲染。目录必须新建，原失败/修订不得覆盖。

原文按块行号与SHA插入图解，反向移除插入必须恢复同一字节串。Quarto接管原生目录、中文搜索、正文排版和MathJax；宽图用原生column-page。图解隔离为iframe，脚本/CSS按内容哈希共用，滚动只暂停播放。普通行内公式保持原生流，真正过长的独立/行内公式可局部横向滚动并用Home/End到两端。渲染会检查有序公式；只接受数学模式行首缩进移除并保存字面差异，拒绝符号、文本模式或宏变更。保留本地依赖许可证和QuartoCOPYRIGHT。

资源策略拒绝额外远程script/link，仅明确移除Pandoc可选ES6 polyfill，并给阅读HTML加入本地资源CSP。它不是任意来源适配器：图片、原始HTML、frontmatter需另外实现，不能悄悄丢掉。review哈希、正常渲染和本地资源策略均不证明数学、审美、教学质量；最后仍需实际浏览器与来源/图意复核。实际25章迁移及失败见quarto-reader-result.json。

2026-10-13 的[整书交付报告](../../evaluation/2026-10-12/qiu-algebra-workflow/FULL-BOOK-REPORT.md)完成151集、25章、56图解的实际阅读包。原始可视化作者19/25章通过门禁，维护者修订与复核另列。正式打包新增：

```bash
python3 tools/package_quarto_book.py work/book/reader final-browser-review.json work/book.zip
# 解压阅读包，在解压目录运行，无需在线安装：
python3 serve.py --open
```

最终 browser review 要含 readyForPackage:true、assemblyRecordSha256、blockingIssues:[] 和整套 _book 的 fileHashes。资源变更、缺文件、外部 CSS 字体、越界引用会拒绝打包；固定排序和时间生成可复现 ZIP。主题使用官方变量关闭远程字体，上游源码不改。包内保留源 Markdown 与本地依赖许可，不包含账号、会话日志或音视频。
