"""Independent stdlib arithmetic against captured browser facts and author plans.

No imports from the library's numeric kernels. This checks finite examples and
idealised assumptions, never hardware measurements, learned weights or art.
"""
import collections, hashlib, json, math, sys
from fractions import Fraction
from pathlib import Path
capture=Path(sys.argv[1]); plans=Path(sys.argv[2]); output=Path(sys.argv[3])
data=json.loads(capture.read_text());checks=0;poses=collections.Counter()
def eq(a,b):
 global checks
 checks+=1
 if isinstance(a,(int,float)) and isinstance(b,(int,float)) and (isinstance(a,float)or isinstance(b,float)): assert math.isclose(a,b,rel_tol=1e-11,abs_tol=1e-10),(a,b)
 else: assert a==b,(a,b)
def rot(v,t):
 # Independent complex-number multiplication, rather than the kernel matrix.
 z=complex(*v)*complex(math.cos(t),math.sin(t));return [z.real,z.imag]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def rope(f):
 for p in f['pairs']:
  frequency=f['base']**(-2*p['index']/f['dimension']);eq(p['frequency'],frequency)
  a=rot(p['q'],(f['m']+f['shift'])*frequency);b=rot(p['k'],(f['n']+f['shift'])*frequency)
  for x,y in zip(p['rotatedQ'],a):eq(x,y)
  for x,y in zip(p['rotatedK'],b):eq(x,y)
  eq(p['dot'],dot(a,b));eq(p['relativeDot'],dot(p['q'],rot(p['k'],(f['n']-f['m'])*frequency)))
  eq(sum(x*x for x in a),sum(x*x for x in p['q']))
def find(value,key):
 if isinstance(value,dict):
  if key in value:return value[key]
  for v in value.values():
   found=find(v,key)
   if found is not None:return found
 elif isinstance(value,list):
  for v in value:
   found=find(v,key)
   if found is not None:return found
 return None
for row in data['records']:
 name=row['id'];f=row['facts'];poses[name]+=1
 if name=='shared-shift':rope(f['shift-plane'])
 elif name=='frequency-scales':
  for key in ['frequency-pair-0','frequency-pair-1']:
   for sub in f[key].values():
    if 'pairs' in sub:rope(sub)
 elif name=='gemm-balance':
  b,d,n=f['B'],f['D'],f['F'];flops=2*b*d*n;traffic=2*(b*d+d*n+b*n)
  eq(f['flops'],flops);eq(f['bytes'],traffic);eq(f['intensity'],float(Fraction(flops,traffic)))
  eq(f['computeUs'],float(Fraction(flops,989*10**12)*10**6));eq(f['transferUs'],float(Fraction(traffic,335*10**10)*10**6))
  eq(f['idealUs'],max(f['computeUs'],f['transferUs']))
  r=Fraction(989*10**12,335*10**10);boundary=r/(1-r*(Fraction(1,d)+Fraction(1,n)))
  eq(f['criticalBatch'],float(boundary));eq(f['intensity']<float(r),b<float(boundary))
 elif name=='shared-private':
  b,s,d,n=f['B'],f['S'],f['D'],f['F'];w=2*d*n;k=4*s*d
  eq(f['weightBytes'],w);eq(f['weightBytesPerRequest'],w/b);eq(f['kvBytesPerRequest'],k);eq(f['kvBytesTotal'],b*k)
  eq(f['attentionFlops'],4*b*s*d);eq(f['attentionBytes'],4*b*d*(s+1));eq(f['attentionIntensity'],s/(s+1))
 elif name=='local-dependency':
  eq(find(f,'inputIndices'),list(range(3,8)));eq(find(f,'span'),5)
 # Static diagrams' exact input/output identities are checked below as plans.
 elif name not in ['recount-pairs','chunk-boundary','reduce-factorization','alltoall-identity','kv-budget']:raise AssertionError(name)

def plan(chapter):return json.loads((plans/chapter/'book.json').read_text())
t=plan('tokenization');bars=t['figures'][0]['scene']['props']['items']
words=[list('the')]*3+[list('thin')]*2
def counts(words):return collections.Counter((a,b)for w in words for a,b in zip(w,w[1:]))
before=counts(words);after_words=[['th']+w[2:]for w in words];after=counts(after_words)
eq([v['value']for v in bars],list(before.values())+list(after.values()));eq(sum(map(len,words)),17);eq(sum(map(len,after_words)),12)
over={o['path']:o['value']for o in t['figures'][1]['overrides']}
eq(over['/scene/props/barriers'],[3]);eq(''.join(over['/scene/props/atoms']).encode(),b'the!')
for r in over['/scene/props/rows']:
 for g in r['groups']:eq(g['start']<3<g['end'],False)
c=plan('communication')
x=c['figures'][0]['scene']['calculations'][0]['inputs']['input'];sums=[sum(column)for column in zip(*x)];eq(sums,[6,10,14,18])
eq(c['figures'][0]['scene']['calculations'][0]['inputs']['kind'],'reduce-scatter');eq(c['figures'][0]['scene']['calculations'][1]['inputs']['kind'],'allgather')
transpose=c['figures'][1]['scene']['calculations'][0]['inputs']['input']
received=[list(col)for col in zip(*transpose)]
eq(received[2][1],12);eq(sorted(v for row in received for v in row),sorted(v for row in transpose for v in row))
cache=plan('cache');budgets=[]
for step in cache['figures'][0]['scene']['calculations']:
 a=step['inputs'];budgets.append(Fraction(2*a['layers']*a['batch']*a['tokens']*a['kvHeads']*a['headDim']*a['bytesPerElement'],2**20))
eq(budgets,[256,128,32])
# Actual rendered facts, not merely equal plan inputs.
for row in data['records']:
 if row['id']=='kv-budget':eq([x['value']for x in find(row['facts'],'items')],[256,128,32])
 if row['id']=='recount-pairs':eq(row['facts']['visibleValues'],list(before.values())+list(after.values()))
 if row['id']=='chunk-boundary':eq(row['facts']['barriers'],[3]);eq(row['facts']['offsets'],[0,1,2,3,4])
 if row['id']=='reduce-factorization':
  eq(row['facts']['before']['data'],x);eq(row['facts']['shards']['data'],[[v]for v in sums]);eq(row['facts']['full']['data'],[sums]*4)
 if row['id']=='alltoall-identity':eq(row['facts']['send']['data'],transpose);eq(row['facts']['receive']['data'],received)
output.write_text(json.dumps({'passed':True,'poses':dict(poses),'states':len(data['records']),'checks':checks,'capturedSha256':hashlib.sha256(capture.read_bytes()).hexdigest(),'htmlIdentities':data['identities'],'tolerance':{'relative':1e-11,'absolute':1e-10},'scope':'Independent integer/Fraction/complex stdlib arithmetic against actual finite runtime values and fixed plan inputs. No reuse of canonical numeric kernels; no training, real hardware, artistic or whole-source mathematical certification.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':True,'states':len(data['records']),'checks':checks}))
