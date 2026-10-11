"""Local stdio MCP: compile authorized candidates and return actual PNG content.

No credentials, HTTP server, remote calls or arbitrary shell arguments. Every
candidate and its revision evidence stays in the supplied local workspace.
"""

import argparse
import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--direct", action="store_true")
    parser.add_argument("--library-first", action="store_true")
    args = parser.parse_args()
    workspace = args.workspace.resolve(strict=True)
    if args.direct and args.library_first: raise ValueError("Library policy applies only to harness")
    drawing_gaps = {}
    tool = ROOT / "tools/visualbook.mjs"
    catalog = json.loads((ROOT / "packages/visualbook/catalog.json").read_text())[
        "designs"
    ]
    components = json.loads((ROOT / "packages/visualbook/components.json").read_text())["components"]
    calculation_metadata = json.loads(subprocess.check_output(['node',str(ROOT/'tools/visualbook_math.mjs'),'list'],text=True,timeout=30)) if not args.direct else {}

    def inside(name):
        path = (workspace / name).resolve()
        if not path.is_relative_to(workspace):
            raise ValueError("Path outside current workspace")
        return path

    definitions = [
        {
            "name": "build_book",
            "description": "Compile source.json and book.json into book.html. Keep original prose and formulas. No artistic quality verdict.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "preview_book",
            "description": "Render desktop/mobile views, fractional progress AND parameter extremes. Return render findings and real PNG image content for every figure at mid-progress. Use a fresh label; at most three candidate previews.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "label": {
                        "type": "string",
                        "description": "Fresh preview label, e.g. first or revised",
                    }
                },
                "required": ["label"],
                "additionalProperties": False,
            },
        },
    ]
    definitions += [
        {"name":"inspect_source","description":"Inspect up to three actual source anchors, neighbouring text and safe insertion advice. No source rewrite or quality verdict.","inputSchema":{"type":"object","properties":{"anchors":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"string"}}},"required":["anchors"],"additionalProperties":False}},
        {"name":"inspect_reader","description":"Inspect one actual source anchor as a reader: real PNGs, formula wrapping and native Home/End access to long formulas. Use when a full-page screenshot looks clipped. Does not rewrite source/candidate or certify math; twelve inspections maximum.","inputSchema":{"type":"object","properties":{"anchor":{"type":"string"},"width":{"type":"integer","enum":[375,1280,1920]}},"required":["anchor"],"additionalProperties":False}},
        {"name":"put_annotation","description":"Add a concise visible condition/clarification/correction beside original source; optional TeX is actually compiled. Original text and hashes remain unchanged. Explicit replace=true to revise a note. Saves before/after and builds; still inspect the real page.","inputSchema":{"type":"object","properties":{"id":{"type":"string"},"afterAnchor":{"type":"string"},"kind":{"type":"string","enum":["condition","clarification","correction"]},"text":{"type":"string","maxLength":360},"formula":{"type":"string","maxLength":500},"placement":{"type":"string","enum":["body","margin"]},"marginSide":{"type":"string","enum":["left","right"]},"replace":{"type":"boolean"}},"required":["id","afterAnchor","kind","text"],"additionalProperties":False}}
    ]
    if args.library_first:
        definitions += [{"name":"declare_drawing_gap","description":"After checking 1..3 named designs, record why this figure needs custom drawing. Binds the escape to this exact code hash; later code changes require a new declaration. Twelve declarations maximum, failed requests count. Does not certify that the reason is true or the custom figure is good.","inputSchema":{"type":"object","properties":{"figureId":{"type":"string"},"attemptedDesigns":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"string"}},"reason":{"type":"string","minLength":30,"maxLength":600}},"required":["figureId","attemptedDesigns","reason"],"additionalProperties":False}}]
    if not args.direct:
        definitions += [
            {
                "name":"extract_source_matrices",
                "description":"Read exact literal numeric matrices from one actual source anchor, with original TeX, block/source hashes and explicit array separators. Variables and unsupported syntax are never guessed. Use returned values in calculation/design data; still inspect source fit. No source rewrite, network or model call.",
                "inputSchema":{"type":"object","properties":{"anchor":{"type":"string"}},"required":["anchor"],"additionalProperties":False},
            },
            {
                "name": "put_design",
                "description": "Insert one named reusable design into the current book and build it, without writing drawing code. Supply real source anchor, optional existing data replacements, and explicit replace=true only to replace an existing figure id. Saves before/after plan and build evidence; still preview and inspect the candidate. Failed build leaves a failed current proposal, never an older ready candidate.",
                "inputSchema": {"type":"object","properties":{
                    "id":{"type":"string","pattern":"^[a-z][a-z0-9-]*$"},
                    "design":{"type":"string","enum":[d['id'] for d in catalog]},
                    "afterAnchor":{"type":"string"},"endAnchor":{"type":"string"},
                    "title":{"type":"string","maxLength":80},"summary":{"type":"string","maxLength":180},
                    "placement":{"type":"string","enum":["body","wide","margin"]},"marginSide":{"type":"string","enum":["left","right"]},"presentation":{"type":"string","enum":["reading","exploration"]},"initialProgress":{"type":"number","minimum":0,"maximum":1},"sourceDiagramAnchor":{"type":"string"},
                    "presets":{"type":"array","maxItems":6,"items":{"type":"object","properties":{"id":{"type":"string"},"label":{"type":"string","maxLength":24},"params":{"type":"object"},"progress":{"type":"number","minimum":0,"maximum":1}},"required":["id","label","params"],"additionalProperties":False}},
                    "overrides":{"type":"array","maxItems":32,"items":{"type":"object","properties":{"path":{"type":"string","maxLength":240},"value":{}},"required":["path","value"],"additionalProperties":False}},
                    "replace":{"type":"boolean"}
                },"required":["id","design","afterAnchor"],"additionalProperties":False},
            },
            {
                "name":"describe_design_inputs",
                "description":"Inspect the actual replaceable scene data and default controls of one named design, without drawing or copying its code. Use figure.design and explicit overrides to reuse its implementation. Replacements must exist; still review math/teaching fit and actual PNGs.",
                "inputSchema":{"type":"object","properties":{"id":{"type":"string","enum":[d['id'] for d in catalog]}},"required":["id"],"additionalProperties":False},
            },
            {
                "name":"search_designs",
                "description":"Search reusable designs and composable components by concept in Chinese or English. Returns at most six matching entries with limits, not all source code.",
                "inputSchema":{"type":"object","properties":{"query":{"type":"string","maxLength":120}},"required":["query"],"additionalProperties":False},
            },
            {
                "name":"describe_component",
                "description":"Retrieve one component's actual input keys, outputs, limits and matching executable examples. Connect its real outputs to other components using $result.",
                "inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"additionalProperties":False},
            },
            {
                "name":"compute_math",
                "description":"Call the same canonical probability/learning numerical kernels used by drawings; no DOM, network or model calls. This helps inspect values but is not independent math review. Allowed input keys are returned on error.",
                "inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":list(calculation_metadata)},"inputs":{"type":"object"},"fields":{"type":"array","minItems":1,"maxItems":8,"uniqueItems":True,"items":{"type":"string"}}},"required":["operation","inputs"],"additionalProperties":False},
            },
            {
                'name':'describe_calculation',
                'description':'Inspect allowed input keys, required fields and actual output fields of one canonical calculation. Use compose.calculations to wire its results into visual components without custom drawing code.',
                'inputSchema':{'type':'object','properties':{'operation':{'type':'string'}},'required':['operation'],'additionalProperties':False}
            },
            {
                "name": "list_designs",
                "description": "List reusable mathematical/ML/programming designs and their limits. Select suitable ones; do not force every concept into a template.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
            {
                "name": "show_design",
                "description": "Return executable example and real desktop/mobile PNG of one reusable design. Does not modify your book. At most two different examples per author session.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "enum": [d["id"] for d in catalog]}
                    },
                    "required": ["id"],
                    "additionalProperties": False,
                },
            },
        ]

    definitions += [
        {
            "name": "export_motion",
            "description": "Optional GIF/MP4 of a reviewed figure, with fixed-progress frames, repeat checks and actual decode verification. Requires matching final review. No automatic playback in the book. Two motion attempts per session, including failed captures; frames stay in ignored work.",
            "inputSchema": {
                "type":"object", "properties": {
                    "label":{"type":"string"}, "id":{"type":"string"},
                    "width":{"type":"integer","enum":[375,1280]},
                    "fps":{"type":"integer","enum":[5,10,20,25]},
                    "duration":{"type":"integer","minimum":1,"maximum":20},
                    "formats":{"type":"array","items":{"type":"string","enum":["gif","mp4"]},"minItems":1,"maxItems":2,"uniqueItems":True},
                    "params":{"type":"object"},
                    "sweep":{"type":"object","properties":{"key":{"type":"string"},"from":{"type":"number"},"to":{"type":"number"}},"required":["key","from","to"],"additionalProperties":False},
                    "from":{"type":"number","minimum":0,"maximum":1},
                    "to":{"type":"number","minimum":0,"maximum":1},
                }, "required":["label","id"], "additionalProperties":False,
            },
        },
        {
            "name": "inspect_frame",
            "description": "Return one real start/end PNG from the latest matching candidate preview. Review both widths for every figure before finalizing; it reuses rendered frames and does not spend a new preview.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "width": {"type": "integer", "enum": [375, 1280]},
                    "progress": {"type": "number", "enum": [0, 0.5, 1]},
                },
                "required": ["id", "width", "progress"],
                "additionalProperties": False,
            },
        },
        {
            "name": "finalize_book",
            "description": "Record unresolved visual/math/teaching issues after actually inspecting endpoints. Known issues stop export; this is not a quality score. Does not modify candidate source.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "issues": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "figureId": {"type": "string"},
                                "condition": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["figureId", "condition", "description"],
                            "additionalProperties": False,
                        },
                    },
                    "mathCheckNote": {"type": "string"},
                    "limits": {"type": "string"},
                },
                "required": ["issues", "mathCheckNote", "limits"],
                "additionalProperties": False,
            },
        },
    ]

    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def tool_fingerprint():
        library=ROOT/'packages/visualbook'
        modules=json.loads((library/'bundle.json').read_text())['modules']
        files=[library/n for n in modules+['bundle.json','runtime.js','theme.css','math.mjs','anchors.mjs','source-matrices.mjs','components.json','catalog.json']]+[tool,Path(__file__).resolve(),ROOT/'tools/audit_visualbook_parameters.mjs',ROOT/'tools/audit_visualbook_interactions.mjs',ROOT/'tools/visualbook_math.mjs',ROOT/'tools/visualbook_inspection.mjs',ROOT/'tools/export_visualbook_motion.mjs',ROOT/'tools/build_visualbook_catalog.mjs',ROOT/'tools/inspect_visualbook_reader.mjs',ROOT/'tools/visualbook_workspace.mjs']
        return hashlib.sha256(json.dumps({str(p.relative_to(ROOT)):digest(p) for p in files},sort_keys=True).encode()).hexdigest()

    def build_inputs():
        return {'source_sha256':digest(inside('source.json')),'plan_sha256':digest(inside('book.json')),'tools_sha256':tool_fingerprint(),'arm':'direct' if args.direct else 'harness','composition_policy':'prefer-library' if args.library_first else 'open','drawing_gaps_sha256':hashlib.sha256(json.dumps(drawing_gaps,sort_keys=True).encode()).hexdigest()}

    def require_current_build():
        receipt=inside('build-receipt.json')
        if not receipt.exists():raise ValueError('Build the current plan successfully before preview or review')
        record=json.loads(receipt.read_text())
        if record.get('status') != 'success' or any(record.get(k)!=v for k,v in build_inputs().items()) or record.get('html_sha256')!=digest(inside('book.html')):
            raise ValueError('Current source/plan/tools do not match a successful build; build_book first. An older HTML is not the revised candidate')
        return record

    def snapshot_build(receipt):
        builds=inside('builds')
        builds.mkdir(exist_ok=True)
        index=1
        while (builds/f'build-{index:03d}').exists():index+=1
        snapshot=builds/f'build-{index:03d}'
        snapshot.mkdir()
        for name in ['source.json','book.json']:shutil.copyfile(inside(name),snapshot/name)
        receipt['snapshot']=str(snapshot.relative_to(workspace))
        (snapshot/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
        return snapshot

    def latest_preview():
        require_current_build()
        reports = sorted(
            workspace.glob("preview-*/report.json"), key=lambda p: p.stat().st_mtime
        )
        if not reports:
            raise ValueError("No candidate preview")
        report = json.loads(reports[-1].read_text())
        if (
            hashlib.sha256(inside("book.html").read_bytes()).hexdigest()
            != report["sha256"]
        ):
            raise ValueError("Candidate changed after preview; preview it again")
        return reports[-1].parent, report

    def design_summary(design):
        operations=[]
        def walk(node):
            operations.extend(c["operation"] for c in node.get("calculations",[]))
            for child in node.get("children",[]):walk(child)
            if node.get("visual"):walk(node["visual"])
        if design.get("scene"):walk(design["scene"])
        return {**{k:design[k] for k in ["id","title","topic","limits"]},"composition":"scene" if design.get("scene") else "code","controls":len(design.get("params",[])),"calculations":list(dict.fromkeys(operations)),"dataSlots":bool(design.get("scene"))}

    def call(name, arguments):
        started = time.monotonic()
        image_metadata = []
        if name not in [d["name"] for d in definitions]:
            raise ValueError("Unknown tool")
        required = next(d for d in definitions if d["name"] == name)["inputSchema"][
            "properties"
        ]
        if any(k not in required for k in arguments):
            raise ValueError("Unknown argument")
        result = None
        is_build = name in ["build_book", "put_design", "put_annotation"]
        if name == "declare_drawing_gap":
            directory=inside('drawing-gaps');directory.mkdir(exist_ok=True)
            count=len(list(directory.glob('declaration-*')))
            if count>=12:raise ValueError('Twelve drawing gap declarations reached')
            path=directory/f'declaration-{count+1:03d}.json'
            record={'arguments':arguments,'status':'requested'};path.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
            plan=json.loads(inside('book.json').read_text());figure=next((f for f in plan['figures'] if f['id']==arguments.get('figureId')),None)
            designs=arguments.get('attemptedDesigns');reason=arguments.get('reason')
            try:
                if not figure or not isinstance(figure.get('code'),str) or figure.get('design'):raise ValueError('Gap declaration needs an existing custom-code figure')
                if not isinstance(designs,list) or not 1<=len(designs)<=3 or len(set(designs))!=len(designs) or any(d not in [x['id'] for x in catalog] for d in designs):raise ValueError('Inspect and identify one to three distinct actual designs')
                if not isinstance(reason,str) or not 30<=len(reason.strip())<=600:raise ValueError('Explain the concrete missing relation in 30..600 characters')
                record.update(status='declared',code_sha256=hashlib.sha256(figure['code'].encode()).hexdigest())
                drawing_gaps[figure['id']]=record
            except Exception as error:
                record.update(status='failed',error=str(error));path.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');raise
            path.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
            result={'declaration':record,'scope':'Recorded author explanation, not independently established coverage or quality'}
        if name == "put_annotation":
            if not isinstance(arguments.get('replace',False),bool):raise ValueError('replace must be an explicit boolean')
            previous=inside('book.json').read_bytes();plan=json.loads(previous);notes=plan.setdefault('annotations',[])
            if not isinstance(notes,list):raise ValueError('Annotations must be an array')
            matches=[i for i,n in enumerate(notes) if n.get('id')==arguments.get('id')]
            if len(matches)>1 or (matches and not arguments.get('replace',False)) or (not matches and arguments.get('replace',False)):raise ValueError('Note replacement requires one existing id and explicit replace=true')
            note={k:v for k,v in arguments.items() if k!='replace'}
            if matches:notes[matches[0]]=note
            else:notes.append(note)
            edits=inside('annotation-edits');edits.mkdir(exist_ok=True)
            if len(list(edits.glob('edit-*')))>=24:raise ValueError('Twenty-four annotation edits reached; failures count')
            directory=edits/f'edit-{len(list(edits.glob("edit-*")))+1:03d}';directory.mkdir()
            (directory/'before.json').write_bytes(previous);(directory/'request.json').write_text(json.dumps(arguments,ensure_ascii=False,indent=2)+'\n')
            proposal=json.dumps(plan,ensure_ascii=False,indent=2)+'\n';(directory/'after.json').write_text(proposal);inside('book.json').write_text(proposal)
        if name == "put_design":
            if not all(isinstance(arguments.get(k),str) and arguments[k] for k in ['id','design','afterAnchor']):
                raise ValueError('Design, figure id and real source anchor required')
            if not re.fullmatch(r'[a-z][a-z0-9-]*',arguments['id']) or arguments['design'] not in [d['id'] for d in catalog]:
                raise ValueError('Unknown design or invalid figure id')
            if not isinstance(arguments.get('replace',False),bool):raise ValueError('replace must be an explicit boolean')
            if len(json.dumps(arguments).encode())>65536:raise ValueError('Design input exceeds 64 KiB')
            previous=inside('book.json').read_bytes()
            plan=json.loads(previous)
            if not isinstance(plan.get('figures'),list) or len(plan['figures'])>4:raise ValueError('Book needs zero to four figures')
            matches=[i for i,f in enumerate(plan['figures']) if f.get('id')==arguments['id']]
            if matches and not arguments.get('replace',False):raise ValueError('Figure id exists; use explicit replace=true')
            if len(matches)>1:raise ValueError('Duplicate figure id in current plan')
            if not matches and arguments.get('replace',False):raise ValueError('Cannot replace a missing figure')
            if not matches and len(plan['figures'])>=4:raise ValueError('Four-figure limit reached')
            figure={k:v for k,v in arguments.items() if k!='replace'}
            if matches:plan['figures'][matches[0]]=figure
            else:plan['figures'].append(figure)
            edits=inside('plan-edits');edits.mkdir(exist_ok=True)
            if len(list(edits.glob('edit-*')))>=32:raise ValueError('Thirty-two design edits reached; retain failures')
            directory=edits/f'edit-{len(list(edits.glob("edit-*")))+1:03d}';directory.mkdir()
            (directory/'before.json').write_bytes(previous)
            (directory/'request.json').write_text(json.dumps(arguments,ensure_ascii=False,indent=2)+'\n')
            proposal=json.dumps(plan,ensure_ascii=False,indent=2)+'\n'
            (directory/'after.json').write_text(proposal)
            inside('book.json').write_text(proposal)
        if name == "inspect_source":
            anchors=arguments.get('anchors')
            if not isinstance(anchors,list) or not 1<=len(anchors)<=3 or any(not isinstance(a,str) for a in anchors):raise ValueError('Provide one to three source anchors')
            process=subprocess.run(['node',str(ROOT/'packages/visualbook/anchors.mjs'),str(inside('source.json')),json.dumps(anchors)],capture_output=True,text=True,timeout=30)
            if process.returncode:raise ValueError(process.stderr[-3000:])
            result=json.loads(process.stdout)
        elif name == "declare_drawing_gap":
            pass
        elif name == "list_designs":
            result = [design_summary(d) for d in catalog]
        elif name == "describe_design_inputs":
            design=next((d for d in catalog if d['id']==arguments.get('id')),None)
            if design is None:raise ValueError('Unknown design')
            slots=[]
            def collect(node,pointer):
                for key,value in node.get('props',{}).items():
                    slots.append({'path':pointer+'/props/'+key,'currentValue':value})
                for index,calculation in enumerate(node.get('calculations',[])):
                    for key,value in calculation['inputs'].items():
                        slots.append({'path':pointer+'/calculations/'+str(index)+'/inputs/'+key,'currentValue':value})
                for index,child in enumerate(node.get('children',[])):collect(child,pointer+'/children/'+str(index))
                if node.get('visual'):collect(node['visual'],pointer+'/visual')
            if design.get('scene'):collect(design['scene'],'/scene')
            result={'id':design['id'],'title':design['title'],'limits':design['limits'],'params':design.get('params',[]),'presets':design.get('presets',[]),'placement':design.get('placement','body'),'presentation':design.get('presentation','reading'),'state':design.get('state',{}),'slots':slots[:64],'truncated':len(slots)>64,'usesCode':bool(design.get('code')),'usage':{'design':design['id'],'id':'your-figure-id','afterAnchor':'a-real-source-anchor','overrides':[]},'scope':'Existing data replacement paths only; not a suitability or quality verdict'}
        elif name == "search_designs":
            query=arguments.get("query")
            if not isinstance(query,str) or not query.strip() or len(query)>120:
                raise ValueError("Provide a short concept query")
            terms=set(re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]",query.lower()))
            matches=[]
            for entry in components:
                text=" ".join([entry["id"],entry["title"],entry["keywords"],entry["limits"]]).lower()
                score=sum(term in text for term in terms)
                if score:
                    matches.append((score,{k:entry[k] for k in ["id","title","limits","examples"]}))
            matches.sort(key=lambda item:(-item[0],item[1]["id"]))
            selected=[item[1] for item in matches[:6]]
            example_ids={ident for item in selected for ident in item["examples"]}
            designs=[]
            for design in catalog:
                text=" ".join(str(design.get(k,"")) for k in ["id","title","topic","limits","keywords"]).lower()
                score=sum(term in text for term in terms)+(0.1 if design["id"] in example_ids else 0)
                if score:designs.append((score,design_summary(design)))
            designs.sort(key=lambda item:(-item[0],item[1]["composition"] != "scene",-item[1]["controls"],item[1]["id"]))
            result={"components":selected,"designs":[item[1] for item in designs[:6]],"scope":"Deterministic keyword lookup; ties prefer data-composable scenes and controls. Capability metadata, not a quality ranking"}
        elif name == "describe_component":
            result=next((entry for entry in components if entry["id"]==arguments.get("id")),None)
            if result is None:raise ValueError("Unknown component")
        elif name == 'describe_calculation':
            operation=arguments.get('operation')
            process=subprocess.run(['node',str(ROOT/'tools/visualbook_math.mjs'),'describe',str(operation)],capture_output=True,text=True,timeout=30,cwd=workspace)
            if process.returncode:raise ValueError(process.stderr[-3000:])
            result=json.loads(process.stdout)
        elif name == "extract_source_matrices":
            anchor=arguments.get('anchor')
            if not isinstance(anchor,str) or not re.fullmatch(r'[a-z][a-z0-9-]*',anchor):raise ValueError('Use an actual source anchor')
            process=subprocess.run(['node',str(ROOT/'packages/visualbook/source-matrices.mjs'),str(inside('source.json')),anchor],capture_output=True,text=True,timeout=30)
            if process.returncode:raise ValueError(process.stderr[-3000:])
            result=json.loads(process.stdout)
            directory=inside('source-matrices');directory.mkdir(exist_ok=True)
            artifact=directory/f'extraction-{len(list(directory.glob("extraction-*.json")))+1:03d}.json';artifact.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            result['evidencePath']=str(artifact.relative_to(workspace))
        elif name == "compute_math":
            request=json.dumps({"operation":arguments.get("operation"),"inputs":arguments.get("inputs")})
            if len(request.encode())>65536:raise ValueError("Numeric input exceeds 64 KiB")
            process=subprocess.run(["node",str(ROOT/"tools/visualbook_math.mjs")],input=request,cwd=workspace,capture_output=True,text=True,timeout=30)
            if process.returncode:raise ValueError(process.stderr[-3000:])
            result=json.loads(process.stdout)
            fields=arguments.get('fields')
            if fields is not None:
                if not isinstance(fields,list) or not 1<=len(fields)<=8 or len(set(fields))!=len(fields) or any(k not in result['result'] for k in fields):raise ValueError('Choose one to eight distinct actual result fields')
                directory=inside('math-results');directory.mkdir(exist_ok=True);artifact=directory/f'result-{len(list(directory.glob("result-*")))+1:03d}.json';artifact.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
                result={**result,'result':{k:result['result'][k] for k in fields},'selectedFields':fields,'fullResultPath':str(artifact.relative_to(workspace))}
        elif name == "inspect_reader":
            require_current_build()
            if len(list(workspace.glob('reader-inspection-*')))>=12:raise ValueError('Twelve source-reader inspections reached; failures count')
            anchor=arguments.get('anchor');width=arguments.get('width',375)
            if not isinstance(anchor,str) or not re.fullmatch(r'[a-z][a-z0-9-]*',anchor) or width not in [375,1280,1920]:raise ValueError('Use an actual source anchor and a supported width')
            out=inside(f'reader-inspection-{len(list(workspace.glob("reader-inspection-*")))+1:03d}')
            process=subprocess.run(['node',str(ROOT/'tools/inspect_visualbook_reader.mjs'),str(inside('book.html')),str(out),json.dumps({'anchor':anchor,'width':width})],cwd=workspace,capture_output=True,text=True,timeout=90)
            if not (out/'report.json').exists():raise ValueError(process.stderr[-3000:])
            result=json.loads((out/'report.json').read_text())
            result['candidateSha256']=result['htmlSha256']
        elif name == "inspect_frame":
            directory, report = latest_preview()
            ident = arguments.get("id")
            width = arguments.get("width")
            progress = arguments.get("progress")
            plan = json.loads(inside("book.json").read_text())
            if (
                ident not in [f["id"] for f in plan["figures"]]
                or width not in [375, 1280]
                or progress not in [0, 0.5, 1]
            ):
                raise ValueError("Unknown figure or frame")
            filename = directory / f"{width}-{ident}-{progress:g}.png"
            result = {
                "screenshots": [str(filename)],
                "frame": arguments,
                "findings": [],
                "candidateSha256": report["sha256"],
            }
        elif name == "export_motion":
            directory, report = latest_preview()
            label = arguments.get('label','')
            if not re.fullmatch(r'[a-z][a-z0-9-]{0,40}',label):
                raise ValueError('Use a fresh short motion label')
            review_file=inside('review.json')
            if not review_file.exists():raise ValueError('Finalize the inspected candidate first')
            review=json.loads(review_file.read_text())
            if not review.get('ready_for_export') or review.get('issues') or review.get('html_sha256')!=digest(inside('book.html')) or review.get('plan_sha256')!=digest(inside('book.json')):
                raise ValueError('Matching issue-free final review required')
            if len([p for p in workspace.glob('motion-*') if p.is_dir()])>=2:
                raise ValueError('Two motion attempts reached; retain failures')
            out=inside('motion-'+label)
            request=inside('motion-request-'+label+'.json')
            if out.exists() or request.exists():raise ValueError('Motion label already used')
            request.write_text(json.dumps({k:v for k,v in arguments.items() if k!='label'},ensure_ascii=False,indent=2)+'\n')
            process=subprocess.run(['node',str(ROOT/'tools/export_visualbook_motion.mjs'),str(inside('book.html')),str(directory),str(out),str(request)],cwd=workspace,capture_output=True,text=True,timeout=180)
            if not (out/'report.json').exists():raise ValueError(process.stderr[-6000:] or process.stdout[-6000:])
            motion=json.loads((out/'report.json').read_text())
            result={'status':motion['status'],'report':str(out/'report.json'),'outputs':motion['outputs'],'findings':motion['findings'],'candidateSha256':report['sha256'],'screenshots':[s['file'] for s in motion['outputs'][0]['sampledFrames']] if motion['outputs'] else []}
        elif name == "finalize_book":
            directory, report = latest_preview()
            issues = arguments.get("issues")
            if not isinstance(issues, list) or any(
                not isinstance(i, dict)
                or set(i) != {"figureId", "condition", "description"}
                or not all(isinstance(v, str) and v for v in i.values())
                for i in issues
            ):
                raise ValueError("Describe every known unresolved issue")
            if not all(
                isinstance(arguments.get(k), str) for k in ["mathCheckNote", "limits"]
            ):
                raise ValueError("Missing final review notes")
            plan = json.loads(inside("book.json").read_text())
            seen = set()
            evidence = inside("mcp-evidence.jsonl")
            if evidence.exists():
                for line in evidence.read_text().splitlines():
                    item = json.loads(line)
                    if (
                        item["tool"] == "inspect_frame"
                        and item.get("candidateSha256") == report["sha256"]
                    ):
                        a = item["arguments"]
                        seen.add((a["id"], a["width"], a["progress"]))
            missing = [
                {"id": f["id"], "width": w, "progress": p}
                for f in plan["figures"]
                for w in [1280, 375]
                for p in [0, 1]
                if (f["id"], w, p) not in seen
            ]
            if missing:
                raise ValueError(
                    "Inspect actual endpoint PNGs first: " + json.dumps(missing)
                )
            result = {
                **arguments,
                "html_sha256": report["sha256"],
                "plan_sha256": hashlib.sha256(
                    inside("book.json").read_bytes()
                ).hexdigest(),
                "ready_for_export": not issues and not report["findings"],
                "scope": "Known-issue review plus render gate; no independent artistic certification.",
            }
            inside("review.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            )
        elif name == "show_design":
            design = next((d for d in catalog if d["id"] == arguments.get("id")), None)
            if design is None:
                raise ValueError("Unknown design")
            out = inside("design-" + design["id"])
            if (
                not out.exists()
                and len([p for p in workspace.glob("design-*") if p.is_dir()]) >= 2
            ):
                raise ValueError("Two different design examples reached")
            if not (out / "catalog-record.json").exists():
                command = [
                    "node",
                    str(ROOT / "tools/build_visualbook_catalog.mjs"),
                    str(out),
                    design["id"],
                ]
                process = subprocess.run(
                    command, cwd=workspace, capture_output=True, text=True, timeout=180
                )
                if process.returncode:
                    raise ValueError(process.stderr[-6000:] or process.stdout[-6000:])
            report = json.loads(
                (out / "evidence" / design["id"] / "report.json").read_text()
            )
            result = {
                "design": design,
                "findings": report["findings"],
                "screenshots": report["screenshots"],
                "kind": "maintenance-authored reusable design, not your generated textbook",
            }
        else:
            if is_build:
                receipt={**build_inputs(),'status':'building'}
                snapshot=snapshot_build(receipt)
                inside('build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
                command = [
                    "node",
                    str(tool),
                    "build",
                    str(inside("source.json")),
                    str(inside("book.json")),
                    str(inside("book.html")),
                ]
                if args.direct:
                    command.append("--direct")
            else:
                require_current_build()
                label = arguments.get("label", "")
                if not re.fullmatch(r"[a-z][a-z0-9-]{0,40}", label):
                    raise ValueError("Invalid preview label")
                if len([p for p in workspace.glob("preview-*") if p.is_dir()]) >= 3:
                    raise ValueError(
                        "Three-preview budget reached; retain final issues"
                    )
                out = inside("preview-" + label)
                if out.exists():
                    raise ValueError("Preview directory already exists")
                command = [
                    "node",
                    str(tool),
                    "preview",
                    str(inside("book.html")),
                    str(out),
                ]
            try:
                if is_build and args.library_first:
                    plan=json.loads(inside('book.json').read_text())
                    for figure in plan.get('figures',[]):
                        if figure.get('code') and not figure.get('design'):
                            current=hashlib.sha256(figure['code'].encode()).hexdigest()
                            if drawing_gaps.get(figure.get('id'),{}).get('code_sha256')!=current:
                                raise ValueError('Prefer a named design or composed scene. If no suitable design fits, inspect candidates then declare_drawing_gap for current figure '+str(figure.get('id'))+'. Revisions require a matching declaration.')
                process = subprocess.run(command, cwd=workspace, capture_output=True, text=True, timeout=180)
            except Exception as error:
                if is_build:
                    failed={**receipt,'status':'failed','error':str(error)}
                    for destination in [inside('build-receipt.json'),snapshot/'receipt.json']:destination.write_text(json.dumps(failed,indent=2)+'\n')
                raise
            if is_build:
                (snapshot/'stdout.txt').write_text(process.stdout)
                (snapshot/'stderr.txt').write_text(process.stderr)
            if process.returncode:
                if is_build:
                    for destination in [inside('build-receipt.json'),snapshot/'receipt.json']:destination.write_text(json.dumps({**receipt,'status':'failed'},indent=2)+'\n')
                raise ValueError(process.stderr[-6000:] or process.stdout[-6000:])
            result = json.loads(process.stdout.splitlines()[-1])
            if is_build:
                receipt={**receipt,'status':'success','html_sha256':digest(inside('book.html'))}
                shutil.copyfile(inside('book.html'),snapshot/'book.html')
                if inside('resolved-plan.json').exists():
                    shutil.copyfile(inside('resolved-plan.json'),snapshot/'resolved-plan.json')
                    receipt['resolved_plan_sha256']=digest(inside('resolved-plan.json'))
                for destination in [inside('build-receipt.json'),snapshot/'receipt.json']:destination.write_text(json.dumps(receipt,indent=2)+'\n')
                result['buildReceipt']=receipt
        content = [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
        if name in ["preview_book", "show_design", "inspect_frame", "export_motion", "inspect_reader"]:
            screenshots = result["screenshots"]
            selected = [
                p
                for p in screenshots
                if Path(p).name.endswith("-0.5.png")
                or Path(p).name.endswith("-reading.png")
                or Path(p).name.endswith("-context.png")
                or Path(p).name.startswith("failure-")
                or Path(p).name == "failed-render.png"
            ]
            if not selected:
                selected = screenshots
            for path in selected:
                file = Path(path).resolve()
                if not file.is_relative_to(workspace):
                    raise ValueError("Screenshot outside workspace")
                data = file.read_bytes()
                content += [
                    {"type": "text", "text": "真实预览 " + file.name},
                    {
                        "type": "image",
                        "mimeType": "image/png",
                        "data": base64.b64encode(data).decode(),
                    },
                ]
                image_metadata.append(
                    {
                        "name": file.name,
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "bytes": len(data),
                        "mimeType": "image/png",
                    }
                )
        entry = {
            "tool": name,
            "arguments": arguments,
            "wall_s": round(time.monotonic() - started, 3),
            "images": image_metadata,
            "findings": result.get("findings", []) if isinstance(result, dict) else [],
            "arm": "direct" if args.direct else "harness",
            "candidateSha256": (
                result.get("candidateSha256") if isinstance(result, dict) else None
            ),
        }
        with (workspace / "mcp-evidence.jsonl").open("a") as stream:
            stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return {"content": content, "isError": (name in ["export_motion", "inspect_reader"] and result.get("status") != "completed") or (name == "preview_book" and result.get("status") == "failed")}

    for line in sys.stdin:
        ident = None
        request = None
        try:
            request = json.loads(line)
            method = request.get("method")
            ident = request.get("id")
            if ident is None:
                continue
            if method == "initialize":
                result = {
                    "protocolVersion": request.get("params", {}).get(
                        "protocolVersion", "2024-11-05"
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "visualbook-local", "version": "0.7.0"},
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": definitions}
            elif method in [
                "resources/list",
                "resources/templates/list",
                "prompts/list",
            ]:
                result = {
                    (
                        "resourceTemplates"
                        if method == "resources/templates/list"
                        else "resources" if method == "resources/list" else "prompts"
                    ): []
                }
            elif method == "tools/call":
                params = request.get("params", {})
                result = call(params.get("name"), params.get("arguments", {}))
            else:
                raise ValueError("Unsupported method")
            response = {"jsonrpc": "2.0", "id": ident, "result": result}
        except Exception as error:
            with (workspace / "mcp-failures.jsonl").open("a") as stream:
                stream.write(
                    json.dumps(
                        {
                            "method": (
                                request.get("method")
                                if isinstance(request, dict)
                                else None
                            ),
                            "error": str(error),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
            response = {
                "jsonrpc": "2.0",
                "id": ident,
                "result": {
                    "content": [{"type": "text", "text": str(error)}],
                    "isError": True,
                },
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
