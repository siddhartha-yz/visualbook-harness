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


if __name__ == '__main__':
    unittest.main()
