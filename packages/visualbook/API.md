# 模型可调用的可视化工具

阅读时默认收起参数和进度条，timeline显示“看一遍”，static不带控制。复杂图可用placement:"wide"占用两侧空白，少量局部对象可用placement:"margin"及marginSide:"left"/"right"；正文仍约720px。presentation:"exploration"显式展开控制。手机保留全部页边信息。详见AUTHOR_API.md的布局与presets输入；命名设计会继承这些默认值。

先读取 source.md 的完整正文与锚点（source-map.json是结构，source.json是编译器内部数据），选择原书没有说明清楚的联系。输出 book.json：

```json
{"figures":[{"id":"gradient-example","design":"gradient-contributions","afterAnchor":"章节-001","endAnchor":"章节-004","title":"两条路径合成梯度","summary":"先确认示例条件与原文一致；这是手选例子。","overrides":[{"path":"/scene/props/terms/0/value","value":[-2,3]}]}]}
```

上例直接复用已经实现的设计。先查询适合当前概念的设计和输入路径；不适合时用scene拼接，仍不合适才写自定义draw。不要为了复用把错误的示例条件接到原文。

最多4图，推荐1–3图，也可合理跳过。每幅覆盖最多8个正文块，不交叠。height稳定，手机可用不同高度。progress 是读者控制的连续0–1，不能只Math.floor后切换整张画面；移动、展开、计算步骤需要适合原文的解释。参数应有因果意义。默认停在初始画面，读者可以拖动、单步或主动播放一次；滚动只会暂停，不推进图解。原文不要重写，图片和公式已经导入。

可选 `initialProgress`（0–1，默认0）、`durationMs`（1000–60000，默认8000）和 `checkpoints`（包含0和1的严格递增进度数组）控制初始视图、主动播放时长与单步位置。不要在源码中自行启动定时器或监听页面滚动。开启系统“减少动态效果”时，播放按钮禁用，拖动和单步仍可用。

figure 可声明 `interaction:"timeline"`（默认）、`"parameters"` 或 `"static"`。参数探索适合直接拖动点或调参数：不显示播放/进度条，必须提供实际有效的参数或共享状态把手。静态图没有交互控件。预览仅对 timeline 要求连续进度改变图形；参数检查仍检查两个端点的真实画面，声明但没有视觉效果的参数会报错。不要为了检查加入没有意义的运动。

## 按名字直接复用设计

figure可以声明 `design:"gradient-contributions"`，编译器展开已实现的设计，不必把它的scene或绘图源码复制进book.json。id、afterAnchor和必要的例子条件由作者填写。数据不同就用 `overrides:[{"path":"/scene/props/terms/0/value","value":[-2,3]}]` 替换真实存在的输入。使用JSON pointer；拼错字段、越界路径、非法参数或连接会被拒绝。也可以整体替换已有 `/params`、`/state`。不得同时提供design和scene/code。

先用 `describe_design_inputs({id})` 查询可替换路径和默认参数；需要看设计效果时用show_design。修改数据后仍须检查颜色、轴范围、条件和真实PNG。默认示例不能被当作原文自己的实验结果。复杂新关系可用scene自由拼接，或写自定义draw。`node tools/visualbook.mjs resolve-plan book.json expanded.json`保存实际展开结果，已有expanded文件不会被覆盖。

也可以直接调用 `put_design({id,design,afterAnchor,overrides})`：它把一幅设计接入当前教材并构建，保存修改前后计划和构建证据。修改已有图需要显式 `replace:true`，不会默默覆盖同名图。一次会话最多32次设计写入，失败也计数；构建失败的当前计划仍保留，旧HTML不能代替新候选。之后照常preview、inspect和finalize。这个入口调用已实现的设计，不生成另一份绘图代码。

## Board：共享绘图、布局与稳定对象

draw每次收到同一个board；工具负责begin/end、尺寸和键值复用。每个图形使用固定id，不要自己清空svg。纯数值计算使用JavaScript；工具不替你选择教学内容。以下颜色在`VisualBook.palette`中：ink、muted、blue、orange、faint、paper。

