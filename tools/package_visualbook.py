"""Package a verified local assembly without source text files or private logs.

Every HTML identity must match its assembly record. This is a deterministic
offline ZIP, not publication or an artistic/math acceptance tool.
"""
import argparse, hashlib, importlib.util, json, re, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
_spec=importlib.util.spec_from_file_location('visualbook_workspace',Path(__file__).with_name('visualbook_workspace.py'))
_workspace=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_workspace)
def sha(b):return hashlib.sha256(b).hexdigest()
def package(book:Path,out:Path):
 book=book.resolve();out=out.resolve()
 if out.exists():raise ValueError('Output exists; preserve prior package')
 record=json.loads((book/'build-record.json').read_text());rows=record['records']
 if not rows or len(rows)>32:raise ValueError('Invalid chapter count')
 files={'index.html':(book/'index.html').read_bytes()}
 if sha(files['index.html'])!=record['indexSha256']:raise ValueError('Index changed after assembly')
 if len({r['id']for r in rows})!=len(rows):raise ValueError('Duplicate chapters')
 for r in rows:
  if not re.fullmatch('[a-z][a-z0-9-]*',r['id'])or r['file']!=r['id']+'.html':raise ValueError('Unsafe chapter filename')
  content=(book/r['file']).read_bytes()
  if sha(content)!=r['finalHtmlSha256']:raise ValueError('Chapter changed after assembly: '+r['id'])
  files[r['file']]=content
 for name in ['D3-LICENSE.txt','KaTeX-LICENSE.txt','Dagre-LICENSE.txt','Graphlib-LICENSE.txt']:
  files[name]=(book/name).read_bytes()
 if (book/'D2L-LICENSE.txt').exists():files['D2L-LICENSE.txt']=(book/'D2L-LICENSE.txt').read_bytes()
 for name,content in files.items():
  if not name.endswith('.html'):continue
  for target in re.findall(r'(?:href|src)="([^"\n]+)"',content.decode()):
   if target.startswith(('data:','http:','https:','#')):continue
   if target.split('#')[0]not in files:raise ValueError('Missing local link '+target+' in '+name)
 provenance={'scope':'Local offline reader package; no remote publication. Original textbook license/accuracy remain separately declared by source metadata. No provider transcripts, Markdown/source JSON, reviews or intermediate images included.',
  'chapters':[{k:r[k]for k in ['id','title','figures','sourceSha256','finalHtmlSha256','planSha256','reusedReviewedCandidate']}for r in rows],
  'fileHashes':{n:sha(v)for n,v in files.items()}}
 files['book-provenance.json']=(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n').encode()
 with zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as z:
  for name,content in sorted(files.items()):
   info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
   z.writestr(info,content,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
 return {'archiveSha256':sha(out.read_bytes()),'files':len(files),'chapters':len(rows),'bytes':out.stat().st_size,'modelCalls':0,'scope':'Identity-checked packaging, not mathematical/artistic review or publication.'}
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('book',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
 if not a.output.resolve().is_relative_to((_workspace.workspace_root(ROOT)/'work').resolve()):raise SystemExit('Use ignored work/ for local source-derived packages')
 print(json.dumps(package(a.book,a.output)))
if __name__=='__main__':main()
