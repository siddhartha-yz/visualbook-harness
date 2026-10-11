"""Append immutable secondary-ASR evidence; conflicting alternatives require explicit triage."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def index(output, sources):
    output.mkdir(parents=True,exist_ok=True)
    for source in sources:
        manifest=json.loads((source/'manifest.json').read_text())
        for name in manifest['records']:
            original=(source/name).resolve()
            if not original.is_relative_to(source.resolve()):raise ValueError('Repair path leaves batch')
            data=json.loads(original.read_text());anchor=data['anchor']
            if not re.fullmatch(r'p\d{3}-s\d{3}',anchor):raise ValueError('Invalid original anchor')
            target=output/(anchor+'.json')
            if target.exists() and sha(target)!=sha(original):raise ValueError('Conflicting alternative: preserve both batches and triage explicitly')
            if not target.exists():target.write_bytes(original.read_bytes())
    entries=[]
    for path in sorted(output.glob('p[0-9][0-9][0-9]-s[0-9][0-9][0-9].json')):
        data=json.loads(path.read_text());entries.append({'file':path.name,'sha256':sha(path),'anchor':data['anchor'],'page':data['page'],'transcriptSha256':data['transcriptSha256'],'audioSha256':data['audioSha256'],'status':data['status']})
    record={'records':[e['file'] for e in entries],'entries':entries,'spans':len(entries),'scope':'Immutable unreviewed alternatives, not certified speech recovery. Manifest may append entries; existing record bytes cannot change.'}
    temporary=output/'manifest.pending.json';temporary.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');os.replace(temporary,output/'manifest.json')
    return record

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);p.add_argument('batches',type=Path,nargs='+');a=p.parse_args()
    root=Path(__file__).resolve().parents[1]
    if not a.output.resolve().is_relative_to((root/'work').resolve()):p.error('Use ignored output')
    r=index(a.output.resolve(),a.batches);print(json.dumps({'indexedSpans':r['spans']}))
if __name__=='__main__':main()
