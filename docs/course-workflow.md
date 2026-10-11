# 从真实课程到可视化教材

这条流程实际用于151集中文高等代数课程。完整源媒体、机器识别、板书截图、教材和模型响应都写入ignored `work/` 或 `outputs/`。仓库只保存自有工具、来源身份与研究证据。当前来源解码固定中文，不能把本次验证推广为任意语言/任意课程准确。

先固定课程的BVID、全部CID、次序与时长；匿名接口可取得字幕就保留字幕，无法取得时转音频。视频只用于按时间抽取原始板书，当前公开接口取到的是480p，而非标题声称的1080p。获取脚本不读取cookies或账号文件，临时媒体地址只写ignored原始响应。

```bash
python3 tools/fetch_bilibili_course.py URL work/COURSE/ingestion --max-parts 151 --workers 3 --video
```

本地ASR使用隔离Python3.12环境和 `requirements-course-asr.txt`。本轮实际Python3.12.14、faster-whisper1.2.1、CTranslate2 4.6.0、PyAV16.0.1；系统Python3.14没有可用CTranslate2轮子，PyAV19移除了依赖使用的metadata_errors参数。二者失败均保留，不修改上游源码来掩盖不兼容。GPU须有兼容CUDA12/cuDNN9运行库，本轮只借用已有ignored环境，未改系统配置。

模型目录需提前下载固定revision，提供JSON `{repo,revision}`，每次实际检查权重文件哈希。本轮主要转写用 `Systran/faster-whisper-large-v3` 的 `edaa852ec7e145841d8ffdb056a99866b5f0a478`，局部复核用 `mobiuslabsgmbh/faster-whisper-large-v3-turbo` 的 `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`。不把安装或一次速度试验当成转写准确性证明。

```bash
work/COURSE/asr-venv/bin/python tools/run_course_transcription.py \
  work/COURSE/ingestion work/COURSE \
  --primary-model work/COURSE/weights/large-v3 --primary-pin work/COURSE/large-pin.json \
  --repair-model work/COURSE/weights/turbo --repair-pin work/COURSE/turbo-pin.json \
  --max-parts 151 --chunk-parts 32
```

同一GPU只串行加载主模型与局部复核模型。先完成一批原始转写，再检查疑似字幕/点赞幻觉、长缺口和异常时间；对疑似视频套话重解码带上下文的原音频。备选文本不覆盖原识别，也不自动宣称是老师真话。修复索引只允许追加不可变记录；同一原位置出现不同候选需明确处理，不能最后一次覆盖。已经完成的部分按输入与设置哈希恢复，源工具在运行中改变会停止下一阶段。

准备一个完整的知识章节计划，各实际分集必须恰好出现一次。章节输入保留全部时间锚点、原转写、局部备选和原始板书图；补抽帧可以回到明确授权的视频路径。可以额外提供附来源URL的身份核对JSON，用来防止姓名等信息被模糊字幕误导。完整书按知识关系组织，逐字稿与教材是两份材料，教材中的补充算例/证明必须标明。

```bash
python3 tools/run_course_textbook.py \
  work/COURSE/ingestion work/COURSE/transcripts-large work/COURSE/chapter-plan.json work/COURSE \
  --max-chapters 25 --attempt-limit 36 --timeout 1500 \
  --repairs work/COURSE/asr-repairs --verified-context work/COURSE/verified-context.json
```

写作用官方已有ChatGPT登录的Codex CLI，所有调用共用串行锁，不抽取登录令牌。每次写作冻结输入、板书、提示与工具哈希，保存原响应、覆盖声明、术语表及数学自查。启动次数和超时明确限定，失败也计数。模型的ready与覆盖声明仍需独立核查，结构门禁只检查真实分集/锚点/标题/哈希等；`blockingIssues` 表示仍影响正确性的缺陷，`sourceLimits` 表示必须保留的来源与审查边界。缺少教师审查不能假装通过了教师审查，也不等于所有注明限制的解释都不能交付。

数学、来源复核后的教材清单进入已有 `run_visualbook.py`。绘图使用独立campaign与最多32次正式启动预算，不能把教材写作次数混进同一个预算目录。先完成全书原文导入和公式预检，再生成图。共享工具在正式绘图期间冻结，改库后的旧计划重建必须作为维护者修订记录，不冒充新的自动模型成功。

最终使用 `deliver_visualbook.py` 检查完整目录、各章、三种宽度、脚本开/关、导出和ZIP身份。书的链接还要在真实本地HTTP服务器验证；只留下一个终端里的临时服务不足以交付。全套源文件存在、数值控制通过或某个页面漂亮，都不证明整本教材可靠。报告保留每阶段分母、失败、来源缺口及人工教师审查是否发生。