- `board.axes(id,{xDomain,yDomain,equalUnits,xLabel,yLabel,box,grid})`：返回`{x,y,left,right,top,bottom,unitX,unitY}`。box为[left,top,right,bottom]像素；默认自排。equalUnits保证x/y单位比例一致。
- `board.vector(id,frame,from,to,{color,label})`：数据坐标箭头，自动算箭头头部和短标签。
- `board.curve(id,frame,[[x,y],...],{color,width,opacity})`：数据曲线。
- `board.matrix(id,values,{x,y,cell,activeRow,activeCol,activeCell,label,color,precision})`：矩阵格、数值、高亮行列；返回尺寸。小屏须安排合适cell及上下排布，不要让矩阵超宽。
- `board.sequence(id,[{id,label},...],{active,x,y,width,height})`：宽屏横排、窄屏竖排的流程；active允许连续值，让信息位置持续变化。推荐3–5个短节点。
- `board.label(id,text,x,y,{maxWidth,size,color,anchor,avoid})`：实测字体宽度、换行、边界限制与有限避让。避让不保证所有组合无碰撞，必须看预览。
- `board.text(id,text,x,y,{size,color,anchor,opacity,weight,halo})`：精确短数值，默认15px、无描边；图形交叠确需背景描边时显式 `halo:true`。条形内/外数值用普通文字，勿塞段落。`board.label` 默认保留几何注释的背景描边，可用 `halo:false` 关闭。
- `board.line(id,x1,y1,x2,y2,color,width,opacity)`、`board.circle(id,x,y,r,color)`、`board.rect(id,x,y,w,h,fill,attrs)`、`board.path(id,points,options)`：基础图元。
- `board.mark(id,tag,attrs,text)`：自定义SVG扩展，保留对象身份。

## 可直接复用的完整设计

- `board.product(id,A,B,{progress,row,col})`：自动算矩阵乘法，桌面并排、手机上下排布，高亮参与的行/列并移动贡献标记，返回真实terms/sum/C。适合小矩阵（最多5行/列，太密会明确拒绝）。高度建议桌面300、手机420；自己看预览。
- `board.optimization(id,{a,b,start,kind,eta,rho,epsilon,steps,progress,compare,xDomain,yDomain})`：二次目标a*x₁²+b*x₂²的等高线、优化轨迹、连续当前位置和可选比较；实际计算用trace。默认是D2L常见示意条件，不是通用深度网络训练。轨迹若超出指定domain需改参数或范围，工具不掩盖发散。
- `board.probabilities(id,scores,{temperature,progress,labels})`：稳定softmax计算、概率轴、短柱形标签，progress从均匀权重连续变到目标分布；不是把插值当真实训练过程。最多10项。

设计模板也允许组合或扩展；不是每个章节都应该套模板。模板返回facts仍须核对表达是否贴合教材。不能把不适合问题的模板强行使用。

## 可以像积木一样组合

一幅图可以用 `scene` 替代 `code`，二者只选一个。scene 负责排布和连接输入；所有实际计算与绘图由组件执行。组件数值输出可传给后面的组件，不能拿未生成的结果。任意新想法仍可写 draw 源码，不必局限于目录。

```json
{"type":"columns","layout":{"weights":[2,1],"gap":18},"children":[{"id":"geom","type":"projection","props":{"vector":{"$state":"v","fallback":[1.5,1]},"onto":[1,0],"progress":{"$progress":true},"stateKey":"v","draggable":true}},{"id":"values","type":"readout","props":{"items":[{"label":"投影","value":{"$result":"geom.projection"},"color":"orange"}]}}]}
```

figure 中可设 `state:{"v":[1.5,1]}`。拖动向量会更新同一份状态，图与读数一起重画；手机上下排布保留状态与对象。`columns`、`stack`、`grid`、`overlay` 可以嵌套，每个子项必须有不同 id。columns 默认每列至少260px，窄屏改为上下排布；`layout` 支持 gap、padding、weights、minColumnWidth 和 grid 的 columns。先给足 mobileHeight，不要靠缩小字号塞下所有东西。

绑定仅支持：`{"$param":"eta"}` 读取已声明参数；`{"$state":"v","fallback":[1,1]}` 读状态；`{"$progress":true}` 或 `{"$progress":[0,6.28]}` 映射演示进度；`{"$lerp":[起始数值或数组,终值]}` 连续插值；`{"$result":"组件id.输出字段"}` 引用前一组件的实际结果。插值是解释变化，不能称为真实迭代或训练。

