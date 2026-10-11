"""Sequential GPU source workflow: bounded primary chunks, targeted alternatives, immutable index.

This coordinates local decoding only. It does not create model agents, certify
ASR accuracy or silently replace the original speech recognition.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('course',type=Path);p.add_argument('output',type=Path)
    for name in ['primary-model','primary-pin','repair-model','repair-pin']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--chunk-parts',type=int,default=32);p.add_argument('--max-parts',type=int,default=32)
    a=p.parse_args();course=a.course.resolve();out=a.output.resolve()
    if not out.is_relative_to((ROOT/'work').resolve()) or not 1<=a.chunk_parts<=64 or not 1<=a.max_parts<=512:p.error('Use ignored output and bounded source range')
    pages=json.loads((course/'course.json').read_text())['pages']
    if len(pages)>a.max_parts:p.error('Course exceeds explicit part budget')
    out.mkdir(parents=True,exist_ok=True);transcripts=out/'transcripts-large';repairs=out/'asr-repairs';runs=out/'source-workflow';runs.mkdir(exist_ok=True)
    tools=['transcribe_course.py','audit_course_transcripts.py','repair_course_transcripts.py','index_course_repairs.py','run_course_transcription.py']
    tool_hashes={name:sha(ROOT/'tools'/name) for name in tools}
    def run(name,arguments,directory):
        if any(sha(ROOT/'tools'/key)!=value for key,value in tool_hashes.items()):raise ValueError('Source tool changed during workflow; freeze a new run before continuing')
        command=[sys.executable,str(ROOT/'tools'/name),*map(str,arguments)]
        started=time.monotonic()
        with (directory/(name+'.log')).open('w') as log:r=subprocess.run(command,stdout=log,stderr=log)
        save(directory/(name+'.process.json'),{'command':command,'exitCode':r.returncode,'elapsedSeconds':round(time.monotonic()-started,3),'toolSha256':tool_hashes[name]})
        if r.returncode:raise ValueError(name+' failed; original logs retained, no blind retry')
    for first in range(1,len(pages)+1,a.chunk_parts):
        last=min(len(pages),first+a.chunk_parts-1);directory=runs/f'p{first:03d}-{last:03d}-{time.time_ns()}';directory.mkdir()
        save(directory/'identity.json',{'courseSha256':sha(course/'course.json'),'first':first,'last':last,'primaryPinSha256':sha(a.primary_pin),'repairPinSha256':sha(a.repair_pin),'toolHashes':tool_hashes,'maxParts':a.max_parts})
        run('transcribe_course.py',[course,transcripts,'--model',a.primary_model.resolve(),'--model-pin',a.primary_pin.resolve(),'--start',first,'--end',last,'--batch-size',8],directory)
        run('audit_course_transcripts.py',[transcripts,directory/'audit.json'],directory)
        run('repair_course_transcripts.py',[course,transcripts,directory/'audit.json',directory/'alternatives','--model',a.repair_model.resolve(),'--model-pin',a.repair_pin.resolve(),'--max-spans',2048,'--pages',','.join(map(str,range(first,last+1))),'--device','cuda','--compute-type','float16','--skip-repairs',repairs],directory)
        run('index_course_repairs.py',[repairs,directory/'alternatives'],directory)
        print(json.dumps({'sourceChunk':[first,last],'partsReady':sum((transcripts/f"p{row['page']:03d}.json").exists() for row in pages),'repairSpans':json.loads((repairs/'manifest.json').read_text())['spans']}),flush=True)
    identities=[]
    for row in pages:
        path=transcripts/f"p{row['page']:03d}.json";record=json.loads(path.read_text())
        if record['page']!=row['page'] or record['cid']!=row['cid']:raise ValueError('Final transcript topology changed')
        identities.append({'page':row['page'],'cid':row['cid'],'transcriptSha256':sha(path),'inputSha256':record['inputSha256'],'duration':record['duration'],'settingsSha256':record['settingsSha256']})
    save(out/'source-manifest.json',{'courseSha256':sha(course/'course.json'),'parts':identities,'repairIndexSha256':sha(repairs/'manifest.json'),'totalExpectedHours':sum(r['duration'] for r in pages)/3600,'scope':'Complete source ingestion/decoding range with retained alternatives; no guarantee of verbatim accuracy or teacher-proof fidelity.'})
    print('Complete source manifest',flush=True)
if __name__=='__main__':main()
