import hashlib, importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('visualbook_package',ROOT/'tools/package_visualbook.py');pkg=importlib.util.module_from_spec(spec);spec.loader.exec_module(pkg)
class PackageControls(unittest.TestCase):
 def fixture(self,p):
  index=b'<a href="one.html">one</a>';chapter=b'<a href="index.html">back</a>'
  (p/'index.html').write_bytes(index);(p/'one.html').write_bytes(chapter)
  for n in ['D3','KaTeX','Dagre','Graphlib']:(p/(n+'-LICENSE.txt')).write_text('Fixture license, not an upstream artifact')
  row={'id':'one','file':'one.html','title':'One','figures':0,'sourceSha256':'fixture','finalHtmlSha256':hashlib.sha256(chapter).hexdigest(),'planSha256':'fixture','reusedReviewedCandidate':False}
  (p/'build-record.json').write_text(json.dumps({'records':[row],'indexSha256':hashlib.sha256(index).hexdigest()}))
  (p/'private.log').write_text('not packaged');return row
 def test_deterministic_whitelist_and_changed_html_rejected(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d);self.fixture(p);a=p/'a.zip';b=p/'b.zip'
   self.assertEqual(pkg.package(p,a)['archiveSha256'],pkg.package(p,b)['archiveSha256'])
   with zipfile.ZipFile(a)as z:self.assertNotIn('private.log',z.namelist());self.assertIn('book-provenance.json',z.namelist())
   (p/'one.html').write_text('changed')
   with self.assertRaisesRegex(ValueError,'Chapter changed'):pkg.package(p,p/'changed.zip')
   self.assertFalse((p/'changed.zip').exists())
 def test_missing_link_rejected_before_archive(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d);self.fixture(p);index=b'<a href="missing.html">missing</a>';(p/'index.html').write_bytes(index)
   x=json.loads((p/'build-record.json').read_text());x['indexSha256']=hashlib.sha256(index).hexdigest();(p/'build-record.json').write_text(json.dumps(x))
   with self.assertRaisesRegex(ValueError,'Missing local link'):pkg.package(p,p/'bad.zip')
