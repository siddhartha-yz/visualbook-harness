"""Synthetic completeness/identity controls, never a real course or teacher review."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assembly, revision = load("assemble_course_textbook"), load("revise_course_textbook")


class CourseAssembly(unittest.TestCase):
    def save(self, file, value):
        file.write_text(json.dumps(value))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-course-assembly-", dir=ROOT / "work")
        self.base = Path(self.temp.name)
        self.course = self.base / "ingestion"
        self.course.mkdir()
        self.transcripts = self.base / "transcripts-large"
        self.transcripts.mkdir()
        self.plan = self.base / "plan.json"
        self.source = self.base / "source-manifest.json"
        self.reviewed = self.base / "reviewed"
        self.reviewed.mkdir()
        self.save(self.course / "course.json", {"bvid": "BVsynthetic", "title": "Synthetic fixture", "pages": [{"page": i, "cid": i + 100} for i in [1, 2]]})
        self.save(self.plan, {"bvid": "BVsynthetic", "title": "Synthetic two-chapter fixture", "chapters": [{"id": name, "title": name, "pages": [i]} for i, name in enumerate(["alpha", "beta"], 1)]})
        source_rows = []
        for page, name in enumerate(["alpha", "beta"], 1):
            transcript = self.transcripts / f"p{page:03d}.json"
            self.save(transcript, {"page": page, "cid": page + 100, "inputSha256": "synthetic-audio"})
            part = {"page": page, "cid": page + 100, "inputSha256": "synthetic-audio", "transcriptSha256": assembly.sha(transcript)}
            source_rows.append(part)
            job = self.base / name
            job.mkdir()
            (job / "chapter.md").write_text("# " + name + "\n\n## Synthetic section\n\nSynthetic text.\n")
            (job / "input.md").write_text("Synthetic source, no actual model call.\n")
            self.save(job / "input-identity.json", {"id": name, "bvid": "BVsynthetic", "courseSha256": assembly.sha(self.course / "course.json"), "planSha256": assembly.sha(self.plan), "parts": [part], "bundleHashes": {"input.md": assembly.sha(job / "input.md")}})
            self.save(job / "coverage.json", {"pages": [{"page": page}]})
            self.save(job / "review.json", {"issues": ["Fixture limit"], "sourceLimits": ["Synthetic input"]})
            self.save(job / "glossary.json", {"terms": [{"term": "Same original term", "definition": name}]})
            self.save(job / "result.json", {"exit_code": 0, "timed_out": False, "inputsUnchanged": True, "check": {"ready": False, "findings": ["known-unresolved-issues"], "chapterSha256": assembly.sha(job / "chapter.md")}})
            evidence = self.base / (name + "-evidence.json")
            self.save(evidence, {"scope": "Synthetic identity control"})
            review = self.base / (name + "-review.json")
            self.save(review, {"reviewer": "Synthetic declared reviewer", "expectedChapterSha256": assembly.sha(job / "chapter.md"), "reviewedParts": [page], "checks": ["Synthetic check"], "blockingIssues": [], "issueDispositions": [{"index": 0, "kind": "documented-source-limit", "reason": "Synthetic retained limit"}], "evidence": [{"path": str(evidence), "sha256": assembly.sha(evidence)}], "edits": []})
            revision.revise(job, review, self.reviewed / name)
        self.save(self.source, {"courseSha256": assembly.sha(self.course / "course.json"), "parts": source_rows})

    def tearDown(self):
        self.temp.cleanup()

    def run_assembly(self):
        return assembly.assemble(self.course, self.source, self.plan, self.reviewed, self.base / "book", 2)

    def test_complete_range_retains_failed_gates_and_glossary_origins(self):
        self.run_assembly()
        record = assembly.read(self.base / "book/record.json")
        self.assertEqual(record["parts"], 2)
        self.assertEqual(len(record["chapters"]), 2)
        self.assertTrue(all(not c["originalAuthorGate"]["ready"] for c in record["chapters"]))
        terms = assembly.read(self.base / "book/glossary-origins.json")["entries"]
        self.assertEqual([x["authorEntry"]["definition"] for x in terms], ["alpha", "beta"])
        self.assertEqual(assembly.sha(self.base / "book/chapters/alpha.md"), assembly.sha(self.reviewed / "alpha/chapter.md"))

    def test_partial_source_is_never_a_complete_book(self):
        source = assembly.read(self.source)
        source["parts"].pop()
        self.save(self.source, source)
        with self.assertRaisesRegex(ValueError, "complete source manifest"):
            self.run_assembly()
        self.assertFalse((self.base / "book").exists())

    def test_changed_adoption_or_evidence_is_rejected(self):
        file = self.reviewed / "alpha/chapter.md"
        original = file.read_bytes()
        file.write_text("Silent alteration")
        with self.assertRaisesRegex(ValueError, "changed explicit maintainer adoption"):
            self.run_assembly()
        file.write_bytes(original)
        (self.base / "alpha-evidence.json").write_text("Changed review evidence")
        with self.assertRaisesRegex(ValueError, "Maintainer evidence changed"):
            self.run_assembly()
        self.assertFalse((self.base / "book").exists())


if __name__ == "__main__":
    unittest.main()
