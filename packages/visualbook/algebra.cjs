/* Exact bounded rational algebra. Geometry still draws numeric approximations. */
(function (global) {
  const abs = n => n < 0n ? -n : n;
  function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; }
  function q(n, d = 1n) {
    if (!d) throw Error("Zero rational denominator");
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d); n /= g; d /= g;
    if (abs(n).toString().length > 128 || d.toString().length > 128) throw Error("Exact algebra exceeds bounded rational size");
    return { n, d };
  }
  function rational(value) {
    if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 1e9)) throw Error("Bounded finite rational input required");
    if (typeof value !== "number" && typeof value !== "string") throw Error("Use numbers or rational strings");
    const text = String(value);
    if (/^-?\d{1,32}\/\d{1,32}$/.test(text)) { const [a, b] = text.split("/"); return q(BigInt(a), BigInt(b)); }
    const m = /^(-?)(\d{1,32})(?:\.(\d{1,32}))?(?:e([+-]?\d{1,2}))?$/i.exec(text);
    if (!m) throw Error("Invalid rational literal");
    const exponent = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
    if (Math.abs(exponent) > 40) throw Error("Rational exponent is too large");
    let n = BigInt(m[2] + (m[3] ?? "")); if (m[1]) n = -n;
    return exponent < 0 ? q(n, 10n ** BigInt(-exponent)) : q(n * 10n ** BigInt(exponent));
  }
  const add = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
  const neg = a => q(-a.n, a.d);
  const sub = (a, b) => add(a, neg(b));
  const mul = (a, b) => q(a.n * b.n, a.d * b.d);
  const div = (a, b) => q(a.n * b.d, a.d * b.n);
  const Z = () => q(0n), O = () => q(1n);
  const literal = a => a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
  const number = a => { const v = Number(a.n) / Number(a.d); if (!Number.isFinite(v)) throw Error("Numeric drawing overflow"); return v; };
  const numeric = rows => rows.map(row => row.map(number));
  const exact = rows => rows.map(row => row.map(literal));
  const copy = rows => rows.map(row => row.slice());
  const identity = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? O() : Z()));
  function matrix(input, maxColumns = 6) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 6 || !Array.isArray(input[0]) || input[0].length < 1 || input[0].length > maxColumns || input.some(row => !Array.isArray(row) || row.length !== input[0].length)) throw Error("Use a bounded rectangular matrix");
    return input.map(row => row.map(rational));
  }
  function product(a, b) {
    if (a[0].length !== b.length) throw Error("Matrix product shape mismatch");
    return a.map(row => b[0].map((_, j) => row.reduce((sum, v, k) => add(sum, mul(v, b[k][j])), Z())));
  }
  const transpose = a => a[0].map((_, j) => a.map(row => row[j]));
  function reduce(a, columns = a[0].length) {
    const current = copy(a), transform = identity(a.length), steps = [], pivots = [];
    let determinant = O(), row = 0;
    const record = operation => steps.push({ operation, values: numeric(current), exact: exact(current), transform: numeric(transform), transformExact: exact(transform) });
    record({ kind: "initial" });
    for (let column = 0; column < columns && row < a.length; column++) {
      const found = current.findIndex((line, i) => i >= row && line[column].n !== 0n);
      if (found < 0) continue;
      if (found !== row) {
        [current[row], current[found]] = [current[found], current[row]];
        [transform[row], transform[found]] = [transform[found], transform[row]];
        determinant = neg(determinant); record({ kind: "swap", row, source: found });
      }
      const pivot = current[row][column]; determinant = mul(determinant, pivot);
      if (pivot.n !== pivot.d) {
        const factor = div(O(), pivot);
        current[row] = current[row].map(v => mul(v, factor));
        transform[row] = transform[row].map(v => mul(v, factor));
        record({ kind: "scale", row, factor: number(factor), factorExact: literal(factor) });
      }
      for (let i = 0; i < a.length; i++) {
        if (i === row || current[i][column].n === 0n) continue;
        const factor = neg(current[i][column]);
        current[i] = current[i].map((v, j) => add(v, mul(factor, current[row][j])));
        transform[i] = transform[i].map((v, j) => add(v, mul(factor, transform[row][j])));
        record({ kind: "add", row: i, source: row, factor: number(factor), factorExact: literal(factor) });
      }
      pivots.push(column); row++;
    }
    return { current, transform, steps, pivots, determinant: a.length === columns ? (row === columns ? determinant : Z()) : null };
  }
  function rowReduction({ input, coefficientColumns, selectedStep } = {}) {
    const a = matrix(input, 12), n = coefficientColumns ?? a[0].length;
    if (!Number.isInteger(n) || n < 1 || n > 6 || n > a[0].length) throw Error("Coefficient columns must be 1..6 within matrix");
    const r = reduce(a, n), free = Array.from({ length: n }, (_, j) => j).filter(j => !r.pivots.includes(j));
    const kernel = free.map(column => { const v = Array.from({ length: n }, Z); v[column] = O(); r.pivots.forEach((pivot, i) => { v[pivot] = neg(r.current[i][column]); }); return v; });
    const solutions = Array.from({ length: a[0].length - n }, (_, k) => {
      const rhs = n + k, consistent = !r.current.some(line => line.slice(0, n).every(v => v.n === 0n) && line[rhs].n !== 0n);
      const p = Array.from({ length: n }, Z); if (consistent) r.pivots.forEach((pivot, i) => { p[pivot] = r.current[i][rhs]; });
      return { rhsColumn: rhs, consistent, particular: consistent ? p.map(number) : null, particularExact: consistent ? p.map(literal) : null };
    });
    const requested = selectedStep ?? r.steps.length - 1;
    if (!Number.isInteger(requested) || requested < 0 || requested > 64) throw Error("Selected row step must be integer 0..64");
    const index = Math.min(requested, r.steps.length - 1);
    return { input: numeric(a), inputExact: exact(a), coefficientColumns: n, steps: r.steps, lastStep: r.steps.length - 1,
      selectedStep: index, selectionClamped: index !== requested, current: r.steps[index].values, currentExact: r.steps[index].exact,
      operation: r.steps[index].operation, final: numeric(r.current), finalExact: exact(r.current), transform: numeric(r.transform), transformExact: exact(r.transform),
      pivotColumns: r.pivots, freeColumns: free, rank: r.pivots.length, nullity: n - r.pivots.length,
      kernelBasis: numeric(kernel), kernelBasisExact: exact(kernel),
      imageBasis: r.pivots.map(column => a.map(row => number(row[column]))),
      imageBasisExact: r.pivots.map(column => a.map(row => literal(row[column]))), solutions,
      determinant: r.determinant ? number(r.determinant) : null, determinantExact: r.determinant ? literal(r.determinant) : null,
      convention: "Exact rational Gauss-Jordan; decimal inputs are interpreted as written rationals. Coefficient rank excludes RHS; displayed numeric values approximate exact strings. Finite examples do not prove statements over arbitrary fields." };
  }
  function inverse(a) {
    if (a.length !== a[0].length) throw Error("Square basis matrix required");
    const r = reduce(a);
    if (r.pivots.length !== a.length) throw Error("Basis/change matrix must be invertible");
    return r.transform;
  }
  function changeBasis({ sourceBasis, targetBasis, vector, operator } = {}) {
    const b = matrix(sourceBasis), c = matrix(targetBasis), n = b.length;
    if (b[0].length !== n || c.length !== n || c[0].length !== n || !Array.isArray(vector) || vector.length !== n) throw Error("Basis/vector dimensions differ");
    const bi = inverse(b), ci = inverse(c), x = vector.map(v => [rational(v)]), transition = product(ci, b);
    const old = product(bi, x), next = product(ci, x);
    let op = null;
    if (operator !== undefined) { const a = matrix(operator); if (a.length !== n || a[0].length !== n) throw Error("Operator dimension mismatch"); op = { source: numeric(product(product(bi, a), b)), target: numeric(product(product(ci, a), c)), sourceExact: exact(product(product(bi, a), b)), targetExact: exact(product(product(ci, a), c)) }; }
    return { vector: numeric(x).map(row => row[0]), sourceBasis: numeric(b), targetBasis: numeric(c),
      sourceCoordinates: numeric(old).map(row => row[0]), targetCoordinates: numeric(next).map(row => row[0]),
      sourceCoordinatesExact: exact(old).map(row => row[0]), targetCoordinatesExact: exact(next).map(row => row[0]),
      transition: numeric(transition), transitionExact: exact(transition), inverseTransition: numeric(product(bi, c)), operator: op,
      convention: "Basis vectors are columns; x=B[x]_B=C[x]_C and [x]_C=C^-1 B[x]_B. Optional operator is supplied in standard coordinates, transformed by similarity." };
  }
  function trim(p) { while (p.length > 1 && p.at(-1).n === 0n) p.pop(); return p; }
  function polynomial(input) { if (!Array.isArray(input) || input.length < 1 || input.length > 13) throw Error("Use 1..13 ascending polynomial coefficients"); return trim(input.map(rational)); }
  const zeroPoly = p => p.length === 1 && p[0].n === 0n;
  function polyAdd(a, b, minus = false) { return trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => minus ? sub(a[i] ?? Z(), b[i] ?? Z()) : add(a[i] ?? Z(), b[i] ?? Z()))); }
  function polyMul(a, b) { const r = Array.from({ length: a.length + b.length - 1 }, Z); a.forEach((v, i) => b.forEach((w, j) => { r[i + j] = add(r[i + j], mul(v, w)); })); return trim(r); }
  function division(a, b) {
    if (zeroPoly(b)) throw Error("Cannot divide by zero polynomial");
    let remainder = a.slice(); const quotient = Array.from({ length: Math.max(1, a.length - b.length + 1) }, Z), steps = [];
    while (!zeroPoly(remainder) && remainder.length >= b.length) {
      const power = remainder.length - b.length, factor = div(remainder.at(-1), b.at(-1));
      quotient[power] = add(quotient[power], factor);
      const term = [...Array.from({ length: power }, Z), factor];
      remainder = polyAdd(remainder, polyMul(term, b), true);
      steps.push({ power, factor: number(factor), factorExact: literal(factor), quotient: quotient.map(number), quotientExact: quotient.map(literal), remainder: remainder.map(number), remainderExact: remainder.map(literal) });
    }
    return { quotient: trim(quotient), remainder, steps };
  }
  function polynomialDivide({ dividend, divisor } = {}) {
    const a = polynomial(dividend), b = polynomial(divisor), r = division(a, b);
    return { dividend: a.map(number), divisor: b.map(number), quotient: r.quotient.map(number), remainder: r.remainder.map(number),
      dividendExact: a.map(literal), divisorExact: b.map(literal), quotientExact: r.quotient.map(literal), remainderExact: r.remainder.map(literal), steps: r.steps,
      convention: "Exact rational coefficients in ascending power order; f=qg+r with deg r<deg g or r=0. Not numerical root finding." };
  }
  function polynomialGcd({ a, b } = {}) {
    const first = polynomial(a), second = polynomial(b);
    if (zeroPoly(first) && zeroPoly(second)) throw Error("Both-zero gcd has no monic normalization");
    let left = first, right = second, u = [O()], v = [Z()], uu = [Z()], vv = [O()]; const steps = [];
    while (!zeroPoly(right)) {
      const r = division(left, right); steps.push({ dividend: left.map(number), divisor: right.map(number), quotient: r.quotient.map(number), remainder: r.remainder.map(number) });
      [left, right] = [right, r.remainder]; [u, uu] = [uu, polyAdd(u, polyMul(r.quotient, uu), true)]; [v, vv] = [vv, polyAdd(v, polyMul(r.quotient, vv), true)];
    }
    const scale = div(O(), left.at(-1)); left = left.map(x => mul(x, scale)); u = u.map(x => mul(x, scale)); v = v.map(x => mul(x, scale));
    return { a: first.map(number), b: second.map(number), gcd: left.map(number), gcdExact: left.map(literal),
      bezoutA: u.map(number), bezoutB: v.map(number), bezoutAExact: u.map(literal), bezoutBExact: v.map(literal), steps,
      convention: "Monic gcd over Q; exact Bezout identity u*a+v*b=gcd. Rational examples do not establish irreducibility over another field." };
  }
  function modularTable({ modulus = 5, operation = "multiply" } = {}) {
    if (!Number.isInteger(modulus) || modulus < 2 || modulus > 12 || !["add", "multiply"].includes(operation)) throw Error("Residue ring modulus 2..12, add/multiply");
    const values = Array.from({ length: modulus }, (_, i) => i), prime = values.slice(2).every(v => modulus % v !== 0);
    const data = values.map(a => values.map(b => (operation === "add" ? a + b : a * b) % modulus));
    const units = values.filter(a => values.some(b => a * b % modulus === 1));
    const zeroDivisors = values.slice(1).filter(a => values.slice(1).some(b => a * b % modulus === 0));
    return { modulus, operation, data, labels: values.map(String), units, zeroDivisors, isField: prime,
      classification: prime ? "域" : "有零因子的环", zeroDivisorCount: zeroDivisors.length,
      convention: "Z/nZ with residue representatives 0..n-1; it is a field precisely for prime n. A zero product counts as a zero divisor only when both factors are nonzero." };
  }
  function jordanProfile({ input } = {}) {
    const a = matrix(input), n = a.length;
    if (a[0].length !== n) throw Error("Square nilpotent matrix required");
    let power = identity(n); const ranks = [n], nullities = [0], powers = [numeric(power)];
    for (let k = 1; k <= n; k++) { power = product(power, a); const r = reduce(power); ranks.push(r.pivots.length); nullities.push(n - r.pivots.length); powers.push(numeric(power)); }
    if (ranks.at(-1) !== 0) throw Error("Input is not nilpotent; subtract a verified single eigenvalue first");
    const atLeast = Array.from({ length: n }, (_, i) => nullities[i + 1] - nullities[i]);
    const blockCounts = atLeast.map((count, i) => count - (atLeast[i + 1] ?? 0));
    const blockSizes = blockCounts.flatMap((count, i) => Array(count).fill(i + 1)).reverse();
    return { input: numeric(a), powers, ranks, nullities, atLeast, blockCounts, blockSizes, nilpotencyIndex: ranks.findIndex((rank, i) => i > 0 && rank === 0),
      convention: "Exact nilpotent profile over Q. dim ker N^k increments count blocks of size>=k; second differences count exact sizes. Does not construct a Jordan basis or assert arbitrary matrices are nilpotent." };
  }
  function evaluateMatrixPolynomial(a, coefficients) {
    let power = identity(a.length), total = a.map(row => row.map(Z));
    const powers = [], terms = [], partials = [];
    coefficients.forEach((coefficient, index) => {
      if (index) power = product(power, a);
      const term = power.map(row => row.map(v => mul(v, coefficient)));
      total = total.map((row, i) => row.map((v, j) => add(v, term[i][j])));
      powers.push(copy(power)); terms.push(term); partials.push(copy(total));
    });
    return { powers, terms, partials, total };
  }
  function matrixPolynomial({ input, coefficients, selectedPower, vector } = {}) {
    const a = matrix(input), p = polynomial(coefficients), n = a.length;
    if (a[0].length !== n) throw Error('Square matrix polynomial input required');
    const r = evaluateMatrixPolynomial(a, p), last = p.length - 1;
    const requested = selectedPower ?? last;
    if (!Number.isInteger(requested) || requested < 0 || requested > 12) throw Error('Selected polynomial power must be integer0..12');
    const index = Math.min(requested, last);
    let vectorValue = null, vectorValueExact = null;
    if (vector !== undefined) {
      if (!Array.isArray(vector) || vector.length !== n) throw Error('Polynomial vector dimension mismatch');
      const v = product(r.total, vector.map(x => [rational(x)]));
      vectorValue = numeric(v).map(row => row[0]); vectorValueExact = exact(v).map(row => row[0]);
    }
    const isZero = r.total.every(row => row.every(v => v.n === 0n));
    return { input:numeric(a), inputExact:exact(a), coefficients:p.map(number), coefficientsExact:p.map(literal),
      degree:zeroPoly(p) ? null : last, lastPower:last, selectedPower:index, selectionClamped:index !== requested,
      powers:r.powers.map(numeric), powersExact:r.powers.map(exact), terms:r.terms.map(numeric), termsExact:r.terms.map(exact),
      partials:r.partials.map(numeric), partialsExact:r.partials.map(exact), currentTerm:numeric(r.terms[index]), currentTermExact:exact(r.terms[index]),
      current:numeric(r.partials[index]), currentExact:exact(r.partials[index]), value:numeric(r.total), valueExact:exact(r.total), isZero, vectorValue, vectorValueExact,
      convention:'Exact rational p(A)=sum c_k A^k with ascending coefficients; constant term is c_0 I, never scalar addition to matrix entries. Discrete partials are terms accumulated in increasing powers. Zero polynomial degree is null; trailing zero coefficients are trimmed. A vector killed by p(A) does not imply p(A) is the zero operator.' };
  }
  function minimalPolynomial({ input } = {}) {
    const a = matrix(input), n = a.length;
    if (a[0].length !== n) throw Error('Square matrix required for minimal polynomial');
    const powers = [identity(n)];
    for (let k = 1; k <= n; k++) powers.push(product(powers.at(-1), a));
    const dependence = [{power:0,rank:1,dependent:false}]; let coefficients = null;
    for (let k = 1; k <= n; k++) {
      const rows = a.flatMap((row, i) => row.map((_, j) => powers.slice(0,k+1).map(p => p[i][j])));
      const reduced = reduce(rows, k);
      const consistent = !reduced.current.some(row => row.slice(0,k).every(v => v.n === 0n) && row[k].n !== 0n);
      if (reduced.pivots.length !== k) throw Error('Earlier matrix powers unexpectedly dependent');
      dependence.push({power:k,rank:consistent ? k : k+1,dependent:consistent});
      if (consistent) { coefficients = [...reduced.current.slice(0,k).map(row => neg(row[k])),O()]; break; }
    }
    if (!coefficients) throw Error('No bounded minimal polynomial found');
    const descending = [O()], traces = powers.slice(1).map(p => p.reduce((sum,row,i) => add(sum,row[i]),Z()));
    for (let k = 1; k <= n; k++) {
      const sum = Array.from({length:k},(_,i) => mul(descending[k-i-1],traces[i])).reduce(add,Z());
      descending.push(neg(div(sum,q(BigInt(k)))));
    }
    const characteristic = descending.reverse(), quotient = division(characteristic, coefficients);
    const value = evaluateMatrixPolynomial(a, coefficients).total, characteristicValue = evaluateMatrixPolynomial(a, characteristic).total;
    if (!zeroPoly(quotient.remainder) || value.some(row => row.some(v => v.n !== 0n)) || characteristicValue.some(row => row.some(v => v.n !== 0n))) throw Error('Exact matrix polynomial invariant failed');
    return { input:numeric(a), inputExact:exact(a), dimension:n, degree:coefficients.length-1, coefficients:coefficients.map(number), coefficientsExact:coefficients.map(literal),
      characteristicDegree:n, characteristicCoefficients:characteristic.map(number), characteristicCoefficientsExact:characteristic.map(literal),
      value:numeric(value), valueExact:exact(value), characteristicValueExact:exact(characteristicValue), quotientExact:quotient.quotient.map(literal), dependence, ranks:dependence.map(x => x.rank),
      convention:'First exact dependence of I,A,...,A^n gives the monic minimal polynomial over Q. Characteristic polynomial uses exact Newton trace identities; minimum divides it, and both evaluations are checked. No roots, eigenbasis, Jordan basis or diagonalizability claim from degree alone. Bounded rational arithmetic can reject oversized intermediates.' };
  }
  function bilinearChange({ input, basis, point } = {}) {
    const a = matrix(input), b = matrix(basis), n = a.length;
    if (a[0].length !== n || b.length !== n || b[0].length !== n) throw Error("Bilinear/basis dimensions differ");
    inverse(b); const c = product(product(transpose(b), a), b), rank = reduce(a).pivots.length;
    const symmetric = a.every((row, i) => row.every((v, j) => sub(v, a[j][i]).n === 0n));
    let values = null;
    if (point !== undefined) {
      if (!Array.isArray(point) || point.length !== n) throw Error("Point is coordinates in the new basis");
      const y = point.map(v => [rational(v)]), x = product(b, y), first = product(product(transpose(x), a), x)[0][0], second = product(product(transpose(y), c), y)[0][0];
      values = { oldPoint: numeric(x).map(row => row[0]), newPoint: numeric(y).map(row => row[0]), oldValue: number(first), newValue: number(second), oldValueExact: literal(first), newValueExact: literal(second) };
    }
    return { input: numeric(a), basis: numeric(b), transformed: numeric(c), transformedExact: exact(c), rank, transformedRank: reduce(c).pivots.length,
      symmetric, values, transformedField: n === 2 && symmetric ? { type: "quadratic", matrix: numeric(c).map(row => row.map(v => 2 * v)), center: [0, 0], constant: 0 } : null, field: n === 2 && symmetric ? { type: "quadratic", matrix: numeric(a).map(row => row.map(v => 2 * v)), center: [0, 0], constant: 0 } : null,
      convention: "Bilinear congruence C=B^T A B, columns of B are the new basis; x=By. For symmetric 2D A the optional level-set field uses 2A because scalar-field internally has factor 1/2. Congruence is not similarity." };
  }
  function determinantExpansion({ input, axis = "row", index = 0 } = {}) {
    const a = matrix(input), n = a.length;
    if(a[0].length!==n || !["row","column"].includes(axis) || !Number.isInteger(index) || index<0 || index>=n)throw Error("Square matrix and valid row/column index required");
    const terms=Array.from({length:n},(_,k)=>{
      const row=axis==="row"?index:k,column=axis==="row"?k:index;
      const minor=a.filter((_,i)=>i!==row).map(line=>line.filter((_,j)=>j!==column));
      const minorDet=n===1?O():reduce(minor).determinant,sign=(row+column)%2?-1:1,cofactor=sign<0?neg(minorDet):minorDet,term=mul(a[row][column],cofactor);
      return {row,column,sign,entry:number(a[row][column]),entryExact:literal(a[row][column]),minor:n===1?[]:numeric(minor),minorExact:n===1?[]:exact(minor),minorDeterminant:number(minorDet),minorDeterminantExact:literal(minorDet),cofactor:number(cofactor),cofactorExact:literal(cofactor),value:number(term),valueExact:literal(term)};
    });
    const value=terms.reduce((sum,t)=>add(sum,rational(t.valueExact)),Z());
    return {input:numeric(a),inputExact:exact(a),axis,index,terms,cofactors:terms.map(t=>t.cofactor),cofactorsExact:terms.map(t=>t.cofactorExact),values:terms.map(t=>t.value),valuesExact:terms.map(t=>t.valueExact),determinant:number(value),determinantExact:literal(value),convention:"Exact cofactor expansion over Q, along the selected row or column. The empty 0×0 minor has determinant 1. Not a large-matrix performance claim."};
  }
  function dualBasis({ basis, vector } = {}) {
    const b=matrix(basis),n=b.length,dual=inverse(b);
    let evaluations=null,evaluationsExact=null;
    if(vector!==undefined) {if(!Array.isArray(vector)||vector.length!==n)throw Error("Dual vector dimension mismatch");const r=product(dual,vector.map(x=>[rational(x)]));evaluations=r.map(row=>number(row[0]));evaluationsExact=r.map(row=>literal(row[0]));}
    const rows=numeric(dual);
    return {basis:numeric(b),basisExact:exact(b),dualRows:rows,dualRowsExact:exact(dual),evaluations,evaluationsExact,
      kernelDirections:n===2?rows.map(row=>[row[1],-row[0]]):null,coordinateScales:n===2?rows.map(row=>Math.hypot(...row)):null,
      pairing:numeric(product(dual,b)),pairingExact:exact(product(dual,b)),convention:"Basis vectors are columns; dual covectors are ROWS of B^-1, so phi_i(b_j)=delta_ij. Evaluations are coordinates of the physical vector. Contour directions/scales use a real 2D Euclidean display only."};
  }
  function symmetricInertia({ input } = {}) {
    let a=matrix(input);const n=a.length;
    if(a[0].length!==n || a.some((row,i)=>row.some((v,j)=>sub(v,a[j][i]).n!==0n)))throw Error("Exact symmetric square matrix required");
    const original=copy(a);let basis=identity(n);const steps=[];
    const change=(t,operation)=>{a=product(product(transpose(t),a),t);basis=product(basis,t);steps.push({operation,matrix:numeric(a),matrixExact:exact(a),basis:numeric(basis),basisExact:exact(basis)});};
    for(let k=0;k<n;k++) {
      let pivot=a.findIndex((row,i)=>i>=k&&row[i].n!==0n);
      if(pivot<0) {
        let pair=null;for(let i=k;i<n&&!pair;i++)for(let j=i+1;j<n;j++)if(a[i][j].n!==0n){pair=[i,j];break;}
        if(!pair)break;
        if(pair[0]!==k) {const t=identity(n);[t[k],t[pair[0]]]=[t[pair[0]],t[k]];change(t,{kind:"swap",a:k,b:pair[0]});}
        const t=identity(n);t[pair[1]][k]=O();change(t,{kind:"create-diagonal",from:pair[1],to:k});pivot=k;
      }
      if(pivot!==k) {const t=identity(n);[t[k],t[pivot]]=[t[pivot],t[k]];change(t,{kind:"swap",a:k,b:pivot});}
      const t=identity(n);let changed=false;
      for(let j=k+1;j<n;j++)if(a[k][j].n!==0n){t[k][j]=neg(div(a[k][j],a[k][k]));changed=true;}
      if(changed)change(t,{kind:"eliminate-paired-row-column",pivot:k});
    }
    const diagonal=a.map((row,i)=>row[i]),positive=diagonal.filter(x=>x.n>0n).length,negative=diagonal.filter(x=>x.n<0n).length,zero=n-positive-negative;
    return {input:numeric(original),inputExact:exact(original),diagonal:diagonal.map(number),diagonalExact:diagonal.map(literal),diagonalMatrix:numeric(a),diagonalMatrixExact:exact(a),basis:numeric(basis),basisExact:exact(basis),steps,positive,negative,zero,rank:positive+negative,positiveDefinite:positive===n,negativeDefinite:negative===n,positiveSemidefinite:negative===0,negativeSemidefinite:positive===0,
      convention:"Exact rational congruence B^T A B=D. Inertia counts positive/negative/zero terms over R; a zero diagonal can require mixing two coordinates before elimination. Over Q these counts do not classify all quadratic forms; over C signs have a different meaning. No irrational normalization to +/-1 is claimed."};
  }
  function coefficientLiterals(input) {
    if(!Array.isArray(input)||input.length<1||input.length>13)throw Error("Use 1..13 polynomial coefficients");
    const values=input.map(rational),last=values.findLastIndex(x=>x.n!==0n);
    return {values:values.map(literal),degree:last<0?null:last};
  }
  function orthogonalize({ vectors, metric } = {}) {
    const original = matrix(vectors), n = original[0].length;
    const g = metric === undefined ? identity(n) : matrix(metric);
    if (g.length !== n || g[0].length !== n || !symmetricInertia({ input: exact(g) }).positiveDefinite) throw Error("Real symmetric positive definite metric required");
    const inner = (a, b) => product(product([a], g), b.map(x => [x]))[0][0];
    const basis = [], norms = [], steps = [], independentIndices = [];
    original.forEach((vector, index) => {
      let remainder = vector.slice(); const projections = [], coefficients = [];
      basis.forEach((u, i) => {
        const coefficient = div(inner(vector, u), norms[i]), projected = u.map(x => mul(x, coefficient));
        remainder = remainder.map((x, j) => sub(x, projected[j]));
        coefficients.push(coefficient); projections.push(projected);
      });
      const norm = inner(remainder, remainder), independent = norm.n !== 0n;
      steps.push({ index, original: vector.map(number), originalExact: vector.map(literal),
        projections: numeric(projections), projectionsExact: exact(projections),
        coefficients: coefficients.map(number), coefficientsExact: coefficients.map(literal),
        remainder: remainder.map(number), remainderExact: remainder.map(literal),
        normSquared: number(norm), normSquaredExact: literal(norm), independent });
      if (independent) { independentIndices.push(index); basis.push(remainder); norms.push(norm); }
    });
    const pairings = basis.map(u => basis.map(v => inner(u, v)));
    const basisMatrix = Array.from({ length: n }, (_, i) => basis.map(u => u[i]));
    return { vectors: numeric(original), vectorsExact: exact(original), metric: numeric(g), metricExact: exact(g),
      steps, rank: basis.length, independentIndices, orthogonalBasis: numeric(basis), orthogonalBasisExact: exact(basis),
      orthogonalMatrix: numeric(basisMatrix), orthogonalMatrixExact: exact(basisMatrix),
      normSquares: norms.map(number), normSquaresExact: norms.map(literal),
      unitBasis: basis.map((v, i) => v.map(x => number(x) / Math.sqrt(number(norms[i])))),
      pairings: numeric(pairings), pairingsExact: exact(pairings),
      convention: "Exact rational Gram-Schmidt over R with positive definite symmetric metric G, <u,v>=u^T G v. Input vectors are rows; orthogonalMatrix places output basis in columns. Zero/dependent inputs are explicitly skipped, not normalized. Unit vectors use numeric square roots; exact basis is unnormalized. G-orthogonality need not look perpendicular in Euclidean screen coordinates." };
  }
  function complex(value) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.keys(value).sort().join(',') !== 'im,re') throw Error('Complex input must have exactly re and im');
      return { re:rational(value.re), im:rational(value.im) };
    }
    return { re:rational(value), im:Z() };
  }
  const cAdd=(a,b)=>({re:add(a.re,b.re),im:add(a.im,b.im)});
  const cMul=(a,b)=>({re:sub(mul(a.re,b.re),mul(a.im,b.im)),im:add(mul(a.re,b.im),mul(a.im,b.re))});
  const cConj=a=>({re:a.re,im:neg(a.im)});
  const cExact=a=>({re:literal(a.re),im:literal(a.im)});
  const cNumber=a=>({re:number(a.re),im:number(a.im)});
  const cPoint=a=>[number(a.re),number(a.im)];
  const cZero=()=>({re:Z(),im:Z()});
  const cEqual=(a,b)=>sub(a.re,b.re).n===0n && sub(a.im,b.im).n===0n;
  const cSum=xs=>xs.reduce(cAdd,cZero());
  function complexVector(input) {
    if (!Array.isArray(input)||input.length<1||input.length>6) throw Error('Use 1..6 complex vector components');
    return input.map(complex);
  }
  function complexInnerProduct({u,v,linearSlot,scalar=1}={}) {
    if (!['first','second'].includes(linearSlot)) throw Error('Explicit linearSlot first or second required');
    const a=complexVector(u),b=complexVector(v),s=complex(scalar);
    if(a.length!==b.length) throw Error('Complex vector dimensions differ');
    const terms=(x,y)=>x.map((z,i)=>linearSlot==='first'?cMul(z,cConj(y[i])):cMul(cConj(z),y[i]));
    const inner=cSum(terms(a,b)),reverse=cSum(terms(b,a)),scaled=a.map(z=>cMul(s,z));
    const bilinear=a.map((z,i)=>cMul(z,b[i]));
    const norm=x=>cSum(x.map(z=>cMul(z,cConj(z)))).re;
    return {u:a.map(cNumber),v:b.map(cNumber),uExact:a.map(cExact),vExact:b.map(cExact),linearSlot,scalar:cNumber(s),scalarExact:cExact(s),
      uPoints:a.map(cPoint),vPoints:b.map(cPoint),conjugatedUPoints:a.map(z=>cPoint(cConj(z))),
      terms:terms(a,b).map(cNumber),termsExact:terms(a,b).map(cExact),termPoints:terms(a,b).map(cPoint),
      inner:cNumber(inner),innerExact:cExact(inner),innerPoint:cPoint(inner),reverseExact:cExact(reverse),
      bilinearWithoutConjugation:cNumber(cSum(bilinear)),bilinearWithoutConjugationExact:cExact(cSum(bilinear)),bilinearTermPoints:bilinear.map(cPoint),
      scaledU:scaled.map(cNumber),scaledUPoints:scaled.map(cPoint),scaledInnerExact:cExact(cSum(terms(scaled,b))),
      normUSquared:number(norm(a)),normVSquared:number(norm(b)),normUSquaredExact:literal(norm(a)),normVSquaredExact:literal(norm(b)),
      convention:'Standard C^n inner product, explicit linear slot: first means sum u_j conjugate(v_j); second means sum conjugate(u_j) v_j. Exact arithmetic in Q(i); re/im drawing coordinates are numeric approximations. No complex vector is represented as a single 2D real arrow unless its components are explicitly separate points. Bilinear product is a comparison, not an inner product.'};
  }
  function complexMatrix(input) {
    if(!Array.isArray(input)||input.length<1||input.length>6||input.some(row=>!Array.isArray(row)||row.length!==input.length)) throw Error('Use a square complex matrix of size1..6');
    return input.map(row=>row.map(complex));
  }
  const cTranspose=a=>a[0].map((_,j)=>a.map(row=>row[j]));
  const cAdjoint=a=>cTranspose(a).map(row=>row.map(cConj));
  const cProduct=(a,b)=>a.map(row=>b[0].map((_,j)=>cSum(row.map((v,k)=>cMul(v,b[k][j])))));
  const cMatrixEqual=(a,b)=>a.every((row,i)=>row.every((v,j)=>cEqual(v,b[i][j])));
  function complexOperator({input}={}) {
    const a=complexMatrix(input),adjoint=cAdjoint(a),t=cTranspose(a),left=cProduct(adjoint,a),right=cProduct(a,adjoint),wrong=cProduct(t,a);
    const id=a.map((row,i)=>row.map((_,j)=>({re:i===j?O():Z(),im:Z()})));
    const parts=m=>({real:m.map(row=>row.map(v=>number(v.re))),imaginary:m.map(row=>row.map(v=>number(v.im))),exact:m.map(row=>row.map(cExact))});
    const unitary=cMatrixEqual(left,id)&&cMatrixEqual(right,id),hermitian=cMatrixEqual(a,adjoint),normal=cMatrixEqual(left,right);
    return {input:parts(a),transpose:parts(t),adjoint:parts(adjoint),adjointProduct:parts(left),reverseAdjointProduct:parts(right),transposeProduct:parts(wrong),
      unitary,hermitian,normal,unitaryIndicator:unitary?1:0,hermitianIndicator:hermitian?1:0,normalIndicator:normal?1:0,
      convention:'Exact square complex matrix over Q(i). Adjoint means conjugate transpose, never plain transpose. Unitary is A* A=A A*=I; Hermitian is A=A*; normal is A* A=A A*. Flags are exact for supplied finite data; no eigenvector/spectral theorem, arbitrary-field or approximate-tolerance claim.'};
  }
  const api = { rowReduction, changeBasis, polynomialDivide, polynomialGcd, modularTable, jordanProfile, matrixPolynomial, minimalPolynomial, bilinearChange, determinantExpansion, dualBasis, symmetricInertia, coefficientLiterals, orthogonalize, complexInnerProduct, complexOperator };
  // Native components also call this kernel directly. Record their resolved
  // finite data during a synchronous runtime frame, without changing returns.
  const recordedOperations = {rowReduction:'exact-row-reduction',changeBasis:'change-basis',polynomialDivide:'polynomial-divide',polynomialGcd:'polynomial-gcd',modularTable:'residue-table',jordanProfile:'nilpotent-profile',matrixPolynomial:'matrix-polynomial',minimalPolynomial:'minimal-polynomial',bilinearChange:'bilinear-congruence',determinantExpansion:'determinant-expansion',dualBasis:'dual-basis',symmetricInertia:'symmetric-inertia',orthogonalize:'orthogonalize',complexInnerProduct:'complex-inner-product',complexOperator:'complex-operator'};
  for (const [name,operation] of Object.entries(recordedOperations)) {
    const original=api[name];
    api[name]=function(input) {
      const invoke=global.VisualBookCalculations?.invokeRecorded;
      if(invoke)return invoke(operation,input??{},()=>original(input));
      const recorder=global.__VisualBookCalculationRecorder;
      const inputs=recorder?JSON.parse(JSON.stringify(input??{})):null;
      const result=original(input);
      if(recorder) recorder({id:null,origin:'algebra-kernel',operation,inputs,result:JSON.parse(JSON.stringify(result))});
      return result;
    };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.VisualBookAlgebra = api;
})(typeof window !== "undefined" ? window : globalThis);
