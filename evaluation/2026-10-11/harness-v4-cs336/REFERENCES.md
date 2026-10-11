# 参考与改成工具的部分

这些是实际查阅的公开参考。布局与图形实现为本仓库自己编写；没有复制网页图片、字体、新上游代码，也没有把参考站的教学效果当作本工具的效果。

| 参考 | 借鉴什么 | 进入工具的部分与边界 |
| --- | --- | --- |
| [Tufte CSS](https://edwardtufte.github.io/tufte-css/) | 小图/旁注紧贴相关段落，复杂图扩大宽度 | 正文、宽幅、局部左右页边三种位置；手机保留旁注。中文字号和布局自己写。 |
| [Distill 写作指南](https://distill.pub/guide/) | 正文/宽图/页边层次，静态图与局部动态共存 | reading模式把探索收起，静态图没有操作；没有安装Distill网页脚本。 |
| [Red Blob Games 六边形教程](https://www.redblobgames.com/grids/hexagons/) | 在当前解释附近改变少量变量，例子与公式相互对应 | 典型情况按钮、共享参数/结果连接。没有搬用六边形代码或宣布同等质量。 |
| [Transformer Explainer](https://poloclub.github.io/transformer-explainer/) | 可视对象应对应实际计算与内部数据 | RoPE/KV/路由由数值内核驱动画面；这里是确定性小例子，没有复现真实GPT-2推理。 |
| [D3 Sankey](https://github.com/d3/d3-sankey) | 连线粗细明确对应数量 | 自写ribbon-flow，只支持两列给定非负矩阵，共用数值尺度；不是通用Sankey，不安装该库，不把交叉线当物理通信。 |
| [RoFormer论文](https://arxiv.org/abs/2104.09864) | 成对旋转与相对位置内积 | 旋转频率和内积核对，不据此宣称长序列外推效果。 |
| [Switch Transformer论文](https://arxiv.org/abs/2101.03961) | 稀疏专家选择与分派 | 给定分数的top-k小例子，支持选中重新归一化或保留完整softmax权重两种显式约定；不是Switch全部算法，无训练、容量溢出或性能宣称。 |
| [H100产品参数](https://www.nvidia.com/en-us/data-center/h100/) | 明确峰值与带宽的单位 | 教材使用989 TFLOP/s、3.35 TB/s作示意；只算理想下界，不冒充实测。当前表的稀疏/密集口径需分开。 |

设计的参考只证明我们看过这些做法；本轮是否好读仍以实际CS336页面、保留失败和用户后续试读为准。

补充实际查阅的一级来源：

- [GQA论文](https://arxiv.org/pdf/2305.13245)，第2.2节与图2文字说明：分组查询头共享K/V。关系被改写为可参数化head-sharing及静态三种关系，未复制论文图片；存储比例不表示质量或速度排序。
- [DeepSeek-V2论文](https://arxiv.org/pdf/2405.04434)，第2.1.3节公式14–19与第2.2节公式21–22：MLA缓存需计入解耦RoPE部分，专家门控可能保留完整softmax中选中项的值。已有候选的C+R说明单独核对；新增full门控约定，不把所有MoE画成选中和必为1。查阅了PDF文字与公式；工具未返回可见论文截图，不声称审阅原图像素。
- [KaTeX选项](https://katex.org/docs/options.html)与[已知问题](https://katex.org/docs/issues.html)：采用实际KaTeX结构允许展示公式自然换行；不可分的长项局部滚动，真实Home/End检查，不缩小字号。
- [Roofline原始技术报告](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2008/EECS-2008-134.html)：只查阅官方摘要，作为计算/带宽上界模型的来源；没有宣称读过完整报告或做GPU测量。
