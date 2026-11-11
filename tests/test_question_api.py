"""Durable question answers with disposable native tmux/SSH fixtures only."""
import contextlib,getpass,json,os,re,shutil,signal,socket,sqlite3,subprocess,tempfile,time,unittest,uuid
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler
from urllib.error import HTTPError
from test_openapi import validate
ROOT=Path(__file__).resolve().parents[1]
def uid():return str(uuid.uuid4())
def port():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
class QuestionAPI(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='cc-question-api-');self.root=Path(self.tmp.name);self.socket=str(self.root/'tmux.sock');self.native=uid();self.mode='normal';self.sshd=None;self.backend=None;self.config=self.root/'config.toml';self.extra='';self.opener=build_opener(ProxyHandler({}));self.log=(self.root/'backend.log').open('wb')
  (self.root/'bin').mkdir();shutil.copy('/usr/bin/python3',self.root/'claude')
  wrapper='''#!/usr/bin/python3
import os,sys,time
from pathlib import Path
root=Path(os.environ['CC_QUESTION_FIXTURE'])
if 'send-keys' in sys.argv:
 if sys.argv[-1]=='Enter' and (root/'fail-enter').exists():sys.exit(1)
 if sys.argv[-1]=='Down' and (root/'delay').exists():time.sleep(.2)
os.execv('/usr/bin/tmux',['tmux',*sys.argv[1:]])
'''
  (self.root/'bin/tmux').write_text(wrapper);(self.root/'bin/tmux').chmod(0o700)
  folder=self.root/'home/projects'/re.sub('[^a-zA-Z0-9]','-',str(self.root));folder.mkdir(parents=True);(folder/(self.native+'.jsonl')).write_text(json.dumps(dict(type='user',sessionId=self.native,cwd=str(self.root),message=dict(role='user',content='Fixture')))+'\n')
  self.spawn_agent();self.start()
 def tmux(self,*args):return subprocess.check_output(['/usr/bin/tmux','-S',self.socket,*args],text=True,env={**os.environ,'TMUX':''}).strip()
 def spawn_agent(self,restart=False):
  command=['env','CLAUDE_CONFIG_DIR='+str(self.root/'home'),str(self.root/'claude'),str(ROOT/'tests/fixtures/question-cli.py'),str(self.root),self.mode]
  if self.mode!='unlinked':command+=['resume',self.native]
  else:command+=['fresh',self.native]
  if restart:self.tmux('respawn-pane','-k','-t',self.pane,'-c',str(self.root),*command)
  else:
   self.tmux('-f','/dev/null','new-session','-d','-s','question','-x','120','-y','40','-c',str(self.root),*command)
   self.session,self.window,self.pane=self.tmux('display-message','-p','-t','question','#{session_id}\t#{window_id}\t#{pane_id}').split('\t')
  end=time.monotonic()+5
  while time.monotonic()<end:
   if 'Enter to select' in self.tmux('capture-pane','-p','-t',self.pane):return
   time.sleep(.02)
  self.fail('Native question fixture did not start')
 def start(self):
  self.config.write_text('[[hosts]]\nid="fixture"\nname="Fixture"\nsocket='+json.dumps(self.socket)+'\n'+self.extra);p=port();self.url=f'http://127.0.0.1:{p}'
  self.backend=subprocess.Popen([str(ROOT/'target/release/command-center'),'--config',str(self.config),'--listen',f'127.0.0.1:{p}','--web-dir',str(ROOT/'web/dist-next')],stdout=self.log,stderr=self.log,env={**os.environ,'CC_QUESTION_FIXTURE':str(self.root),'PATH':str(self.root/'bin')+':'+os.environ['PATH']})
  end=time.monotonic()+8
  while time.monotonic()<end:
   try:
    with self.opener.open(self.url+'/api/v1/health',timeout=1):return
   except OSError:time.sleep(.02)
  self.fail('Fixture backend did not start')
 def stop(self):
  if self.backend and self.backend.poll()is None:self.backend.terminate();self.backend.wait(timeout=5)
 def tearDown(self):
  self.stop()
  if self.sshd:self.sshd.terminate();self.sshd.wait(timeout=5);self.ssh_log.close()
  subprocess.run(['/usr/bin/tmux','-S',self.socket,'kill-server'],capture_output=True);self.log.close();self.tmp.cleanup()
 def call(self,path,body=None,status=200,method='POST'):
  try:r=self.opener.open(Request(self.url+'/api/v1/'+path,data=json.dumps(body).encode()if body is not None else None,method=method if body is not None else'GET',headers={'Content-Type':'application/json','Origin':self.url}),timeout=25)
  except HTTPError as error:r=error
  with r:
   data=r.read();self.assertEqual(r.status,status,data);return json.loads(data)if data else None
 def detail(self,host='fixture'):
  from urllib.parse import urlencode
  revision=next(h['connection_revision']for h in self.call('hosts')if h['id']==host);value=self.call('hosts/'+host+'/agents/conversation?'+urlencode(dict(session=self.session,window=self.window,pane=self.pane,connection_revision=revision)));validate(value,{'$ref':'#/components/schemas/Conversation'});return value
 def prepared(self,host='fixture'):
  d=self.detail(host);self.assertEqual(d['association'],'process');q=d['input_request'];self.assertIsNotNone(q.get('token'),q);return d,q
 def send(self,q,choice='2',text=None,id=None,host='fixture',status=200):
  body=dict(id=id or uid(),token=q['token'],choice=choice)
  if text is not None:body['text']=text
  result=self.call('hosts/'+host+'/agents/question',body,status)
  if status==200:validate(result['receipt'],{'$ref':'#/components/schemas/QuestionReceipt'})
  return body,result
 def events(self):
  p=self.root/'events.jsonl';return [json.loads(x)for x in p.read_text().splitlines()]if p.exists()else[]
 def wait_receipt(self,id):
  end=time.monotonic()+8
  while time.monotonic()<end:
   r=self.call('agents/questions/'+id)['receipt']
   if r['status']!='submitting':return r
   time.sleep(.02)
  self.fail('Receipt remained submitting')
 def test_choice_exactly_once_and_cross_client_prompt_claim(self):
  d,q=self.prepared();_,second=self.prepared();pid=self.tmux('display-message','-p','-t',self.pane,'#{pane_pid}');body,result=self.send(q);r=result['receipt'];self.assertEqual(r['status'],'submitted');self.assertEqual(r['instance'],d['instance']);self.assertEqual(self.tmux('display-message','-p','-t',self.pane,'#{pane_pid}'),pid)
  self.call('hosts/fixture/agents/question',body);self.call('hosts/fixture/agents/question',{**body,'choice':'1'},409);self.send(second,'1',status=409);events=self.events();self.assertEqual([e['event']for e in events],['down','enter']);self.assertEqual(events[-1]['choice'],2);self.assertEqual(self.call('agents/questions/'+body['id'])['receipt']['status'],'submitted')
 def test_other_paste_is_literal_and_confirmed_before_enter(self):
  _,q=self.prepared();body,result=self.send(q,'other','Literal alpha & <beta>');self.assertEqual(result['receipt']['status'],'submitted');events=self.events();self.assertEqual([e['event']for e in events],['down','down','paste','enter']);self.assertEqual(events[-1]['text'],'Literal alpha & <beta>');self.assertNotIn('text',result['receipt']);self.assertNotIn('Literal',json.dumps(result))
 def test_invalid_text_and_unknown_choice_do_not_consume_grant_or_send_input(self):
  _,q=self.prepared()
  for choice,text in [('9',None),('other','two\nlines'),('other','x'*513)]:self.send(q,choice,text,status=409)
  self.assertEqual(self.events(),[]);_,r=self.send(q,'1');self.assertEqual(r['receipt']['status'],'submitted')
 def test_changed_question_rejects_without_keyboard_input(self):
  _,q=self.prepared();pid=int(self.tmux('display-message','-p','-t',self.pane,'#{pane_pid}'));os.kill(pid,signal.SIGUSR1);time.sleep(.05);_,result=self.send(q);self.assertEqual(result['receipt']['status'],'rejected');self.assertEqual(self.events(),[])
 def test_replaced_process_does_not_receive_old_answer(self):
  _,q=self.prepared();self.spawn_agent(restart=True);_,result=self.send(q);self.assertEqual(result['receipt']['status'],'rejected');self.assertEqual(self.events(),[])
 def test_uncertain_after_navigation_survives_restart_and_selection_change(self):
  _,q=self.prepared();(self.root/'fail-enter').touch();body,result=self.send(q);self.assertEqual(result['receipt']['status'],'uncertain');self.assertEqual([e['event']for e in self.events()],['down']);self.stop();(self.root/'fail-enter').unlink();self.start();fresh=self.detail()['input_request'];self.assertEqual(fresh['id'],q['id']);self.assertTrue(fresh['submitted']);self.assertNotIn('token',fresh);self.assertEqual(self.call('agents/questions/'+body['id'])['receipt']['status'],'uncertain');self.assertEqual([e['event']for e in self.events()],['down'])
 def test_corrupted_paste_is_uncertain_and_never_enters(self):
  self.mode='corrupt';self.spawn_agent(restart=True);_,q=self.prepared();_,result=self.send(q,'other','Intended answer');self.assertEqual(result['receipt']['status'],'uncertain');self.assertNotIn('enter',[e['event']for e in self.events()])
 def test_missing_process_link_keeps_the_question_read_only(self):
  self.mode='unlinked';self.spawn_agent(restart=True);value=self.detail();self.assertEqual(value['association'],'project');self.assertNotIn('token',value['input_request']);self.assertIn('process-linked',value['input_request']['reason']);self.assertEqual(self.events(),[])
 def test_receipt_storage_failure_sends_nothing(self):
  _,q=self.prepared()
  with contextlib.closing(sqlite3.connect(self.root/'config.board.sqlite3'))as c,c:c.execute("CREATE TRIGGER deny_receipt BEFORE INSERT ON agent_question_receipts BEGIN SELECT RAISE(ABORT,'fixture'); END;")
  self.send(q,status=500);self.assertEqual(self.events(),[])
 def test_disconnect_after_durable_claim_does_not_cancel_or_replay_answer(self):
  _,q=self.prepared();(self.root/'delay').touch();id=uid();body=json.dumps(dict(id=id,token=q['token'],choice='2')).encode();from urllib.parse import urlsplit
  url=urlsplit(self.url);sock=socket.create_connection((url.hostname,url.port));sock.sendall((f'POST /api/v1/hosts/fixture/agents/question HTTP/1.1\r\nHost: {url.netloc}\r\nOrigin: {self.url}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n').encode()+body)
  seen=False
  for _ in range(100):
   with contextlib.closing(sqlite3.connect(self.root/'config.board.sqlite3'))as c:row=c.execute('SELECT data FROM agent_question_receipts WHERE id=?',(id,)).fetchone()
   if row:seen=True;break
   time.sleep(.005)
  sock.close();self.assertTrue(seen);r=self.wait_receipt(id);self.assertEqual(r['status'],'submitted');self.assertEqual([e['event']for e in self.events()],['down','enter'])

 def test_repeated_identical_menu_with_new_native_waiting_transition_is_new_intent(self):
  self.mode='repeat';self.spawn_agent(restart=True);_,first=self.prepared();self.send(first,'1');pid=int(self.tmux('display-message','-p','-t',self.pane,'#{pane_pid}'));os.kill(pid,signal.SIGUSR1);time.sleep(.05);_,second=self.prepared();self.assertEqual(first['title'],second['title']);self.assertNotEqual(first['id'],second['id']);_,result=self.send(second,'2');self.assertEqual(result['receipt']['status'],'submitted');self.assertEqual([e['event']for e in self.events()],['enter','down','enter'])
 def test_endpoint_edit_invalidates_a_prepared_question_answer(self):
  _,q=self.prepared();settings=self.call('settings/hosts');alias=self.root/'alias.sock';alias.symlink_to(self.socket);self.call('hosts/fixture',dict(revision=settings['revision'],host=dict(name='Updated endpoint',socket=str(alias),ssh=None,ssh_config=None)),method='PUT');self.send(q,status=409);self.assertEqual(self.events(),[])

 def test_shared_ssh_and_jump_transport_answers_only_the_verified_native_prompt(self):
  if not Path('/usr/sbin/sshd').exists():self.skipTest('OpenSSH server unavailable')
  self.stop()
  for name in ['hostkey','identity']:subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-f',str(self.root/name)],check=True,capture_output=True)
  (self.root/'authorized_keys').write_text((self.root/'identity.pub').read_text());(self.root/'authorized_keys').chmod(0o600);ssh_port=port()
  config=self.root/'sshd_config';config.write_text(f'Port {ssh_port}\nListenAddress 127.0.0.1\nHostKey {self.root}/hostkey\nAuthorizedKeysFile {self.root}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile {self.root}/sshd.pid\nAllowUsers {getpass.getuser()}\nLogLevel ERROR\n');self.ssh_log=(self.root/'sshd.log').open('wb');self.sshd=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(config)],stdout=self.ssh_log,stderr=self.ssh_log)
  (self.root/'known_hosts').write_text(f'[127.0.0.1]:{ssh_port} '+(self.root/'hostkey.pub').read_text());ssh_config=self.root/'ssh_config';ssh_config.write_text(f'Host question-dest question-jump\n HostName 127.0.0.1\n Port {ssh_port}\n User {getpass.getuser()}\n IdentityFile {self.root}/identity\n IdentitiesOnly yes\n UserKnownHostsFile {self.root}/known_hosts\n')
  for host in ['remote','jump']:
   self.extra+=f'\n[[hosts]]\nid="{host}"\nname="{host}"\nsocket={json.dumps(self.socket)}\nssh="question-dest"\nssh_config={json.dumps(str(ssh_config))}\n'
   if host=='jump':self.extra+='ssh_jump="question-jump"\n'
  self.start()
  for host in ['remote','jump']:
   with self.subTest(host=host):
    pid=int(self.tmux('display-message','-p','-t',self.pane,'#{pane_pid}'));os.kill(pid,signal.SIGUSR1);time.sleep(.05);_,q=self.prepared(host);_,result=self.send(q,'1',host=host);self.assertEqual(result['receipt']['status'],'submitted');self.assertEqual(result['receipt']['host'],host)
  self.assertEqual([e['event']for e in self.events()],['enter','enter'])

if __name__=='__main__':unittest.main()