源码组合也支持 `board.region(id,{x,y,width,height},localBoard=>...)`，所有坐标变成该区域的局部坐标，原有矩阵、曲线等方法可直接复用。`board.layout(count,options)` 返回局部排布。`draw` 额外收到 `state` 和 `controls`：setState(key,value)、setParam(key,value)、setProgress(value)、pause()。不要改状态后忘记刷新，使用这些共享方法。

`board.handle(id,frame,[x,y],{onChange,label,ariaLabel,color,axis,step,bounds,constrain})` 提供稳定的鼠标/触摸把手、方向键与边界约束，默认双轴移动，axis 可为 x 或 y，bounds 为 `{x:[最小,最大],y:[最小,最大]}`。label是可见的短标记，ariaLabel是辅助阅读说明，多把手不要堆叠说明文字。拖动时暂停演示。`board.selectable(node,{label,selected,onSelect})` 让已有图元能用点击、Enter、空格选择。

新增概率/学习组件：distribution、histogram、bayes、regression、loss-curve、decision-boundary、pca，可和下列基础组件用共享状态和 $result 拼接。用 describe_component 查询完整字段。

当前基础组件：projection（vector、onto、progress，可拖动）、linear-transform（2×2 matrix、vector、progress）、plot（xDomain/yDomain 与 curve/points/vector/area/handle 图层）、readout（短 label/value 数值列表）。数学组件：function-plot（function、x、derivative）、derivative（function、x、h）、integral（function、a、b、count、rule、progress）、unit-circle（angle）。函数 function 是数据：polynomial + 低次到高次 coefficients，或 sin/cos/exp/log/sigmoid/tanh/relu/gaussian；gaussian 支持 mean/sigma。范围需要覆盖教材例子，工具不会把画外数据伪装成画内结果。用目录的真实图片选择合适设计，完整示例和限制随目录提供。

查看共享数学内核：`VisualBook.project(v,onto)`、`scalarFunction(spec).f(x)/df(x)`、`riemannSum(spec,a,b,{count,rule})`。ReLU在0处不可导，显示0只是选择的次梯度；`h=0` 显示解析导数，不执行0/0；数值积分和精确积分分开返回。

## 张量与卷积设计

- `board.reshape(id,values,rows,{progress})`：保持行优先顺序和元素数量，让同一批稳定对象移动到新形状；不是转置。最多36值、每维最多8，过密会拒绝。新行数必须整除元素总数。
- `board.convolution(id,input,kernel,{stride,padding,progress})`：实际计算深度学习中的互相关、输出尺寸、当前窗口的乘积求和；核不翻转。支持输入最多6×6、核最多3×3、零填充最多1。连续窗口移动是阅读演示，输出只取实际离散位置。手机需选择小例子，建议height330/mobileHeight430。
- `VisualBook.correlate2d(input,kernel,{stride,padding})`：无DOM数值结果，检查核、步幅与填充形状，不假装测量硬件执行。

本地MCP的 `search_designs({query})` 按概念检索最多六个组件；`describe_component({id})` 返回实际输入字段、输出、限制与示例。目录是积木的展示方式，不要把整份源码读进上下文。概率/学习组件的 `compute_math({operation,inputs})` 调用同一无DOM计算内核，支持normal-cdf、binomial、histogram、bayes、regression、regression-optimum、pca；这是核对实际使用数值的便利工具，不是独立数学验收。

本地MCP的`list_designs`给出目录与限制，`show_design({id})`返回某种设计的执行示例及真实桌面/手机PNG。每次会话最多查看两种不同设计；查看示例不修改候选教材，也不占候选的三轮预览。

卷积/加权回归新增 `receptive-field` 和 `kernel-regression` 组件。前者保留膨胀空洞、补零边界、步长和多层实际输入索引；图上点的位置只是关系排布，不是原始空间坐标。后者直接拖动查询点，彩色圆面积与归一化高斯权重成正比；给定样本不代表训练结果。两者也有无DOM的 `receptive-field`、`gaussian-weights` canonical计算，输出能通过compose接到其它画面。

自定义图可用 `VisualBook.plotFrame(board,id,{xDomain,yDomain,title,grid,footerHeight})`；footerHeight额外保留0–80px给短图例，避免占用坐标刻度。它仍须给绘图区留下至少160px高度。

