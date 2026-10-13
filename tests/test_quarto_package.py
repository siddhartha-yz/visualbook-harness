"""Synthetic artifact controls; no model, Quarto or browser certification."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('quarto_package', ROOT / 'tools/package_quarto_book.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QuartoPackageTests(unittest.TestCase):
    def test_review_identity_resources_and_deterministic_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            book = p / '_book'
            (book / 'downloads').mkdir(parents=True)
            files = {'index.html': b'<a href="small.html">Read</a>', 'small.html': b'<a href="./">Home</a><script src="reader.js"></script>',
                'search.json': b'[]', 'reader.js': b'void 0;', 'reader.css': b'body{}', 'downloads/textbook.md': b'# Small\n'}
            assembly = {'draft': False, 'chapters': [{'id': 'small', 'title': 'Small', 'originalMarkdownSha256': module.sha(files['downloads/textbook.md']), 'planFileSha256': 'fixture', 'widgets': []}]}
            (p / 'assembly-record.json').write_text(json.dumps(assembly))
            (p / 'reader-build-check.json').write_text('{"status":"awaiting-browser-review"}')
            for n, b in files.items(): (book / n).write_bytes(b)
            review = {'readyForPackage': True, 'blockingIssues': [], 'assemblyRecordSha256': module.sha((p / 'assembly-record.json').read_bytes()), 'fileHashes': {n: module.sha(b) for n, b in files.items()}}
            review_file = p / 'review.json'
            def accept(): review_file.write_text(json.dumps(review))
            accept()
            first = module.package(p, review_file, p / 'one.zip')
            second = module.package(p, review_file, p / 'two.zip')
            self.assertEqual(first['archiveSha256'], second['archiveSha256'])
            with zipfile.ZipFile(p / 'one.zip') as z:
                self.assertIsNone(z.testzip())
                self.assertIn('serve.py', z.namelist())
            (book / 'small.html').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'files changed'): module.package(p, review_file, p / 'changed.zip')
            files['small.html'] = b'<script src="missing.js"></script>'
            (book / 'small.html').write_bytes(files['small.html'])
            review['fileHashes']['small.html'] = module.sha(files['small.html']); accept()
            with self.assertRaisesRegex(ValueError, 'Missing local'): module.package(p, review_file, p / 'missing.zip')
            files['small.html'] = b'<script src="./"></script>'
            (book / 'small.html').write_bytes(files['small.html'])
            review['fileHashes']['small.html'] = module.sha(files['small.html']); accept()
            with self.assertRaisesRegex(ValueError, 'Missing local'): module.package(p, review_file, p / 'directory-asset.zip')
            files['small.html'] = b'<script src="https://example.com/runtime.js"></script>'
            (book / 'small.html').write_bytes(files['small.html'])
            review['fileHashes']['small.html'] = module.sha(files['small.html']); accept()
            with self.assertRaisesRegex(ValueError, 'External executable'): module.package(p, review_file, p / 'remote.zip')
            files['small.html'] = b'<a href="../private.txt">Outside</a>'
            (p / 'private.txt').write_text('fixture')
            (book / 'small.html').write_bytes(files['small.html'])
            review['fileHashes']['small.html'] = module.sha(files['small.html']); accept()
            with self.assertRaisesRegex(ValueError, 'escapes'): module.package(p, review_file, p / 'escape.zip')
            files['small.html'] = b'<a href="./">Home</a>'
            (book / 'small.html').write_bytes(files['small.html'])
            review['fileHashes']['small.html'] = module.sha(files['small.html'])
            for css in [b'@import"https://fonts.googleapis.com/css?family=Example";',
                        b'@import url(https://example.com/font.css);',
                        b'body{background:url(../private.txt)}',
                        b'@font-face{src:url(missing.woff2)}']:
                (book / 'reader.css').write_bytes(css)
                review['fileHashes']['reader.css'] = module.sha(css); accept()
                with self.assertRaises(ValueError): module.package(p, review_file, p / 'bad-css.zip')
            review['blockingIssues'] = ['not reviewed']; accept()
            with self.assertRaisesRegex(ValueError, 'blocked'): module.package(p, review_file, p / 'blocked.zip')
