"""Check recorded finite algebra examples independently using standard-library fractions.

This checks calculation certificates, not textbook theorems, source fidelity,
SVG binding, pedagogical usefulness, or artistic quality. Unsupported operations
and legacy runtimes remain explicit unverified coverage, never counted as passes.
"""
import argparse
from fractions import Fraction as F
import hashlib
import itertools
import json
import math
from pathlib import Path
import time


def require(condition, message):
    if not condition:
        raise ValueError(message)


def q(value):
    require(not isinstance(value, bool) and isinstance(value, (int, float, str, F)), 'rational type')
    return F(str(value))


def exact(value):
    if isinstance(value, list):
        return [exact(x) for x in value]
    if isinstance(value, dict):
        return {k: exact(v) for k, v in value.items()}
    return q(value)


def close(actual, expected, label):
    if expected is None:
        require(actual is None, label)
    elif isinstance(expected, list):
        require(isinstance(actual, list) and len(actual) == len(expected), label + ' shape')
        for i, (a, b) in enumerate(zip(actual, expected)):
            close(a, b, f'{label}[{i}]')
    elif isinstance(expected, dict):
        require(isinstance(actual, dict), label + ' object')
        for k, b in expected.items():
            require(k in actual, label + '.' + k)
            close(actual[k], b, label + '.' + k)
    else:
        require(isinstance(actual, (int, float, F)) and not isinstance(actual, bool)
                and math.isfinite(actual) and math.isclose(actual, float(expected), rel_tol=1e-11, abs_tol=1e-11), label)


def numeric_pairs(value, label='result'):
    if isinstance(value, dict):
        for k, v in value.items():
            if k.endswith('Exact') and k[:-5] in value:
                close(value[k[:-5]], None if v is None else exact(v), label + '.' + k[:-5])
            numeric_pairs(v, label + '.' + k)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            numeric_pairs(v, f'{label}[{i}]')


def mat(value):
    require(isinstance(value, list) and 1 <= len(value) <= 6
            and all(isinstance(r, list) and 1 <= len(r) <= 12 for r in value)
            and len({len(r) for r in value}) == 1, 'matrix shape')
    return exact(value)


def eye(n):
    return [[F(i == j) for j in range(n)] for i in range(n)]


def transpose(a):
    return [list(row) for row in zip(*a)]


def multiply(a, b):
    require(len(a[0]) == len(b), 'product dimensions')
    return [[sum((a[i][k] * b[k][j] for k in range(len(b))), F(0))
             for j in range(len(b[0]))] for i in range(len(a))]


def scale(a, c):
    return [[v * c for v in row] for row in a]


def add(a, b):
    return [[x + y for x, y in zip(ra, rb)] for ra, rb in zip(a, b)]


def zero_matrix(a):
    return all(v == 0 for row in a for v in row)


def det(a):
    # Permutation expansion intentionally differs from the renderer's elimination.
    n = len(a)
    return sum(((-1) ** sum(p[i] > p[j] for i in range(n) for j in range(i + 1, n))
                * math.prod(a[i][p[i]] for i in range(n)) for p in itertools.permutations(range(n))), F(0))


def rref(a, columns=None):
    a = [row[:] for row in a]
    columns = len(a[0]) if columns is None else columns
    row, pivots = 0, []
    for c in range(columns):
        found = next((i for i in range(row, len(a)) if a[i][c]), None)
        if found is None:
            continue
        a[row], a[found] = a[found], a[row]
        a[row] = [v / a[row][c] for v in a[row]]
        for i in range(len(a)):
            if i != row:
                factor = a[i][c]
                a[i] = [x - factor * y for x, y in zip(a[i], a[row])]
        pivots.append(c)
        row += 1
        if row == len(a):
            break
    return a, pivots


def rank(a):
    return len(rref(a)[1])


def trim(p):
    p = p[:]
    while len(p) > 1 and not p[-1]:
        p.pop()
    return p


def padd(a, b):
    return trim([(a[i] if i < len(a) else F(0)) + (b[i] if i < len(b) else F(0))
                 for i in range(max(len(a), len(b)))])


def pmul(a, b):
    out = [F(0)] * (len(a) + len(b) - 1)
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            out[i + j] += x * y
    return trim(out)


