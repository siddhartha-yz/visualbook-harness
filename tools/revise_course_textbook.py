"""Make an explicit, immutable maintainer revision without changing author results.

Review declarations are recorded as declarations, never teacher certification.
Original failed gates stay failed. Only exact, individually explained text edits
are allowed; all original source identities and limits travel with the copy.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def revise(job, review_file, output):
    job, review_file, output = job.resolve(), review_file.resolve(), output.resolve()
    work = (ROOT / "work").resolve()
    if not job.is_relative_to(work) or not review_file.is_relative_to(work) or not output.is_relative_to(work):
        raise ValueError("Use ignored work/ inputs and output")
    if output.exists() or output.is_relative_to(job) or job.is_relative_to(output):
        raise ValueError("Use a fresh directory outside the immutable author job")
    names = ["chapter.md", "input.md", "input-identity.json", "coverage.json", "review.json", "result.json"]
    originals = {name: sha(job / name) for name in names}
    declared = json.loads(review_file.read_text())
    original_review = json.loads((job / "review.json").read_text())
    result = json.loads((job / "result.json").read_text())
    identity = json.loads((job / "input-identity.json").read_text())
    if declared.get("expectedChapterSha256") != originals["chapter.md"]:
        raise ValueError("Review refers to another chapter")
    if result.get("check", {}).get("chapterSha256") != originals["chapter.md"] or result.get("inputsUnchanged") is not True:
        raise ValueError("Author output or source identity changed")
    if result.get("exit_code") != 0 or result.get("timed_out") or set(result["check"]["findings"]) - {"known-unresolved-issues"}:
        raise ValueError("Diagnose incomplete authoring or structural/source defects before adopting a chapter")
    for name, expected in identity["bundleHashes"].items():
        if sha(job / name) != expected:
            raise ValueError("Original input/frame changed: " + name)
    if not declared.get("reviewer") or not declared.get("checks") or declared.get("blockingIssues"):
        raise ValueError("Explicit reviewer, checks and no unresolved blocker required")
    issues = original_review.get("issues", [])
    dispositions = declared.get("issueDispositions", [])
    if sorted(item.get("index") for item in dispositions) != list(range(len(issues))):
        raise ValueError("Every original issue needs one explicit disposition")
    for item in dispositions:
        if item.get("kind") not in ["documented-source-limit", "corrected-in-copy"] or not item.get("reason"):
            raise ValueError("Do not silently erase an original issue")
    pages = [part["page"] for part in identity["parts"]]
    if sorted(declared.get("reviewedParts", [])) != sorted(pages):
        raise ValueError("Declare actual knowledge-review scope for every assigned part")
    evidence = []
    for item in declared.get("evidence", []):
        path = Path(item["path"]).resolve()
        if not path.is_relative_to(work) or not path.is_file() or sha(path) != item["sha256"]:
            raise ValueError("Review evidence missing, changed or outside ignored work/")
        evidence.append(item)
    if not evidence:
        raise ValueError("Preserve at least one real review-evidence file")
    text = (job / "chapter.md").read_text()
    edits = declared.get("edits", [])
    for edit in edits:
        before, after = edit["before"], edit["after"]
        if not before or not after or text.count(before) != 1 or not edit.get("basis"):
            raise ValueError("Each edit needs one exact match, replacement and basis")
        text = text.replace(before, after, 1)
    output.mkdir(parents=True)
    (output / "chapter.md").write_text(text)
    record = {"status": "maintainer-adopted-for-visualization", "modelCalls": 0,
              "originalJob": str(job), "originalHashes": originals,
              "originalGate": result["check"], "originalIssues": issues,
              "originalSourceLimits": original_review.get("sourceLimits", []),
              "reviewDeclaration": declared, "reviewFileSha256": sha(review_file),
              "chapterSha256": sha(output / "chapter.md"), "toolSha256": sha(Path(__file__)),
              "scope": "Explicit maintainer revision and review declaration; no new model generation, no automatic semantic proof, no teacher certification. Original gates and limits retained."}
    save(output / "revision.json", record)
    if any(sha(job / name) != expected for name, expected in originals.items()):
        raise RuntimeError("Immutable author job changed during revision")
    print(json.dumps({"chapter": str(output / "chapter.md"), "edits": len(edits), "originalGateReady": result["check"]["ready"], "modelCalls": 0}))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("review", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    revise(args.job, args.review, args.output)


if __name__ == "__main__":
    main()
