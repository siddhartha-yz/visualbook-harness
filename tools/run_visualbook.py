"""One-command serial VisualBook authoring; uses official signed-in Codex only.

A manifest accepts ordinary Markdown or imported source JSON chapters. Every chapter gets
one independent model session, shared executable designs, real PNG feedback and
up to three internal revisions. Failed chapters stay diagnostic; they are not
quietly published as ready books. Raw provider output remains in ignored work/.
"""

import argparse, hashlib, json, os, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Also works when loaded for gate checks with importlib, without changing sys.path.
import importlib.util
_workspace_spec = importlib.util.spec_from_file_location("visualbook_workspace", ROOT / "tools/visualbook_workspace.py")
_workspace = importlib.util.module_from_spec(_workspace_spec)
_workspace_spec.loader.exec_module(_workspace)
workspace_root = _workspace.workspace_root
_preparation_spec = importlib.util.spec_from_file_location("visualbook_preparation", ROOT / "tools/prepare_visualbook.py")
_preparation = importlib.util.module_from_spec(_preparation_spec)
_preparation_spec.loader.exec_module(_preparation)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def deliver(output):
    attempts = output / "delivery"
    attempts.mkdir(exist_ok=True)
    count = max([int(p.name.split("-")[1]) for p in attempts.glob("attempt-[0-9][0-9][0-9]")] or [0]) + 1
    if count > 999:
        raise SystemExit("Delivery attempt limit reached; retain evidence and use a fresh run")
    target = attempts / ("attempt-%03d" % count)
    p = subprocess.run([sys.executable, str(ROOT / "tools/deliver_visualbook.py"), str(output / "book"), str(target)], cwd=ROOT)
    if p.returncode: raise SystemExit(p.returncode)
    print("Verified offline book: " + str(output / "book/index.html"))
    print("Offline ZIP: " + str(target / "book.zip"))


