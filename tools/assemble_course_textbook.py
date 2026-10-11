"""Freeze a complete reviewed course textbook without concealing failed author gates.

No generation or semantic certification. Every planned part needs its original
source identity and an explicit maintainer adoption; no sample-to-book fallback.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def inside_work(path):
    path = Path(path).resolve()
    if not path.is_relative_to((ROOT / "work").resolve()):
        raise ValueError("Course outputs and retained evidence must be in ignored work/")
    return path


def assemble(course, source_manifest, plan_file, reviewed, output, max_chapters=32, groups_file=None):
    course, source_manifest, plan_file = map(Path, [course, source_manifest, plan_file])
    reviewed, output = inside_work(reviewed), inside_work(output)
    if output.exists() or output.is_relative_to(reviewed) or reviewed.is_relative_to(output):
        raise ValueError("Use a fresh output separate from maintainer revisions")
    meta, final_source, plan = read(course / "course.json"), read(source_manifest), read(plan_file)
    if plan.get("bvid") != meta["bvid"]:
        raise ValueError("Plan refers to another video course")
    course_sha, plan_sha = sha(course / "course.json"), sha(plan_file)
    chapters = plan.get("chapters", [])
    ids = [chapter["id"] for chapter in chapters]
    if not 1 <= len(ids) <= max_chapters <= 32 or len(set(ids)) != len(ids) or any(not re.fullmatch(r"[a-z][a-z0-9-]*", i) for i in ids):
        raise ValueError("Use an explicit complete plan of 1..32 unique chapters")
    actual = {part["page"]: part for part in meta["pages"]}
    groups = None
    if groups_file is not None:
        groups_file = Path(groups_file).resolve()
        groups = read(groups_file)
        checked = subprocess.run(["node", str(ROOT / "packages/visualbook/book-index.mjs"), "--groups", str(groups_file), str(plan_file.resolve())], capture_output=True, text=True, timeout=30)
        if checked.returncode:
            raise ValueError("Invalid complete-book groups: " + checked.stderr)
    assigned = [page for chapter in chapters for page in chapter["pages"]]
    if len(actual) != len(meta["pages"]) or sorted(assigned) != sorted(actual) or len(set(assigned)) != len(assigned):
        raise ValueError("Every actual source part must occur exactly once in the plan")
    source_rows = final_source.get("parts", [])
    sources = {part["page"]: part for part in source_rows}
    if final_source.get("courseSha256") != course_sha or len(sources) != len(source_rows) or sorted(sources) != sorted(actual):
        raise ValueError("A complete source manifest for this exact course is required")
    for page, row in sources.items():
        transcript = source_manifest.parent / "transcripts-large" / f"p{page:03d}.json"
        data = read(transcript)
        if sha(transcript) != row["transcriptSha256"] or row["cid"] != actual[page]["cid"] or data["cid"] != row["cid"] or data["inputSha256"] != row["inputSha256"]:
            raise ValueError("Source transcript identity changed at part " + str(page))
    records, glossary = [], []
    for chapter in chapters:
        directory = inside_work(reviewed / chapter["id"])
        revision_file = directory / "revision.json"
        revision = read(revision_file)
        job = inside_work(revision["originalJob"])
        identity = read(job / "input-identity.json")
        declaration = revision.get("reviewDeclaration", {})
        if revision.get("status") != "maintainer-adopted-for-visualization" or revision.get("chapterSha256") != sha(directory / "chapter.md") or not declaration.get("reviewer") or not declaration.get("checks") or not declaration.get("evidence") or declaration.get("blockingIssues"):
            raise ValueError("Missing or changed explicit maintainer adoption: " + chapter["id"])
        if identity["id"] != chapter["id"] or identity["courseSha256"] != course_sha or identity["planSha256"] != plan_sha or identity["bvid"] != meta["bvid"] or [p["page"] for p in identity["parts"]] != chapter["pages"]:
            raise ValueError("Original author was given another chapter or course")
        if sorted(declaration.get("reviewedParts", [])) != sorted(chapter["pages"]):
            raise ValueError("Maintainer review scope omits an assigned source part")
        result = read(job / "result.json")
        if result.get("exit_code") != 0 or result.get("timed_out") or result.get("inputsUnchanged") is not True or set(result["check"]["findings"]) - {"known-unresolved-issues"} or result["check"] != revision["originalGate"]:
            raise ValueError("Unresolved original structural/process gate: " + chapter["id"])
        for name, expected in revision["originalHashes"].items():
            if sha(job / name) != expected:
                raise ValueError("Original author evidence changed: " + name)
        if result["check"].get("chapterSha256") != sha(job / "chapter.md") or declaration.get("expectedChapterSha256") != sha(job / "chapter.md"):
            raise ValueError("Maintainer declaration refers to another original chapter")
        for name, expected in identity["bundleHashes"].items():
            file = inside_work(job / name)
            if not file.is_relative_to(job) or sha(file) != expected:
                raise ValueError("Original writing input/frame changed: " + name)
        for part in identity["parts"]:
            current = sources[part["page"]]
            if any(part[key] != current[key] for key in ["cid", "transcriptSha256", "inputSha256"]):
                raise ValueError("Author source differs from final course source")
        for item in declaration.get("evidence", []):
            if sha(inside_work(item["path"])) != item["sha256"]:
                raise ValueError("Maintainer evidence changed")
        original_review = read(job / "review.json")
        if revision["originalIssues"] != original_review.get("issues", []) or revision["originalSourceLimits"] != original_review.get("sourceLimits", []):
            raise ValueError("Original issue or source-limit record changed")
        if sorted(item["index"] for item in declaration.get("issueDispositions", [])) != list(range(len(original_review.get("issues", [])))):
            raise ValueError("An original issue disappeared without disposition")
        terms = read(job / "glossary.json").get("terms", [])
        glossary.extend({"chapter": chapter["id"], "originalGlossarySha256": sha(job / "glossary.json"), "authorEntry": term} for term in terms)
        records.append({"id": chapter["id"], "title": chapter["title"], "pages": chapter["pages"],
                        "chapterSha256": sha(directory / "chapter.md"), "revisionSha256": sha(revision_file),
                        "reviewer": declaration["reviewer"], "originalAuthorGate": revision["originalGate"],
                        "originalSourceLimits": revision["originalSourceLimits"], "remainingLimits": declaration.get("remainingLimits", []),
                        "source": str(directory / "chapter.md")})
    # All input checks happen before creating a completed book directory.
    output.mkdir(parents=True)
    (output / "chapters").mkdir()
    manifest = {"title": plan["title"], "description": "依原视频课程全套分集整理；按知识章节阅读，来源回看随章保留。", "chapters": []}
    if groups_file is not None:
        manifest["groups"] = groups
    for record in records:
        file = output / "chapters" / (record["id"] + ".md")
        file.write_bytes(Path(record["source"]).read_bytes())
        manifest["chapters"].append({"id": record["id"], "source": str(file), "sourceUrl": meta.get("url", "https://www.bilibili.com/video/" + meta["bvid"]), "sourceName": plan.get("sourceName", meta.get("title", "原视频课程") + "：编者整理")})
        record["frozenChapter"] = str(file)
    combined = "# " + plan["title"] + "\n\n按知识章节整理的课程教材。机器转写、编者补充和来源限制随章记录。\n\n" + "\n\n---\n\n".join(Path(r["source"]).read_text() for r in records)
    (output / "textbook.md").write_text(combined)
    save(output / "manifest.json", manifest)
    save(output / "glossary-origins.json", {"entries": glossary, "scope": "Original per-chapter author glossary entries with origins; duplicate or differing definitions are retained, not silently unified or certified."})
    save(output / "record.json", {"status": "complete-maintainer-adopted-range", "modelCalls": 0,
          "parts": len(actual), "chapters": records, "courseSha256": course_sha, "planSha256": plan_sha,
          "sourceManifestSha256": sha(source_manifest), "manifestSha256": sha(output / "manifest.json"),
          "groupsSha256": sha(Path(groups_file)) if groups_file is not None else None,
          "textbookSha256": sha(output / "textbook.md"), "toolSha256": sha(Path(__file__)),
          "scope": "Complete source topology and frozen maintainer adoptions, not verbatim ASR, independent teacher certification or visualbook acceptance. Original failed author gates stay recorded."})
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ["course", "source_manifest", "plan", "reviewed", "output"]:
        p.add_argument(name, type=Path)
    p.add_argument("--max-chapters", type=int, default=32)
    p.add_argument("--groups", type=Path, help="Optional explicit book-index groups; visual preparation validates complete chapter coverage before model calls")
    a = p.parse_args()
    manifest = assemble(a.course, a.source_manifest, a.plan, a.reviewed, a.output, a.max_chapters, a.groups)
    print(json.dumps({"chapters": len(manifest["chapters"]), "manifest": str(a.output.resolve() / "manifest.json"), "modelCalls": 0}))


if __name__ == "__main__":
    main()
