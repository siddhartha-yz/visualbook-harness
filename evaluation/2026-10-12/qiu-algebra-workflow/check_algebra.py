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

def complex_inputs(a):
    return [[{'re':literal(S.re(v)),'im':literal(S.im(v))} for v in row] for row in a.tolist()]

def complex_value(a):
    return S.Rational(a['re'])+S.I*S.Rational(a['im'])

def complex_matrix(a):
    return S.Matrix([[complex_value(v) for v in row] for row in a])

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
    for n in range(1,7):
        for _ in range(4):
            u=random_matrix(n,1)+S.I*random_matrix(n,1);v=random_matrix(n,1)+S.I*random_matrix(n,1)
            scalar=S.Rational(RNG.randrange(-3,4),2)+S.I*S.Rational(RNG.randrange(-3,4),3)
            for slot in ['first','second']:
                add('complex-inner-product',{'u':complex_inputs(u.T)[0],'v':complex_inputs(v.T)[0],
                    'linearSlot':slot,'scalar':{'re':literal(S.re(scalar)),'im':literal(S.im(scalar))}},(u,v,scalar,slot))
        a=random_matrix(n,n)+S.I*random_matrix(n,n)
        phases=[S.I**RNG.randrange(4) for _ in range(n)];permutation=S.eye(n);order=list(range(n));RNG.shuffle(order);permutation=permutation[:,order]
        for m in [a,a+a.adjoint(),S.diag(*[a[i,i] for i in range(n)]),permutation*S.diag(*phases)]:
            add('complex-operator',{'input':complex_inputs(m)},m)
    for n in range(1,7):
        for _ in range(8):
            a=random_matrix(n,n);p=[literal(S.Rational(RNG.randrange(-3,4),RNG.randrange(1,4))) for _ in range(RNG.randrange(1,14))];v=random_matrix(n,1)
            add('matrix-polynomial',{'input':inputs(a),'coefficients':p,'selectedPower':12,'vector':[literal(x) for x in v]},(a,p,v))
        nilpotent=S.zeros(n)
        for i in range(n-1):nilpotent[i,i+1]=1
        diagonal=S.diag(*[S.Integer(i%2) for i in range(n)]);basis=invertible(n)
        for a in [random_matrix(n,n),2*S.eye(n),nilpotent,2*S.eye(n)+nilpotent,diagonal,basis*diagonal*basis.inv()]:
            add('minimal-polynomial',{'input':inputs(a)},a)
    for a in [S.Matrix([[0,-1],[1,0]]),S.Matrix([[0,0,-1],[1,0,-1],[0,1,0]]),S.zeros(6),S.diag(0,0,2,2)]:
        add('minimal-polynomial',{'input':inputs(a)},a)
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
        elif op=='complex-inner-product':
            u,v,scalar,slot=ref
            inner=(u.T*v.conjugate())[0] if slot=='first' else (u.conjugate().T*v)[0]
            assert S.expand(complex_value(r['innerExact'])-inner)==0
            assert S.expand(complex_value(r['reverseExact'])-S.conjugate(inner))==0
            assert S.expand(complex_value(r['scaledInnerExact'])-(scalar if slot=='first' else S.conjugate(scalar))*inner)==0
            assert S.expand(complex_value(r['bilinearWithoutConjugationExact'])-(u.T*v)[0])==0
            assert S.Rational(r['normUSquaredExact'])==S.expand((u.adjoint()*u)[0])
            assert S.Rational(r['normVSquaredExact'])==S.expand((v.adjoint()*v)[0])
            assert len(r['termsExact'])==u.rows
            for i,t in enumerate(r['termsExact']):
                term=u[i]*S.conjugate(v[i]) if slot=='first' else S.conjugate(u[i])*v[i]
                assert S.expand(complex_value(t)-term)==0
        elif op=='complex-operator':
            a=ref;adj=a.adjoint();left=(adj*a).applyfunc(S.expand);right=(a*adj).applyfunc(S.expand)
            assert complex_matrix(r['adjoint']['exact'])==adj and complex_matrix(r['transpose']['exact'])==a.T
            assert complex_matrix(r['adjointProduct']['exact'])==left and complex_matrix(r['reverseAdjointProduct']['exact'])==right
            assert complex_matrix(r['transposeProduct']['exact'])==(a.T*a).applyfunc(S.expand)
            assert r['unitary']==(left==S.eye(a.rows) and right==S.eye(a.rows))
            assert r['hermitian']==(a==adj) and r['normal']==(left==right)
        elif op=='matrix-polynomial':
            a,p,v=ref;coefficients=[S.Rational(x) for x in p]
            while len(coefficients)>1 and coefficients[-1]==0:coefficients.pop()
            total=S.zeros(a.rows);assert r['degree']==(None if all(x==0 for x in coefficients) else len(coefficients)-1)
            for k,c in enumerate(coefficients):
                power=a**k;term=c*power;total+=term
                assert mat(r['powersExact'][k])==power and mat(r['termsExact'][k])==term and mat(r['partialsExact'][k])==total
            assert mat(r['valueExact'])==total and mat(r['currentExact'])==total and r['isZero']==(total==S.zeros(a.rows))
            assert S.Matrix([S.Rational(x) for x in r['vectorValueExact']])==total*v
        elif op=='minimal-polynomial':
            a=ref;degree=r['degree'];p=polynomial(r['coefficientsExact']);characteristic=polynomial(r['characteristicCoefficientsExact'])
            assert 1<=degree<=a.rows and p.degree()==degree and p.LC()==1
            assert characteristic==S.Poly(a.charpoly(p.gen).as_expr(),p.gen,domain=S.QQ)
            evaluated=sum((S.Rational(c)*(a**k) for k,c in enumerate(r['coefficientsExact'])),S.zeros(a.rows))
            assert evaluated==S.zeros(a.rows)==mat(r['valueExact'])==mat(r['characteristicValueExact'])
            columns=[S.Matrix(list(a**k)) for k in range(degree+1)]
            assert S.Matrix.hstack(*columns[:-1]).rank()==degree
            assert r['ranks']==[S.Matrix.hstack(*columns[:k+1]).rank() for k in range(degree+1)]
            quotient,remainder=S.div(characteristic,p);assert remainder.is_zero and polynomial(r['quotientExact'])==quotient
        counts[op]=counts.get(op,0)+1
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'inputs.json').write_text(json.dumps(requests,indent=2)+'\n');(args.output/'outputs.json').write_text(json.dumps(results,indent=2)+'\n')
    report={'seed':20261012,'sympyVersion':S.__version__,'cases':len(results),'counts':counts,'passed':True,'elapsedSeconds':round(time.monotonic()-started,3),'sourceSha256':hashlib.sha256((ROOT/'packages/visualbook/algebra.cjs').read_bytes()).hexdigest(),'scope':'Independent exact numeric comparison, not source accuracy, rendering or artistic review'}
    (args.output/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':main()
