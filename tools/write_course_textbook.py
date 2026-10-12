"""Serial official-Codex textbook authoring from frozen timed course transcripts.

Inputs, board frames, original responses, coverage claims and actual structural
checks remain separate. A passing record is not semantic or mathematical proof.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def check_formula_preflight(job, timeout=90):
    """Fail closed on display defects or an invalid read-only helper response."""
    chapter, helper = job / "chapter.md", ROOT / "tools/check_textbook_math.mjs"
    directory = job / "formula-preflight"
    directory.mkdir(exist_ok=True)
    attempt = directory / f"attempt-{len(list(directory.glob('attempt-*'))) + 1:03d}"
    attempt.mkdir()
    before = sha(chapter)
    record = {"ready": False, "modelCalls": 0, "chapterSha256": before,
              "helperSha256": sha(helper), "timeoutSeconds": timeout,
              "scope": "Shared reader formula-display gate, not semantic or mathematical proof.",
              "findings": []}
    stdout, stderr = "", ""
    try:
        process = subprocess.run(["node", str(helper), str(chapter)], cwd=ROOT,
                                 capture_output=True, text=True, timeout=timeout)
        stdout, stderr = process.stdout, process.stderr
        record["exitCode"] = process.returncode
        answer = json.loads(stdout)
        record["helperResult"] = answer
        if (not isinstance(answer, dict) or type(answer.get("ready")) is not bool or
                type(answer.get("modelCalls")) is not int or answer["modelCalls"] != 0 or
                answer.get("chapterSha256") != before or not isinstance(answer.get("findings"), list)):
            raise ValueError("invalid-formula-helper-protocol")
        counts = [answer.get("formulasExpected"), answer.get("formulasRendered")]
        if process.returncode or not answer["ready"]:
            record["findings"].append("formula-display-rejected")
        elif (any(type(n) is not int or not 0 <= n <= 100000 for n in counts) or
                counts[0] != counts[1] or answer["findings"]):
            raise ValueError("invalid-formula-helper-counts")
        else:
            record.update(ready=True, formulasExpected=counts[0], formulasRendered=counts[1])
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout or ""
        stderr = error.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode(errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        record["findings"].append("formula-helper-timeout")
    except (OSError, ValueError, TypeError, AttributeError) as error:
        record["findings"].append("formula-helper-error:" + type(error).__name__)
        record["error"] = str(error)
    if sha(chapter) != before:
        record["findings"].append("chapter-changed-during-formula-preflight")
        record["ready"] = False
    if record["findings"]:
        record["ready"] = False
    (attempt / "stdout.log").write_text(stdout)
    (attempt / "stderr.log").write_text(stderr)
    save(attempt / "result.json", record)
    return {"ready": record["ready"], "findings": record["findings"],
            "reportPath": str(attempt / "result.json"), "reportSha256": sha(attempt / "result.json"),
            "helperSha256": record["helperSha256"], "chapterSha256": before}


def check_chapter(job, expected_pages):
    """Check identity, declared coverage and formula display; no semantic proof."""
    failures = []
    chapter = job / "chapter.md"
    if not chapter.exists():
        return {"ready": False, "findings": ["missing-chapter"]}
    text = chapter.read_text()
    if len(text) < 2500:
        failures.append("chapter-too-short-for-detailed-textbook")
    if "\ufffd" in text or re.search(r"(?m)^\s*>\s*\[!", text):
        failures.append("unresolved-transcription-or-unsupported-markdown")
    if not text.startswith("# ") or "## " not in text:
        failures.append("missing-chapter-structure")
    for name in ["coverage.json", "review.json", "glossary.json"]:
        if not (job / name).exists():
            failures.append("missing-" + name)
    coverage = json.loads((job / "coverage.json").read_text()) if (job / "coverage.json").exists() else {}
    rows = coverage.get("pages", [])
    if sorted(row.get("page") for row in rows) != sorted(expected_pages):
        failures.append("declared-page-coverage-mismatch")
    input_data = json.loads((job / "input-identity.json").read_text())
    anchors = {segment["anchor"] for part in input_data["parts"] for segment in part["segments"]}
    for row in rows:
        if not row.get("topics") or not row.get("sections") or not row.get("anchors"):
            failures.append("empty-page-coverage")
        if any(anchor not in anchors or not anchor.startswith(f"p{row['page']:03d}-") for anchor in row.get("anchors", [])):
            failures.append("invented-source-anchor")
        for section in row.get("sections", []):
            if section not in text:
                failures.append("coverage-section-not-in-chapter")
    review = json.loads((job / "review.json").read_text()) if (job / "review.json").exists() else {}
    if review.get("blockingIssues", review.get("issues", [])) or review.get("ready") is not True:
        failures.append("known-unresolved-issues")
    if review.get("chapterSha256") != sha(chapter):
        failures.append("review-does-not-match-final-chapter")
    formula = check_formula_preflight(job)
    if not formula["ready"]:
        failures.append("formula-display-preflight-failed")
    return {"ready": not failures, "findings": sorted(set(failures)),
            "characters": len(text), "declaredPages": len(rows), "chapterSha256": sha(chapter),
            "formulaPreflight": formula,
            "scope": "Structural, declared-source and shared formula-display checks; not independent content coverage, ASR accuracy or theorem validation."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_bundle", type=Path, help="Frozen input-identity.json, input.md and board frames")
    parser.add_argument("job", type=Path)
    parser.add_argument("--campaign", type=Path, required=True)
    parser.add_argument("--attempt-limit", type=int, default=36)
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--model")
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high", "xhigh", "max", "ultra"])
    args = parser.parse_args()
    source, job, campaign = args.source_bundle.resolve(), args.job.resolve(), args.campaign.resolve()
    work = (ROOT / "work").resolve()
    if not job.is_relative_to(campaign) or not campaign.is_relative_to(work) or job.exists():
        parser.error("Use a fresh job inside an ignored campaign")
    if not 1 <= args.attempt_limit <= 76 or not 60 <= args.timeout <= 2400:
        parser.error("Invalid startup/time budget")
    identity = json.loads((source / "input-identity.json").read_text())
    files = {"input.md": source / "input.md", "input-identity.json": source / "input-identity.json"}
    for name in identity.get("boardFrames", []):
        path = (source / name).resolve()
        if not path.is_relative_to(source) or not path.is_file():
            raise SystemExit("Board frame leaves input bundle or is missing")
        files[name] = path
    inputs = {name: sha(path) for name, path in files.items()}
    env = dict(os.environ)
    for key in ["OPENAI_API_KEY", "CODEX_API_KEY"]:
        env.pop(key, None)
    login = subprocess.run(["codex", "login", "status"], env=env, capture_output=True, text=True)
    if login.returncode or "Logged in using ChatGPT" not in login.stdout + login.stderr:
        raise SystemExit("Requires official existing ChatGPT login")
    version = subprocess.check_output(["codex", "--version"], env=env, text=True).strip()
    campaign.mkdir(parents=True, exist_ok=True)
    serial = work / "visualbook/codex-serial.lock"
    serial.parent.mkdir(parents=True, exist_ok=True)
    with serial.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if len(list(campaign.rglob("invocation.json"))) >= args.attempt_limit:
            raise SystemExit("Textbook startup budget reached; failed starts count")
        previous = sorted(campaign.rglob("result.json"), key=lambda p: p.stat().st_mtime)
        if len(previous) >= 3 and all(json.loads(p.read_text()).get("exit_code") != 0 for p in previous[-3:]):
            raise SystemExit("Three process/service failures; diagnose before another start")
        job.mkdir(parents=True)
        for name, path in files.items():
            target = job / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(path.read_bytes())
        title = identity["title"]
        prompt = f"""你是中文高等代数教材作者，读者正在认真学习这门课程。把input.md中的完整真实课堂转写整理成一章详细、严谨、好读的教材，章名：{title}。不要写摘要或提纲，不把分集标题逐条铺开。完整读取input.md及input-identity.json，然后查看boardFrames中的真实板书图片。先理清定义、条件、证明、算例之间的关系，再按知识节组织chapter.md。

