# 本轮参考与取舍

- [原始课程](https://www.bilibili.com/video/BV1jR4y1M78W/)：唯一授课来源，冻结BVID、151个CID与分集次序。公开匿名播放器未返回可下载字幕，并不证明登录环境或原视频没有字幕。
- [北京大学数学学院丘维声个人页](https://math.pku.edu.cn/jsdw/ltx/69575.htm)：核对姓名“丘维声”。原识别与模型第一章自行声称的“邱维声”不作为姓名真值，维护者修正记录与原响应分离。
- [清华大学出版社2010版教材介绍](https://www.tup.tsinghua.edu.cn/booksCenter/book_03258702.html)：只核对书名、作者与出版身份，不拿出版物倒写逐字稿。
- [Video2Book](https://github.com/LINJIANG12/video2book)，本地固定提交 `0127fd1fa3b343d293a2543d4a79aa7a706fa410`：借鉴来源分层和知识章节组织。实际走本地ASR，未执行其禁止本地ASR的原技能，不能叫原生完整复现。
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)：固定1.2.1，GPU使用原有CUDA12/cuDNN9依赖；PyAV19不兼容 metadata_errors，隔离环境固定16.0.1。没有修改上游。
- [3Blue1Brown：换基](https://www.3blue1brown.com/lessons/change-of-basis/)：借鉴同一个向量保留几何身份、两套基与坐标并列的讲解方式。自写组件与算例，没有搬运截图、原动画或讲稿。
- [Immersive Linear Algebra：行列式](https://www.immersivemath.com/ila/ch07_determinants/ch07.html)：参考把几何对象、参数变化和邻近正文连起来的方式。代数教材不能把二维面积图当成任意数域上的证明。
- [Axler开放教材作者站](https://www.linear.axler.net/)：可用作独立理论对照，不是本轮转写来源；未复制其教材作为课程正文。
- [Axler第四版第6章](https://linear.axler.net/LADR4e.pdf)：实际核对复内积“第一个变量线性”的定义及另一种约定的说明。新计算入口要求显式选first/second，不把某一约定藏成默认值；未复制书页或正文。
- [SymPy矩阵文档](https://docs.sympy.org/latest/modules/matrices/matrices.html)：核对adjoint为共轭转置，与adjugate（伴随矩阵）不同。独立数值对照使用本地固定SymPy1.14.0，而不是网页浮动版本。

设计原则：静态默认能读懂，必要的连续构造主动短播；离散算法用真正的离散步骤。图里优先画对象与关系，说明只给一条阅读线索；运行限制和审查证据留在开发记录。新图的通过门禁仅意味着检查范围内没有已发现布局/公式错误，仍须实际看画面并检查教学含义。
