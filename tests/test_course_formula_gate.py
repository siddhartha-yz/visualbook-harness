"""Synthetic subprocess protocol controls, no author/model/browser call."""
import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('course_writer',ROOT/'tools/write_course_textbook.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.ROOT=ROOT
class Protocol(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='synthetic-formula-protocol-',dir=ROOT/'work')
  self.job=Path(self.temp.name);(self.job/'chapter.md').write_text('# Synthetic\n\n$x^2$.\n')
  self.answer={'ready':True,'modelCalls':0,'chapterSha256':m.sha(self.job/'chapter.md'),'formulasExpected':1,'formulasRendered':1,'findings':[]}
 def tearDown(self):self.temp.cleanup()
 def run_response(self,answer=None,code=0):
  with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],code,json.dumps(self.answer if answer is None else answer),'')) as call:
   result=m.check_formula_preflight(self.job,timeout=9)
   self.assertEqual(call.call_args.kwargs['timeout'],9)
   self.assertEqual(call.call_args.args[0][0],'node')
   self.assertTrue(Path(result['reportPath']).exists())
   self.assertEqual(m.sha(Path(result['reportPath'])),result['reportSha256'])
   return result
 def test_success_retains_hashes_and_each_attempt(self):
  first=self.run_response();second=self.run_response();self.assertTrue(first['ready']);self.assertNotEqual(first['reportPath'],second['reportPath']);self.assertTrue(Path(first['reportPath']).exists())
 def test_malformed_and_nonobject_fail_closed(self):
  for answer in [[],None,'string',5]:
   value=[] if answer is None else answer
   self.assertFalse(self.run_response(value)['ready'])
 def test_missing_hash_and_model_calls_fail_closed(self):
  for change in [{'chapterSha256':'different'},{'modelCalls':1},{'modelCalls':False},{'ready':'true'},{'findings':None}]:
   self.assertFalse(self.run_response({**self.answer,**change})['ready'])
 def test_nonzero_and_negative_response_rejected(self):
  self.assertFalse(self.run_response(code=2)['ready']);self.assertFalse(self.run_response({**self.answer,'ready':False,'findings':['real renderer rejection']},2)['ready'])
 def test_counts_and_positive_findings_rejected(self):
  for change in [{'formulasRendered':0},{'formulasExpected':True},{'formulasExpected':-1},{'formulasExpected':1.0},{'formulasExpected':100001,'formulasRendered':100001},{'findings':['contradiction']}]:
   self.assertFalse(self.run_response({**self.answer,**change})['ready'])
 def test_invalid_json_and_timeout_recorded(self):
  for outcome in ['bad-json','timeout','os-error']:
   with patch.object(m.subprocess,'run') as call:
    if outcome=='bad-json':call.return_value=subprocess.CompletedProcess([],0,'{','')
    elif outcome=='timeout':call.side_effect=subprocess.TimeoutExpired(['node'],9)
    else:call.side_effect=FileNotFoundError('synthetic missing runtime')
    result=m.check_formula_preflight(self.job,timeout=9)
   self.assertFalse(result['ready']);self.assertTrue(Path(result['reportPath']).exists())
 def test_input_mutation_rejected(self):
  def mutate(*args,**kwargs):
   (self.job/'chapter.md').write_text('Changed synthetic fixture')
   return subprocess.CompletedProcess([],0,json.dumps(self.answer),'')
  with patch.object(m.subprocess,'run',side_effect=mutate):result=m.check_formula_preflight(self.job)
  self.assertFalse(result['ready']);self.assertIn('chapter-changed-during-formula-preflight',result['findings'])
if __name__=='__main__':unittest.main()