## 可检查的数学计算

`VisualBook.dot(a,b)`、`matmul(A,B)`、`mix(a,b,t)`、`clamp(v,min,max)`。

`VisualBook.trace(kind, gradient, start, {eta,rho,epsilon,steps})` 返回每一步theta、square、gradient、step。kind是sgd/rmsprop/adagrad/momentum，采用RMSProp分母sqrt(square+epsilon)、momentum的velocity=rho*velocity+gradient约定；条件与教材不同请明确说明或自定义，不能盲套。参数不是训练结果。

`VisualBook.interpolateTrace(trace,progress)`只把相邻迭代位置作阅读演示插值，返回theta/index/previous/next；不是新增优化步骤。数据范围先按全部轨迹确定，避免镜头随progress乱变。

## 命令行工作流程

使用任务给定的TOOL绝对路径：

```
node TOOL build source.json book.json book.html
node TOOL preview book.html preview-01
```

preview返回真实桌面/手机PNG和report.json，覆盖0、0.25、0.26、0.5、1进度，以及单参数两端、全最小/全最大参数在0.5/1进度的实际检查。不是所有参数组合穷举。用图片查看工具看画面，处理具体碰撞、越界、错误轴和解释问题。修改book.json后重新build并使用新preview目录，旧失败保留。两臂都有同一预览工具；direct加`--direct`并自行操作SVG DOM，不使用Board或VisualBook库。

预览的布局检查不证明数学或教学正确；返回facts须是画面实际使用的数据，不能自打分。不要访问网络、账号配置、外部凭据或改工具源码；只写当前任务目录。工具接受本地已授权生成源码，不是陌生代码上传服务。

构建和预览用MCP的build_book/preview_book，图片直接作为工具结果进入模型上下文。不要cat编译后的book.html或source.json来假装看图；源文、锚点和真实图片是分开提供的。每次修改后重新预览，导出哈希必须一致。

trace要求有限向量、同形有限梯度、eta≥0、epsilon>0、0≤rho<1和0..1000整数步。其step>0记录的gradient是到达当前theta时使用的上一位置梯度；需要当前位置梯度时重新用自己的gradient(theta)计算。sequence让同一个signal对象跨越各层，不用切换不同标记。普通Markdown可用--source-name注明原文归属。

最终检查：用inspect_frame({id,width,progress})查看最后预览的每幅图在1280/375下的0/1端点，图片直接返回，不消耗新预览。随后调用finalize_book({issues:[],mathCheckNote:"实际核对方式",limits:"未验证范围"})。issues必须如实记录所有已知未解决遮挡/数学/教学问题，不给自己打分。没有最终记录、记录过期或仍有已知问题，流水线停止导出。这个机制只能挡住已经被发现的问题，不能证明模型审美判断正确。

计算图 autograd 使用标量节点，支持多输出与反传 seeds 计算 Jᵀv；detach 保持前向值并截断梯度。g 表示目标加权和对该节点的导数。多次使用同一输入须分别累计，零贡献的反向边不显示传播标记。traceGraph 的 seededValue 是加权目标，value 仍是原始输出（多个输出时为数组）。

## 选择器和神经网络积木

参数支持原有数字范围，以及 `{"key":"mode","label":"模式","kind":"select","value":"batch","options":[{"value":"batch","label":"当前批次"},{"value":"running","label":"给定历史统计"}]}`。原生下拉列表保留string/number/boolean值，不用0/1冒充文字模式。每个选择器2..8项，检查遍历全部选项。

新增tensor（矩阵与热力图，颜色和数值分开）、attention（Q/K/V实际计算，输出可接tensor）、normalization（样本×特征，axis0/1，epsilon在sqrt内，gamma/beta按特征）、dense-layer（给定权重的仿射和激活，点选输出）、dropout（显式固定掩码，inverted缩放，推理恒等）。原有product/reshape/convolution/optimizer/probabilities/sequence也已注册为scene组件，能通过$result拼接。pca支持projection与coordinates两种表示，可共享数据和pointColors。输入输出及限度用describe_component查，避免猜字段。

