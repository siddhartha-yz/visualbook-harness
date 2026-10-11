"""Flag transcription defects without rewriting speech or treating confidence as accuracy."""
import argparse
import hashlib
import json
from pathlib import Path
import re

PATTERNS = {
    'possible-video-boilerplate': r'字幕(?:提供|制作|志愿者|由)|中文字幕|点赞|點贊|订阅|訂閱|打赏|打賞|投币|Amara|字幕组',
    'replacement-character': '\ufffd',
    'long-phrase-repetition': r'(.{8,40})\1{2,}',
}

def audit(record):
    findings=[];previous=0
    for row in record['segments']:
        reasons=[name for name,pattern in PATTERNS.items() if re.search(pattern,row['text'],re.I)]
        if row['end']<row['start'] or row['start']<0 or row['end']>record['duration']+2:reasons.append('invalid-time')
        if row['start']-previous>45:reasons.append('long-coverage-gap')
        previous=max(previous,row['end'])
        if reasons:findings.append({'anchor':row['anchor'],'start':row['start'],'end':row['end'],'text':row['text'],'reasons':reasons})
    if record['duration']-previous>45:findings.append({'anchor':None,'start':previous,'end':record['duration'],'text':'','reasons':['long-tail-gap']})
    return findings

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('transcripts',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    root=Path(__file__).resolve().parents[1]
    if not a.output.resolve().is_relative_to((root/'work').resolve()):p.error('Keep raw source audit in ignored work/')
    files=sorted(a.transcripts.glob('p[0-9][0-9][0-9].json'));rows=[]
    for path in files:
        r=json.loads(path.read_text());rows.append({'page':r['page'],'transcriptSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'segmentCount':len(r['segments']),'findings':audit(r)})
    result={'completedParts':len(files),'flaggedParts':sum(bool(r['findings']) for r in rows),'findingCount':sum(len(r['findings']) for r in rows),'parts':rows,'scope':'Heuristic flags for review/secondary ASR, not verified speech errors or word-error accuracy. Original transcript is untouched.'}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='parts'}))
if __name__=='__main__':main()
