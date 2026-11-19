"""Rebuild a source-level inventory; this is not evidence of runtime completeness."""
from html.parser import HTMLParser
from pathlib import Path
import json,re,subprocess
ROOT=Path(__file__).resolve().parents[1]
MODULES=['tutor','todo','memo','wiki','ss','workflow','kdp','material','admission']
class Controls(HTMLParser):
 def __init__(self):super().__init__();self.items=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag in ['button','input','select','textarea','form','dialog','details'] or tag=='a' and a.get('href'):
   self.items.append({'line':self.getpos()[0],'tag':tag,'attributes':a})
result={'baseline_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'evidence':'Static original-source inventory, not runtime parity certification','modules':{}}
for module in MODULES:
 files=[]
 for path in sorted((ROOT/module).rglob('*')):
  if path.suffix not in ['.html','.js','.mjs'] or any(p in ['test','vendor','node_modules'] for p in path.parts):continue
  text=path.read_text();record={'file':str(path.relative_to(ROOT))}
  if path.suffix=='.html':p=Controls();p.feed(text);record['controls']=p.items
  record['interactions']=[{'line':i,'source':line.strip()} for i,line in enumerate(text.splitlines(),1) if re.search(r'addEventListener\(|onclick\s*=|onsubmit\s*=|onchange\s*=|apiFetch\(|api\(|fetch\(',line)]
  files.append(record)
 result['modules'][module]=files
out=ROOT/'docs/full-parity-source-inventory.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print({m:{'files':len(fs),'controls':sum(len(f.get('controls',[])) for f in fs),'interactions':sum(len(f['interactions']) for f in fs)} for m,fs in result['modules'].items()})