compute_math另支持matmul、softmax、attention、normalization、dense、dense-backward、dropout、squared-loss、softmax-loss，全部使用同一无DOM内核，不是独立验收。describe_calculation返回必填字段、支持字段和真实输出，先查后接。输出的convention说明尺度、统计分母与手选权重等限制。实际训练和硬件时间不在这些工具的证明范围。

需要中间计算时，可用compose连接最多16步受限计算，再绘图。不是eval表达式语言。每一步的$result只能引用前面的真实结果，编译时拒绝未定义输出和向前引用。例如：

```json
{"type":"compose","calculations":[{"id":"forward","operation":"dense","inputs":{"input":[[1,2]],"weights":[[0.5],[1]],"activation":"linear"}},{"id":"loss","operation":"squared-loss","inputs":{"prediction":{"$result":"forward.output"},"target":[[2]]}}],"visual":{"id":"numbers","type":"readout","props":{"items":[{"label":"输出","value":{"$result":"forward.output"}},{"label":"损失","value":{"$result":"loss.loss"}}]}}}
```

dense-backward的seeds形状必须与输出相同，返回inputGradient/weightGradient/biasGradient。它计算输出加权和的导数，不自动对批次平均；把损失实际导数作为seeds连接，可展示完整链式法则。给定权重不代表训练结果。squared-loss默认half-squared的mean除以全部标量个数，softmax-loss的mean按样本数平均，不能混用分母。

构建记录绑定原文、计划、工具和HTML。失败构建、修改原文/计划或改变HTML后，MCP拒绝沿用旧画面。修订必须成功build_book再preview_book。导出拒绝已经发现的渲染问题；关闭JavaScript时使用实际渲染的SVG初始帧，隐藏没有作用的控制器。

## 编程关系与逐步观察

array-view把逻辑索引与共享缓冲区地址连接，支持显式elementStrides/offset和点击索引；task-schedule按照任务依赖和同行顺序计算示例调度。两者的字节大小和时间均由输入给定，不代表JS、CPU或GPU实测。code-lines与memory-objects可以独立拼接，也可由memory-trace执行有限allocate/alias/copy/write/delete指令后组合。代码字符串只用于显示，不宣称执行了任意Python；颜色按对象身份对应，不按变量名分配。

离散步骤可使用参数`{"key":"step","label":"已执行语句","kind":"stepper","min":0,"max":4,"step":1,"value":0}`，有原生滑块和前后按钮，边界自动禁用。不用时间插值制造不存在的中间程序状态。

Board.path只接受有限二维坐标数组；SVG路径字符串使用`board.svgPath(id,d,{color,width,opacity,dash,fill})`。渲染检查同时检测非法几何属性和浏览器控制台错误。Board.text支持family，measure第三参数使用相同字体；局部代码不压到13px以下。

每次MCP构建都会保存不可覆盖的builds/build-NNN输入计划、原文、结果和构建记录，包括失败。每次预览保存attempt、实际渲染及错误记录；失败也占三轮次数。设计目录保存原始源码、原始HTML、渲染报告和另行导出的HTML，不用导出文件覆盖待复核的原始渲染输入。

## 贡献、区间和固定帧导出

`contributions` 接收带 `id,label,value,weight` 的项，value为标量或同维向量。每项保留正负号，输出完整向量sum/visibleSum/partialSums。可把梯度的两条路径、期望的概率加权项、线性组合接到同一组件；它不替作者推导梯度。显示最多6项的一个坐标，progress是逐项加入的连续解释构造。

`lifetimes` 接收 `{id,label,start,end,size}` 区间，采用 `[start,end)`：结束点已释放。输出真实activeSize/peakSize和事件阶梯数据；绘图显示最多8条区间和同时存活量。所有大小、时间来自输入，不声称真实框架内存或硬件测量。时间域可以共用，使多图对照同一时刻。

MCP可选 `export_motion({label,id,width:375,fps:20,duration:6,formats:["gif","mp4"]})`，必须先完成同一份计划的图片审阅和finalize。参数图需要 `sweep:{key,from,to}` 指定一个实际数字参数；整数stepper只生成整数状态。每次最多300帧、两次尝试。GIF只播放一遍；不会替教材加入自动播放。工具保存每帧PNG/SVG/facts、重放一致性检查、编码日志及解码抽样图。不动的图或已知错误会停止导出。

