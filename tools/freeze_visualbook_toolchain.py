"""Copy owned authoring tools into a hashed, ignored experiment snapshot.

Keeps serial generation on a fixed implementation while maintenance continues.
Dependencies are an explicitly recorded link to the existing pinned runtime;
this is not a standalone archive and does not snapshot account configuration.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    out = args.output.resolve()
    if not out.is_relative_to(ROOT / "work") or out.exists():
        raise SystemExit("Use a fresh output inside ignored work/")
    runtime = ROOT / "work/visualbook/runtime"
    if not (runtime / "node_modules").is_dir():
        raise SystemExit("Install the pinned runtime first")
    records = {}
    for folder in ["packages/visualbook", "tools", "experiments/visualbook"]:
        for source in sorted((ROOT / folder).rglob("*")):
            if not source.is_file() or "__pycache__" in source.parts or source.suffix == ".pyc":
                continue
            target = out / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            records[str(source.relative_to(ROOT))] = hashlib.sha256(source.read_bytes()).hexdigest()
    for name in ["AGENTS.md", "package.json", "package-lock.json"]:
        shutil.copyfile(ROOT / name, out / name)
        records[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    (out / "work/visualbook").mkdir(parents=True)
    (out / "work/visualbook/runtime").symlink_to(runtime, target_is_directory=True)
    lock = ROOT / "experiments/visualbook/package-lock.json"
    frozen = {"workspace":str(ROOT),"baseCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "files": records, "codeSha256": hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest(),
              "runtime": str(runtime), "runtimeLockSha256": hashlib.sha256(lock.read_bytes()).hexdigest(),
              "limits": "Owned sources copied, dependencies linked and lock-pinned. No credentials, provider logs, upstream checkouts or user textbooks copied. Verify source hashes after authoring; not a standalone dependency archive."}
    (out / "toolchain.json").write_text(json.dumps(frozen, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output":str(out),"files":len(records),"codeSha256":frozen["codeSha256"]}))


if __name__ == "__main__":
    main()