def pdiv(a, b):
    a, b = trim(a), trim(b)
    require(b != [0], 'zero divisor polynomial')
    out = [F(0)] * max(1, len(a) - len(b) + 1)
    while a != [0] and len(a) >= len(b):
        k, c = len(a) - len(b), a[-1] / b[-1]
        out[k] += c
        a = padd(a, [0] * k + [-c * v for v in b])
    return trim(out), a


def matrix_powers(a, count):
    out = [eye(len(a))]
    for _ in range(count):
        out.append(multiply(out[-1], a))
    return out


def peval(a, coeff):
    out = scale(a, F(0))
    for c, power in zip(coeff, matrix_powers(a, len(coeff) - 1)):
        out = add(out, scale(power, c))
    return out


def charpoly(a):
    # det(x I-A) in Q[x], not Newton traces used by the renderer.
    n = len(a)
    out = [F(0)]
    for p in itertools.permutations(range(n)):
        term = [F((-1) ** sum(p[i] > p[j] for i in range(n) for j in range(i + 1, n)))]
        for i in range(n):
            term = pmul(term, [-a[i][p[i]], F(1)] if i == p[i] else [-a[i][p[i]]])
        out = padd(out, term)
    return out


def check_rows(data, r):
    a = mat(data['input']); n = data.get('coefficientColumns', len(a[0]))
    final, pivots = rref(a, n)
    require(exact(r['inputExact']) == a and exact(r['finalExact']) == final, 'rref result')
    require(r['pivotColumns'] == pivots and r['rank'] == len(pivots) and r['nullity'] == n - len(pivots), 'rank/nullity/pivots')
    require(multiply(exact(r['transformExact']), a) == final, 'final row transformation')
    previous = None
    for step in r['steps']:
        require(multiply(exact(step['transformExact']), a) == exact(step['exact']), 'row step certificate')
        close(step['values'], exact(step['exact']), 'row step values')
        require(det(exact(step['transformExact'])) != 0, 'invertible row step')
        op = step['operation']; expected = [line[:] for line in (a if previous is None else previous)]
        if previous is None:
            require(op['kind'] == 'initial', 'initial operation')
        elif op['kind'] == 'swap':
            i, j = op['row'], op['source']; expected[i], expected[j] = expected[j], expected[i]
        elif op['kind'] == 'scale':
            expected[op['row']] = [q(op['factorExact']) * x for x in expected[op['row']]]
        elif op['kind'] == 'add':
            i, j, c = op['row'], op['source'], q(op['factorExact'])
            expected[i] = [x + c * y for x, y in zip(expected[i], expected[j])]
        else:
            raise ValueError('unknown row operation')
        require(expected == exact(step['exact']), 'row operation label does not match step')
        previous = expected
    selected = min(data.get('selectedStep', len(r['steps']) - 1), len(r['steps']) - 1)
    require(r['selectedStep'] == selected and exact(r['currentExact']) == exact(r['steps'][selected]['exact']), 'selected row step')
    require(r['lastStep'] == len(r['steps']) - 1 and r['operation'] == r['steps'][selected]['operation']
            and r['selectionClamped'] is (selected != data.get('selectedStep', len(r['steps']) - 1)), 'row selection metadata')
    free = [c for c in range(n) if c not in pivots]
    require(r['freeColumns'] == free and len(r['kernelBasisExact']) == len(free), 'free columns')
    expected_kernel = []
    for c in free:
        v = [F(0)] * n; v[c] = 1
        for i, pivot in enumerate(pivots):
            v[pivot] = -final[i][c]
        expected_kernel.append(v)
    require(exact(r['kernelBasisExact']) == expected_kernel, 'kernel basis')
    require(exact(r['imageBasisExact']) == [[row[c] for row in a] for c in pivots], 'image basis')
    coeff = [row[:n] for row in a]
    require(len(r['solutions']) == len(a[0]) - n, 'solution count')
    for k, solution in enumerate(r['solutions']):
        rhs = n + k
        consistent = rank(coeff) == rank([row[:n] + [row[rhs]] for row in a])
        require(solution['rhsColumn'] == rhs and solution['consistent'] is consistent, 'consistency')
        if consistent:
            require(multiply(coeff, [[v] for v in exact(solution['particularExact'])]) == [[row[rhs]] for row in a], 'particular solution')
        else:
            require(solution['particularExact'] is None and solution['particular'] is None, 'inconsistent solution')
    require(r['determinantExact'] is None if len(a) != n else q(r['determinantExact']) == det(coeff), 'determinant')