本地命令：`node tools/export_visualbook_motion.mjs book.html preview-directory work/fresh-output motion.json`。需要已有FFmpeg，工具不自动安装；中间帧与视频留在ignored work。输出文件可另行交付，不能把导出成功当作审美或教学认证。

二维贡献可以用 `vector-sum`：给定1–4个二维加权项、共同起点与完整坐标域，返回vertices/currentEndpoint/endpoint。共享箭头对零向量不画假箭头，短向量的箭头头部也随长度收缩。默认示例含数据/惩罚两项；它不替模型推导梯度。

## 二维函数与可读的数值

`level-set`绘制有限二维解析函数的等高线，黑点可直接拖动，`point/value/gradient/hessian`能接入其它组件。field支持`{type:"quadratic",matrix:[[3,1],[1,1]],center:[0,0],constant:0}`或`{type:"rosenbrock",a:1,b:8}`；二次型采用`0.5*(p-center)^T H (p-center)+constant`，矩阵必须对称，但不假设正定。相同无DOM计算是`compute_math({operation:"scalar-field",inputs:{spec,point}})`。等高线是21..101网格的采样近似；橙箭头长度经过归一化并在边界缩短，只表示梯度或负梯度方向，不能叫真实梯度大小或一次优化更新。方向为none时不画箭头，零梯度也不画假箭头。

`VisualBook.formatNumber(value,{precision:3})`只改变显示，极小的非零值使用科学计数，精确facts保持不变。`fitNumber(value,{maxWidth,precision,size,minSize})`使用实际字体测量，先尝试所需精度，必要时减少显示位数，字号至少12px；仍放不下就拒绝。tensor返回displayValues/displayPrecisions说明实际显示内容，不能拿显示舍入值代替运算值。

正式preview会实际操作注册的图内把手和选中点，检查键盘/指针输入是否改变画面、是否报错以及无输入重画是否一致。最多16个注册控件/图、两个尺寸、首次可用姿态；没有穷举所有状态、自定义DOM控件或物理触摸设备。无作用的把手、输入后错误和随机重画进入正式发现，失败截图返回模型，阻止导出。数值正确与图形美观仍须分别审阅。

`aligned-points`把同一批项目在1–5行数值中的位置连起来：每行`{label,values}`，数量一致，共同数字刻度，均值与总体方差可选。点选一个项目会用共享状态同时强调所有行的同一项；重复值只在非定量纵向轻微错开，不改真实x值。它能接规范化/仿射输出、成对观测或其它一一对应数据。连线不代表因果、时间或训练轨迹，数字同刻度也不意味着物理单位相同。

`compute_math({operation:"transpose",inputs:{input,index}})`返回转置数值、前后形状与交换后的选中索引。可以把标准化的N×1结果转成一行送给点图，或者把矩阵的同一元素连接到另一幅图。这里不推断真实框架是否复制了存储。

### 采样响应、拟合、源文补充

`sample-grid`返回显式`grid`描述、cell-centre `points`和可选二维解析`field`的N×1 `values`。`dense`可以直接接`points`，然后把结果送给`scalar-map`；两幅图可共用`point/stateKey`。色图要求显式色标覆盖所有样本，不默默剪裁；读数取所在单元中心，不能冒充连续精确函数或训练结果。示例`neural-response`、`sigmoid-response`、`sampled-field`可以直接`put_design`。

`polynomial-fit`对2..40个明确观测执行列主元Householder QR，degree0..12，支持明确center/scale基底和非负λ。惩罚不含截距；没有可靠满列秩时拒绝，而非编造解。返回系数、残差、训练均方误差、目标、驻点梯度和采样曲线；`diagonalRatio`不是条件数。可接`plot`与`readout`。`plot.legend:true`由同一图层生成图例，最多六个不同短标签，避免观测/拟合含义混淆。

`inspect_source`查真实邻接；图和补充不能拆开冒号引导句与紧跟公式/代码/列表/表格。`put_annotation`可追加明确标注的condition/clarification/correction和可选TeX；原文和哈希不变。补充公式实际编译并另计显示覆盖，不能拿补充代替原公式。

