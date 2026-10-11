"""Frozen tools share the owning workspace's serial lock and startup budget."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "visualbook_workspace", Path(__file__).resolve().parents[1] / "tools/visualbook_workspace.py"
)
workspace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workspace)


class WorkspaceTests(unittest.TestCase):
    def test_frozen_copies_keep_one_owner_with_directory_or_worktree_git(self):
        with tempfile.TemporaryDirectory() as directory:
            owner = Path(directory)
            git = owner / ".git"
            git.mkdir()
            for name in ["first", "second"]:
                frozen = owner / "work" / name
                frozen.mkdir(parents=True)
                (frozen / "toolchain.json").write_text(json.dumps({"workspace": str(owner)}))
                self.assertEqual(workspace.workspace_root(frozen), owner)
            git.rmdir()
            git.write_text("gitdir: /unused/worktree-metadata")
            self.assertEqual(workspace.workspace_root(frozen), owner)

    def test_missing_or_legacy_manifest_keeps_local_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(workspace.workspace_root(root), root)
            (root / "toolchain.json").write_text("{}")
            self.assertEqual(workspace.workspace_root(root), root)

    def test_unrelated_owner_cannot_redirect_authoring_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            owner = root / "owner"
            owner.mkdir()
            (owner / ".git").mkdir()
            tool = root / "unrelated"
            tool.mkdir()
            (tool / "toolchain.json").write_text(json.dumps({"workspace": str(owner)}))
            with self.assertRaises(ValueError):
                workspace.workspace_root(tool)
