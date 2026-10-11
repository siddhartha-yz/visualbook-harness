"""Real whole-Markdown split/resume controls. No author or model process."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]).resolve()
if out.exists() or not out.is_relative_to(ROOT/'work'):raise SystemExit('Use a fresh ignored work/ directory')
out.mkdir(parents=True);original=out/'original';original.mkdir()
image=original/'axis.svg';image.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="6"/></svg>')
book=original/'whole.md';book.write_text('# 整本输入\n\n前言保留。\n\n## 第一部分\n\n![图](axis.svg)\n\n$x^2$\n\n```text\n## 代码不是新章节\n```\n\n## 第二部分\n\n正文二。\n\n## 第三部分\n\n$$\ny=3\n$$\n\n最后一句保留。\n')
records=[]
def invoke(label,output,limit=3,resume=False,passed=True):
 p=subprocess.run([sys.executable,str(ROOT/'tools/run_visualbook.py'),str(book),str(output),'--prepare-only','--split-level','2','--max-chapters',str(limit)]+(['--resume'] if resume else []),cwd=ROOT,capture_output=True,text=True,timeout=120)
 (out/(label+'.stdout')).write_text(p.stdout);(out/(label+'.stderr')).write_text(p.stderr)
 assert (p.returncode==0)==passed,(label,p.returncode,p.stderr)
 assert not list(output.rglob('invocation.json'))
 records.append({'label':label,'exit':p.returncode,'modelInvocations':0})
 return p
run=out/'prepared';invoke('whole-book',run)
sources=[json.loads(p.read_text()) for p in sorted((run/'inputs').glob('*.json'))]
assert len(sources)==3 and sum(s['adaptation']['mathExpected'] for s in sources)==2
assert sum(s['adaptation']['images'] for s in sources)==1
raw='\n'.join(b['raw'] for s in sources for b in s['blocks'])
assert '前言保留。' in raw and '最后一句保留。' in raw and '## 代码不是新章节' in raw
ids=[b['id'] for s in sources for b in s['blocks']];assert len(ids)==len(set(ids))
assert sources[0]['blocks'][0]['id']=='chapter-001'
invoke('resume-unchanged',run,resume=True)
small=out/'too-many';invoke('budget-rejected',small,limit=2,passed=False);assert not (small/'inputs').exists()
snapshot=run/'inputs/chapter-s001.source.json';before=hashlib.sha256(snapshot.read_bytes()).hexdigest()
image.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="30" height="30"/></svg>')
p=invoke('changed-local-image',run,resume=True,passed=False);assert 'local image content changed' in p.stderr
assert hashlib.sha256(snapshot.read_bytes()).hexdigest()==before
book.write_text(book.read_text()+'\n$\\unknownPartitionFormula{x}$\n')
bad=out/'bad-last';invoke('bad-late-formula',bad,passed=False);assert not (bad/'inputs').exists()
record={'passed':True,'modelCalls':0,'cases':records,'blocks':len(ids),'formulas':2,'images':1,
 'scope':'Whole Markdown import, original block coverage, three title partitions, real source-only browser preflight and resume/budget/math rejection. No generation, expert or aesthetic assessment.'}
(out/'control.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'passed':True,'cases':len(records),'modelCalls':0}))
