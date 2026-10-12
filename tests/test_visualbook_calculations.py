"""Directional controls for recorded math gates, not implementation mirrors."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('calculation_audit', Path(__file__).resolve().parents[1] / 'tools/check_visualbook_calculations.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class RecordedCalculationTests(unittest.TestCase):
    def base(self):
        return {'states': [{'id': 'ring', 'width': 375, 'progress': 0,
                 'calculationTraceVersion': 1, 'declarations': [{'id': 'c', 'operation': 'residue-table'}],
                 'calculations': [{'id': 'c', 'operation': 'residue-table', 'inputs': {'modulus': 2},
                 'result': {'data': [[0, 0], [0, 1]], 'units': [1], 'zeroDivisors': [], 'isField': True, 'zeroDivisorCount': 0}}]}]}

    def test_false_classification_is_blocked_even_when_table_is_right(self):
        good = self.base(); self.assertEqual(module.audit(good)['counts']['verifiedCalculations'], 1)
        bad = copy.deepcopy(good); bad['states'][0]['calculations'][0]['result']['isField'] = False
        result = module.audit(bad)
        self.assertEqual(result['status'], 'failed'); self.assertEqual(result['counts']['verifiedCalculations'], 0)

    def test_second_changed_result_is_not_deduplicated_by_input(self):
        value = self.base(); other = copy.deepcopy(value['states'][0])
        other['progress'] = 1; other['calculations'][0]['result']['data'][1][1] = 0
        value['states'].append(other); result = module.audit(value)
        self.assertEqual(result['counts']['uniqueCalculations'], 2)
        self.assertEqual(len(result['findings']), 1)

    def test_missing_trace_blocks_new_runtime_and_legacy_is_explicit(self):
        value = self.base(); value['states'][0]['calculations'] = []
        self.assertEqual(module.audit(value)['status'], 'failed')
        value['states'][0]['calculationTraceVersion'] = 0
        result = module.audit(value)
        self.assertEqual(result['status'], 'passed'); self.assertEqual(result['counts']['legacyStates'], 1)
        self.assertEqual(result['counts']['verifiedCalculations'], 0)

    def test_unsupported_operation_is_not_counted_as_verified(self):
        value = self.base(); state = value['states'][0]
        state['declarations'][0]['operation'] = state['calculations'][0]['operation'] = 'sampling'
        result = module.audit(value)
        self.assertEqual(result['counts']['verifiedCalculations'], 0)
        self.assertEqual(result['unsupportedOperations'], {'sampling': 1})

    def test_numeric_drawing_must_match_exact_certificate(self):
        module.numeric_pairs({'value': [[0.5]], 'valueExact': [['1/2']]})
        with self.assertRaisesRegex(ValueError, 'value'):
            module.numeric_pairs({'value': [[2]], 'valueExact': [['1/2']]})

    def test_affine_output_bias_and_echo_cannot_disagree(self):
        # Synthetic course-like scalar parameter -> two affine outputs.
        row = {'id': 'c', 'operation': 'dense', 'inputs': {'input': [[2]], 'weights': [[3, -1]], 'bias': [1, 4]},
               'result': {'input': [[2]], 'weights': [[3, -1]], 'bias': [1, 4], 'activation': 'linear',
                          'preactivation': [[7, 2]], 'output': [[7, 2]], 'inputShape': [1, 1], 'weightShape': [1, 2], 'outputShape': [1, 2]}}
        document = {'states': [{'calculationTraceVersion': 2, 'calculations': [row]}]}
        self.assertEqual(module.audit(document)['counts']['verifiedCalculations'], 1)
        for key, value in [('output', [[6, 2]]), ('bias', [0, 4]), ('weights', [[2, -1]]), ('outputShape', [2, 1]), ('activation', 'relu')]:
            bad = copy.deepcopy(document); bad['states'][0]['calculations'][0]['result'][key] = value
            self.assertEqual(module.audit(bad)['status'], 'failed', key)

    def test_relu_changes_output_and_bad_dimension_never_passes(self):
        row = {'id': 'c', 'operation': 'dense', 'inputs': {'input': [[-2, 1]], 'weights': [[1], [1]], 'activation': 'relu'},
               'result': {'input': [[-2, 1]], 'weights': [[1], [1]], 'bias': [0], 'activation': 'relu',
                          'preactivation': [[-1]], 'output': [[0]], 'inputShape': [1, 2], 'weightShape': [2, 1], 'outputShape': [1, 1]}}
        document = {'states': [{'calculationTraceVersion': 2, 'calculations': [row]}]}
        self.assertEqual(module.audit(document)['counts']['verifiedCalculations'], 1)
        row['inputs']['weights'] = [[1]]
        self.assertEqual(module.audit(document)['status'], 'failed')

    def test_exact_decimal_cancellation_requires_the_zero_certificate(self):
        row = {'id': 'c', 'operation': 'exact-matrix-product',
               'inputs': {'a': [[.1, .3], [.2, .6]], 'b': [[1, -3], [0, 1]]},
               'result': {'a': [[.1, .3], [.2, .6]], 'aExact': [['1/10', '3/10'], ['1/5', '3/5']],
                          'b': [[1, -3], [0, 1]], 'bExact': [['1', '-3'], ['0', '1']],
                          'output': [[.1, 0], [.2, 0]], 'outputExact': [['1/10', '0'], ['1/5', '0']],
                          'leftShape': [2, 2], 'rightShape': [2, 2], 'outputShape': [2, 2]}}
        document = {'states': [{'calculationTraceVersion': 2, 'calculations': [row]}]}
        self.assertEqual(module.audit(document)['counts']['verifiedCalculations'], 1)
        bad = copy.deepcopy(document); bad['states'][0]['calculations'][0]['result']['outputExact'][0][1] = '1/1000000000000'
        self.assertEqual(module.audit(bad)['status'], 'failed')
        bad = copy.deepcopy(document); del bad['states'][0]['calculations'][0]['result']['output']
        self.assertEqual(module.audit(bad)['status'], 'failed')

    def test_matrix_products_do_not_accept_a_relabelled_or_misshaped_output(self):
        # A genuine zero-relation witness from this course: the t column vanishes.
        row = {'id': 'c', 'operation': 'matmul',
               'inputs': {'a': [[1, 0, 1], [0, 1, 1]], 'b': [[2, -1], [3, -1], [0, 1]]},
               'result': {'output': [[2, 0], [3, 0]]}}
        document = {'states': [{'calculationTraceVersion': 2, 'calculations': [row]}]}
        self.assertEqual(module.audit(document)['counts']['verifiedCalculations'], 1)
        for output in [[[2, 1], [3, 0]], [[2, 0, 0], [3, 0, 0]], [[2], [3]]]:
            bad = copy.deepcopy(document); bad['states'][0]['calculations'][0]['result']['output'] = output
            self.assertEqual(module.audit(bad)['status'], 'failed')
        row['inputs']['b'] = [[2, -1], [3, -1]]
        self.assertEqual(module.audit(document)['status'], 'failed')

    def test_root_component_is_not_the_whole_space_and_changes_cannot_hide(self):
        # Directional synthetic diagonal fixture: only one of two dimensions
        # belongs to lambda2; the other contributes rank1 at every positive power.
        result = {'input': [[2, 0], [0, 5]], 'inputExact': [['2', '0'], ['0', '5']],
                  'eigenvalue': 2, 'eigenvalueExact': '2', 'dimension': 2,
                  'shifted': [[0, 0], [0, 3]], 'shiftedExact': [['0', '0'], ['0', '3']],
                  'powers': [[[1, 0], [0, 1]], [[0, 0], [0, 3]], [[0, 0], [0, 9]], [[0, 0], [0, 27]]],
                  'powersExact': [[['1', '0'], ['0', '1']], [['0', '0'], ['0', '3']], [['0', '0'], ['0', '9']], [['0', '0'], ['0', '27']]],
                  'ranks': [2, 1, 1, 1], 'nullities': [0, 1, 1, 1],
                  'atLeast': [1, 0], 'blockCounts': [1, 0], 'blockSizes': [1],
                  'hasEigenvalue': True, 'eigenspaceDimension': 1, 'rootSpaceDimension': 1,
                  'complementDimension': 1, 'maxBlockSize': 1, 'stabilizationPower': 1,
                  'wholeShiftNilpotent': False}
        document = {'states': [{'id': 'synthetic-root', 'calculationTraceVersion': 2,
                    'calculations': [{'id': 'c', 'operation': 'generalized-kernel-profile',
                    'inputs': {'input': [[2, 0], [0, 5]], 'eigenvalue': 2}, 'result': result}]}]}
        self.assertEqual(module.audit(document)['counts']['verifiedCalculations'], 1)
        for key, value in [('wholeShiftNilpotent', True), ('blockSizes', [2]), ('eigenvalueExact', '5')]:
            bad = copy.deepcopy(document)
            bad['states'][0]['calculations'][0]['result'][key] = value
            audit = module.audit(bad)
            self.assertEqual(audit['status'], 'failed', key)
            self.assertEqual(audit['counts']['verifiedCalculations'], 0, key)


if __name__ == '__main__':
    unittest.main()