来源是一份机器转写，含口误、同音字、错误数学符号，甚至“中文字幕提供”等幻觉；这些都不是真实事实。不得把流畅识别当作可靠原话。常识可确认的术语可以规范化，但具体板书算例的系数、符号、变量或老师给出的特殊结论必须结合图片。老师身体遮住或画面不可读时，记录不确定之处，不能冒充已经确认。若无法完整恢复原算例，用自己独立核算的简单例子解释，并明确标“编者补充”，保留原算例的回看入口。禁止由现成教材反推逐字稿。不要替老师宣布未讲过的结论，不模仿老师第一人称写未经确认的话。

保留本章各分集实际出现的知识、证明思路、条件、算例作用和有用的解释；删口头重复，不删难点。所有定义注明数域/空间与适用条件，定理给条件和结论，关键证明写中间推理，不能用“显然”跳掉本课核心步骤。计算例子写过程与验算，注意零向量/空集/有限维/非零分母/可逆/代数闭域/内积共轭等边界。避免把欧氏直觉推广到所有域。课程只介绍而未证明的主题明确其边界，编者的推导/补充例子与课程事实区分。

写大白话但数学精确。文字保持连续，少用表格，不堆定义卡片、黑话或装饰emoji。建议实质正文约6000–16000中文字，复杂章节可更长；根据实际知识量决定，不为字数重复。读者应能独立学习，公式必须完整可渲染，使用$...$及独立$$...$$，避免\"\\begin{{align}}\"等外层环境和自定义宏。只用标准Markdown，不用裸HTML、脚注语法或Mermaid。第一行#章名，后面##知识节、###必要小节。全书数域统一记F、空间V/W，但不要未经确认改内积共轭约定。自测2–4题附提示或答案思路，是编者补充；不要把整章降成题库。

