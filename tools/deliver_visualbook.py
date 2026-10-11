"""Check the actual assembled reader, then create its offline ZIP; no author call.

Each attempt stays in fresh ignored work/. A failed final reader never produces
an archive or a ready record. This is an engineering gate, not a quality score.
"""
import argparse, hashlib, importlib.util, json, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("visualbook_workspace", ROOT / "tools/visualbook_workspace.py")
_workspace = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_workspace)

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("book", type=Path); parser.add_argument("output", type=Path)
    args = parser.parse_args(); book, out = args.book.resolve(), args.output.resolve()
    if out.exists() or not out.is_relative_to((_workspace.workspace_root(ROOT) / "work").resolve()):
        raise SystemExit("Use fresh ignored work/ output; retain previous attempts")
    out.mkdir(parents=True); started = time.monotonic()
    record = {"status": "running", "modelCalls": 0, "ready": False,
              "scope": "Final offline reader identity/render/navigation gate and deterministic packaging. Does not change author outcomes or certify mathematics, art or learning."}
    def save(): (out / "delivery-record.json").write_text(json.dumps(record, indent=2) + "\n")
    save()
    try:
        record["assemblySha256"] = digest(book / "build-record.json")
        record["toolHashes"] = {n: digest(ROOT / n) for n in ["tools/deliver_visualbook.py", "tools/check_visualbook_collection.mjs", "tools/package_visualbook.py", "tools/visualbook_capture.mjs"]}
        p = subprocess.run(["node", str(ROOT / "tools/check_visualbook_collection.mjs"), str(book), str(out / "reader")], capture_output=True, text=True)
        (out / "reader.log").write_text(p.stdout + p.stderr)
        reader = json.loads((out / "reader/report.json").read_text())
        record["readerReportSha256"] = digest(out / "reader/report.json")
        record["readerCases"] = len(reader["cases"])
        if p.returncode or reader["status"] != "completed" or reader["findings"]:
            raise ValueError("Final reader failed; no archive produced")
        if digest(book / "build-record.json") != record["assemblySha256"]:
            raise ValueError("Assembly changed during final check")
        p = subprocess.run([sys.executable, str(ROOT / "tools/package_visualbook.py"), str(book), str(out / "book.zip")], capture_output=True, text=True)
        (out / "package.log").write_text(p.stdout + p.stderr)
        if p.returncode: raise ValueError("Packaging failed; retain package.log")
        record["package"] = json.loads(p.stdout)
        record.update(status="completed", ready=True)
    except Exception as error:
        record.update(status="failed", error=str(error))
    finally:
        record["wallSeconds"] = round(time.monotonic() - started, 3); save()
    print(json.dumps({"status": record["status"], "ready": record["ready"], "modelCalls": 0,
                      "record": str(out / "delivery-record.json"), "archive": str(out / "book.zip") if record["ready"] else None}))
    if not record["ready"]: raise SystemExit(2)

if __name__ == "__main__": main()