def check_change(data, r):
    b, c = mat(data['sourceBasis']), mat(data['targetBasis'])
    x = [[v] for v in exact(data['vector'])]
    require(det(b) != 0 and det(c) != 0, 'basis invertibility')
    require(multiply(b, [[v] for v in exact(r['sourceCoordinatesExact'])]) == x, 'source coordinates')
    require(multiply(c, [[v] for v in exact(r['targetCoordinatesExact'])]) == x, 'target coordinates')
    require(multiply(c, exact(r['transitionExact'])) == b, 'transition direction')
    close(multiply(b, exact(r['inverseTransition'])), c, 'inverse transition')
    if 'operator' in data:
        a = mat(data['operator'])
        require(multiply(a, b) == multiply(b, exact(r['operator']['sourceExact'])), 'source operator')
        require(multiply(a, c) == multiply(c, exact(r['operator']['targetExact'])), 'target operator')


def check_divide(data, r):
    a, b = trim(exact(data['dividend'])), trim(exact(data['divisor']))
    quotient, remainder = exact(r['quotientExact']), exact(r['remainderExact'])
    require((quotient, remainder) == pdiv(a, b), 'division quotient/remainder')
    for step in r['steps']:
        require(padd(pmul(exact(step['quotientExact']), b), exact(step['remainderExact'])) == a, 'division step identity')


def check_gcd(data, r):
    a, b, g = trim(exact(data['a'])), trim(exact(data['b'])), exact(r['gcdExact'])
    require(g[-1] == 1 and pdiv(a, g)[1] == [0] and pdiv(b, g)[1] == [0], 'monic common divisor')
    require(padd(pmul(exact(r['bezoutAExact']), a), pmul(exact(r['bezoutBExact']), b)) == g, 'Bezout certificate')


def check_residue(data, r):
    n, op = data.get('modulus', 5), data.get('operation', 'multiply')
    require(r['data'] == [[(a + b if op == 'add' else a * b) % n for b in range(n)] for a in range(n)], 'residue table')
    units = [a for a in range(n) if math.gcd(a, n) == 1]
    zeros = [a for a in range(1, n) if math.gcd(a, n) != 1]
    prime = all(n % k for k in range(2, math.isqrt(n) + 1))
    require(r['units'] == units and r['zeroDivisors'] == zeros and r['isField'] is prime and r['zeroDivisorCount'] == len(zeros), 'residue classification')


def check_nilpotent(data, r):
    a = mat(data['input']); n = len(a); powers = matrix_powers(a, n)
    ranks = [rank(p) for p in powers]
    close(r['powers'], powers, 'nilpotent powers')
    require(ranks[-1] == 0 and r['ranks'] == ranks and r['nullities'] == [n - v for v in ranks], 'nilpotent ranks')
    sizes = r['blockSizes']
    require(sum(sizes) == n and all(isinstance(s, int) and 1 <= s <= n for s in sizes), 'block sizes')
    require(ranks == [sum(max(s - k, 0) for s in sizes) for k in range(n + 1)], 'Jordan block rank certificate')
    require(r['atLeast'] == [sum(s >= k for s in sizes) for k in range(1, n + 1)] and r['blockCounts'] == [sizes.count(k) for k in range(1, n + 1)], 'block counts')
    require(r['nilpotencyIndex'] == next(k for k in range(1, n + 1) if not ranks[k]), 'nilpotency index')