读者正文不要出现源文件、JSON、工具、置信分数等实现细节。章末用很短的“课程回看”说明本章来源，第p集的时间链接用https://www.bilibili.com/video/{identity['bvid']}/?p=数字&t=秒，给真正对应定义/证明的几个位置，不重复151个技术索引。对必须回看确认的来源缺口用自然短注释解释。

同时写coverage.json={{\"pages\":[{{\"page\":实际分集号,\"topics\":[具体知识],\"sections\":[chapter.md中实际标题文本],\"anchors\":[真实pXXX-sXXX],\"omissions\":[删去重复/闲谈或不确定内容的具体说明]}}],\"corrections\":[{{\"anchor\":原文位置,\"sourceText\":原误识别,\"resolved\":规范写法,\"basis\":板书文件或明确数学核对依据}}],\"addedExamples\":[补充例子与核算]}}。每集必须准确进入本章索引，不拿空话伪造覆盖；这只是你的声明，后续会独立核查。
写glossary.json={{\"terms\":[{{\"term\":术语,\"notation\":记号,\"definition\":短定义}}]}}。
完成后自己检查定义、证明、算例和TeX。定稿前可运行明确授权的只读显示检查：node {ROOT / "tools/check_textbook_math.mjs"} chapter.md。它只读取本章及自有渲染代码，不调用模型，不改原文。若拒绝，按具体错误自行修正并重新运行；将结果保留在当前目录，不把显示通过当成数学证明。启动器还会在会话退出后独立重复检查最终稿，错误会阻止接纳。写review.json={{\"ready\":是否愿意交给学习者,\"issues\":[真实未解决问题],\"blockingIssues\":[仍会误导学习或阻碍交付的问题],\"chapterSha256\":最终chapter.md的SHA256,\"mathChecks\":[实际独立验算/推理],\"sourceLimits\":[未确认的口述/板书位置与影响]}}。issues和blockingIssues只列仍影响学习正确性的未解决问题；已明确说明的来源缺口、未经过教师审查等边界写sourceLimits，不能删除负面证据。若替代解释已独立验算且明确标为编者补充，可以作为带来源限制的教材交付，不能声称恢复了原讲解。已知影响学习的错误必须记录，不自打分，不因为文件存在就声称严谨。写作审查不等于独立教师审查。

只在当前目录写输出，禁止网络、任何额外模型/代理、读取账号配置、改公共工具或原始输入。用实际view_image查看图片，不凭路径声称看过。input-identity.json中boardSources是只读的明确授权源视频；需要确认重要公式时可以用ffmpeg从这些视频路径按source anchor时间提取PNG到当前目录，再实际查看。不要修改源视频。允许在当前目录用Python/Fraction/SymPy核算自选算例。官方账号认证由启动器管理。不提交Git。把书写入文件，最后消息只报告完成路径与重要限制。
"""
        (job / "prompt.md").write_text(prompt)
        cmd = ["codex", "exec", "--ephemeral", "--skip-git-repo-check", "--approve-for-me", "--json", "--cd", str(job),
               "--output-last-message", str(job / "last-message.md")]
        if args.model:
            cmd += ["--model", args.model]
        if args.reasoning_effort:
            cmd += ["-c", "model_reasoning_effort=" + json.dumps(args.reasoning_effort)]
        cmd += ["-"]
        save(job / "invocation.json", {"title": title, "inputHashes": inputs, "promptSha256": sha(job / "prompt.md"),
              "toolSha256": sha(Path(__file__)), "cliVersion": version, "requestedModel": args.model, "requestedReasoningEffort": args.reasoning_effort,
              "auth": "official existing ChatGPT login", "timeoutSeconds": args.timeout, "attemptLimit": args.attempt_limit,
              "source": "real timed course transcription and board images; not an existing textbook"})
        started, timed_out = time.monotonic(), False
        with (job / "events.jsonl").open("w") as log, (job / "stderr.log").open("w") as error:
            process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=log, stderr=error, env=env, start_new_session=True)
            try:
                process.communicate(prompt.encode(), timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        after = {name: sha(job / name) for name in files}
        try:
            check = check_chapter(job, [part["page"] for part in identity["parts"]])
        except Exception as error:
            check = {"ready": False, "findings": ["invalid-output-schema"], "type": type(error).__name__}
        if after != inputs:
            check["ready"] = False
            check["findings"].append("source-input-was-modified")
        if process.returncode or timed_out:
            check["ready"] = False
            check["findings"].append("author-process-incomplete")
        save(job / "chapter-check.json", check)
        result = {"exit_code": process.returncode, "timed_out": timed_out, "elapsedSeconds": time.monotonic() - started,
                  "inputsUnchanged": after == inputs, "check": check,
                  "scope": "Real official model authoring; gate includes source declarations and formula display. Mathematical/artistic/teacher review remains separate."}
        save(job / "result.json", result)
        print(json.dumps(result, ensure_ascii=False))
        if not check["ready"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
