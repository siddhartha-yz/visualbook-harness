"""Create frozen knowledge-chapter inputs from a complete course assignment.

All parts must occur once in the declared plan. Each bundle keeps transcript
identity, timed anchors and deterministic source board frames. No model calls.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course", type=Path)
    parser.add_argument("transcripts", type=Path)
    parser.add_argument("plan", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--chapter", help="Prepare one ready chapter while later transcription continues")
    parser.add_argument("--repairs", type=Path, help="Completed secondary-ASR directory; alternatives remain labelled and never replace raw text")
    parser.add_argument("--verified-context", type=Path, help="Explicit independently checked source-identity facts, with URLs")
    args = parser.parse_args()
    course, transcripts, output = args.course.resolve(), args.transcripts.resolve(), args.output.resolve()
    if not output.is_relative_to((ROOT / "work").resolve()):
        parser.error("Course input bundles must stay in ignored work/")
    verified_context = json.loads(args.verified_context.read_text()) if args.verified_context else None
    if verified_context and (not isinstance(verified_context.get("facts"), list) or any(not all(key in fact for key in ["field", "value", "sourceUrl", "basis"]) for fact in verified_context["facts"])):
        raise SystemExit("Verified source context needs attributed facts")
    repair_files = {}
    if args.repairs:
        manifest = json.loads((args.repairs / "manifest.json").read_text())
        for name in manifest["records"]:
            path = (args.repairs / name).resolve()
            if not path.is_relative_to(args.repairs.resolve()):
                raise SystemExit("Repair record leaves explicit directory")
            data = json.loads(path.read_text())
            repair_files.setdefault(data["page"], []).append((path, data))
    meta = json.loads((course / "course.json").read_text())
    plan = json.loads(args.plan.read_text())
    assignments = [page for chapter in plan["chapters"] for page in chapter["pages"]]
    if sorted(assignments) != [page["page"] for page in meta["pages"]] or len(set(assignments)) != len(assignments):
        raise SystemExit("Plan must cover every actual source part exactly once")
    ids = [chapter["id"] for chapter in plan["chapters"]]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r"[a-z][a-z0-9-]*", i) for i in ids):
        raise SystemExit("Invalid or duplicate chapter ids")
    if args.chapter and args.chapter not in ids:
        parser.error("Unknown chapter")
    output.mkdir(parents=True, exist_ok=True)
    for chapter in plan["chapters"]:
        if args.chapter and chapter["id"] != args.chapter:
            continue
        final = output / chapter["id"]
        if final.exists():
            identity = json.loads((final / "input-identity.json").read_text())
            if identity["planSha256"] != sha(args.plan):
                raise SystemExit("Plan changed; use a new bundle output")
            for part in identity["parts"]:
                if part["transcriptSha256"] != sha(transcripts / f"p{part['page']:03d}.json"):
                    raise SystemExit("Transcript changed after preparation")
            for name, digest in identity["bundleHashes"].items():
                if sha(final / name) != digest:
                    raise SystemExit("Prepared text/frame bytes changed")
            print(json.dumps({"chapter": chapter["id"], "status": "reused"}), flush=True)
            continue
        data = [json.loads((transcripts / f"p{page:03d}.json").read_text()) for page in chapter["pages"]]
        directory = output / (chapter["id"] + f".preparation-{time.time_ns()}")
        directory.mkdir()
        (directory / "board").mkdir()
        identity = {"id": chapter["id"], "title": chapter["title"], "bvid": meta["bvid"],
                    "courseSha256": sha(course / "course.json"), "planSha256": sha(args.plan),
                    "parts": [], "boardFrames": [], "boardSources": [], "repairRecords": [],
                    "sourceScope": "Machine transcription of actual course; board frames sampled, not all boards inspected. Not a verbatim accuracy guarantee."}
        text = [f"# 章节写作输入：{chapter['title']}", "", "以下是原始真实转写，不是已校对教材；保留识别错误和时间位置。"]
        if verified_context:
            identity["verifiedContext"] = verified_context
            identity["verifiedContextSha256"] = sha(args.verified_context)
            text += ["", "## 已独立核对的来源身份（不是授课转写）"]
            text += [f"{fact['field']}：{fact['value']}；依据 {fact['sourceUrl']}。{fact['basis']}" for fact in verified_context["facts"]]
        for part in data:
            page = part["page"]
            original = json.loads((course / "parts" / f"p{page:03d}.json").read_text())
            if original["cid"] != part["cid"] or original["sha256"] != part["inputSha256"]:
                raise SystemExit("Transcript/media identity mismatch")
            if sha(course / original["path"]) != original["sha256"]:
                raise SystemExit("Original source bytes changed")
            identity["parts"].append({"page": page, "cid": part["cid"], "title": part["title"],
                "transcriptSha256": sha(transcripts / f"p{page:03d}.json"), "inputSha256": part["inputSha256"],
                "duration": part["duration"], "segments": [{key: s[key] for key in ["anchor", "start", "end"]} for s in part["segments"]],
                "uncertain": part["uncertain"]})
            text += ["", (transcripts / f"p{page:03d}.md").read_text()]
            alternatives = repair_files.get(page, [])
            if alternatives:
                text += ["", "## 局部复核备选（仍是机器识别，不能当成已确认原话）"]
            for repair_path, repair in alternatives:
                if repair["transcriptSha256"] != sha(transcripts / f"p{page:03d}.json") or repair["audioSha256"] != part["inputSha256"]:
                    raise SystemExit("Secondary repair no longer matches original source")
                identity["repairRecords"].append({"anchor": repair["anchor"], "recordSha256": sha(repair_path), "settingsSha256": repair["settingsSha256"], "path": str(repair_path), "status": repair["status"]})
                text += [f"针对原位置 {repair['anchor']}（原识别：{repair['original']['text']}）的局部重解码："]
                text += [f"[{segment['start']:.2f}–{segment['end']:.2f}] {segment['text']}" for segment in repair["alternative"]]
            video = original.get("video")
            if not video:
                continue
            video_path = course / video["path"]
            if sha(video_path) != video["sha256"]:
                raise SystemExit("Board video bytes changed")
            identity["boardSources"].append({"page": page, "path": str(video_path), "sha256": video["sha256"], "duration": part["duration"]})
            times = [round(part["duration"] * fraction, 1) for fraction in [0.18, 0.42, 0.66, 0.88]]
            for at in times:
                name = f"board/p{page:03d}-{int(at):04d}.png"
                process = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(at), "-i", str(video_path),
                                          "-frames:v", "1", str(directory / name)], capture_output=True, text=True)
                if process.returncode:
                    raise SystemExit("Source frame extraction failed: " + process.stderr[-500:])
                identity["boardFrames"].append(name)
        (directory / "input.md").write_text("\n\n".join(text) + "\n")
        identity["bundleHashes"] = {name: sha(directory / name) for name in ["input.md", *identity["boardFrames"]]}
        (directory / "input-identity.json").write_text(json.dumps(identity, ensure_ascii=False, indent=2) + "\n")
        directory.rename(final)
        print(json.dumps({"chapter": chapter["id"], "status": "prepared", "pages": len(data),
                          "characters": len((final / "input.md").read_text()), "boardFrames": len(identity["boardFrames"])}), flush=True)


if __name__ == "__main__":
    main()