def check_generalized_kernels(data, r):
    a, value = mat(data['input']), q(data['eigenvalue'])
    n = len(a)
    shifted = [[v - value if i == j else v for j, v in enumerate(row)] for i, row in enumerate(a)]
    powers = matrix_powers(shifted, n + 1)
    ranks = [rank(p) for p in powers]
    nullities = [n - v for v in ranks]
    increments = [nullities[k] - nullities[k-1] for k in range(1, n+1)]
    counts = [increments[k] - (increments[k+1] if k+1 < n else 0) for k in range(n)]
    sizes = [k+1 for k in reversed(range(n)) for _ in range(counts[k])]
    require(q(r['eigenvalueExact']) == value, 'selected eigenvalue identity')
    close(r['eigenvalue'], value, 'selected eigenvalue numeric')
    require(exact(r['shiftedExact']) == shifted and exact(r['powersExact']) == powers, 'exact shifted powers')
    close(r['shifted'], shifted, 'shifted drawing matrix')
    close(r['powers'], powers, 'shifted drawing powers')
    require(r['dimension'] == n and r['ranks'] == ranks and r['nullities'] == nullities, 'generalized ranks/nullities')
    require(nullities[n] == nullities[n+1] and r['atLeast'] == increments and r['blockCounts'] == counts and r['blockSizes'] == sizes, 'selected-root block counts')
    require(sum(sizes) == nullities[n] and r['rootSpaceDimension'] == nullities[n] and r['complementDimension'] == ranks[n], 'root/complement dimensions')
    require(r['eigenspaceDimension'] == nullities[1] and r['hasEigenvalue'] is (nullities[1] > 0), 'eigenvalue presence')
    require(r['maxBlockSize'] == max(sizes, default=0) and r['stabilizationPower'] == next(k for k in range(n+1) if nullities[k] == nullities[k+1]), 'kernel stabilization')
    require(r['wholeShiftNilpotent'] is (ranks[n] == 0), 'whole-space nilpotence is separate')


def check_bilinear(data, r):
    a, b = mat(data['input']), mat(data['basis']); c = multiply(multiply(transpose(b), a), b)
    require(det(b) != 0 and exact(r['transformedExact']) == c and r['rank'] == rank(a) and r['transformedRank'] == rank(c), 'congruence')
    symmetric = a == transpose(a)
    require(r['symmetric'] is symmetric, 'symmetric flag')
    if 'point' in data:
        y = [[v] for v in exact(data['point'])]; x = multiply(b, y)
        close(r['values']['oldPoint'], [v[0] for v in x], 'old point')
        close(r['values']['newPoint'], [v[0] for v in y], 'new point')
        value = multiply(multiply(transpose(x), a), x)[0][0]
        require(q(r['values']['oldValueExact']) == value == q(r['values']['newValueExact']), 'quadratic value')
    if len(a) == 2 and symmetric:
        close(r['field']['matrix'], scale(a, 2), 'field factor half')
        close(r['transformedField']['matrix'], scale(c, 2), 'transformed field factor half')


def check_expansion(data, r):
    a = mat(data['input']); n = len(a); axis, index = data.get('axis', 'row'), data.get('index', 0)
    require(len(r['terms']) == n and q(r['determinantExact']) == det(a), 'expanded determinant')
    for k, term in enumerate(r['terms']):
        i, j = (index, k) if axis == 'row' else (k, index)
        minor = [[v for c, v in enumerate(row) if c != j] for s, row in enumerate(a) if s != i]
        d, sign = det(minor), (-1) ** (i + j)
        require((term['row'], term['column'], term['sign']) == (i, j, sign) and exact(term['minorExact']) == minor, 'cofactor position')
        require(q(term['entryExact']) == a[i][j] and q(term['minorDeterminantExact']) == d
                and q(term['cofactorExact']) == sign * d and q(term['valueExact']) == a[i][j] * sign * d, 'cofactor term')
    require(exact(r['cofactorsExact']) == [q(t['cofactorExact']) for t in r['terms']] and exact(r['valuesExact']) == [q(t['valueExact']) for t in r['terms']], 'cofactor arrays')


def check_dual(data, r):
    b = mat(data['basis']); dual = exact(r['dualRowsExact']); n = len(b)
    require(multiply(dual, b) == eye(n) == exact(r['pairingExact']), 'dual pairing')
    if 'vector' in data:
        require(multiply(b, [[v] for v in exact(r['evaluationsExact'])]) == [[v] for v in exact(data['vector'])], 'dual evaluation')
    if n == 2:
        close(r['kernelDirections'], [[row[1], -row[0]] for row in dual], 'dual kernel direction')
        close(r['coordinateScales'], [math.sqrt(sum(float(v) ** 2 for v in row)) for row in dual], 'dual coordinate scales')


