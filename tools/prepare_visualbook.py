"""Import and freeze every chapter before starting any paid author session.
Ordinary Markdown manifests and imported source JSON are accepted. This is input
preparation, not generation, browser validation or a quality review.
"""
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

class MathCoverage(HTMLParser):
    def __init__(self):
        super().__init__();self.rendered=0;self.errors=0
    def handle_starttag(self,tag,attrs):
        classes=dict(attrs).get('class','').split()
        self.rendered+=int('katex' in classes);self.errors+=int('katex-error' in classes)

def check_compiled_math(data):
    total=0
    for block in data['blocks']:
        expected=block.get('math',{}).get('expected',0)
        if type(expected) is not int or expected<0:raise ValueError('Source formula count must be a nonnegative integer')
        coverage=MathCoverage();coverage.feed(block['html'])
        if coverage.errors or coverage.rendered!=expected:raise ValueError('Imported formula coverage mismatch at '+block['id'])
        total+=expected
    return total

def prepare(input_file, output, *, max_chapters=3, source_url='', source_name='输入教材', split_level=None):
    input_file=input_file.resolve();output=output.resolve();output.mkdir(parents=True,exist_ok=True)
    attempts=output/'preparation';attempts.mkdir(exist_ok=True)
    attempt=attempts/f'attempt-{len(list(attempts.glob("attempt-*")))+1:03d}';attempt.mkdir()
    report={'status':'preparing','input':str(input_file),'modelCalls':0,'records':[],
            'scope':'Source import, formula coverage and frozen input identity; no model generation, render or art review.'}
    def record():save(attempt/'report.json',report)
    record()
    try:
        preimported={}
        if split_level is not None:
            if split_level not in [2,3] or input_file.suffix.lower()!='.md':
                raise ValueError('Title partitioning requires one Markdown book and level 2/3')
            partition=attempt/'partition'
            options={'id':'chapter','sourceUrl':source_url,'sourceName':source_name,'level':split_level,'maxChapters':max_chapters}
            process=subprocess.run(['node',str(ROOT/'tools/partition_visualbook.mjs'),str(input_file),str(partition),json.dumps(options,ensure_ascii=False)],capture_output=True,text=True,cwd=ROOT,timeout=120)
            (attempt/'partition.stdout').write_text(process.stdout);(attempt/'partition.stderr').write_text(process.stderr)
            if process.returncode:raise ValueError('Book partition failed before model calls; see preparation diagnostics')
            manifest=json.loads((partition/'manifest.json').read_text())
            report['partitionCoverage']=json.loads((partition/'coverage.json').read_text())
            for c in manifest['chapters']:
                preimported[c['id']]=json.loads((partition/c['source']).read_text())
                c['source']=str(input_file)
        elif input_file.suffix.lower()=='.md':
            manifest={'chapters':[{'id':'chapter','source':str(input_file),'sourceUrl':source_url,'sourceName':source_name}]}
        else:
            manifest=json.loads(input_file.read_text())
            if 'blocks' in manifest:
                manifest={'title':manifest['title'],'chapters':[{'id':manifest['id'],'source':str(input_file)}]}
        chapters=manifest.get('chapters',[])
        if not isinstance(chapters,list) or not 1<=len(chapters)<=max_chapters:
            raise ValueError('Chapter count outside explicit batch budget')
        ids=[c.get('id','') for c in chapters]
        if len(set(ids))!=len(ids) or any(not isinstance(i,str) or not re.fullmatch(r'[a-z][a-z0-9-]*',i) for i in ids):
            raise ValueError('Invalid or duplicate chapter id')
        if manifest.get('groups') is not None:
            navigation=attempt/'navigation.json'
            save(navigation,{'groups':manifest['groups'],'chapters':[{'id':i} for i in ids]})
            checked=subprocess.run(['node',str(ROOT/'packages/visualbook/book-index.mjs'),str(navigation)],capture_output=True,text=True,cwd=ROOT,timeout=30)
            (attempt/'navigation.stdout').write_text(checked.stdout);(attempt/'navigation.stderr').write_text(checked.stderr)
            if checked.returncode:raise ValueError('Invalid complete-book grouping before model calls; see navigation diagnostics')
            report['navigation']=json.loads(checked.stdout)
        candidates=[]
        for c in chapters:
            source=Path(c['source']);source=source.resolve() if source.is_absolute() else (input_file.parent/source).resolve()
            candidate=attempt/(c['id']+'.source.json')
            entry={'id':c['id'],'original':str(source),'status':'importing'};report['records'].append(entry);record()
            if c['id'] in preimported:
                save(candidate,preimported[c['id']])
            elif source.suffix.lower()=='.md':
                options={k:c.get(k,default) for k,default in [('id',c['id']),('sourceUrl',source_url),('sourceName',source_name),('license',None)]}
                process=subprocess.run(['node',str(ROOT/'packages/visualbook/import.mjs'),str(source),str(candidate),json.dumps(options,ensure_ascii=False)],capture_output=True,text=True,cwd=ROOT,timeout=60)
                (attempt/(c['id']+'.import.stdout')).write_text(process.stdout)
                (attempt/(c['id']+'.import.stderr')).write_text(process.stderr)
                if process.returncode:raise ValueError(f'Chapter {c["id"]} import failed; see preparation diagnostics')
            elif source.suffix.lower()=='.json':
                candidate.write_bytes(source.read_bytes())
            else:raise ValueError('Chapter source must be ordinary Markdown or imported source JSON')
            data=json.loads(candidate.read_text())
            if data.get('id')!=c['id'] or not isinstance(data.get('blocks'),list) or not data['blocks']:
                raise ValueError('Imported source must have matching chapter id and nonempty blocks')
            block_ids=[b.get('id') for b in data['blocks']]
            if len(set(block_ids))!=len(block_ids) or any(not isinstance(i,str) or not i for i in block_ids):raise ValueError('Source anchors must be unique nonempty strings')
            if any(not isinstance(b.get(k),str) for b in data['blocks'] for k in ['raw','html','sha256']):raise ValueError('Source blocks need raw, compiled html and original hash strings')
            checked_formulas=check_compiled_math(data)
            entry.update(status='prepared',originalSha256=digest(source),importedSha256=digest(candidate),blocks=len(data['blocks']),formulas=checked_formulas,sourceSha256=data['sourceSha256'])
            candidates.append((c,data,candidate));record()
        prepared_manifest={'title':manifest.get('title',candidates[0][1]['title']),'description':manifest.get('description'),'chapters':[{'id':c['id'],'source':str(output/'inputs'/(c['id']+'.source.json'))} for c,_,_ in candidates]}
        for field in ['groups','labels']:
            if field in manifest:prepared_manifest[field]=manifest[field]
        identity={'inputSha256':digest(input_file),'sourceUrl':source_url,'sourceName':source_name,
                  'chapters':[{k:entry[k] for k in ['id','original','originalSha256','importedSha256']} for entry in report['records']]}
        if split_level is not None:identity['splitLevel']=split_level
        frozen=output/'prepared-inputs.json'
        if frozen.exists():
            prior=json.loads(frozen.read_text())
            if prior['identity']!=identity:raise ValueError('Resume source or local image content changed; use a fresh output directory')
            for c,_,candidate in candidates:
                snapshot=output/'inputs'/(c['id']+'.source.json')
                if not snapshot.exists() or digest(snapshot)!=digest(candidate):raise ValueError('Frozen input snapshot was modified; use a fresh output directory')
        else:
            inputs=output/'inputs'
            if inputs.exists():raise ValueError('Unrecorded inputs directory exists; do not overwrite it')
            inputs.mkdir()
            for c,_,candidate in candidates:(inputs/(c['id']+'.source.json')).write_bytes(candidate.read_bytes())
            save(frozen,{'identity':identity,'manifest':prepared_manifest})
        report['status']='prepared';report['identity']=identity;record()
        save(output/'prepared-manifest.json',prepared_manifest)
        return prepared_manifest
    except Exception as error:
        report['status']='failed';report['error']=str(error);record();raise

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input',type=Path);p.add_argument('output',type=Path);p.add_argument('--max-chapters',type=int,default=3);p.add_argument('--source-url',default='');p.add_argument('--source-name',default='输入教材');a=p.parse_args()
    if not 1<=a.max_chapters<=32:p.error('Chapter limit must be 1..32')
    if not a.output.resolve().is_relative_to((ROOT/'work').resolve()):p.error('Preparation evidence must stay in ignored work/')
    try:m=prepare(a.input,a.output,max_chapters=a.max_chapters,source_url=a.source_url,source_name=a.source_name)
    except Exception as error:raise SystemExit(str(error))
    print(json.dumps({'chapters':len(m['chapters']),'modelCalls':0,'manifest':str(a.output.resolve()/'prepared-manifest.json')},ensure_ascii=False))

if __name__=='__main__':main()