默认生成入口是`prefer-library`，使用较短的AUTHOR_API.md和实际MCP构建约束：design/scene优先，自写code需要`declare_drawing_gap`说明实际检查过的设计与缺口，声明绑定当前代码哈希，代码改后重新声明。最多十二次含失败；不是安全隔离、证明缺口真实或品质保证。明确`--composition-policy open`保留开放绘图研究路径；不同政策的结果不能混作公平同方法对照。

## 状态更新与高维索引

`optimizer-trace`从解析场或显式梯度序列二选一计算SGD、momentum、Adagrad、RMSProp、Adam，保留每步更新前位置/梯度和更新后位置/函数值。Adam整数步偏差校正；新的自适应分母为sqrt(v)+ε，和旧VisualBook.trace的sqrt(v+ε)不同。可把visiblePoints接level-set.paths，把selected接readout；不是训练或收敛保证。

`gradient-step`对相同形状的小矩阵算values−ηgradient；可接softmax-loss的梯度再重新计算概率/损失，但不自动证明梯度对应某个目标。`tensor-reindex`保存每个逻辑元素的原索引、轴置换后索引、reshape后索引及两种显示格子；最多四轴64值，没有零拷贝或硬件宣称。

检索设计会说明是否scene、有多少参数、哪些canonical计算。同关键字分数优先scene数据接口，不是品质排名。新增optimizer-landscape、adam-bias、softmax-competition、softmax-gradient-step、head-reindex均可替换数据并接现有组件。

张量cellAspect:auto默认使单行/单列向量可以是矩形格，矩阵保持方格；square/free显式选择。aligned-points的compact:auto按可用空间选择50px或68px行间隔；compact:true/false可显式选择，字号仍12..13px。列/堆叠权重与总高度仍需安排，任意复杂场景不保证自动适配。

长公式不缩小到难读的字号：展示公式优先在关系符和运算符处自然换行，无法拆开的矩阵、行内公式保留局部横向查看。只有实际超宽公式获得焦点和长公式标签，左右/Home/End在该区域操作；禁用脚本仍保留局部滚动的CSS和完整公式。

## 分组共享与专家门控

`group-map`把1..8个显式source节点按assignment连接到1..8个target节点，返回实际分组；它展示引用或归属，没有通信方向或注意力权重。`head-sharing`是具体注意力头共享关系：1..8个queryHeads，kvHeads必须整除queryHeads，同组Q引用同一对K/V。读数cacheRatio只表示相同长度、精度和头维度下的KV存储比例，不表示质量或速度。

设计`head-sharing-cases`用同一个kvHeads参数连接共享关系与真实cache-footprint账本，MHA/GQA/MQA按钮一次更新两幅视图。`head-sharing-families`是三种关系的静态并列，手机按列顺序排列；`owner-group-map`用任意显式assignment展示对象归属。关系模块和数值账本可独立拼接，不要求使用注意力示例。

`top-k-route`增加可选normalization，默认`selected`保持旧行为：只对选中分数做softmax，选中权重之和为1。`full`先对全部专家做softmax，选中后保留原权重，选中和可能小于1。返回normalization与每个token的weightSums。两种约定没有通用优劣；作者必须按来源选择。`routing-gate-conventions`用相同分数、相同选中集合静态比较两种数值，不能冒充实际训练、负载均衡或容量溢出模拟。

## 原文与预览图片

run默认在第一场模型前用真实Chromium检查整本原文在375/1280宽、禁用脚本时的公式覆盖、整页宽度和本地图解码；失败保留reader-preflight记录并停止。preview会在截图DOM中主动加载、解码所有原图并等待绘制，候选HTML字节和原文不改。解码通过不证明图片内容/语义正确，模型仍需看实际图片。

optimizer-trace新增Yogi的D2L PyTorch递推约定及每维firstMomentCurves/squareMomentCurves；算法的二次状态不是EWMA，不声称校正后无偏。epsilon仍显式可选，默认1e−8，不冒充D2L演示的1e−3。新稀疏梯度设计使用eta=0仅比较状态。aligned-points compact默认auto，有限空间使用50px行距，宽松空间68px；显式布尔选择可覆盖，字号保持，空间不足仍拒绝。

相等数值的点选区域按本行最近项分区，重复值保留原x和非定量纵向微偏移，鼠标/Enter选择保持同一项目；1/3/4项、375/1280的实际软件输入已核对。密集到不可辨的值仍需其它阅读方式，不声称真实触摸已验证。
