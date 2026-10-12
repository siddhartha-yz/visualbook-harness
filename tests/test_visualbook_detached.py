"""Real process-lifecycle checks with a synthetic driver; no model or browser."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/start_visualbook_run.py"
spec = importlib.util.spec_from_file_location("detached", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DetachedTests(unittest.TestCase):
    def test_pid_reuse_is_not_liveness(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "work") as tmp:
            p = Path(tmp)
            ticks = module.process_ticks(os.getpid())
            (p / "launch.json").write_text(json.dumps({"pid": os.getpid(), "startTicks": ticks + 1}))
            self.assertFalse(module.status(p)["live"])
            (p / "launch.json").write_text(json.dumps({"pid": os.getpid(), "startTicks": ticks}))
            self.assertTrue(module.status(p)["live"])

    def test_detached_driver_survives_launcher_and_records_real_exit(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "work") as tmp:
            p = Path(tmp)
            chain = p / "chain"
            (chain / "tools").mkdir(parents=True)
            driver = chain / "tools/run_visualbook.py"
            driver.write_text("import time\ntime.sleep(.8)\nraise SystemExit(17)\n")
            (chain / "toolchain.json").write_text(json.dumps({"workspace": str(ROOT),
                "files": {"tools/run_visualbook.py": hashlib.sha256(driver.read_bytes()).hexdigest()}}))
            manifest = p / "manifest.json"
            manifest.write_text('{"synthetic":true}')
            campaign = p / "campaign"
            record = p / "record"
            cmd = [sys.executable, str(SCRIPT), str(manifest), str(campaign / "run"), str(record),
                   "--toolchain", str(chain), "--campaign", str(campaign)]
            launched = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(launched.returncode, 0, launched.stderr)
            state = module.status(record)
            self.assertTrue(state["live"])
            self.assertEqual(os.getsid(state["pid"]), state["pid"])
            # Second launcher must not run alongside the same campaign worker.
            duplicate = subprocess.run(cmd[:4] + [str(p / "duplicate")] + cmd[5:], capture_output=True, text=True)
            self.assertNotEqual(duplicate.returncode, 0)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                state = module.status(record)
                if state["execution"] and state["execution"]["status"] == "completed":
                    break
                time.sleep(.02)
            self.assertEqual(state["execution"]["exitCode"], 17)
            self.assertEqual(state["execution"]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