def check_inertia(data, r):
    a = mat(data['input']); b, d = exact(r['basisExact']), exact(r['diagonalMatrixExact']); n = len(a)
    require(a == transpose(a) and det(b) != 0 and multiply(multiply(transpose(b), a), b) == d, 'inertia congruence certificate')
    require(all(d[i][j] == 0 for i in range(n) for j in range(n) if i != j), 'diagonal matrix')
    diagonal = [d[i][i] for i in range(n)]
    p, m, z = sum(v > 0 for v in diagonal), sum(v < 0 for v in diagonal), sum(v == 0 for v in diagonal)
    require(exact(r['diagonalExact']) == diagonal and (r['positive'], r['negative'], r['zero'], r['rank']) == (p, m, z, p + m), 'inertia counts')
    for key, expected in {'positiveDefinite': p == n, 'negativeDefinite': m == n, 'positiveSemidefinite': m == 0, 'negativeSemidefinite': p == 0}.items():
        require(r[key] is expected, 'inertia ' + key)
    for step in r['steps']:
        basis = exact(step['basisExact'])
        require(det(basis) != 0 and multiply(multiply(transpose(basis), a), basis) == exact(step['matrixExact']), 'inertia step certificate')


def check_orthogonal(data, r):
    vectors = mat(data['vectors']); n = len(vectors[0]); g = mat(data.get('metric', eye(n)))
    require(g == transpose(g) and all(det([row[:k] for row in g[:k]]) > 0 for k in range(1, n + 1)), 'positive definite metric')
    def pairing(u, v):
        return multiply(multiply([u], g), [[x] for x in v])[0][0]
    basis = exact(r['orthogonalBasisExact']); norms = [pairing(v, v) for v in basis]
    require(len(basis) == rank(vectors) == r['rank'] and all(x > 0 for x in norms), 'orthogonal rank/norms')
    require(exact(r['normSquaresExact']) == norms and exact(r['pairingsExact']) == [[pairing(u, v) for v in basis] for u in basis], 'pairings')
    require(all(pairing(u, v) == 0 for i, u in enumerate(basis) for j, v in enumerate(basis) if i != j), 'orthogonality')
    require(rank(vectors + basis) == len(basis), 'orthogonal span')
    require(exact(r['orthogonalMatrixExact']) == (transpose(basis) if basis else [[] for _ in range(n)]), 'orthogonal column matrix')
    close(r['unitBasis'], [[float(x) / math.sqrt(float(norm)) for x in v] for v, norm in zip(basis, norms)], 'unit basis')
    previous, indices = [], []
    require(len(r['steps']) == len(vectors), 'Gram-Schmidt step count')
    for i, (v, step) in enumerate(zip(vectors, r['steps'])):
        coeff = [pairing(v, u) / pairing(u, u) for u in previous]
        projections = [[c * x for x in u] for c, u in zip(coeff, previous)]
        remainder = [v[j] - sum((p[j] for p in projections), F(0)) for j in range(n)]
        norm = pairing(remainder, remainder)
        require(step['index'] == i and exact(step['originalExact']) == v and exact(step['coefficientsExact']) == coeff
                and exact(step['projectionsExact']) == projections and exact(step['remainderExact']) == remainder
                and q(step['normSquaredExact']) == norm and step['independent'] is (norm != 0), 'Gram-Schmidt step')
        if norm:
            previous.append(remainder); indices.append(i)
    require(previous == basis and indices == r['independentIndices'], 'independent indices')


def check_matrix_polynomial(data, r):
    a, coeff = mat(data['input']), trim(exact(data['coefficients'])); powers = matrix_powers(a, len(coeff) - 1)
    terms, partials, current = [], [], scale(a, 0)
    for c, power in zip(coeff, powers):
        term = scale(power, c); current = add(current, term); terms.append(term); partials.append(current)
    selected = min(data.get('selectedPower', len(coeff) - 1), len(coeff) - 1)
    require(exact(r['coefficientsExact']) == coeff and r['degree'] == (None if coeff == [0] else len(coeff) - 1), 'matrix polynomial coefficients')
    require(exact(r['powersExact']) == powers and exact(r['termsExact']) == terms and exact(r['partialsExact']) == partials, 'matrix polynomial partials')
    require(r['selectedPower'] == selected and exact(r['currentTermExact']) == terms[selected]
            and exact(r['currentExact']) == partials[selected] and exact(r['valueExact']) == current
            and r['isZero'] is zero_matrix(current), 'matrix polynomial value')
    if 'vector' in data:
        require(exact(r['vectorValueExact']) == [v[0] for v in multiply(current, [[v] for v in exact(data['vector'])])], 'polynomial vector value')


