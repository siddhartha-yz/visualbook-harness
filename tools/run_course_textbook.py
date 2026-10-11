"""Drive bounded serial chapter writing while earlier ASR parts become ready.

Resume reuses immutable completed jobs; failed jobs remain failed. The final
manifest is emitted only when every planned chapter passes structural checks.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course", type=Path)
    parser.add_argument("transcripts", type=Path)
    parser.add_argument("plan", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-chapters", type=int, default=3)
    parser.add_argument("--attempt-limit", type=int, default=36)
    parser.add_argument("--timeout", type=int, default=1500)
    parser.add_argument("--wait-minutes", type=int, default=45)
    parser.add_argument("--repairs", type=Path)
    parser.add_argument("--verified-context", type=Path)
    args = parser.parse_args()
    course, transcripts, out = args.course.resolve(), args.transcripts.resolve(), args.output.resolve()
    if not out.is_relative_to((ROOT / "work").resolve()) or not 1 <= args.max_chapters <= 32:
        parser.error("Use ignored output and an explicit 1..32 chapter budget")
    plan = json.loads(args.plan.read_text())
    if len(plan["chapters"]) > args.max_chapters:
        parser.error("Plan exceeds explicit chapter budget")
    out.mkdir(parents=True, exist_ok=True)
    identity = {"planSha256": hashlib.sha256(args.plan.read_bytes()).hexdigest(),
                "courseSha256": hashlib.sha256((course / "course.json").read_bytes()).hexdigest()}
    pin = out / "identity.json"
    if pin.exists() and json.loads(pin.read_text()) != identity:
        raise SystemExit("Course/plan changed; use a new campaign")
    pin.write_text(json.dumps(identity, indent=2) + "\n")
    records = []
    jobs = out / "textbook-authors"
    for chapter in plan["chapters"]:
        job = jobs / (chapter["id"] + "-01")
        result = job / "result.json"
        if job.exists() and not result.exists():
            # A manually started pilot can finish under the same global CLI lock.
            deadline = time.monotonic() + args.timeout + 60
            while not result.exists() and time.monotonic() < deadline:
                time.sleep(2)
            if not result.exists():
                raise SystemExit("Unfinished existing author; preserve it and diagnose")
        if not result.exists():
            deadline = time.monotonic() + args.wait_minutes * 60
            missing = lambda: [page for page in chapter["pages"] if not (transcripts / f"p{page:03d}.json").exists()]
            while missing() and time.monotonic() < deadline:
                time.sleep(2)
            if missing():
                raise SystemExit("Transcripts not ready within explicit wait budget")
            prepare = [sys.executable, str(ROOT / "tools/prepare_course_chapters.py"), str(course), str(transcripts),
                       str(args.plan.resolve()), str(out / "chapter-inputs"), "--chapter", chapter["id"]]
            if args.repairs:
                repair_deadline = time.monotonic() + args.wait_minutes * 60
                while not (args.repairs / "manifest.json").exists() and time.monotonic() < repair_deadline:
                    time.sleep(2)
                if not (args.repairs / "manifest.json").exists():
                    raise SystemExit("Secondary repair batch did not complete")
                prepare += ["--repairs", str(args.repairs.resolve())]
            if args.verified_context:
                prepare += ["--verified-context", str(args.verified_context.resolve())]
            subprocess.run(prepare, check=True)
            cmd = [sys.executable, str(ROOT / "tools/write_course_textbook.py"), str(out / "chapter-inputs" / chapter["id"]),
                   str(job), "--campaign", str(jobs), "--attempt-limit", str(args.attempt_limit), "--timeout", str(args.timeout)]
            with (out / (chapter["id"] + "-author.log")).open("w") as log:
                subprocess.run(cmd, stdout=log, stderr=log)
        if not result.exists():
            raise SystemExit("Author did not write a process result; diagnose before retry")
        data = json.loads(result.read_text())
        current_hash = hashlib.sha256((job / "chapter.md").read_bytes()).hexdigest() if (job / "chapter.md").exists() else None
        if data["check"].get("chapterSha256") and current_hash != data["check"]["chapterSha256"]:
            raise SystemExit("Completed author output changed; preserve original and use an explicit maintainer revision")
        row = {"id": chapter["id"], "title": chapter["title"], "pages": chapter["pages"],
               "job": str(job), "ready": data["check"]["ready"], "findings": data["check"]["findings"],
               "chapterSha256": hashlib.sha256((job / "chapter.md").read_bytes()).hexdigest() if (job / "chapter.md").exists() else None}
        records.append(row)
        (out / "textbook-progress.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(row, ensure_ascii=False), flush=True)
    if any(not record["ready"] for record in records):
        raise SystemExit("Some chapters remain diagnostic; no complete-textbook claim")
    manifest = {"title": plan["title"], "chapters": [{"id": row["id"], "source": str(Path(row["job"]) / "chapter.md")} for row in records]}
    (out / "textbook-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print("Complete structural textbook manifest: " + str(out / "textbook-manifest.json"), flush=True)


if __name__ == "__main__":
    main()
