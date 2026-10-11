"""Synthetic identity controls; not real authoring or semantic textbook review."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("course_revision", ROOT / "tools/revise_course_textbook.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CourseRevision(unittest.TestCase):
    def setUp(self):
        (ROOT / "work").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-course-revision-", dir=ROOT / "work")
        self.base = Path(self.temp.name)
        self.job = self.base / "original"
        self.job.mkdir()
        self.write(self.job / "chapter.md", "# Synthetic title\n\nOne spelling error.\n")
        self.write(self.job / "input.md", "Synthetic source fixture, not real speech.\n")
        self.save(self.job / "input-identity.json", {"parts": [{"page": 1}], "bundleHashes": {"input.md": module.sha(self.job / "input.md")}})
        self.save(self.job / "coverage.json", {"pages": [{"page": 1}]})
        self.save(self.job / "review.json", {"issues": ["Documented boundary"], "sourceLimits": ["Synthetic fixture"]})
        self.save(self.job / "result.json", {"exit_code": 0, "timed_out": False, "inputsUnchanged": True, "check": {"chapterSha256": module.sha(self.job / "chapter.md"), "ready": False, "findings": ["known-unresolved-issues"]}})
        self.evidence = self.base / "evidence.json"
        self.save(self.evidence, {"scope": "Synthetic identity check, not semantic proof"})
        self.review = self.base / "review.json"
        self.declared = {"reviewer": "Synthetic fixture", "expectedChapterSha256": module.sha(self.job / "chapter.md"), "checks": ["Synthetic identity control"], "blockingIssues": [], "reviewedParts": [1], "issueDispositions": [{"index": 0, "kind": "documented-source-limit", "reason": "Synthetic boundary remains"}], "evidence": [{"path": str(self.evidence), "sha256": module.sha(self.evidence)}], "edits": [{"before": "spelling error", "after": "corrected spelling", "basis": "Synthetic exact replacement"}]}
        self.save(self.review, self.declared)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, value):
        path.write_text(value)

    def save(self, path, value):
        path.write_text(json.dumps(value))

    def test_failed_original_and_all_limits_survive_exact_edit(self):
        before = {p.name: module.sha(p) for p in self.job.iterdir()}
        output = self.base / "revised"
        record = module.revise(self.job, self.review, output)
        self.assertFalse(record["originalGate"]["ready"])
        self.assertEqual(record["originalIssues"], ["Documented boundary"])
        self.assertEqual(record["originalSourceLimits"], ["Synthetic fixture"])
        self.assertIn("corrected spelling", (output / "chapter.md").read_text())
        self.assertEqual(before, {p.name: module.sha(p) for p in self.job.iterdir()})

    def test_changed_source_or_chapter_cannot_be_adopted(self):
        self.write(self.job / "input.md", "Changed fixture")
        with self.assertRaisesRegex(ValueError, "input/frame changed"):
            module.revise(self.job, self.review, self.base / "revised")
        self.assertFalse((self.base / "revised").exists())

    def test_structural_defect_and_unclassified_issue_cannot_be_erased(self):
        result = json.loads((self.job / "result.json").read_text())
        result["check"]["findings"].append("invented-source-anchor")
        self.save(self.job / "result.json", result)
        with self.assertRaisesRegex(ValueError, "structural/source defects"):
            module.revise(self.job, self.review, self.base / "revised")
        result["check"]["findings"] = ["known-unresolved-issues"]
        self.save(self.job / "result.json", result)
        self.declared["issueDispositions"] = []
        self.save(self.review, self.declared)
        with self.assertRaisesRegex(ValueError, "Every original issue"):
            module.revise(self.job, self.review, self.base / "revised")


if __name__ == "__main__":
    unittest.main()
