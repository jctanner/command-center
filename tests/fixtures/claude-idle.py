#!/usr/bin/env python3
"""Fake native Claude with a process/start/target-bound idle registry."""
import ctypes,json,os,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
if '--help' in sys.argv:
    print('Fixture Claude --resume');raise SystemExit(0)
ctypes.CDLL(None).prctl(15,b'claude',0,0,0)
home=Path(os.environ['CLAUDE_CONFIG_DIR']);session=sys.argv[sys.argv.index('--resume')+1];cwd=os.getcwd()
import re
log=home/'projects'/re.sub('[^a-zA-Z0-9]','-',cwd)/(session+'.jsonl')
if not log.is_file():raise SystemExit('Fixture resume rejected: exact transcript missing')
pid=os.getpid();start=Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[19]
target=subprocess.check_output(['tmux','display-message','-p','-t',os.environ['TMUX_PANE'],'#{session_id}:#{window_id}.#{pane_id}'],text=True).strip()
registry=home/'sessions';registry.mkdir(parents=True,exist_ok=True);stamp=datetime.now(timezone.utc).isoformat()
file=registry/(str(pid)+'.json');file.write_text(json.dumps(dict(pid=pid,procStart=start,sessionId=session,cwd=cwd,tmux=target,status='idle',statusUpdatedAt=stamp,updatedAt=stamp)));file.chmod(0o600)
print('Fixture Claude ready',flush=True)
for line in sys.stdin:print('Fixture input',flush=True)
