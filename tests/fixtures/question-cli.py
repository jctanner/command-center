"""Disposable raw-TTY question simulator; never calls a model or runs answers."""
import ctypes,json,os,signal,subprocess,sys,time,tty
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2];session=sys.argv[-1]
ctypes.CDLL(None).prctl(15,b'claude',0,0,0);tty.setraw(0)
position=1;answer='';version=0;pending=b''
import re
project=re.sub('[^a-zA-Z0-9]','-',str(root));log=root/'home/projects'/project/(session+'.jsonl')
call_id=''
def append_native(record):
 with log.open('a')as f:f.write(json.dumps(record)+'\n')
def close_call(identifier):
 append_native(dict(type='user',sessionId=session,cwd=str(root),message=dict(role='user',content=[dict(type='tool_result',tool_use_id=identifier,content='Fixture answer')])) )
def native_question():
 global call_id
 # Only synthetic logs: close old pending calls before respawn/new request.
 active=set()
 for line in log.read_text().splitlines():
  record=json.loads(line)
  for block in record.get('message',{}).get('content',[]):
   if not isinstance(block,dict):continue
   if block.get('type')=='tool_use':active.add(block['id'])
   if block.get('type')=='tool_result':active.discard(block['tool_use_id'])
 for identifier in active:close_call(identifier)
 call_id='fixture-question-'+str(os.getpid())+'-'+str(version)
 append_native(dict(type='assistant',sessionId=session,cwd=str(root),message=dict(role='assistant',content=[dict(type='tool_use',id=call_id,name='AskUserQuestion',input=dict(questions=[dict(question='Which fixture should receive diagram '+str(0 if mode=='repeat'else version)+'?',header='Destination',options=[dict(label='First fixture',description='First description'),dict(label='Second fixture',description='Second description')],multiSelect=False)]))])))
def record(event,**extra):
 with (root/'events.jsonl').open('a')as f:f.write(json.dumps(dict(event=event,**extra))+'\n')
def registry(status):
 if mode=='unlinked':return
 base=Path('/proc/self');start=(base/'stat').read_text().rsplit(')',1)[1].split()[19]
 target=subprocess.check_output(['/usr/bin/tmux','display-message','-p','-t',os.environ['TMUX_PANE'],'#{session_id}:#{window_id}.#{pane_id}'],text=True).strip()
 stamp=int(time.time()*1000);data=dict(pid=os.getpid(),procStart=start,sessionId=session,cwd=str(root),tmux=target,status=status,statusUpdatedAt=stamp,updatedAt=stamp,startedAt=stamp-1000)
 path=root/'home/sessions'/f'{os.getpid()}.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data))
def paint():
 rows=[('First fixture','First description'),('Second fixture','Second description'),(answer or 'Type something.',''),('Chat about this','')]
 lines=['☐ Destination','','│ Which fixture should receive diagram '+str(0 if mode=='repeat'else version)+'?','']
 for n,(label,description)in enumerate(rows,1):
  if n==4:lines.append('────────────────────────')
  lines.append(('❯ 'if position==n else'  ')+str(n)+'. '+label)
  if description:lines.append('     '+description)
 lines.append('Enter to select · ↑/↓ to navigate · Esc to cancel')
 os.write(1,('\x1b[2J\x1b[H'+'\r\n'.join(lines)).encode())
def changed(*_):
 global position,answer,version
 position=1;answer='';version+=1;native_question();registry('waiting');paint()
signal.signal(signal.SIGUSR1,changed);os.write(1,b'\x1b[?2004h');native_question();registry('waiting');paint()
while True:
 data=os.read(0,4096)
 if not data:break
 pending+=data
 while pending:
  if pending.startswith(b'\x1b[200~'):
   end=pending.find(b'\x1b[201~')
   if end<0:break
   answer=pending[6:end].decode();pending=pending[end+6:]
   if mode=='corrupt':answer='corrupted answer'
   record('paste',text=answer);paint();continue
  if pending.startswith(b'\x1b'):
   if len(pending)<3:break
   key=pending[:3];pending=pending[3:]
   if key==b'\x1b[B':position=min(4,position+1);record('down')
   elif key==b'\x1b[A':position=max(1,position-1);record('up')
   else:record('unknown',data=key.hex())
   paint();continue
  key=pending[:1];pending=pending[1:]
  if key in (b'\r',b'\n'):
   record('enter',choice=position,text=answer);close_call(call_id);registry('idle');os.write(1,b'\x1b[2J\x1b[HFixture answer received')
  else:record('unexpected',data=key.hex())
