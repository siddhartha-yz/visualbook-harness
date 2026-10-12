"""Read a serial run without generating, resuming or trusting stale export gates.

The snapshot is observational: files can change while an author is writing.
Candidate readiness means the existing engineering gate, never teaching quality
or whole-book acceptance. Provider logs and credentials are not read.
"""
import argparse
import importlib.util
import json
import re
from collections import Counter
from pathlib import Path

_spec = importlib.util.spec_from_file_location("visualbook_runner", Path(__file__).with_name("run_visualbook.py"))
_runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_runner)


def snapshot(directory):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / "prepared-manifest.json").read_text())
    frozen = json.loads((directory / "prepared-inputs.json").read_text())
    chapters = manifest.get("chapters", [])
    ids = [row.get("id") for row in chapters]
    if not 1 <= len(ids) <= 32 or len(set(ids)) != len(ids) or any(not isinstance(i, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", i) for i in ids):
        raise ValueError("Invalid prepared chapter topology")
    if frozen.get("manifest") != manifest:
        raise ValueError("Prepared manifest differs from frozen preparation")
    identities = {row["id"]: row for row in frozen["identity"]["chapters"]}
    if set(identities) != set(ids):
        raise ValueError("Frozen identity omits or adds chapters")
    records = []
    for row in chapters:
        ident = row["id"]
        source = Path(row["source"])
        source = source.resolve() if source.is_absolute() else (directory / source).resolve()
        if source != directory / "inputs" / (ident + ".source.json"):
            raise ValueError("Prepared source is outside its named input snapshot")
        job = directory / "sessions" / ident
        record = {"id": ident, "state": "not_started", "reasons": []}
        try:
            if _runner.digest(source) != identities[ident]["importedSha256"]:
                raise ValueError("frozen-input-changed")
            if (job / "result.json").exists():
                result = json.loads((job / "result.json").read_text())
                gate = _runner.inspect(job)  # Recompute; never reuse export-gate.json.
                if not (job / "source.json").exists() or _runner.digest(source) != _runner.digest(job / "source.json"):
                    gate["ready_for_export"] = False
                    gate["reasons"].append("input-source-changed")
                record.update(state="candidate_gate_ready" if gate["ready_for_export"] else "diagnostic",
                              reasons=gate["reasons"], latestPreview=gate["latest_preview"],
                              authorWallSeconds=result.get("wall_s"), authorExitCode=result.get("exit_code"))
            elif job.exists():
                record["state"] = "authoring_or_interrupted"
        except (OSError, ValueError, KeyError, TypeError) as error:
            record.update(state="unreadable_or_changed", reasons=[str(error)])
        records.append(record)
    return {"title": manifest.get("title"), "chapters": records, "counts": dict(Counter(r["state"] for r in records)),
            "plannedChapters": len(records), "modelCalls": 0,
            "scope": "Read-only point-in-time snapshot; no process liveness, source semantics, mathematical or artistic certification, or whole-book delivery acceptance."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    print(json.dumps(snapshot(args.directory), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
