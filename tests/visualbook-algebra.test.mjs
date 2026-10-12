import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const A=createRequire(import.meta.url)('../packages/visualbook/algebra.cjs');
const C=createRequire(import.meta.url)('../packages/visualbook/calculations.cjs');
test('Coefficient rank and each RHS consistency are distinct',()=>{
 const r=A.rowReduction({input:[[1,2,3,3],[2,4,6,7]],coefficientColumns:2});
 assert.equal(r.rank,1);assert.equal(r.nullity,1);assert.deepEqual(r.kernelBasisExact,[['-2','1']]);
 assert.deepEqual(r.solutions.map(x=>x.consistent),[true,false]);
 assert.equal(r.determinantExact,'0');
 assert.deepEqual(r.solutions[0].particularExact,['3','0']);
 assert.equal(r.solutions[1].particularExact,null);
});
test('Decimal fractions preserve exact identity without a floating epsilon',()=>{
 const r=A.rowReduction({input:[['0.1','1/3','1'],['0.2','2/3','2']],coefficientColumns:2});
 assert.equal(r.rank,1);assert.deepEqual(r.finalExact,[['1','10/3','10'],['0','0','0']]);
 assert.equal(r.determinantExact,'0');
});
test('Changing basis keeps vector fixed and transforms operator by similarity',()=>{
 const r=A.changeBasis({sourceBasis:[[1,0],[0,1]],targetBasis:[[1,1],[0,1]],vector:[3,2],operator:[[1,2],[0,3]]});
 assert.deepEqual(r.vector,[3,2]);assert.deepEqual(r.sourceCoordinatesExact,['3','2']);assert.deepEqual(r.targetCoordinatesExact,['1','2']);
 assert.deepEqual(r.transitionExact,[['1','-1'],['0','1']]);assert.deepEqual(r.operator.targetExact,[['1','0'],['0','3']]);
});
test('Polynomial division and Bezout use ascending exact coefficients',()=>{
 const d=A.polynomialDivide({dividend:[1,2,0,1],divisor:[1,0,1]});
 assert.deepEqual(d.quotientExact,['0','1']);assert.deepEqual(d.remainderExact,['1','1']);
 const g=A.polynomialGcd({a:[-1,0,1],b:[2,-3,1]});assert.deepEqual(g.gcdExact,['-1','1']);
 assert.deepEqual(A.polynomialGcd({a:[0],b:[-2,2]}).gcdExact,['-1','1']);
});
test('Nilpotent zero matrix has one size-one block per dimension',()=>{
 const r=A.jordanProfile({input:[[0,0],[0,0]]});assert.deepEqual(r.blockSizes,[1,1]);assert.deepEqual(r.ranks,[2,0,0]);assert.equal(r.nilpotencyIndex,1);
});
test('Selected-root kernels retain the rank of other eigenvalue components',()=>{
 const input=[[2,1,2,0],[0,2,1,0],[0,0,2,0],[0,0,0,5]];
 const a=C.compute('generalized-kernel-profile',{input,eigenvalue:2}).result;
 assert.deepEqual(a.ranks,[4,3,2,1,1,1]);assert.deepEqual(a.nullities,[0,1,2,3,3,3]);
 assert.deepEqual(a.blockSizes,[3]);assert.equal(a.rootSpaceDimension,3);assert.equal(a.complementDimension,1);
 assert.equal(a.stabilizationPower,3);assert.equal(a.wholeShiftNilpotent,false);
 const b=A.generalizedKernelProfile({input,eigenvalue:5});assert.deepEqual(b.blockSizes,[1]);assert.equal(b.eigenspaceDimension,1);
 assert.throws(()=>A.jordanProfile({input:input.map((row,i)=>row.map((x,j)=>i===j?x-2:x))}),/not nilpotent/);
});
test('Generalized kernel profiles handle absent roots, rational scalars and unsplit other factors',()=>{
 const empty=A.generalizedKernelProfile({input:[[0,-1],[1,0]],eigenvalue:0});
 assert.equal(empty.hasEigenvalue,false);assert.deepEqual(empty.blockSizes,[]);assert.equal(empty.stabilizationPower,0);
 const r=A.generalizedKernelProfile({input:[['1/2',1,0],[0,'1/2',0],[0,0,'3/2']],eigenvalue:'1/2'});
 assert.equal(r.eigenvalueExact,'1/2');assert.deepEqual(r.blockSizes,[2]);assert.equal(r.wholeShiftNilpotent,false);
 const mixed=A.generalizedKernelProfile({input:[[2,0,0],[0,0,-1],[0,1,0]],eigenvalue:2});
 assert.deepEqual(mixed.blockSizes,[1]);assert.equal(mixed.complementDimension,2);
 assert.throws(()=>C.compute('generalized-kernel-profile',{input:[[1]],eigenvalue:'1/0'}),/denominator/);
 assert.throws(()=>C.compute('generalized-kernel-profile',{input:[[1,2]],eigenvalue:1}),/Square/);
 assert.throws(()=>C.compute('generalized-kernel-profile',{input:[[1]]}),/eigenvalue/);
});
test('Congruence preserves the actual quadratic value and the field half-factor',()=>{
 const r=A.bilinearChange({input:[[2,1],[1,3]],basis:[[1,1],[0,1]],point:[2,3]});
 assert.deepEqual(r.transformedExact,[['2','3'],['3','7']]);assert.equal(r.values.oldValueExact,'107');assert.equal(r.values.newValueExact,'107');
 assert.deepEqual(r.field.matrix,[[4,2],[2,6]]);
});
test('Modular table excludes zero itself from zero-divisor witnesses',()=>{
 assert.deepEqual(A.modularTable({modulus:6}).zeroDivisors,[2,3,4]);assert.deepEqual(A.modularTable({modulus:5}).zeroDivisors,[]);assert.equal(A.modularTable({modulus:2}).isField,true);
});
test('Reject wrong dimensions, singular bases, invalid fields and false nilpotence',()=>{
 for(const run of [()=>A.rowReduction({input:[[1],[1,2]]}),()=>A.rowReduction({input:[['1/0']]}),()=>A.changeBasis({sourceBasis:[[1,1],[1,1]],targetBasis:[[1,0],[0,1]],vector:[1,2]}),()=>A.polynomialDivide({dividend:[1],divisor:[0]}),()=>A.polynomialGcd({a:[0],b:[0]}),()=>A.jordanProfile({input:[[1,0],[0,0]]}),()=>A.modularTable({modulus:1}),()=>C.compute('change-basis',{sourceBasis:[[1]],targetBasis:[[1]],vector:[1],transpose:true})])assert.throws(run);
});
test('Cofactor expansion includes the scalar 0×0-minor convention',()=>{
 assert.equal(A.determinantExpansion({input:[[7]]}).determinantExact,'7');
 const r=A.determinantExpansion({input:[[1,2,3],[0,4,5],[1,0,6]],axis:'column',index:1});
 assert.equal(r.determinantExact,'22');assert.deepEqual(r.cofactorsExact,['5','3','-5']);
});
test('Dual basis is the inverse rows, not the inverse columns',()=>{
 const r=A.dualBasis({basis:[[1,1],[0,1]],vector:[3,2]});
 assert.deepEqual(r.dualRowsExact,[['1','-1'],['0','1']]);assert.deepEqual(r.pairingExact,[['1','0'],['0','1']]);assert.deepEqual(r.evaluationsExact,['1','2']);
});
test('Zero diagonal does not imply a zero quadratic form',()=>{
 const r=A.symmetricInertia({input:[[0,1],[1,0]]});
 assert.equal(r.positive,1);assert.equal(r.negative,1);assert.equal(r.zero,0);
 assert.deepEqual(r.diagonalExact,['2','-1/2']);assert.equal(r.positiveDefinite,false);
 assert.throws(()=>A.symmetricInertia({input:[[1,2],[0,3]]}),/symmetric/);
});
test('Coefficient slots remain visible but zero/trailing-zero degrees are honest',()=>{
 assert.deepEqual(A.coefficientLiterals(['0/2','1/2','0']),{values:['0','1/2','0'],degree:1});
 assert.deepEqual(A.coefficientLiterals([0,0]),{values:['0','0'],degree:null});
});
test('Orthogonalization skips zero and dependent vectors before any normalization',()=>{
 const r=A.orthogonalize({vectors:[[0,0],[1,1],[2,2],[3,1]]});
 assert.equal(r.rank,2);assert.deepEqual(r.independentIndices,[1,3]);
 assert.deepEqual(r.orthogonalBasisExact,[['1','1'],['1','-1']]);
 assert.deepEqual(r.steps.map(x=>x.independent),[false,true,false,true]);
 assert.deepEqual(A.orthogonalize({vectors:[[0,0]]}).unitBasis,[]);
});
test('General inner-product orthogonality uses its metric, not screen angles',()=>{
 const r=A.orthogonalize({vectors:[[1,0],[1,1]],metric:[[2,1],[1,2]]});
 assert.deepEqual(r.orthogonalBasisExact,[['1','0'],['-1/2','1']]);
 assert.deepEqual(r.pairingsExact,[['2','0'],['0','3/2']]);
 assert.throws(()=>A.orthogonalize({vectors:[[1,0]],metric:[[1,0],[0,-1]]}),/positive definite/);
 assert.throws(()=>A.orthogonalize({vectors:[[1,0]],metric:[[1,1],[0,1]]}),/symmetric/);
});
test('Complex inner products explicitly choose the linear slot and conjugate scalars',()=>{
 const data={u:[{re:1,im:1},2],v:[{re:2,im:-1},{re:0,im:1}],scalar:{re:0,im:1}};
 const a=A.complexInnerProduct({...data,linearSlot:'first'}),b=A.complexInnerProduct({...data,linearSlot:'second'});
 assert.deepEqual(a.innerExact,{re:'1',im:'1'});assert.deepEqual(b.innerExact,{re:'1',im:'-1'});
 assert.deepEqual(a.scaledInnerExact,{re:'-1',im:'1'});assert.deepEqual(b.scaledInnerExact,{re:'-1',im:'-1'});
 assert.throws(()=>A.complexInnerProduct(data),/linearSlot/);
 assert.throws(()=>A.complexInnerProduct({...data,linearSlot:'first',u:[{re:1,im:1,guess:true}]}),/exactly/);
});
test('Bilinear complex product fails positivity while conjugate product has positive norm',()=>{
 const r=A.complexInnerProduct({u:[{re:0,im:1}],v:[{re:0,im:1}],linearSlot:'first'});
 assert.deepEqual(r.innerExact,{re:'1',im:'0'});assert.deepEqual(r.bilinearWithoutConjugationExact,{re:'-1',im:'0'});
 assert.equal(r.normUSquaredExact,'1');
 assert.equal(A.complexInnerProduct({u:[0],v:[0],linearSlot:'second'}).normUSquaredExact,'0');
});
test('Conjugate transpose differs from transpose for unitary complex phases',()=>{
 const r=A.complexOperator({input:[[{re:0,im:1},0],[0,1]]});
 assert.equal(r.unitary,true);assert.equal(r.normal,true);assert.equal(r.hermitian,false);
 assert.deepEqual(r.adjointProduct.real,[[1,0],[0,1]]);assert.deepEqual(r.transposeProduct.real,[[-1,0],[0,1]]);
 assert.deepEqual(r.adjoint.imaginary,[[-1,0],[0,0]]);
 const h=A.complexOperator({input:[[1,{re:0,im:1}],[{re:0,im:-1},2]]});assert.equal(h.hermitian,true);assert.equal(h.unitary,false);
  assert.equal(A.complexOperator({input:[[0,1],[0,0]]}).normal,false);
});
test('Matrix polynomial constants multiply the identity and vector annihilation is separate',()=>{
 const r=A.matrixPolynomial({input:[[0,0],[0,1]],coefficients:[0,1],vector:[1,0]});
 assert.equal(r.isZero,false);assert.deepEqual(r.vectorValueExact,['0','0']);
 assert.deepEqual(A.matrixPolynomial({input:[[2,1],[0,2]],coefficients:[3]}).valueExact,[['3','0'],['0','3']]);
 const z=A.matrixPolynomial({input:[[2,1],[0,2]],coefficients:[0,0],selectedPower:12});
 assert.equal(z.degree,null);assert.equal(z.selectionClamped,true);assert.equal(z.isZero,true);
 assert.throws(()=>A.matrixPolynomial({input:[[1,2]],coefficients:[1]}),/Square/);
});
test('Minimal polynomial distinguishes a repeated scalar from a Jordan block',()=>{
 const scalar=A.minimalPolynomial({input:[[2,0],[0,2]]});
 assert.deepEqual(scalar.coefficientsExact,['-2','1']);assert.deepEqual(scalar.characteristicCoefficientsExact,['4','-4','1']);
 const jordan=A.minimalPolynomial({input:[[2,1],[0,2]]});
 assert.deepEqual(jordan.coefficientsExact,['4','-4','1']);assert.deepEqual(jordan.ranks,[1,2,2]);
 assert.deepEqual(jordan.valueExact,[['0','0'],['0','0']]);
 const rotation=A.minimalPolynomial({input:[[0,-1],[1,0]]});
 assert.deepEqual(rotation.coefficientsExact,['1','0','1']);
 assert.deepEqual(A.minimalPolynomial({input:[[0]]}).coefficientsExact,['0','1']);
});

test('Exact matrix products do not create a false decimal zero-relation',()=>{
 const r=C.compute('exact-matrix-product',{a:[[.1,.3],[.2,.6]],b:[[1,-3],[0,1]]}).result;
 assert.deepEqual(r.outputExact,[['1/10','0'],['1/5','0']]);assert.deepEqual(r.output,[[.1,0],[.2,0]]);
 const q=C.compute('exact-matrix-product',{a:[['1/3','2/3']],b:[['3'],['-3/2']]}).result;
 assert.deepEqual(q.outputExact,[['0']]);
 assert.throws(()=>C.compute('exact-matrix-product',{a:[[1,2]],b:[[1]]}),/shape/);
 assert.throws(()=>A.matrixProduct({a:[['1/0']],b:[[1]]}),/denominator/);
});