def inspect(job):
    result = (
        json.loads((job / "result.json").read_text())
        if (job / "result.json").exists()
        else {}
    )
    html = job / "book.html"
    reports = sorted(job.glob("preview-*/report.json"), key=lambda p: p.stat().st_mtime)
    reasons = []
    if result.get("exit_code") != 0 or result.get("timed_out"):
        reasons.append("author-session-incomplete")
    if not result.get("source_unchanged"):
        reasons.append("source-was-modified")
    if not result.get("tool_sources_unchanged"):
        reasons.append("shared-tools-were-modified")
    if not result.get("returned_candidate_png_count", result.get("returned_png_count")):
        reasons.append("no-image-feedback")
    plan = job / "book.json"
    if not plan.exists() or digest(plan) != result.get("plan_sha256"):
        reasons.append("plan-was-modified-after-authoring")
    latest = None
    if not reports:
        reasons.append("no-preview")
    else:
        latest = json.loads(reports[-1].read_text())
        if latest.get("status") != "completed":
            reasons.append("preview-incomplete")
        if not html.exists() or digest(html) != latest["sha256"]:
            reasons.append("preview-is-stale")
        if latest["findings"]:
            reasons.append("unresolved-render-findings")
    review_file = job / "review.json"
    if not review_file.exists():
        reasons.append("no-final-issue-review")
    else:
        review = json.loads(review_file.read_text())
        if review.get("issues") or not review.get("ready_for_export"):
            reasons.append("known-unresolved-issues")
        if (
            not html.exists()
            or review.get("html_sha256") != digest(html)
            or review.get("plan_sha256") != result.get("plan_sha256")
        ):
            reasons.append("final-review-is-stale")
    return {
        "ready_for_export": not reasons,
        "reasons": reasons,
        "latest_preview": str(reports[-1].parent) if reports else None,
        "render_findings": latest["findings"] if latest else None,
        "quality": "Engineering gate only; does not establish teaching or aesthetic quality.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--model", help="Optional explicit official CLI model")
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high", "xhigh", "max", "ultra"])
    parser.add_argument("--campaign", type=Path, help="Optional shared ignored parent campaign; includes this output and earlier startup attempts")
    parser.add_argument("--attempt-limit", type=int, default=16, help="Global startup limit when --campaign is supplied; failures count")
    parser.add_argument("--composition-policy",choices=["prefer-library","open"],default="prefer-library")
    parser.add_argument("--split-level",type=int,choices=[2,3],help="For one Markdown book, split at original H2/H3 titles, retaining every imported block. Counts against --max-chapters before any model call.")
    parser.add_argument("--prepare-only", action="store_true", help="Import and freeze every chapter without starting any model session")
    parser.add_argument("--keep-going", action="store_true", help="Evaluate later chapters after a chapter gate fails; still refuse book export if any chapter fails")
    parser.add_argument(
        "--max-chapters",
        type=int,
        default=3,
        help="Explicit bounded batch size; default 3.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Reuse completed sessions; never overwrite or repeat model calls.",
    )
    parser.add_argument(
        "--source-url",
        default="",
        help="Original textbook URL for ordinary Markdown input.",
    )
    parser.add_argument(
        "--source-name",
        default="输入教材",
        help="Attribution name for ordinary Markdown.",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    work = (workspace_root(ROOT) / "work").resolve()
    if not output.is_relative_to(work):
        raise SystemExit(
            "Raw generation output must be in ignored work/ to keep provider logs out of Git"
        )
    campaign = args.campaign.resolve() if args.campaign else output
    if not campaign.is_relative_to(work) or not output.is_relative_to(campaign):
        raise SystemExit("Campaign must be an ignored parent of this output")
    if not 1 <= args.max_chapters <= 32 or not 1 <= args.attempt_limit <= 32:
        raise SystemExit("Chapter/startup limits must be 1..32")
    if output.exists() and not args.resume:
        raise SystemExit("Output exists; use a fresh directory or --resume")
    output.mkdir(parents=True, exist_ok=True)
    identity = {
        "input_sha256": digest(args.manifest),
        "source_url": args.source_url,
        "source_name": args.source_name,
    }
    identity_path = output / "input-identity.json"
    if identity_path.exists() and json.loads(identity_path.read_text()) != identity:
        raise SystemExit("Resume input changed; use a fresh run")
    save(identity_path, identity)
    try:
        manifest = _preparation.prepare(args.manifest, output, max_chapters=args.max_chapters, source_url=args.source_url, source_name=args.source_name, split_level=args.split_level)
    except Exception as error:
        raise SystemExit(str(error))
    # Check the complete source reader before the first author, including prepare-only.
    reader = output / "reader-preflight"
    reader.mkdir(exist_ok=True)
    reader_attempt = reader / f"attempt-{len(list(reader.glob('attempt-*'))) + 1:03d}"
    try:
        reader_process = subprocess.run(
            ["node", str(ROOT / "tools/check_visualbook_source.mjs"), str(output / "prepared-manifest.json"), str(reader_attempt)],
            cwd=ROOT, capture_output=True, text=True, timeout=300,
        )
    except subprocess.TimeoutExpired:
        save(reader / (reader_attempt.name + ".timeout.json"), {"status": "failed", "kind": "reader-preflight-timeout", "modelCalls": 0, "timeoutSeconds": 300})
        raise SystemExit("Source reader preflight timed out before model calls; diagnostics retained in " + str(reader))
    (reader / (reader_attempt.name + ".stdout")).write_text(reader_process.stdout)
    (reader / (reader_attempt.name + ".stderr")).write_text(reader_process.stderr)
    if reader_process.returncode:
        raise SystemExit("Source reader preflight failed before model calls; see " + str(reader_attempt / "report.json"))
    if args.prepare_only:
        print("Prepared and source reader checked without model calls: " + str(output / "prepared-manifest.json"))
        return
    chapters = manifest.get("chapters", [])
    if not 1 <= len(chapters) <= args.max_chapters:
        raise SystemExit("Chapter count outside explicit batch budget")
    ids = [c.get("id", "") for c in chapters]
    if len(set(ids)) != len(ids) or any(
        not re.fullmatch(r"[a-z][a-z0-9-]*", i) for i in ids
    ):
        raise SystemExit("Invalid or duplicate chapter id")
    if not 60 <= args.timeout <= 1800:
        raise SystemExit("Timeout must be 60..1800 seconds")
    records = []
    started = time.monotonic()
    for c in chapters:
        chapter_id = c["id"]
        source = Path(c["source"])
        if not source.is_absolute():
            source = (args.manifest.parent / source).resolve()
        job = output / "sessions" / chapter_id
        if not (job / "result.json").exists():
            command = [
                sys.executable,
                str(ROOT / "tools/author_book.py"),
                chapter_id,
                "harness",
                "--source",
                str(source),
                "--job",
                str(job),
                "--timeout",
                str(args.timeout),
                "--mcp",
                "--composition-policy",
                args.composition_policy,
                "--campaign",
                str(campaign),
                "--attempt-limit",
                str(args.attempt_limit if args.campaign else args.max_chapters),
            ]
            if args.model:
                command += ["--model", args.model]
            if args.reasoning_effort:
                command += ["--reasoning-effort", args.reasoning_effort]
            p = subprocess.run(command, cwd=ROOT)
            if p.returncode and not (job / "result.json").exists():
                records.append(
                    {
                        "id": chapter_id,
                        "state": "session-start-failed",
                        "exit_code": p.returncode,
                    }
                )
                if args.keep_going:
                    continue
                break
        gate = inspect(job)
        if (job / "source.json").exists() and digest(source) != digest(
            job / "source.json"
        ):
            gate["ready_for_export"] = False
            gate["reasons"].append("input-source-changed")
        save(job / "export-gate.json", gate)
        records.append(
            {
                "id": chapter_id,
                "source": str(source),
                "plan": str(job / "book.json"),
                "html": str(job / "book.html"),
                "preview": gate["latest_preview"],
                "review": str(job / "review.json"),
                "arm": "harness",
                "gate": gate,
            }
        )
        if not gate["ready_for_export"]:
            if not args.keep_going:
                break
    save(
        output / "pipeline-record.json",
        {
            "chapters": records,
            "wall_s": round(time.monotonic() - started, 3),
            "max_chapters": args.max_chapters,
            "campaign": str(campaign),
            "attempt_limit": args.attempt_limit if args.campaign else args.max_chapters,
            "keep_going": args.keep_going,
            "automatic_user_feedback": 0,
            "ready_chapters": sum(
                r.get("gate", {}).get("ready_for_export", False) for r in records
            ),
        },
    )
    if len(records) != len(chapters) or any(
        not r.get("gate", {}).get("ready_for_export") for r in records
    ):
        print(
            "Stopped with retained diagnostics: " + str(output / "pipeline-record.json")
        )
        raise SystemExit(2)
    assembly = output / "assembly.json"
    save(
        assembly,
        {
            "title": manifest.get("title", "VisualBook"),
            "description": manifest.get("description"),
            "navigation": True,
            **{field: manifest[field] for field in ["groups", "labels"] if field in manifest},
            "chapters": [
                {k: r[k] for k in ["id", "source", "plan", "arm", "html", "preview", "review"]} for r in records
            ],
        },
    )
    if (output / "book/index.html").exists() and args.resume:
        built = json.loads((output / "book/build-record.json").read_text())
        if built.get("indexSha256") != digest(output / "book/index.html") or any(
            r.get("finalHtmlSha256") != digest(output / "book" / r["file"])
            for r in built["records"]
        ):
            raise SystemExit(
                "Assembled book identity changed or predates export hashes; rebuild into a fresh directory"
            )
        deliver(output)
        return
    p = subprocess.run(
        [
            "node",
            str(ROOT / "tools/assemble_visualbook.mjs"),
            str(assembly),
            str(output / "book"),
        ],
        cwd=ROOT,
    )
    if p.returncode:
        raise SystemExit(p.returncode)
    deliver(output)


if __name__ == "__main__":
    main()