def check_minimal(data, r):
    a = mat(data['input']); n = len(a); coeff = exact(r['coefficientsExact']); d = len(coeff) - 1
    require(1 <= d <= n and coeff[-1] == 1 and r['degree'] == d and r['dimension'] == n, 'minimal degree/monic')
    powers = matrix_powers(a, d)
    flat = [[v for row in p for v in row] for p in powers]
    require(rank(flat[:-1]) == d and rank(flat) == d and zero_matrix(peval(a, coeff)) and zero_matrix(exact(r['valueExact'])), 'minimality certificate')
    characteristic = charpoly(a)
    require(exact(r['characteristicCoefficientsExact']) == characteristic and r['characteristicDegree'] == n, 'characteristic polynomial')
    quotient, remainder = pdiv(characteristic, coeff)
    require(remainder == [0] and exact(r['quotientExact']) == quotient and zero_matrix(peval(a, characteristic))
            and zero_matrix(exact(r['characteristicValueExact'])), 'Cayley-Hamilton/divisibility')
    require(r['ranks'] == [rank(flat[:k + 1]) for k in range(d + 1)], 'power dependence ranks')


def complex_q(v):
    return (q(v['re']), q(v['im'])) if isinstance(v, dict) else (q(v), F(0))


def cadd(a, b):
    return a[0] + b[0], a[1] + b[1]


def cmul(a, b):
    return a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]


def conj(a):
    return a[0], -a[1]


def csum(values):
    out = (F(0), F(0))
    for v in values:
        out = cadd(out, v)
    return out


def cexact(v):
    return {'re': v[0], 'im': v[1]}


def check_complex_inner(data, r):
    u, v = [complex_q(x) for x in data['u']], [complex_q(x) for x in data['v']]
    s, slot = complex_q(data.get('scalar', 1)), data['linearSlot']
    require(slot in ('first', 'second'), 'explicit complex convention')
    def terms(a, b):
        return [cmul(x, conj(y)) if slot == 'first' else cmul(conj(x), y) for x, y in zip(a, b)]
    t, bilinear = terms(u, v), [cmul(x, y) for x, y in zip(u, v)]
    scaled = [cmul(s, x) for x in u]
    for key, expected in {'uExact': [cexact(x) for x in u], 'vExact': [cexact(x) for x in v], 'scalarExact': cexact(s),
                          'termsExact': [cexact(x) for x in t], 'innerExact': cexact(csum(t)), 'reverseExact': cexact(csum(terms(v, u))),
                          'bilinearWithoutConjugationExact': cexact(csum(bilinear)), 'scaledInnerExact': cexact(csum(terms(scaled, v)))}.items():
        require(exact(r[key]) == expected, 'complex ' + key)
    require(r['linearSlot'] == slot and q(r['normUSquaredExact']) == sum(x[0] ** 2 + x[1] ** 2 for x in u)
            and q(r['normVSquaredExact']) == sum(x[0] ** 2 + x[1] ** 2 for x in v), 'complex norm/convention')
    for key, expected in {'uPoints': u, 'vPoints': v, 'conjugatedUPoints': [conj(x) for x in u], 'termPoints': t,
                          'innerPoint': csum(t), 'bilinearTermPoints': bilinear, 'scaledUPoints': scaled}.items():
        close(r[key], [list(x) for x in expected] if key != 'innerPoint' else list(expected), 'complex points ' + key)
    close(r['scaledU'], [cexact(x) for x in scaled], 'scaled complex vector')


def check_complex_operator(data, r):
    a = [[complex_q(v) for v in row] for row in data['input']]; n = len(a)
    t = transpose(a); adj = [[conj(v) for v in row] for row in t]
    def product(a, b):
        return [[csum(cmul(a[i][k], b[k][j]) for k in range(n)) for j in range(n)] for i in range(n)]
    left, right = product(adj, a), product(a, adj)
    for key, expected in {'input': a, 'transpose': t, 'adjoint': adj, 'adjointProduct': left, 'reverseAdjointProduct': right, 'transposeProduct': product(t, a)}.items():
        parts = r[key]
        require(exact(parts['exact']) == [[cexact(v) for v in row] for row in expected], 'complex matrix ' + key)
        close(parts['real'], [[v[0] for v in row] for row in expected], key + ' real')
        close(parts['imaginary'], [[v[1] for v in row] for row in expected], key + ' imaginary')
    identity = [[(F(i == j), F(0)) for j in range(n)] for i in range(n)]
    for key, expected in {'unitary': left == identity and right == identity, 'hermitian': a == adj, 'normal': left == right}.items():
        require(r[key] is expected and r[key + 'Indicator'] == int(expected), 'complex flag ' + key)


