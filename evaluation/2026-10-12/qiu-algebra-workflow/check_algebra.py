"""Independent exact SymPy checks; renderer/artistic quality are outside scope."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import subprocess
import time
import sympy as S

ROOT = Path(__file__).resolve().parents[3]
RNG = random.Random(20261012)

def literal(x):
    return str(S.Rational(x))

def inputs(a):
    return [[literal(v) for v in row] for row in a.tolist()]

def mat(a):
    return S.Matrix([[S.Rational(v) for v in row] for row in a])

def polynomial(a):
    x = S.Symbol('x')
    return S.Poly(sum(S.Rational(v)*x**i for i,v in enumerate(a)), x, domain=S.QQ)

def random_matrix(n,m):
    return S.Matrix(n,m,lambda i,j:S.Rational(RNG.randrange(-5,6),RNG.randrange(1,4)))

def invertible(n):
    while True:
        a=random_matrix(n,n)
        if a.det(): return a

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);args=p.parse_args()
    if not args.output.resolve().is_relative_to((ROOT/'work').resolve()): p.error('Keep actual evaluation records in ignored work/')
    requests=[]; references=[]
    def add(op,data,ref): requests.append({'operation':op,'inputs':data});references.append((op,ref))
    for n in range(1,7):
        for m in range(1,7):
            a=random_matrix(n,m)
            if n>1 and (n+m)%2==0: a[n-1,:]=a[0,:]*2
            b=random_matrix(n,2);aug=a.row_join(b)
            add('exact-row-reduction',{'input':inputs(aug),'coefficientColumns':m},(a,b,aug))
    for n in range(1,7):
        for _ in range(4):
            b,c=invertible(n),invertible(n);v=random_matrix(n,1);op=random_matrix(n,n)
            add('change-basis',{'sourceBasis':inputs(b),'targetBasis':inputs(c),'vector':[literal(x) for x in v],'operator':inputs(op)},(b,c,v,op))
    for _ in range(48):
        a=[literal(S.Rational(RNG.randrange(-5,6),RNG.randrange(1,4))) for i in range(RNG.randrange(1,13))]
        b=[literal(S.Rational(RNG.randrange(-5,6),RNG.randrange(1,4))) for i in range(RNG.randrange(1,8))]
        if polynomial(b).is_zero: b=['1']
        add('polynomial-divide',{'dividend':a,'divisor':b},(polynomial(a),polynomial(b)))
        if not (polynomial(a).is_zero and polynomial(b).is_zero): add('polynomial-gcd',{'a':a,'b':b},(polynomial(a),polynomial(b)))
    for modulus in range(2,13):
        for operation in ['add','multiply']: add('residue-table',{'modulus':modulus,'operation':operation},(modulus,operation))
    for blocks in [[1],[2],[3],[4],[5],[6],[2,1],[3,1],[2,2],[3,2],[3,3],[4,2],[2,2,1],[1,1,1],[2,1,1,1]]:
        j=S.diag(*[S.zeros(k) for k in blocks]);offset=0
        for k in blocks:
            for i in range(k-1): j[offset+i,offset+i+1]=1
            offset+=k
        b=invertible(sum(blocks));a=b*j*b.inv()
        add('nilpotent-profile',{'input':inputs(a)},(a,blocks))
    for n in range(1,7):
        for symmetric in [False,True]:
            a=random_matrix(n,n)
            if symmetric: a=a+a.T
            b=invertible(n);v=random_matrix(n,1)
            add('bilinear-congruence',{'input':inputs(a),'basis':inputs(b),'point':[literal(x) for x in v]},(a,b,v))
    for n in range(1,7):
        for _ in range(4):
            a=random_matrix(n,n)
            if n>1 and n%2==0:a[n-1,:]=a[0,:]*2
            for axis in ['row','column']:
                add('determinant-expansion',{'input':inputs(a),'axis':axis,'index':RNG.randrange(n)},a)
            b=invertible(n);v=random_matrix(n,1)
            add('dual-basis',{'basis':inputs(b),'vector':[literal(x) for x in v]},(b,v))
        for positive in range(n+1):
            for negative in range(n-positive+1):
                diag=S.diag(*([S.Rational(2)]*positive+[-S.Rational(3)]*negative+[S.Rational(0)]*(n-positive-negative)))
                b=invertible(n);a=b.T*diag*b
                add('symmetric-inertia',{'input':inputs(a)},(a,positive,negative,n-positive-negative))
    add('symmetric-inertia',{'input':[['0','1'],['1','0']]},(S.Matrix([[0,1],[1,0]]),1,1,0))
    for n in range(1,7):
        for count in range(1,7):
            columns=random_matrix(n,count)
            if count>1 and (n+count)%2==0:columns[:,count-1]=columns[:,0]*2
            for general_metric in [False,True]:
                b=invertible(n);g=b.T*b if general_metric else S.eye(n)
                add('orthogonalize',{'vectors':inputs(columns.T),'metric':inputs(g)},(columns,g))
    started=time.monotonic()
    javascript="const C=require('./packages/visualbook/calculations.cjs'); let s=''; process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(x=>C.compute(x.operation,x.inputs).result))));"
    results=json.loads(subprocess.run(['node','-e',javascript],cwd=ROOT,input=json.dumps(requests),text=True,capture_output=True,check=True).stdout)
    counts={};assert len(results)==len(references)
    for index,(r,(op,ref)) in enumerate(zip(results,references)):
        if op=='exact-row-reduction':
            a,b,aug=ref;rr,piv=a.rref();full=mat(r['finalExact']);e=mat(r['transformExact'])
            assert full==e*aug and full[:,:a.cols]==rr and list(piv)==r['pivotColumns']
            assert r['rank']==a.rank() and r['nullity']==a.cols-a.rank()
            for step in r['steps']: assert mat(step['exact'])==mat(step['transformExact'])*aug
            assert r['imageBasisExact']==[[literal(a[i,j]) for i in range(a.rows)] for j in piv]
            for v in r['kernelBasisExact']: assert a*S.Matrix([S.Rational(x) for x in v])==S.zeros(a.rows,1)
            for k,s in enumerate(r['solutions']):
                consistent=a.rank()==a.row_join(b[:,k]).rank();assert s['consistent']==consistent
                if consistent: assert a*S.Matrix([S.Rational(x) for x in s['particularExact']])==b[:,k]
            if a.rows==a.cols: assert S.Rational(r['determinantExact'])==a.det()
        elif op=='change-basis':
            b,c,v,a=ref; assert S.Matrix([S.Rational(x) for x in r['sourceCoordinatesExact']])==b.inv()*v
            assert S.Matrix([S.Rational(x) for x in r['targetCoordinatesExact']])==c.inv()*v
            t=mat(r['transitionExact']);assert t==c.inv()*b
            old,new=mat(r['operator']['sourceExact']),mat(r['operator']['targetExact'])
            assert old==b.inv()*a*b and new==c.inv()*a*c and new==t*old*t.inv()
        elif op=='polynomial-divide':
            a,b=ref;q,rem=polynomial(r['quotientExact']),polynomial(r['remainderExact'])
            assert a==q*b+rem and (rem.is_zero or rem.degree()<b.degree()) and (q,rem)==S.div(a,b)
        elif op=='polynomial-gcd':
            a,b=ref;g=polynomial(r['gcdExact']);u,v=polynomial(r['bezoutAExact']),polynomial(r['bezoutBExact'])
            assert g==S.gcd(a,b).monic() and u*a+v*b==g
        elif op=='residue-table':
            n,operation=ref;assert r['isField']==bool(S.isprime(n))
            assert r['units']==[v for v in range(n) if S.gcd(v,n)==1]
            assert r['zeroDivisors']==[v for v in range(1,n) if S.gcd(v,n)>1]
            assert r['data']==[[((a+b) if operation=='add' else (a*b))%n for b in range(n)] for a in range(n)]
        elif op=='nilpotent-profile':
            a,blocks=ref;assert r['blockSizes']==sorted(blocks,reverse=True)
            assert r['ranks']==[(a**k).rank() for k in range(a.rows+1)] and r['nilpotencyIndex']==max(blocks)
        elif op=='bilinear-congruence':
            a,b,v=ref;c=b.T*a*b;assert mat(r['transformedExact'])==c and r['rank']==a.rank()==r['transformedRank']
            assert S.Rational(r['values']['oldValueExact'])==S.Rational(r['values']['newValueExact'])==(v.T*c*v)[0]
        elif op=='determinant-expansion':
            a=ref;assert S.Rational(r['determinantExact'])==a.det()
            for term in r['terms']:
                i,j=term['row'],term['column'];assert S.Rational(term['cofactorExact'])==a.cofactor(i,j)
                assert S.Rational(term['valueExact'])==a[i,j]*a.cofactor(i,j)
        elif op=='dual-basis':
            b,v=ref;dual=mat(r['dualRowsExact']);assert dual==b.inv() and mat(r['pairingExact'])==S.eye(b.rows)
            assert S.Matrix([S.Rational(x) for x in r['evaluationsExact']])==b.inv()*v
        elif op=='symmetric-inertia':
            a,positive,negative,zero=ref;b=mat(r['basisExact']);d=mat(r['diagonalMatrixExact'])
            assert b.det()!=0 and b.T*a*b==d and d.is_diagonal()
            assert (r['positive'],r['negative'],r['zero'])==(positive,negative,zero)
            assert r['rank']==a.rank() and r['positiveDefinite']==(positive==a.rows)
            for step in r['steps']:
                c=mat(step['basisExact']);assert c.det()!=0 and c.T*a*c==mat(step['matrixExact'])
        elif op=='orthogonalize':
            columns,g=ref;rank=columns.rank();assert r['rank']==rank
            basis=S.Matrix(columns.rows,rank,lambda i,j:S.Rational(r['orthogonalMatrixExact'][i][j]))
            pairing=basis.T*g*basis
            assert basis.rank()==rank and basis.row_join(columns).rank()==rank and pairing.is_diagonal()
            assert all(pairing[i,i]>0 for i in range(rank))
            previous=[]
            for step in r['steps']:
                v=columns[:,step['index']];remaining=S.Matrix([S.Rational(x) for x in step['remainderExact']])
                total=S.zeros(columns.rows,1)
                for j,u in enumerate(previous):
                    coefficient=(u.T*g*v)[0]/(u.T*g*u)[0]
                    projected=S.Matrix([S.Rational(x) for x in step['projectionsExact'][j]])
                    assert S.Rational(step['coefficientsExact'][j])==coefficient and projected==u*coefficient
                    total+=projected;assert (u.T*g*remaining)[0]==0
                assert total+remaining==v and S.Rational(step['normSquaredExact'])==(remaining.T*g*remaining)[0]
                assert step['independent']==(remaining!=S.zeros(columns.rows,1))
                if step['independent']:previous.append(remaining)
            assert list(basis.T.tolist())==[list(v) for v in previous]
        counts[op]=counts.get(op,0)+1
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'inputs.json').write_text(json.dumps(requests,indent=2)+'\n');(args.output/'outputs.json').write_text(json.dumps(results,indent=2)+'\n')
    report={'seed':20261012,'sympyVersion':S.__version__,'cases':len(results),'counts':counts,'passed':True,'elapsedSeconds':round(time.monotonic()-started,3),'sourceSha256':hashlib.sha256((ROOT/'packages/visualbook/algebra.cjs').read_bytes()).hexdigest(),'scope':'Independent exact numeric comparison, not source accuracy, rendering or artistic review'}
    (args.output/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':main()
