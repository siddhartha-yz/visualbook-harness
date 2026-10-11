# 公开证据怎样重建

实际已验证两份：Adam、Softmax定向重放。结果见[public-rebuild-results.json](public-rebuild-results.json)：原文JSON和raw HTML与原记录逐字节相同，零模型调用。Softmax原来的拒绝仍保留。下面需要当前仓库Git历史、固定Node依赖，以及固定D2L源码；不需要provider日志。

先在当前仓库执行 `python3 tools/setup_visualbook.py --install`。D2L源码应在ignored `work/visualbook/upstreams/d2l-zh`，HEAD为 `e6b18ccea71451a55fcd861d7b96fddf2587b09a`。缺少时可从官方 `https://github.com/d2l-ai/d2l-zh.git` 创建新的固定副本；已有不同版本不要直接重置正在使用的评估目录。

以下脚本从当前仓库根目录运行。输出目录必须不存在；每章分开保存，以兼容冻结版CLI的旧附属文件行为。源码与依赖使用已有固定副本，不修改它们。

```python
import hashlib, json, subprocess
from pathlib import Path

root = Path.cwd()
out = root / "work/public-candidate-rebuild"
out.mkdir()
archive = subprocess.run(["git", "archive", "cec6a00"], capture_output=True, check=True).stdout
subprocess.run(["tar", "-x", "-C", str(out)], input=archive, check=True)
(out / "work/visualbook/upstreams").mkdir(parents=True)
(out / "work/visualbook/runtime").symlink_to(root / "work/visualbook/runtime", target_is_directory=True)
(out / "work/visualbook/upstreams/d2l-zh").symlink_to(root / "work/visualbook/upstreams/d2l-zh", target_is_directory=True)

base = root / "evaluation/2026-10-11/harness-v3/candidates"
candidates = ["adam-harness-phase9", "softmax-regression-harness-phase9"]
inputs = [json.loads((base / c / "source-data.json").read_text()) for c in candidates]
sampling = {"upstream_commit": inputs[0]["sourceCommit"], "sections": [
    {"stratum": d["id"], "selected": d["source"], "source_sha256": d["sourceSha256"]}
    for d in inputs
]}
(out / "sampling.json").write_text(json.dumps(sampling, ensure_ascii=False))
tool = out / "tools/visualbook.mjs"
subprocess.run(["node", str(tool), "import", str(out / "sampling.json"), str(out / "sources")], check=True)
for candidate, data in zip(candidates, inputs):
    source = out / "sources" / (data["id"] + ".source.json")
    html = out / "rebuilt" / candidate / "book.html"
    subprocess.run(["node", str(tool), "build", str(source), str(base / candidate / "book.json"), str(html)], check=True)
    expected = json.loads((base / candidate / "identity.json").read_text())
    assert hashlib.sha256(source.read_bytes()).hexdigest() == expected["sourceJsonSha256"]
    assert hashlib.sha256(html.read_bytes()).hexdigest() == expected["rawHtmlSha256"]
    print(candidate, "source and HTML match")
```

公开source-data省略编译HTML，因此不能直接充当完整source.json；固定D2L适配器会补回公式和原图。source.md是带锚点的审阅记录，也不是未经处理的原教材输入。重建证明材料可恢复，不证明绘图解释正确或教学有效。实际浏览器重新检查应使用新的证据目录，不能覆盖原失败。