def tensor_matrix(value):
    require(isinstance(value, list) and value and isinstance(value[0], list) and value[0], 'tensor matrix shape')
    rows, cols = len(value), len(value[0])
    require(rows * cols <= 4096 and all(isinstance(row, list) and len(row) == cols for row in value), 'tensor matrix bound/shape')
    require(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for row in value for v in row), 'tensor finite numeric input')
    return exact(value)


def check_exact_product(data, result):
    a, b = mat(data['a']), mat(data['b'])
    output = multiply(a, b)
    require(exact(result['aExact']) == a and exact(result['bExact']) == b, 'exact product input echo')
    require(exact(result['outputExact']) == output, 'exact matrix product')
    for key, expected in {'a': a, 'b': b, 'output': output}.items():
        close(result[key], expected, 'exact product numeric ' + key)
    for key, shape in {'leftShape': [len(a), len(a[0])], 'rightShape': [len(b), len(b[0])], 'outputShape': [len(a), len(b[0])]}.items():
        require(result[key] == shape and all(type(v) is int for v in result[key]), 'exact product ' + key)


def check_matmul(data, result):
    a, b = tensor_matrix(data['a']), tensor_matrix(data['b'])
    require(len(a[0]) == len(b) and len(a) * len(b[0]) * len(b) <= 262144, 'matmul dimensions/bound')
    close(result['output'], multiply(a, b), 'matmul output')


def check_dense(data, result):
    # Fraction sums are independent of the renderer's JavaScript reduction.
    # The tensor kernel has larger bounds than the small algebra matrices.
    a, w = tensor_matrix(data['input']), tensor_matrix(data['weights'])
    m, k, n = len(a), len(a[0]), len(w[0])
    require(len(w) == k and m * n * k <= 262144, 'dense product dimensions/bound')
    bias = data.get('bias', 0)
    bias = [bias] * n if isinstance(bias, (int, float)) and not isinstance(bias, bool) else bias
    require(isinstance(bias, list) and len(bias) == n and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in bias), 'dense bias shape/type')
    bias = exact(bias)
    activation = data.get('activation', 'linear')
    require(activation in ('linear', 'relu', 'sigmoid', 'tanh') and result['activation'] == activation, 'dense activation echo')
    pre = [[sum((a[i][j] * w[j][c] for j in range(k)), F(0)) + bias[c] for c in range(n)] for i in range(m)]
    def activated(value):
        if activation == 'linear': return value
        if activation == 'relu': return max(F(0), value)
        value = float(value)
        require(math.isfinite(value), 'dense preactivation overflow')
        if activation == 'tanh': return math.tanh(value)
        # Stable sigmoid evaluated independently by Python's math library.
        return 1 / (1 + math.exp(-value)) if value >= 0 else math.exp(value) / (1 + math.exp(value))
    for key, expected in {'input': a, 'weights': w, 'bias': bias, 'preactivation': pre,
                          'output': [[activated(v) for v in row] for row in pre]}.items():
        close(result[key], expected, 'dense ' + key)
    for key, expected in {'inputShape': [m, k], 'weightShape': [k, n], 'outputShape': [m, n]}.items():
        require(result[key] == expected and all(type(v) is int for v in result[key]), 'dense ' + key)


CHECKS = {'exact-matrix-product': check_exact_product, 'matmul': check_matmul, 'dense': check_dense, 'exact-row-reduction': check_rows, 'change-basis': check_change, 'polynomial-divide': check_divide,
          'polynomial-gcd': check_gcd, 'residue-table': check_residue, 'nilpotent-profile': check_nilpotent,
          'generalized-kernel-profile': check_generalized_kernels,
          'bilinear-congruence': check_bilinear, 'determinant-expansion': check_expansion, 'dual-basis': check_dual,
          'symmetric-inertia': check_inertia, 'orthogonalize': check_orthogonal, 'matrix-polynomial': check_matrix_polynomial,
          'minimal-polynomial': check_minimal, 'complex-inner-product': check_complex_inner, 'complex-operator': check_complex_operator}


