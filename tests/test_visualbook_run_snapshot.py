"""Synthetic freshness controls, not model generation or learning evaluation."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("run_snapshot", ROOT / "tools/inspect_visualbook_run.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value))


class FreshnessControls(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.run = Path(self.temporary.name)
        (self.run / "inputs").mkdir()
        self.source = self.run / "inputs/chapter.source.json"
        self.source.write_text('{"id":"chapter","blocks":[]}')
        self.manifest = {"title": "Synthetic control", "chapters": [{"id": "chapter", "source": str(self.source)}]}
        save(self.run / "prepared-manifest.json", self.manifest)
        save(self.run / "prepared-inputs.json", {"manifest": self.manifest, "identity": {"chapters": [{"id": "chapter", "importedSha256": digest(self.source)}]}})
        self.job = self.run / "sessions/chapter"
        self.job.mkdir(parents=True)
        (self.job / "source.json").write_bytes(self.source.read_bytes())
        (self.job / "book.json").write_text('{"figures":[]}')
        (self.job / "book.html").write_text("synthetic html")
        self.preview = self.job / "preview-01"
        self.preview.mkdir()
        save(self.preview / "report.json", {"status": "completed", "sha256": digest(self.job / "book.html"), "findings": []})
        save(self.job / "review.json", {"ready_for_export": True, "issues": [], "html_sha256": digest(self.job / "book.html"), "plan_sha256": digest(self.job / "book.json")})
        save(self.job / "result.json", {"exit_code": 0, "timed_out": False, "source_unchanged": True, "tool_sources_unchanged": True, "returned_candidate_png_count": 1, "plan_sha256": digest(self.job / "book.json")})
        save(self.job / "export-gate.json", {"ready_for_export": True, "reasons": []})

    def state(self):
        return module.snapshot(self.run)["chapters"][0]

    def test_fresh_candidate_then_stale_plan_rejected_despite_saved_gate(self):
        self.assertEqual(self.state()["state"], "candidate_gate_ready")
        (self.job / "book.json").write_text('{"figures":[{"id":"changed"}]}')
        state = self.state()
        self.assertEqual(state["state"], "diagnostic")
        self.assertIn("plan-was-modified-after-authoring", state["reasons"])

    def test_changed_html_and_frozen_source_are_not_ready(self):
        (self.job / "book.html").write_text("changed")
        self.assertIn("preview-is-stale", self.state()["reasons"])
        self.source.write_text("changed input")
        self.assertEqual(self.state()["state"], "unreadable_or_changed")

    def test_no_result_is_not_evidence_of_running_process(self):
        (self.job / "result.json").unlink()
        self.assertEqual(self.state()["state"], "authoring_or_interrupted")
        save(self.job / "result.json", {"exit_code": 1})
        self.assertEqual(self.state()["state"], "diagnostic")


if __name__ == "__main__":
    unittest.main()
