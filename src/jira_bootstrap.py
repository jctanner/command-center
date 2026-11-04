"""One bounded request; no remote install, daemon, listener, or credential export."""
import json
import os
from pathlib import Path
import subprocess
import sys
try:
    request=json.loads(sys.stdin.buffer.read(131073))
    project=Path(request['project'])
    if not project.is_absolute() or not project.is_dir(): raise ValueError()
    python=project/'.venv/bin/python'
    if not python.is_file():
        result={'status':503,'error':'source_project_venv_missing'}
    else:
        env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
        child=subprocess.run([str(python),'-B','-c',request['code']],cwd=project,env=env,input=json.dumps(request['request']).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15)
        if child.returncode or len(child.stdout)>1024*1024: raise ValueError()
        result=json.loads(child.stdout)
except subprocess.TimeoutExpired: result={'status':504,'error':'jira_source_timed_out'}
except Exception: result={'status':502,'error':'jira_source_unavailable'}
json.dump(result,sys.stdout)