def input_echoes(operation, data, result):
    # These outputs are often drawn beside the result; verify they still refer
    # to the resolved input, including trimmed polynomial coefficient lists.
    for key in ('input', 'sourceBasis', 'targetBasis', 'vector', 'basis', 'vectors', 'metric', 'dividend', 'divisor', 'a', 'b', 'coefficients'):
        if key not in data or key not in result or (operation == 'complex-operator' and key == 'input'):
            continue
        expected = exact(data[key])
        if operation in ('polynomial-divide', 'polynomial-gcd', 'matrix-polynomial') and key in ('dividend', 'divisor', 'a', 'b', 'coefficients'):
            expected = trim(expected)
        close(result[key], expected, 'input echo ' + key)
        if key + 'Exact' in result:
            require(exact(result[key + 'Exact']) == expected, 'exact input echo ' + key)


def audit(document):
    findings, unsupported, seen = [], {}, set()
    counts = {'states': 0, 'legacyStates': 0, 'recordedCalculations': 0, 'uniqueCalculations': 0, 'verifiedCalculations': 0,
              'unsupportedCalculations': 0, 'statesWithoutCalculations': 0}
    for state in document.get('states', []):
        counts['states'] += 1
        pose = {k: state.get(k) for k in ('id', 'width', 'progress', 'kind')}
        rows = state.get('calculations', [])
        version = state.get('calculationTraceVersion', 0)
        if version not in (1, 2):
            counts['legacyStates'] += 1
            continue
        if state.get('error'):
            findings.append({**pose, 'problem': 'frame-error', 'error': state['error']})
        if not isinstance(rows, list) or len(rows) > 1024:
            findings.append({**pose, 'problem': 'invalid-trace'})
            continue
        declarations = state.get('declarations')
        declared_rows = rows if version == 1 else [r for r in rows if r.get('origin') == 'compose']
        if declarations is not None and [{'id': r.get('id'), 'operation': r.get('operation')} for r in declared_rows] != declarations:
            findings.append({**pose, 'problem': 'missing-or-reordered-calculations'})
        if not rows:
            counts['statesWithoutCalculations'] += 1
        for row in rows:
            counts['recordedCalculations'] += 1
            stable = {k: v for k, v in row.items() if k != 'cacheHit'}
            key = hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            if key in seen:
                continue
            seen.add(key); counts['uniqueCalculations'] += 1
            op = row.get('operation')
            if op not in CHECKS:
                counts['unsupportedCalculations'] += 1
                unsupported[op] = unsupported.get(op, 0) + 1
                continue
            try:
                require(isinstance(row.get('inputs'), dict) and isinstance(row.get('result'), dict), 'calculation input/result object')
                CHECKS[op](row['inputs'], row['result'])
                input_echoes(op, row['inputs'], row['result'])
                numeric_pairs(row['result'])
                counts['verifiedCalculations'] += 1
            except (ValueError, KeyError, TypeError, IndexError, ZeroDivisionError, OverflowError) as error:
                findings.append({**pose, 'problem': 'calculation-certificate', 'calculation': row.get('id'), 'operation': op, 'error': str(error)})
    return {'status': 'passed' if not findings else 'failed', 'counts': counts, 'unsupportedOperations': unsupported,
            'findings': findings, 'supportedOperations': sorted(CHECKS),
            'scope': 'Independent finite algebra certificates and numeric/exact agreement for recorded synchronous compute calls and exported algebra-kernel calls. Unsupported operations, legacy runtime, opaque custom math, source-to-figure meaning, general theorems and artistic quality are unverified.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Refuse to overwrite a calculation audit')
    raw = args.input.read_bytes(); started = time.monotonic()
    result = audit(json.loads(raw))
    result.update(inputSha256=hashlib.sha256(raw).hexdigest(), elapsedSeconds=time.monotonic() - started)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('status', 'counts', 'unsupportedOperations')}, ensure_ascii=False))
    raise SystemExit(0 if not result['findings'] else 1)


if __name__ == '__main__':
    main()
