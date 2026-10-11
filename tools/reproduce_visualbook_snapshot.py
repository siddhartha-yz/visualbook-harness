"""Reconstruct recorded owned source files from a local Git commit plus a patch.

Checks every recorded hash. Dependencies are installed separately from the pinned
lock; user textbooks, account state and provider output are never reconstructed.
"""
import argparse, hashlib, json, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest',type=Path);p.add_argument('output',type=Path);p.add_argument('--patch',type=Path);a=p.parse_args()
 out=a.output.resolve()
 if out.exists()or not out.is_relative_to(ROOT/'work'):raise SystemExit('Use a fresh ignored work/ output')
 data=json.loads(a.manifest.read_text());base=data['baseCommit'];files=data['files']
 if not re.fullmatch('[a-f0-9]{40}',base)or not isinstance(files,dict)or not 1<=len(files)<=500 or any(not re.fullmatch('[a-f0-9]{64}',h)for h in files.values()):raise SystemExit('Use pinned commit and file hashes')
 subprocess.run(['git','rev-parse','--verify',base+'^{commit}'],cwd=ROOT,check=True,capture_output=True)
 if any(Path(n).is_absolute()or '..'in Path(n).parts or not n.startswith(('packages/visualbook/','tools/','experiments/visualbook/'))and n not in ['AGENTS.md','package.json','package-lock.json']for n in files):raise SystemExit('Unexpected owned-source path')
 out.mkdir(parents=True)
 for name in files:
  r=subprocess.run(['git','show',base+':'+name],cwd=ROOT,capture_output=True)
  if r.returncode:continue # Recorded new file is supplied by the exact patch.
  target=out/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(r.stdout)
 subprocess.run(['git','init','-q'],cwd=out,check=True,capture_output=True)
 if a.patch:
  patch=a.patch.resolve();subprocess.run(['git','apply','--check',str(patch)],cwd=out,check=True,capture_output=True)
  subprocess.run(['git','apply',str(patch)],cwd=out,check=True,capture_output=True)
 actual={};errors=[]
 for name,expected in files.items():
  if not(out/name).is_file():errors.append({'file':name,'kind':'missing'});continue
  h=hashlib.sha256((out/name).read_bytes()).hexdigest();actual[name]=h
  if h!=expected:errors.append({'file':name,'kind':'changed'})
 code=hashlib.sha256(json.dumps(actual,sort_keys=True).encode()).hexdigest()
 report={'passed':not errors and code==data['codeSha256'],'files':len(actual),'expectedFiles':len(files),'baseCommit':base,'codeSha256':code,'expectedCodeSha256':data['codeSha256'],'errors':errors,'scope':'Owned source content reconstruction only. No dependency installation, real generation, rendering, account state or user book reconstruction.'}
 (out/'reconstruction.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report))
 if not report['passed']:raise SystemExit(1)
if __name__=='__main__':main()
