"""Produce bounded secondary ASR alternatives for flagged spans; never overwrite originals."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['course','transcripts','audit','output']:p.add_argument(name,type=Path)
    p.add_argument('--model',type=Path,required=True);p.add_argument('--model-pin',type=Path,required=True)
    p.add_argument('--max-spans',type=int,default=3);p.add_argument('--pages',default='');p.add_argument('--context-seconds',type=float,default=18)
    p.add_argument('--device',choices=['cpu','cuda'],default='cpu');p.add_argument('--compute-type',default='int8');p.add_argument('--threads',type=int,default=6)
    p.add_argument('--skip-repairs',type=Path,help='Reuse exact source-matched immutable alternatives from an index')
    a=p.parse_args();out=a.output.resolve()
    if not out.is_relative_to((ROOT/'work').resolve()) or out.exists() or not 1<=a.max_spans<=2048 or not 0<=a.context_seconds<=60:p.error('Use fresh ignored output and explicit bounded span count/context')
    course=a.course.resolve();audit=json.loads(a.audit.read_text());pages={int(x) for x in a.pages.split(',') if x}
    spans=[(part,row) for part in audit['parts'] if not pages or part['page'] in pages for row in part['findings'] if row['anchor'] and 'possible-video-boilerplate' in row['reasons']][:a.max_spans]
    if a.skip_repairs:
        existing={}
        manifest_path=a.skip_repairs/'manifest.json'
        if manifest_path.exists():
            for entry in json.loads(manifest_path.read_text())['entries']:
                path=a.skip_repairs/entry['file']
                if sha(path)!=entry['sha256']:raise ValueError('Indexed repair was modified')
                existing[entry['anchor']]=entry
        spans=[(part,row) for part,row in spans if row['anchor'] not in existing or existing[row['anchor']]['transcriptSha256']!=part['transcriptSha256']]
    out.mkdir(parents=True);modelpin=json.loads(a.model_pin.read_text())
    settings={'auditSha256':sha(a.audit),'model':modelpin,'modelWeights':{f.name:sha(f) for f in a.model.glob('*') if f.is_file()},'device':a.device,'computeType':a.compute_type,'contextSeconds':a.context_seconds,'beamSize':5,'language':'zh','vadFilter':True,'wordTimestamps':True,'conditionOnPreviousText':False,'hallucinationSilenceThreshold':2,'threads':a.threads,'packages':{n:importlib.metadata.version(n) for n in ['faster-whisper','ctranslate2','av']},'toolSha256':sha(Path(__file__))}
    save(out/'settings.json',settings)
    if not spans:
        save(out/'manifest.json',{'settingsSha256':sha(out/'settings.json'),'spans':0,'records':[],'scope':'No new flagged spans; previous source-matched alternatives stay separate.'});print('No new spans',flush=True);return
    from faster_whisper import WhisperModel
    model=WhisperModel(str(a.model.resolve()),device=a.device,compute_type=a.compute_type,cpu_threads=a.threads,num_workers=1)
    records=[]
    for part,row in spans:
        page=part['page'];sourcefile=a.transcripts/f'p{page:03d}.json'
        if sha(sourcefile)!=part['transcriptSha256']:raise ValueError('Audit no longer matches immutable transcript')
        raw=json.loads(sourcefile.read_text());media=json.loads((course/'parts'/f'p{page:03d}.json').read_text());audio=course/media['path']
        if sha(audio)!=media['sha256']:raise ValueError('Audio source changed')
        start=max(0,row['start']-a.context_seconds);end=min(raw['duration'],row['end']+a.context_seconds);clip=out/(row['anchor']+'.wav')
        subprocess.run(['ffmpeg','-v','error','-nostdin','-ss',str(start),'-t',str(end-start),'-i',str(audio),'-ac','1','-ar','16000',str(clip)],check=True)
        begin=time.monotonic();segments,info=model.transcribe(str(clip),language='zh',beam_size=5,vad_filter=True,word_timestamps=True,condition_on_previous_text=False,hallucination_silence_threshold=2,
          initial_prompt='高等代数课堂。未知量、线性方程组、系数矩阵、增广矩阵、线性空间、线性映射、行列式、多项式、内积。')
        alternative=[{'start':s.start+start,'end':s.end+start,'text':s.text,'avg_logprob':s.avg_logprob,'no_speech_prob':s.no_speech_prob} for s in segments]
        record={'page':page,'anchor':row['anchor'],'original':row,'contextStart':start,'contextEnd':end,'audioSha256':media['sha256'],'clipSha256':sha(clip),'transcriptSha256':sha(sourcefile),'settingsSha256':sha(out/'settings.json'),'alternative':alternative,'elapsedSeconds':round(time.monotonic()-begin,3),'boilerplateRemains':any(re.search(r'中文字幕|点赞|订阅|打赏|投币|字幕提供',s['text']) for s in alternative),'status':'unreviewed-alternative','scope':'Secondary ASR is evidence to inspect, not automatically accepted true speech or recovered teacher proof.'}
        save(out/(row['anchor']+'.json'),record);records.append(record)
        print(json.dumps({'anchor':row['anchor'],'seconds':record['elapsedSeconds'],'segments':len(alternative),'boilerplateRemains':record['boilerplateRemains']}),flush=True)
    save(out/'manifest.json',{'settingsSha256':sha(out/'settings.json'),'spans':len(records),'records':[r['anchor']+'.json' for r in records],'scope':'Unreviewed secondary alternatives; original ASR remains frozen.'})
if __name__=='__main__':main()
