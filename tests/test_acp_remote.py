import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

SPEC=importlib.util.spec_from_file_location('acp_remote',Path(__file__).parents[1]/'src/acp_remote.py')
M=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(M)
class RemoteTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='cc-acp-remote-');self.home=Path(self.tmp.name);self.patch=patch.dict(os.environ,HOME=str(self.home));self.patch.start()
 def tearDown(self):self.patch.stop();self.tmp.cleanup()
 def test_no_native_install_or_state_on_read(self):
  self.assertEqual([],M.main({'action':'list'}));self.assertFalse((self.home/'.cache').exists())
 def test_symlink_and_other_writable_ancestors_rejected(self):
  other=self.home/'other';other.mkdir();(self.home/'.cache').symlink_to(other,target_is_directory=True)
  with self.assertRaisesRegex(ValueError,'Unsafe|Symlinked'):M.root(True)
  (self.home/'.cache').unlink();(self.home/'.cache').mkdir(mode=0o777);(self.home/'.cache').chmod(0o777)
  with self.assertRaisesRegex(ValueError,'Unsafe'):M.root(True)
 def test_launch_claim_is_no_overwrite_and_adapter_identity_is_rechecked(self):
  adapter=self.home/'claude-agent-acp';adapter.write_text('#!/bin/sh\nexit 0\n');adapter.chmod(0o700)
  with patch.object(M.shutil,'which',side_effect=lambda name:str(adapter)if name=='claude-agent-acp'else'/usr/bin/tmux'):
   options=M.options({'path':str(self.home)})
   ident=str(uuid.uuid4());root=Path(M.root(True));(root/ident).mkdir(mode=0o700)
   req={'action':'launch','broker':ident,'prepared':options,'_broker_code':'# fixture'}
   with self.assertRaises(FileExistsError):M.main(req)
   adapter.write_text('#!/bin/sh\nexit 1\n# changed\n')
   with self.assertRaisesRegex(ValueError,'changed'):M.main(dict(req,broker=str(uuid.uuid4())))
 def test_provider_allowlist_and_grant_prevent_adapter_switch(self):
  adapter=self.home/'codex-acp';adapter.write_text('#!/bin/sh\nexit 0\n');adapter.chmod(0o700)
  with patch.object(M.shutil,'which',side_effect=lambda name:str(adapter)if name=='codex-acp'else('/usr/bin/tmux'if name=='tmux'else None)):
   prepared=M.options({'path':str(self.home),'provider':'codex'})
   self.assertEqual('codex',prepared['provider']);self.assertEqual(str(adapter),prepared['executable'])
   with self.assertRaisesRegex(ValueError,'not installed'):M.options({'path':str(self.home)})
   with self.assertRaisesRegex(ValueError,'Unsupported'):M.options({'path':str(self.home),'provider':'../codex'})
   with self.assertRaisesRegex(ValueError,'changed'):M.launch({'broker':str(uuid.uuid4()),'prepared':dict(prepared,executable='/wrong')})
 def test_uuid_and_private_file_guards(self):
  for ident in ['../outside','not-a-uuid','/tmp/anything']:
   with self.assertRaises((ValueError,AttributeError)):M.canonical_uuid(ident)
  file=self.home/'public.json';file.write_text('{}');file.chmod(0o644)
  with self.assertRaisesRegex(ValueError,'Unsafe'):M.read_json(file)
  file.chmod(0o600);link=self.home/'linked.json';os.link(file,link)
  with self.assertRaisesRegex(ValueError,'Unsafe'):M.read_json(file)
 def test_close_is_claimed_once_and_uncertain_signals_never_replay(self):
  import json,sqlite3
  live={'instance':str(uuid.uuid4()),'pid':123,'start':'one'}
  M.exclusive_json(self.home/'live.json',live)
  file=self.home/'receipts.sqlite3'
  with sqlite3.connect(file)as db:db.execute('create table receipts(id text primary key,digest text,data text)')
  file.chmod(0o600)
  action={'id':str(uuid.uuid4()),'instance':live['instance'],'action':'close'}
  with patch.object(M,'verified_live',return_value=live),patch.object(M,'verify_target'),patch.object(M.os,'pidfd_open',side_effect=PermissionError('fixture')) as opening:
   with self.assertRaises(PermissionError):M.close_broker({},str(self.home),action)
   self.assertEqual('uncertain',M.close_broker({},str(self.home),action)['state']);self.assertEqual(1,opening.call_count)
  with self.assertRaisesRegex(ValueError,'Stale'):M.close_broker({},str(self.home),dict(action,instance=str(uuid.uuid4())))
  with self.assertRaisesRegex(ValueError,'reused'):M.close_broker({},str(self.home),dict(action,extra='changed'))
 def test_completed_close_receipt_can_be_read_after_process_exit(self):
  import sqlite3
  live={'instance':str(uuid.uuid4()),'pid':123,'start':'one'};M.exclusive_json(self.home/'live.json',live)
  file=self.home/'receipts.sqlite3'
  with sqlite3.connect(file)as db:db.execute('create table receipts(id text primary key,digest text,data text)')
  file.chmod(0o600);action={'id':str(uuid.uuid4()),'instance':live['instance'],'action':'close'}
  with open(os.devnull,'rb')as fd,patch.object(M,'verified_live',return_value=live),patch.object(M,'verify_target'),patch.object(M.os,'pidfd_open',side_effect=lambda pid:os.dup(fd.fileno())),patch.object(M.signal,'pidfd_send_signal')as sending:
   self.assertEqual('submitted',M.close_broker({},str(self.home),action)['state']);self.assertEqual(1,sending.call_count)
  with patch.object(M,'verified_live',side_effect=ValueError('gone')):
   self.assertEqual('submitted',M.close_broker({},str(self.home),action)['state'])
 def test_read_cursor_uses_completed_prompt_order_not_stream_chunks_or_recent_receipt_limit(self):
  import json,sqlite3
  ident=str(uuid.uuid4());turn=str(uuid.uuid4());message=str(uuid.uuid4())
  M.exclusive_json(self.home/'target.json',{'session':'$0','window':'@0','pane':'%0'})
  file=self.home/'receipts.sqlite3'
  with sqlite3.connect(file)as db:
   db.execute('create table receipts(id text primary key,digest text,data text)')
   db.execute('insert into receipts values(?,?,?)',(turn,'digest',json.dumps({'id':turn,'kind':'prompt','state':'completed'})))
   for i in range(45):
    other=str(uuid.uuid4());db.execute('insert into receipts values(?,?,?)',(other,'digest',json.dumps({'id':other,'kind':'permission','state':'submitted'})))
  file.chmod(0o600);request={'broker':ident};value={'sequence':100,'messages':[{'id':message,'role':'assistant','turn':turn,'text':'reply'}],'receipts':[],'permissions':[]}
  first=M.decorate(dict(value),request,str(self.home));second=M.decorate(dict(value,sequence=200),request,str(self.home))
  self.assertEqual(message,first['reply_cursor']);self.assertEqual(1,first['reply_position']);self.assertEqual(first['reply_position'],second['reply_position'])
if __name__=='__main__':unittest.main()
