"""Start one bounded serial book run independently of the launching terminal.

The driver still uses official signed-in Codex and existing generation gates.
This stores process evidence, not a book-quality verdict. Linux /proc required.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def process_ticks(pid):
    try:
        text = (Path("/proc") / str(pid) / "stat").read_text()
        fields = text[text.rfind(")") + 2:].split()
        return None if fields[0] == "Z" else int(fields[19])
    except (OSError, ValueError, IndexError):
        return None


def status(directory):
    launch = json.loads((directory / "launch.json").read_text())
    ticks = process_ticks(launch["pid"])
    execution = directory / "execution.json"
    return {"pid": launch["pid"], "live": ticks is not None and ticks == launch["startTicks"],
            "execution": json.loads(execution.read_text()) if execution.exists() else None,
            "scope": "Actual Linux PID/start-tick identity; no process inferred from artifacts and no book acceptance."}


def worker(directory):
    launch = json.loads((directory / "launch.json").read_text())
    started = time.monotonic()
    record = {"status": "running", "exitCode": None, "modelCalls": "owned by existing serial driver"}
    save(directory / "execution.json", record)
    try:
        if sha(launch["manifest"]) != launch["manifestSha256"]:
            raise ValueError("Manifest changed before detached execution")
        for name, digest in launch["toolFiles"].items():
            if sha(Path(launch["toolchain"]) / name) != digest:
                raise ValueError("Frozen tool changed: " + name)
        result = subprocess.run(launch["command"], cwd=launch["toolchain"], stdin=subprocess.DEVNULL)
        record.update(status="completed", exitCode=result.returncode)
    except Exception as error:
        record.update(status="failed", error=str(error))
    record["wallSeconds"] = round(time.monotonic() - started, 3)
    save(directory / "execution.json", record)


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "--worker":
        directory = Path(sys.argv[2]).resolve()
        if not directory.is_relative_to(WORK.resolve()):
            raise SystemExit("Worker record must be in ignored work/")
        # Parent writes PID identity after spawn. No provider/model call precedes it.
        for _ in range(200):
            if (directory / "launch.json").exists():
                worker(directory)
                return
            time.sleep(.01)
        raise SystemExit("Missing launch identity")
    if len(sys.argv) == 3 and sys.argv[1] == "--status":
        directory = Path(sys.argv[2]).resolve()
        if not directory.is_relative_to(WORK.resolve()):
            raise SystemExit("Status record must be in ignored work/")
        print(json.dumps(status(directory), ensure_ascii=False))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("record", type=Path)
    parser.add_argument("--toolchain", type=Path, required=True)
    parser.add_argument("--campaign", type=Path, required=True)
    parser.add_argument("--max-chapters", type=int, default=25)
    parser.add_argument("--attempt-limit", type=int, default=32)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    manifest, output, directory, chain, campaign = [p.resolve() for p in
        [args.manifest, args.output, args.record, args.toolchain, args.campaign]]
    if not Path("/proc/self/stat").exists():
        raise SystemExit("Detached identity requires Linux /proc")
    if directory.exists() or any(not p.is_relative_to(WORK.resolve()) for p in [output, directory, chain, campaign]):
        raise SystemExit("Use ignored work/ paths and a fresh process-record directory")
    if not output.is_relative_to(campaign) or not 1 <= args.max_chapters <= 32 or not 1 <= args.attempt_limit <= 32 or not 60 <= args.timeout <= 1800:
        raise SystemExit("Use bounded chapter/attempt/timeout values and an owning campaign")
    frozen = json.loads((chain / "toolchain.json").read_text())
    if Path(frozen["workspace"]).resolve() != ROOT or "tools/run_visualbook.py" not in frozen["files"]:
        raise SystemExit("Use an owned frozen toolchain")
    incomplete = [p.parent.name for p in (output / "sessions").glob("*/invocation.json") if not (p.parent / "result.json").exists()]
    if incomplete:
        raise SystemExit("Unfinished author records; inspect live processes and preserve/recover diagnostics before resume: " + ", ".join(incomplete))
    command = [sys.executable, str(chain / "tools/run_visualbook.py"), str(manifest), str(output),
               "--max-chapters", str(args.max_chapters), "--attempt-limit", str(args.attempt_limit),
               "--campaign", str(campaign), "--timeout", str(args.timeout), "--keep-going"]
    if args.resume:
        command.append("--resume")
    directory.mkdir(parents=True)
    launch = {"manifest": str(manifest), "manifestSha256": sha(manifest), "output": str(output),
              "toolchain": str(chain), "toolFiles": frozen["files"], "command": command,
              "scope": "Detached existing serial driver; no new agent platform, credentials or automatic review."}
    # Hold one campaign-driver lock in the worker through subprocess completion.
    # This is separate from the official-author lock used by the existing driver.
    campaign.mkdir(parents=True, exist_ok=True)
    lock = os.open(campaign / "serial-driver.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with (directory / "driver.log").open("wb") as log:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", str(directory), str(lock)],
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True, pass_fds=(lock,))
    finally:
        os.close(lock)
    launch.update(pid=child.pid, startTicks=process_ticks(child.pid))
    save(directory / "launch.json", launch)
    print(json.dumps({"record": str(directory), "pid": child.pid, "startTicks": launch["startTicks"],
                      "scope": "Launch only. Inspect --status and the original run evidence; no completion claim."}))


if __name__ == "__main__":
    main()
