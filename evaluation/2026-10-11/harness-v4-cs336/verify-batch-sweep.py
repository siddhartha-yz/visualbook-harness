"""Independent exact traffic arithmetic for captured native batch-sweep controls."""
import hashlib,json,math,sys
from fractions import Fraction
from pathlib import Path
source=Path(sys.argv[1]);target=Path(sys.argv[2]);data=json.loads(source.read_text());checks=0
def eq(a,b):
 global checks
 checks+=1
 if a is None or b is None:assert a is b,(a,b)
 elif isinstance(b,(int,Fraction,float)):assert math.isclose(a,float(b),rel_tol=1e-11,abs_tol=1e-10),(a,b)
 else:assert a==b,(a,b)
for row in data['states']:
 p={'inputDim':4096,'outputDim':11008,'bytesPerElement':2,'computeTFLOPS':989,'memoryGBPS':3350}|row['inputs']
 d,f,e=p['inputDim'],p['outputDim'],p['bytesPerElement'];batch=row['batch'];r=row['budget']
 peak=Fraction(str(p['computeTFLOPS']));bandwidth=Fraction(str(p['memoryGBPS']));c=peak*1000/bandwidth
 def traffic(b):return 2*b*d*f,e*(b*d+d*f+b*f)
 flops,bytes=traffic(batch);compute=Fraction(flops,1)/(peak*10**9);transfer=Fraction(bytes,1)/(bandwidth*10**6)
 for k,v in {'flops':flops,'bytes':bytes,'aBytes':e*batch*d,'bBytes':e*d*f,'cBytes':e*batch*f,
             'intensity':Fraction(flops,bytes),'computeMs':compute,'transferMs':transfer,'crossover':c}.items():eq(r['selected'][k],v)
 eq(r['selected']['bound'],'compute'if compute>=transfer else'memory')
 denominator=2*d*f-c*e*(d+f);critical=c*e*d*f/denominator if denominator>0 else None
 eq(r['criticalBatch'],critical);eq(r['firstComputeBoundBatch'],math.ceil(critical)if critical is not None else None)
 eq(r['intensityCeiling'],Fraction(2*d*f,e*(d+f)))
 eq(r['timesUs'][0],compute*1000);eq(r['timesUs'][1],transfer*1000)
 for b,v in r['intensityCurve']:
  q,z=traffic(b);eq(v,Fraction(q,z))
 for b,v in r['weightOnlyCurve']:eq(v,Fraction(2*b,e))
 for b,v in r['crossoverLine']:eq(v,c)
 eq(r['selectedPoint'][0][0],batch);eq(r['selectedPoint'][0][1],Fraction(flops,bytes))
target.write_text(json.dumps({'passed':True,'states':len(data['states']),'checks':checks,'capturedSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'scope':'Independent Fraction/stdlib arithmetic for eleven maintainer data variants captured from actual native rendering. Not model generation, aesthetic review, whole-book certification or GPU measurement.'},indent=2)+'\n')
print(json.dumps({'passed':True,'states':len(data['states']),'checks':checks}))
