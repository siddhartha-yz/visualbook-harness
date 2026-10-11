"""Real source-reader MCP/PNG/accessibility controls. No model process."""
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
matrix=r'\begin{pmatrix}'+ '&'.join(['1000']*14)+r'\end{pmatrix}'
(out/'chapter.md').write_text('# 阅读控制\n\n$$'+matrix+'$$\n\n最后一句。\n')
subprocess.run(['node',str(ROOT/'packages/visualbook/import.mjs'),str(out/'chapter.md'),str(out/'source.json')],check=True,capture_output=True)
source=json.loads((out/'source.json').read_text());anchor=next(b['id'] for b in source['blocks']if b['math']['expected'])
(out/'book.json').write_text('{"figures":[]}\n')
calls=[]
with (out/'stderr.log').open('w') as err:
 p=subprocess.Popen([sys.executable,str(ROOT/'tools/visualbook_mcp.py'),'--workspace',str(out)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True)
 try:
  def call(name,arguments={}):
   p.stdin.write(json.dumps({'jsonrpc':'2.0','id':len(calls)+1,'method':'tools/call','params':{'name':name,'arguments':arguments}})+'\n');p.stdin.flush()
   result=json.loads(p.stdout.readline())['result']
   calls.append({'tool':name,'arguments':arguments,'isError':result['isError'],'imageCount':sum(b['type']=='image'for b in result['content'])})
   return result
  assert call('inspect_reader',{'anchor':anchor})['isError'];assert not list(out.glob('reader-inspection-*'))
  assert not call('build_book')['isError'];before={n:hashlib.sha256((out/n).read_bytes()).hexdigest()for n in ['book.html','source.json','book.json']}
  assert not call('inspect_reader',{'anchor':anchor,'width':375})['isError'];assert calls[-1]['imageCount']>=3
  report=json.loads((out/'reader-inspection-001/report.json').read_text());f=report['formulas'][0]
  assert f['home']==0 and f['end']>0 and abs(f['end']-f['maximum'])<=2
  assert report['htmlSha256']==before['book.html']
  assert all(hashlib.sha256((out/n).read_bytes()).hexdigest()==h for n,h in before.items())
  assert call('inspect_reader',{'anchor':'missing-anchor'})['isError']
  assert json.loads((out/'reader-inspection-002/report.json').read_text())['status']=='failed'
  assert call('inspect_reader',{'anchor':anchor,'width':0})['isError']
  assert len(list(out.glob('reader-inspection-*')))==2
  (out/'book.json').write_text('{"figures":[],"annotations":[]}\n')
  assert call('inspect_reader',{'anchor':anchor})['isError'];assert len(list(out.glob('reader-inspection-*')))==2
  assert not call('build_book')['isError']
  assert not call('inspect_reader',{'anchor':anchor,'width':1920})['isError']
  for i in range(4,13):(out/f'reader-inspection-{i:03d}').mkdir()
  assert call('inspect_reader',{'anchor':anchor})['isError'];assert not(out/'reader-inspection-013').exists()
 finally:p.stdin.close();p.wait(timeout=10)
(out/'control.json').write_text(json.dumps({'passed':True,'modelCalls':0,'calls':calls,'htmlSourcePlanPreserved':True,'scope':'Actual MCP PNG delivery, keyboard Home/End, missing anchor, invalid width, stale-build rejection and inspection cap. Maintainer fixtures, not new author or art evidence.'},indent=2)+'\n')
print(json.dumps({'passed':True,'calls':len(calls),'modelCalls':0}))
