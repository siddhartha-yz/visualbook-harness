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

独立计算检查器现支持17种操作。新增`dense`核对矩阵乘法、偏置、输入回显、形状及四种激活的有限数值输出；不认证权重经过训练或梯度正确。[真实记录重放与定向失败控制](../../evaluation/2026-10-12/qiu-algebra-workflow/dense-certificate-result.json)分别列出新增覆盖和仍未核验的操作。

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

当前59组件、110设计、55数值操作。相同state/param可以连接多幅视图，$result连接之前计算的输出。除优化、张量与程序状态外，新增分词边界条带、按数量绘制的流带、RoPE、GEMM/单步decode访存、KV账本、紧凑通信矩阵和top-k路由。所有示例都有具体边界，手选参数不冒充训练。

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
