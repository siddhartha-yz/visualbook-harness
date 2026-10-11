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
