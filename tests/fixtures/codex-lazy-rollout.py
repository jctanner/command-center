#!/usr/bin/env python3
"""Fake native Codex: owns a thread before its first transcript is persisted."""
import ctypes,fcntl,json,os,sys,time
from pathlib import Path
ctypes.CDLL(None).prctl(15,b'codex',0,0,0)
home=Path(os.environ['CODEX_HOME']);session=os.environ['CC_FIXTURE_THREAD'];cwd=os.getcwd()
locks=home/'thread-writer-locks';locks.mkdir(parents=True,exist_ok=True)
stream=(locks/(session+'.lock')).open('w');fcntl.flock(stream,fcntl.LOCK_EX)
print('› Ask Codex to do anything\n\nFixture model · '+cwd+'\n? for shortcuts',flush=True)
path=home/'sessions/2026/11/16'/('rollout-'+session+'.jsonl')
for line in sys.stdin:
    text=line.rstrip('\n');path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a')as log:
        if log.tell()==0:log.write(json.dumps({'type':'session_meta','timestamp':time.time(),'payload':{'id':session,'cwd':cwd}})+'\n')
        for record in [
            {'type':'event_msg','payload':{'type':'task_started','turn_id':'fixture'}},
            {'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':text}]}},
            {'type':'response_item','payload':{'type':'message','role':'assistant','content':[{'type':'output_text','text':'First reply from the correct fresh thread'}]}},
            {'type':'event_msg','payload':{'type':'task_complete','turn_id':'fixture'}}]:
            log.write(json.dumps(dict(timestamp=time.time(),**record))+'\n')
    print('Received\n› Ask Codex to do anything\n\nFixture model · '+cwd+'\n? for shortcuts',flush=True)
