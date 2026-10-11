"""Bounded serial official Codex author session with real local tool use."""

import argparse, fcntl, hashlib, json, os, re, signal, subprocess, time
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
_workspace_spec = importlib.util.spec_from_file_location("visualbook_workspace", ROOT / "tools/visualbook_workspace.py")
_workspace = importlib.util.module_from_spec(_workspace_spec)
_workspace_spec.loader.exec_module(_workspace)
workspace_root = _workspace.workspace_root
BASE = ROOT / "work/harness-v2/runs"
PUBLIC = ROOT / "evaluation/2026-10-10/harness-v2"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def write(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("section")
    p.add_argument("arm", choices=["direct", "harness"])
    p.add_argument("--attempt", default="")
    p.add_argument("--mcp", action="store_true")
    p.add_argument("--composition-policy",choices=["prefer-library","open"],default="prefer-library")
    p.add_argument("--source", type=Path)
    p.add_argument("--job", type=Path)
    p.add_argument("--timeout", type=int, default=1200)
    p.add_argument("--model", help="Pin the official CLI model for a reproducible comparison")
    p.add_argument("--reasoning-effort", choices=["low", "medium", "high", "xhigh", "max", "ultra"])
    p.add_argument("--campaign", type=Path, help="Ignored campaign directory containing bounded session attempts")
    p.add_argument("--attempt-limit", type=int, default=16)
    args = p.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]*", args.section):
        raise SystemExit("Invalid chapter id")
    if (args.source is None) != (args.job is None):
        raise SystemExit("--source and --job must be supplied together")
    if not 60 <= args.timeout <= 1800:
        raise SystemExit("Timeout must be 60..1800 seconds")
    if args.model and not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:/-]*", args.model):
        raise SystemExit("Invalid model name")
    if not 1 <= args.attempt_limit <= 32:
        raise SystemExit("Attempt limit must be 1..32")
    if args.source is None and args.section not in [
        "geometry",
        "optimization",
        "programming",
    ]:
        raise SystemExit("Unknown frozen section")
    if args.attempt and not re.fullmatch(r"[a-z][a-z0-9-]*", args.attempt):
        raise SystemExit("Bad attempt")
    BASE.mkdir(parents=True, exist_ok=True)
    job = (
        args.job.resolve()
        if args.job
        else BASE
        / (args.section + "-" + args.arm + ("-" + args.attempt if args.attempt else ""))
    )
    work_root = (workspace_root(ROOT) / "work").resolve()
    if not job.is_relative_to(work_root):
        raise SystemExit("Raw authoring output must stay in ignored work/")
    campaign = args.campaign.resolve() if args.campaign else None
    if campaign and (not campaign.is_relative_to(work_root) or not job.is_relative_to(campaign)):
        raise SystemExit("Campaign and its sessions must stay inside ignored work/")
    if job.exists():
        raise SystemExit("Refuse to overwrite a session")
    source = (
        args.source.resolve()
        if args.source
        else ROOT / "work/harness-v2/sources" / f"{args.section}.source.json"
    )
    book = json.loads(source.read_text())
    tool = ROOT / "tools/visualbook.mjs"
    api = ROOT / "packages/visualbook/API.md"
    libfiles = [
        ROOT / "packages/visualbook" / n
        for n in json.loads((ROOT / "packages/visualbook/bundle.json").read_text())["modules"] + [
            "bundle.json",
            "runtime.js",
            "theme.css",
            "math.mjs",
            "notation.mjs",
            "anchors.mjs",
            "source-matrices.mjs",
            "emphasis.mjs",
            "markdown-math.mjs",
            "AUTHOR_API.md",
            "API.md",
            "DIRECT_API.md",
            "catalog.json",
            "components.json",
        ]
    ] + [
        tool,
        ROOT / "tools/visualbook_mcp.py",
        ROOT / "tools/audit_visualbook_parameters.mjs",
        ROOT / "tools/audit_visualbook_interactions.mjs",
        ROOT / "tools/check_visualbook_calculations.py",
        ROOT / "tools/build_visualbook_catalog.mjs",
        ROOT / "tools/visualbook_math.mjs",
        ROOT / "tools/visualbook_inspection.mjs",
        ROOT / "tools/export_visualbook_motion.mjs",
        ROOT / "tools/inspect_visualbook_reader.mjs",
        ROOT / "tools/visualbook_workspace.mjs",
    ]
    env = dict(os.environ)
    for key in ["OPENAI_API_KEY", "CODEX_API_KEY"]:
        env.pop(key, None)
    login = subprocess.run(
        ["codex", "login", "status"], env=env, capture_output=True, text=True
    )
    if login.returncode or "Logged in using ChatGPT" not in login.stdout + login.stderr:
        raise SystemExit("Requires official ChatGPT login")
    version = subprocess.check_output(
        ["codex", "--version"], env=env, text=True
    ).strip()
    serial_lock=work_root/'visualbook/codex-serial.lock'
    serial_lock.parent.mkdir(parents=True,exist_ok=True)
    with serial_lock.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if campaign and len(list(campaign.rglob("invocation.json"))) >= args.attempt_limit:
            raise SystemExit("Campaign startup attempt limit reached; failures count too")
        if args.source is None and len(list(BASE.glob("*/invocation.json"))) >= 8:
            raise SystemExit(
                "Eight attempt scope reached, including launch failures and pilot"
            )
        previous = sorted((campaign.rglob("result.json") if campaign else BASE.glob("*/result.json")), key=lambda f: f.stat().st_mtime)
        if len(previous) >= 3 and all(
            json.loads(f.read_text())["exit_code"] != 0 for f in previous[-3:]
        ):
            raise SystemExit("Three service/process failures; diagnose first")
        job.mkdir(parents=True)
        (job / "source.json").write_bytes(source.read_bytes())
        (job / "source.md").write_text(
            "\n\n".join(f'[{b["id"]}]\n{b["raw"]}' for b in book["blocks"])
        )
        write(
            job / "source-map.json",
            {
                "title": book["title"],
                "sourceSha256": book["sourceSha256"],
                "blocks": [
                    {k: b.get(k) for k in ["id", "type", "depth", "line"]}
                    for b in book["blocks"]
                ],
            },
        )
        source_md_sha = sha(job / "source.md")
        schema = {"figures": []}
        write(job / "book.json", schema)
        prompt = f"""你要把当前目录的完整教材变成优秀的段落内可视化教材。中文，保留原文与公式，不改source文件。阅读source.md的完整内容与锚点，source-map.json提供结构。source.json包含编译后的大段HTML和图片编码，仅给编译器使用，不要读取它来重复占用上下文；完整原文已经在source.md中。选择1–3个原书没有解释清楚的关系，允许有依据地零图；不要把原文段落再次塞进图。
本次工具路径 TOOL={tool}。把绘图计划写到book.json，调用构建和预览工具，查看实际桌面与手机PNG，自行修订。连续演示使用连续的0–1进度；直接拖动或调参数的图可声明interaction=parameters，静态关系可声明static。需要真实因果参数、清楚的轴与短标签、安静但有设计感的画面。不要只把进度取整后切换静态图片。图解默认静止，读者不操作也能先看懂当前关系；静态图、短演示、必要的参数探索都可以。presentation默认reading，复杂图用placement=wide，局部小图可用margin；initialProgress应是有意义的定格。页面滚动只暂停。避免装饰卡片、说明墙和超过480px的桌面图。
两臂共享同一原文、基本任务、编译器、阅读运行时和预览检查。你的arm={args.arm}。
运行 node TOOL build source.json book.json book.html {'--direct' if args.arm=='direct' else ''}（TOOL换成上面绝对路径）。运行 node TOOL preview book.html preview-01 会得到真实PNG与report.json。至少预览一次并查看桌面和手机的图片。每次修改重新build，预览目录另起名。最多3次预览，{args.timeout}秒会话上限；内部检查不能代替审美判断。失败保留，不自打分。
{('你使用普通SVG/DOM自行绘图，不调用VisualBook/Board库。draw收到svg,width,height,progress,params，可自己管理稳定SVG对象。' if args.arm=='direct' else '你可以使用可复用Board和VisualBook数学工具，使用稳定图元id，充分利用库减少布局与绘图负担。')}
输出book.json形状和接口见下面。源码是function draw(input)，绘图后返回实际使用的facts；不要自称训练结果或实测性能。公式已经编译，不重写教材。最终写AUTHOR.md说明图的取舍、实际预览与修订、未解决问题。
禁止网络、其他模型或代理、读取账号配置与凭据、修改工具源码或任务外文件。只操作当前目录，不需要git提交。预览若因sandbox被阻断可按正常审批请求执行本地Chromium，不跳过安全控制。
"""
        interface = (ROOT/"packages/visualbook/AUTHOR_API.md").read_text() if args.arm=="harness" and args.composition_policy=="prefer-library" else api.read_text()
        if args.arm == "direct":
            interface = (ROOT / "packages/visualbook/DIRECT_API.md").read_text()
        prompt += "\n" + interface
        if args.mcp:
            prompt += "\n本轮有本地 visualbook MCP 工具。可以先用list_designs和show_design查看适合章节的可复用设计与真实图片。必须用 build_book 构建，再用 preview_book 预览；它直接返回真实桌面/手机PNG图片内容，不能仅凭文件路径或数值报告声称看过画面。观察图片后自行修订。Python脚本使用python3，环境未提供python别名。可用search_designs按概念寻找积木，describe_component核对真实输入输出，再用scene的$result或共享状态拼接；不必把全部目录读进上下文。CLI命令只用于读取原文和写book.json，不用shell替代图片预览。最多3次预览，不要更改工具源码。最后必须用inspect_frame检查每幅图在1280和375下的起点/终点，并用finalize_book记录数学核对、已知未解决问题与限制。不要因为数值报告零发现就隐瞒遮挡、错误解释或其它问题；有问题就记录，工具会停止导出。\n"
        if args.arm=='harness' and args.composition_policy=='prefer-library':
            if not args.mcp:raise SystemExit('prefer-library requires local MCP; use --mcp or explicit --composition-policy open')
            prompt+='\n本轮使用prefer-library入口：先search_designs，再describe_design_inputs，优先put_design或组合scene。直接写custom code需要先检查现成设计，并调用declare_drawing_gap记录具体缺口；代码修订后重新声明。它只记录你的解释，不代表解释已获认可。不要为了符合形式硬套不合适的图。原文有明确条件缺失或需澄清时，用inspect_source查上下文，再put_annotation加简洁补充，不改source；必须查看补充在页面上的真实位置。\n'
        (job / "prompt.md").write_text(prompt)
        before = {str(f.relative_to(ROOT)): sha(f) for f in libfiles}
        write(
            job / "invocation.json",
            {
                "section": args.section,
                "arm": args.arm,
                "source_sha256": book["sourceSha256"],
                "source_md_sha256": source_md_sha,
                "prompt_sha256": sha(job / "prompt.md"),
                "tool_hashes": before,
                "composition_policy":args.composition_policy if args.arm=="harness" else "direct",
                "cliVersion": version,
                "requested_model": args.model,
                "requested_reasoning_effort": args.reasoning_effort,
                "configuration_note": "Explicit CLI overrides when supplied; otherwise existing user configuration. Requested settings are not independent verification of provider model identity.",
                "campaign": str(campaign) if campaign else None,
                "attempt_limit": args.attempt_limit if campaign else None,
                "timeout_s": args.timeout,
                "auth": "official existing ChatGPT login",
            },
        )
        # This CLI release treats --approve-for-me as workspace-write already;
        # combining it with --sandbox fails before any model request.
        cmd = [
            "codex",
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--approve-for-me",
            "--json",
            "--cd",
            str(job),
            "--output-last-message",
            str(job / "last-message.md"),
            "-",
        ]
        overrides = []
        if args.model:
            overrides += ["--model", args.model]
        if args.reasoning_effort:
            overrides += ["-c", "model_reasoning_effort=" + json.dumps(args.reasoning_effort)]
        cmd = cmd[:-1] + overrides + ["-"]
        if args.mcp:
            server_args = [
                str(ROOT / "tools/visualbook_mcp.py"),
                "--workspace",
                str(job),
            ] + (["--direct"] if args.arm == "direct" else (["--library-first"] if args.composition_policy=="prefer-library" else []))
            cmd = cmd[:-1] + [
                "-c",
                'mcp_servers.visualbook.command="python3"',
                "-c",
                "mcp_servers.visualbook.args=" + json.dumps(server_args),
                "-c",
                "mcp_servers.visualbook.tool_timeout_sec=180",
                "-",
            ]
        started = time.monotonic()
        timed_out = False
        with (job / "events.jsonl").open("w") as stdout, (job / "stderr.log").open(
            "w"
        ) as stderr:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=stdout,
                stderr=stderr,
                env=env,
                start_new_session=True,
            )
            try:
                proc.communicate(prompt.encode(), timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()
            except KeyboardInterrupt:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()
                raise
        events = []
        for line in (job / "events.jsonl").read_text().splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
        items = [e.get("item", {}) for e in events if e.get("type") == "item.completed"]
        usage = [
            e["usage"]
            for e in events
            if e.get("type") == "turn.completed" and "usage" in e
        ]
        counts = {
            kind: sum(i.get("type") == kind for i in items)
            for kind in sorted({i.get("type", "unknown") for i in items})
        }
        image_calls = (
            [
                json.loads(line)
                for line in (job / "mcp-evidence.jsonl").read_text().splitlines()
            ]
            if (job / "mcp-evidence.jsonl").exists()
            else []
        )
        result = {
            "section": args.section,
            "arm": args.arm,
            "exit_code": proc.returncode,
            "timed_out": timed_out,
            "wall_s": round(time.monotonic() - started, 3),
            "tool_item_counts": counts,
            "usage": usage,
            "tool_sources_unchanged": all(
                sha(f) == before[str(f.relative_to(ROOT))] for f in libfiles
            ),
            "source_unchanged": sha(job / "source.json") == sha(source)
            and sha(job / "source.md") == source_md_sha,
            "plan_sha256": sha(job / "book.json"),
            "html_exists": (job / "book.html").exists(),
            "preview_count": len(list(job.glob("preview-*/report.json"))),
            "returned_png_count": sum(len(c["images"]) for c in image_calls),
            "returned_candidate_png_count": sum(
                len(c["images"])
                for c in image_calls
                if c["tool"] in ["preview_book", "inspect_frame"]
            ),
            "mcp_enabled": args.mcp,
            "requested_model": args.model,
            "requested_reasoning_effort": args.reasoning_effort,
            "auth": "official existing ChatGPT login",
        }
        write(job / "result.json", result)
        if args.source is None:
            (PUBLIC / "calls").mkdir(parents=True, exist_ok=True)
            write(PUBLIC / "calls" / (job.name + ".json"), result)
        print(json.dumps(result, ensure_ascii=False))
        if proc.returncode or timed_out or not result["tool_sources_unchanged"]:
            raise SystemExit("Session incomplete; retained raw evidence")


if __name__ == "__main__":
    main()
