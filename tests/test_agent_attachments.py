"""Guarded export-to-outbox flow with a disposable cat-as-Codex tmux fixture.

No live provider is contacted. Copies use new UUIDs under the account's managed
attachment root and are removed by exact intent cleanup at teardown.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import socket
import getpass
from datetime import datetime, timezone
from contextlib import closing
import subprocess
import time
import unittest
from urllib.parse import urlencode
import uuid
import test_whiteboard_api as fixtures
from test_whiteboard_api import ROOT, uid
import test_whiteboard_exports as exports
from test_openapi import validate

spec=importlib.util.spec_from_file_location('attachment_fs',ROOT/'src/attachment_remote.py')
fs=importlib.util.module_from_spec(spec);spec.loader.exec_module(fs)

class AgentAttachments(fixtures.WhiteboardApi):
 rendered=exports.Exports.rendered
 @classmethod
 def setUpClass(cls):
  super().setUpClass();cls.stop();cls.manifests=[];cls.socket=str(cls.root/'tmux.sock');cls.provider=cls.root/'provider';cls.provider.mkdir();cls.native=uid();cls.logfile=cls.provider/'sessions/2026/11/11/rollout-fixture.jsonl';cls.logfile.parent.mkdir(parents=True);cls.logfile.write_text(json.dumps({'type':'session_meta','payload':{'id':cls.native,'cwd':str(cls.root),'timestamp':'2026-11-11T00:00:00Z'}})+'\n');shutil.copy('/bin/cat',cls.root/'codex');(cls.root/'resume').touch();(cls.root/cls.native).touch()
  cls.agent_command=f"printf '› \\n'; exec env CODEX_HOME={cls.provider} {cls.root/'codex'} resume {cls.native} -"
  cls.tmux('-f','/dev/null','new-session','-d','-s','attachments-fixture','-c',str(cls.root),cls.agent_command)
  fields=cls.tmux('display-message','-p','-t','attachments-fixture','#{session_id}\t#{window_id}\t#{pane_id}').split('\t');cls.target=dict(zip(('session','window','pane'),fields))
  cls.sshd=None
  extra=''
  if Path('/usr/sbin/sshd').exists():
   for name in ['hostkey','identity']:subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-f',str(cls.root/name)],check=True,capture_output=True)
   (cls.root/'authorized_keys').write_text((cls.root/'identity.pub').read_text());(cls.root/'authorized_keys').chmod(0o600)
   with socket.socket()as sock:sock.bind(('127.0.0.1',0));ssh_port=sock.getsockname()[1]
   ssh_config=cls.root/'ssh_config';sshd_config=cls.root/'sshd_config';sshd_config.write_text(f'Port {ssh_port}\nListenAddress 127.0.0.1\nHostKey {cls.root}/hostkey\nAuthorizedKeysFile {cls.root}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile {cls.root}/sshd.pid\nAllowUsers {getpass.getuser()}\nLogLevel ERROR\n')
   cls.ssh_log=(cls.root/'sshd.log').open('wb');cls.sshd=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(sshd_config)],stdout=cls.ssh_log,stderr=cls.ssh_log)
   (cls.root/'known_hosts').write_text(f'[127.0.0.1]:{ssh_port} '+(cls.root/'hostkey.pub').read_text())
   ssh_config.write_text(f'Host attachment-jump attachment-dest\n HostName 127.0.0.1\n Port {ssh_port}\n User {getpass.getuser()}\n IdentityFile {cls.root}/identity\n IdentitiesOnly yes\n UserKnownHostsFile {cls.root}/known_hosts\n')
   for host in ['ssh-fixture','jump-fixture']:
    extra+=f'\n[[hosts]]\nid={json.dumps(host)}\nname={json.dumps(host)}\nsocket={json.dumps(cls.socket)}\nssh="attachment-dest"\nssh_config={json.dumps(str(ssh_config))}\n'
    if host=='jump-fixture':extra+='ssh_jump="attachment-jump"\n'
  (cls.root/'config.toml').write_text(f'[[hosts]]\nid="fixture"\nname="Disposable attachment fixture"\nsocket={json.dumps(cls.socket)}\n'+extra);cls.start()
 @classmethod
 def tmux(cls,*args):return subprocess.check_output(['tmux','-S',cls.socket,*args],text=True,env={**os.environ,'TMUX':''}).strip()
 @classmethod
 def tearDownClass(cls):
  cls.stop()
  for m in cls.manifests:
   try:fs.cleanup(m)
   except(FileNotFoundError,fs.AttachmentError):pass
  cls.tmux('kill-server')
  if cls.sshd:cls.sshd.terminate();cls.sshd.wait(timeout=5);cls.ssh_log.close()
  cls.log.close();cls.tmp.cleanup()
 def setUp(self):
  self.logfile.write_text(json.dumps({'type':'session_meta','payload':{'id':self.native,'cwd':str(self.root)}})+'\n')
 def detail(self,host="fixture"):
  hosts=self.call('hosts');revision=next(h['connection_revision']for h in hosts if h['id']==host);return self.call('hosts/'+host+'/agents/conversation?'+urlencode({**self.target,'connection_revision':revision}))
 def prepared(self,export,host="fixture"):
  detail=self.detail(host);self.assertEqual(detail['association'],'process',detail);self.assertTrue(detail['send_available']);body={'id':uid(),'token':detail['message_token'],'text':'Please inspect the attached synthetic architecture.','attachment':{'export_id':export['id'],'format':'png'}};result=self.call('hosts/'+host+'/agents/message/attachments/prepare','POST',body);validate(result,{'$ref':'#/components/schemas/AgentAttachmentPrepared'});self.manifests.append(result['attachment']['manifest']);self.assertFalse(Path(result['attachment']['path']).parent.exists());return body,result
 def enqueue(self,p,status=200):
  return self.call('hosts/'+p['host']+'/agents/message','POST',{'id':p['id'],'token':p['token'],'text':p['text'],'attachments':[p['attachment']['source']]},status)
 def receipt(self,id):return next(e for e in self.call('agents/outbox')['entries']if e['id']==id)
 def wait(self,id,predicate):
  end=time.monotonic()+15
  while time.monotonic()<end:
   r=self.receipt(id)
   if predicate(r):return r
   time.sleep(.1)
  self.fail('Receipt did not reach expected state: '+json.dumps(r))
 def test_managed_copy_verified_manual_delivery_and_native_seen(self):
  board=self.create();self.graph(board);_,export=self.rendered(board);body,p=self.prepared(export)
  self.assertIn(p['attachment']['path'],p['text']);self.assertIn('Rust API',p['text']);self.assertTrue(p['text'].startswith(body['text']))
  self.call('hosts/fixture/agents/message/attachments/prepare','POST',body,410)
  self.enqueue({**p,'text':'changed'},409);response=self.enqueue(p);validate(response['outbox'],{'$ref':'#/components/schemas/AgentOutboxEntry'});self.assertEqual(response['outbox']['attachment']['state'],'pending')
  self.enqueue(p);self.call('hosts/fixture/agents/message','POST',{'id':p['id'],'token':'unused','text':p['text']},409)
  verified=self.wait(p['id'],lambda r:r['attachment']['state']=='verified');path=Path(verified['attachment']['path']);self.assertTrue(path.is_absolute());self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),verified['attachment']['manifest']['sha256']);self.assertEqual(path.stat().st_mode&0o777,0o400)
  self.assertEqual(verified['status'],'queued') # cat has no verified provider-ready events.
  grant=self.detail();submitted=self.call('agents/outbox/'+p['id'],'POST',{'action':'submit','revision':self.receipt(p['id'])['revision'],'token':grant['message_token']})['outbox'];self.assertEqual(submitted['status'],'submitted');self.assertIsNotNone(submitted['attachment']['submitted_at'])
  # Fixture log append models provider persistence; this is not a real model.
  with self.logfile.open('a')as f:f.write(json.dumps({'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':p['text']}]}})+'\n')
  self.call('agents/outbox/'+p['id'],'POST',{'action':'check','revision':self.receipt(p['id'])['revision']});seen=self.receipt(p['id']);self.assertEqual(seen['status'],'seen');self.assertIsNotNone(seen['seen_message']);self.assertIsNotNone(seen['attachment']['seen_at'])
  # Ready export public URL expires while the durable outbox retains the source.
  with closing(sqlite3.connect(self.root/'config.board.sqlite3'))as c, c:c.execute("UPDATE whiteboard_exports SET metadata=json_set(metadata,'$.expires_at',0) WHERE id=?",(export['id'],))
  self.rendered(board);self.call('whiteboard-exports/'+export['id']+'/png',status=410)
  with closing(sqlite3.connect(self.root/'config.board.sqlite3'))as c, c:self.assertIsNotNone(c.execute('SELECT png FROM whiteboard_exports WHERE id=?',(export['id'],)).fetchone()[0])
 def test_automatic_input_rechecks_native_state_after_file_verification(self):
  board=self.create();self.graph(board);_,export=self.rendered(board);_,p=self.prepared(export);self.enqueue(p)
  self.wait(p['id'],lambda r:r['attachment']['state']=='verified')
  turn=uid()
  with self.logfile.open('a')as f:
   for kind in ['task_started','task_complete']:f.write(json.dumps({'type':'event_msg','timestamp':datetime.now(timezone.utc).isoformat(),'payload':{'type':kind,'turn_id':turn,'root_turn_id':turn}})+'\n')
  r=self.wait(p['id'],lambda r:r['status']=='submitted');self.assertEqual(r['attachment']['state'],'verified');self.assertIn(p['attachment']['path'],self.tmux('capture-pane','-p','-J','-t',self.target['pane'],'-S','-200'))
  with self.logfile.open('a')as f:f.write(json.dumps({'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':p['text']}]}})+'\n')
  self.wait(p['id'],lambda r:r['status']=='seen')
 def test_collision_and_process_replacement_never_send_or_overwrite(self):
  board=self.create();self.graph(board);_,export=self.rendered(board);_,p=self.prepared(export)
  directory=Path(p['attachment']['path']).parent;root_fd=fs.root(p['attachment']['manifest']['home'],create=True);os.close(root_fd);directory.mkdir(mode=0o700);sentinel=directory/'keep';sentinel.write_text('do not overwrite')
  self.enqueue(p);blocked=self.wait(p['id'],lambda r:r['status']=='blocked');self.assertEqual(blocked['attachment']['state'],'uncertain');self.assertEqual(sentinel.read_text(),'do not overwrite');self.assertFalse(Path(p['attachment']['path']).exists())
  self.call('agents/outbox/'+p['id'],'POST',{'action':'check_attachment','revision':blocked['revision']});self.assertEqual(self.receipt(p['id'])['status'],'blocked')
  self.call('agents/outbox/'+p['id'],'POST',{'action':'cancel','revision':self.receipt(p['id'])['revision']});sentinel.unlink();directory.rmdir()
  _,p=self.prepared(export);self.tmux('respawn-pane','-k','-t',self.target['pane'],'-c',str(self.root),self.agent_command);time.sleep(.1)
  self.enqueue(p);blocked=self.wait(p['id'],lambda r:r['status']=='blocked');self.assertFalse(Path(p['attachment']['path']).exists());self.call('agents/outbox/'+p['id'],'POST',{'action':'cancel','revision':blocked['revision']})

 def rewrite_receipt_and_restart(self,id,edit):
  self.stop()
  with closing(sqlite3.connect(self.root/'config.board.sqlite3'))as c, c:
   row=json.loads(c.execute('SELECT data FROM agent_outbox WHERE id=?',(id,)).fetchone()[0]);edit(row);row['revision']+=1;c.execute('UPDATE agent_outbox SET phase=?,revision=?,data=? WHERE id=?',(row['status'],row['revision'],json.dumps(row),id))
  self.start()
 def test_restart_copy_claim_is_not_replayed_and_can_be_checked_read_only(self):
  board=self.create();self.graph(board);_,export=self.rendered(board);_,p=self.prepared(export);self.enqueue(p);verified=self.wait(p['id'],lambda r:r['attachment']['state']=='verified');before=Path(verified['attachment']['path']).stat()
  def interrupted(row):row['attachment']['state']='copying';row['attachment']['verified_at']=None
  self.rewrite_receipt_and_restart(p['id'],interrupted);r=self.wait(p['id'],lambda r:r['status']=='blocked');self.assertEqual(r['attachment']['state'],'uncertain');after=Path(r['attachment']['path']).stat();self.assertEqual((before.st_ino,before.st_mtime_ns),(after.st_ino,after.st_mtime_ns))
  r=self.call('agents/outbox/'+p['id'],'POST',{'action':'check_attachment','revision':r['revision']})['outbox'];self.assertEqual(r['attachment']['state'],'verified');self.assertEqual(r['status'],'queued');self.call('agents/outbox/'+p['id'],'POST',{'action':'cancel','revision':r['revision']})
 def test_expired_resolved_attachment_cleanup_releases_only_its_source_pin(self):
  board=self.create();self.graph(board);_,export=self.rendered(board);_,p=self.prepared(export);self.enqueue(p);r=self.wait(p['id'],lambda r:r['attachment']['state']=='verified');self.call('agents/outbox/'+p['id'],'POST',{'action':'cancel','revision':r['revision']})
  self.rewrite_receipt_and_restart(p['id'],lambda row:row['attachment'].update(expires_at=0));r=self.wait(p['id'],lambda r:r['attachment']['state']=='expired');self.assertFalse(Path(r['attachment']['path']).parent.exists());self.assertIsNotNone(r['attachment']['expired_at'])
  with closing(sqlite3.connect(self.root/'config.board.sqlite3'))as c:self.assertIsNone(c.execute('SELECT id FROM export_attachment_pins WHERE id=?',(p['id'],)).fetchone())

 def test_shared_ssh_and_proxyjump_copy_with_exact_remote_checksum(self):
  if not self.sshd:self.skipTest('OpenSSH server unavailable')
  board=self.create();self.graph(board);_,export=self.rendered(board)
  for host in ['ssh-fixture','jump-fixture']:
   with self.subTest(host=host):
    _,p=self.prepared(export,host);self.enqueue(p);r=self.wait(p['id'],lambda r:r['attachment']['state']=='verified' or r['status']=='blocked');self.assertEqual(r['attachment']['state'],'verified',r);self.assertEqual(fs.verify(r['attachment']['manifest'])['sha256'],export['artifacts']['png']['sha256']);self.assertEqual(r['status'],'queued');self.call('agents/outbox/'+p['id'],'POST',{'action':'cancel','revision':r['revision']})

if __name__=='__main__':unittest.main()
