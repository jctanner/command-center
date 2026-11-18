import importlib.util
import io
import threading
from types import SimpleNamespace
from unittest.mock import Mock
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import uuid

SPEC = importlib.util.spec_from_file_location('acp_broker', Path(__file__).parents[1] / 'src/acp_broker.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
FAKE = (Path(__file__).parent/'fixtures/fake-acp-agent.py').read_text()

def wait(fn):
    until = time.monotonic() + 5
    while time.monotonic() < until:
        if fn(): return
        time.sleep(.01)
    raise AssertionError('Timed out')

class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cc-acp-unit-')
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        executable = self.root / 'fake-agent'
        source=FAKE
        if self._testMethodName=='test_claude_load_replays_large_image_without_retaining_bytes':
            source=source.replace("session=m['params']['sessionId'];result={}", "session=m['params']['sessionId'];result={};print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':session,'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'image','data':'X'*(2*1024*1024),'mimeType':'image/png'}}}}),flush=True)")
        if self._testMethodName.startswith('test_codex_native'):(self.root/'enable-native-shell').touch()
        executable.write_text(source)
        executable.chmod(0o700)
        if self._testMethodName.startswith(('test_codex_','test_claude_')):
            (self.root/'intent.json').write_text(json.dumps({'id':str(uuid.uuid4()),'prepared':{'provider':'claude'if self._testMethodName.startswith('test_claude_')else'codex'},'resume_session':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));(self.root/'intent.json').chmod(0o600)
        self.broker = MOD.Broker(str(self.root), str(executable), str(self.root))
        wait(lambda: self.broker.state == 'ready')

    def tearDown(self):
        self.broker.closed = True
        command=self.broker.active_command
        if command:
            with self.broker.lock:self.broker.stop_local_command(command)
            command["thread"].join(timeout=4)
        self.broker.agent.terminate()
        self.broker.agent.wait(timeout=5)
        self.broker.server.close()
        self.temp.cleanup()

    def action(self, **kwargs):
        return dict(instance=self.broker.instance, id=str(uuid.uuid4()), **({'execution':'cc_broker'} if kwargs.get('action')=='local_command' else {'execution':'codex_native_full_access'} if kwargs.get('action')=='harness_command' else {}), **kwargs)

    def test_bang_is_not_silently_executed_by_broker_terminal(self):
        for text in ('!pwd','  !echo hello','!!pwd'):
            with self.subTest(text=text),self.assertRaisesRegex(ValueError,'Nothing sent or executed'):
                MOD.terminal_request(text)
        self.assertEqual({'action':'local_command','execution':'cc_broker','text':'!pwd'},MOD.terminal_request('/broker pwd'))
        self.assertEqual({'action':'prompt','text':'hello'},MOD.terminal_request('hello'))
        with self.assertRaises(ValueError):MOD.terminal_request('/broker')
        with self.assertRaises(ValueError):MOD.terminal_request('/broker   ')
        self.assertFalse(self.broker.snapshot()['harness_commands'])
        with self.assertRaisesRegex(ValueError,'unavailable'):
            self.broker.dispatch(dict(instance=self.broker.instance,id=str(uuid.uuid4()),action='local_command',text='!pwd'))

    def test_native_capability_rejects_unknown_versions_scopes_and_wrong_types(self):
        self.assertTrue(MOD.native_shell_capability(dict(MOD.NATIVE_SHELL_CAPABILITY)))
        for changes in ({'version':True},{'version':2},{'execution':'cc_broker'},{'contextIncluded':False},{'outputBytes':1},{'method':'session/prompt'},{'extra':'unsupported'}):
            with self.subTest(changes=changes):self.assertFalse(MOD.native_shell_capability(dict(MOD.NATIVE_SHELL_CAPABILITY,**changes)))

    def test_codex_native_command_uses_extension_and_native_context_not_broker_shell(self):
        self.assertTrue(self.broker.snapshot()['harness_commands'])
        request=self.action(action='harness_command',text='!pwd')
        with unittest.mock.patch.object(MOD.subprocess,'Popen',side_effect=AssertionError('broker must not spawn a shell')),unittest.mock.patch.object(MOD,'display')as rendered:
            self.broker.dispatch(request);wait(lambda:self.broker.dispatch(request)['state']=='completed')
        self.assertEqual(1,''.join(str(call.args[0])for call in rendered.call_args_list).count('[Exit 0]'))
        self.assertEqual('harness_command',MOD.terminal_request('!pwd',True)['action'])
        receipt=self.broker.dispatch(request);self.assertTrue(receipt['context_included']);self.assertEqual('codex_native_full_access',receipt['execution'])
        self.assertTrue(any(m.get('kind')=='harness_command_output'and str(self.root)in m['text']for m in self.broker.messages))
        calls=[json.loads(l)for l in(self.root/'native-fixture-calls.jsonl').read_text().splitlines()]
        self.assertEqual(['_cc/session/shell'],[v['method']for v in calls]);self.assertEqual(self.broker.session,calls[0]['params']['sessionId'])
        self.broker.dispatch(request);self.assertEqual(1,len((self.root/'native-fixture-calls.jsonl').read_text().splitlines()))
        normal=self.action(action='prompt',text='native-context');self.broker.dispatch(normal);wait(lambda:self.broker.dispatch(normal)['state']=='completed')
        self.assertTrue(any(m.get('turn')==normal['id']and str(self.root)in m['text']for m in self.broker.messages))

    def test_codex_native_command_queues_cancels_and_rejects_foreign_output(self):
        request=self.action(action='harness_command',text='!hold-native');self.broker.dispatch(request)
        wait(lambda:bool(self.broker.native_command.get('turn')))
        before=json.dumps(self.broker.messages)
        with self.broker.lock:self.broker.update({'sessionUpdate':'tool_call_update','_meta':{MOD.NATIVE_SHELL_META:{'requestId':str(uuid.uuid4()),'text':'secret'}}})
        self.assertEqual(before,json.dumps(self.broker.messages))
        queued=self.action(action='harness_command',text='!pwd');self.assertEqual('queued',self.broker.dispatch(queued)['state'])
        self.broker.dispatch(self.action(action='cancel'));wait(lambda:self.broker.dispatch(request)['state']=='cancelled');wait(lambda:self.broker.dispatch(queued)['state']=='completed')

    def test_codex_native_output_survives_bounded_history_eviction(self):
        request=self.action(action='harness_command',text='!hold-native');self.broker.dispatch(request)
        wait(lambda:bool(self.broker.native_command.get('turn')))
        with self.broker.lock:self.broker.messages.clear()
        self.broker.dispatch(self.action(action='cancel'));wait(lambda:self.broker.dispatch(request)['state']=='cancelled')
        self.assertTrue(any(m.get('kind')=='harness_command_output'and'[Exit -15]'in m['text']for m in self.broker.messages))

    def test_codex_native_success_requires_persisted_context_proof(self):
        request=self.action(action='harness_command',text='!missing-context');self.broker.dispatch(request)
        wait(lambda:self.broker.dispatch(request)['state']=='uncertain')
        self.assertEqual('failed',self.broker.state)
        self.assertIsNone(self.broker.dispatch(request)['context_included'])

    def test_codex_native_command_invalid_proof_holds_followups_without_fallback(self):
        request=self.action(action='harness_command',text='!invalid-proof');self.broker.dispatch(request);wait(lambda:self.broker.dispatch(request)['state']=='uncertain')
        self.assertEqual('failed',self.broker.state)
        self.assertEqual(['_cc/session/shell'],[json.loads(l)['method']for l in(self.root/'native-fixture-calls.jsonl').read_text().splitlines()])

    def test_native_command_unavailable_never_becomes_prompt_or_broker_execution(self):
        with self.assertRaisesRegex(ValueError,'unavailable'):
            self.broker.dispatch(self.action(action='harness_command',text='!pwd'))
        self.assertEqual([],self.broker.messages)

    def completed_command(self,text):
        request=self.action(action='local_command',text=text)
        self.broker.dispatch(request)
        wait(lambda:self.broker.dispatch(request)['state']in ('completed','cancelled','failed','uncertain'))
        return request,self.broker.dispatch(request)

    def test_local_command_runs_in_pinned_directory_without_model_prompt(self):
        original=self.broker.rpc
        self.broker.rpc=Mock(wraps=original)
        request,receipt=self.completed_command('!pwd')
        self.assertEqual('completed',receipt['state']);self.assertEqual(0,receipt['exit_code']);self.assertEqual('cc_broker',receipt['execution']);self.assertFalse(receipt['context_included'])
        output=next(m for m in self.broker.messages if m.get('kind')=='command_output')
        self.assertEqual(str(self.root)+'\n\n[Exit 0]',output['text'])
        self.broker.rpc.assert_not_called();self.assertEqual('ready',self.broker.state)
        self.assertIsNone(self.broker.snapshot()['usage'])
        self.assertNotIn(str(self.root),json.dumps(receipt))

    def test_local_command_output_exit_and_uuid_are_literal_and_idempotent(self):
        request,receipt=self.completed_command("!printf '<img src=x>' ; printf 'error' >&2; echo x >> marker; exit 7")
        self.assertEqual(7,receipt['exit_code'])
        text=next(m['text']for m in self.broker.messages if m.get('kind')=='command_output')
        self.assertIn('<img src=x>',text);self.assertIn('stderr:\nerror',text)
        self.assertEqual(receipt,self.broker.dispatch(request));self.assertEqual('x\n',(self.root/'marker').read_text())
        with self.assertRaisesRegex(ValueError,'reused'):self.broker.dispatch(dict(request,text='!echo again'))
        with self.assertRaises(ValueError):self.broker.dispatch(dict(request,instance=str(uuid.uuid4())))

    def test_local_command_waits_for_approval_and_can_be_cancelled_before_dispatch(self):
        self.hold_turn()
        cancelled=self.action(action='local_command',text='!touch cancelled')
        command=self.action(action='local_command',text='!touch after')
        self.assertEqual('queued',self.broker.dispatch(cancelled)['state'])
        self.assertEqual('queued',self.broker.dispatch(command)['state'])
        self.broker.dispatch(self.action(action='cancel_queued',prompt=cancelled['id']))
        self.assertFalse((self.root/'after').exists());self.assertEqual('approval',self.broker.state)
        self.finish_permission()
        wait(lambda:self.broker.dispatch(command)['state']=='completed')
        self.assertTrue((self.root/'after').exists());self.assertFalse((self.root/'cancelled').exists())

    def test_local_command_cancel_is_exact_and_blocks_handoff(self):
        request=self.action(action='local_command',text='!sleep 30')
        self.broker.dispatch(request);wait(lambda:self.broker.snapshot()['command_running'])
        with self.assertRaisesRegex(ValueError,'no longer running'):self.broker.dispatch(self.action(action='cancel_command',command=str(uuid.uuid4())))
        with self.assertRaisesRegex(ValueError,'idle'):self.broker.dispatch(self.action(action='handoff'))
        queued=self.action(action='local_command',text='!echo next')
        self.assertEqual('queued',self.broker.dispatch(queued)['state'])
        self.broker.dispatch(self.action(action='cancel_command',command=request['id']))
        wait(lambda:self.broker.dispatch(request)['state']=='cancelled')
        wait(lambda:self.broker.dispatch(queued)['state']=='completed')
        self.assertFalse(self.broker.snapshot()['command_running'])

    def test_local_command_timeout_and_output_limit(self):
        from unittest.mock import patch
        with patch.object(MOD,'COMMAND_TIMEOUT',.2):
            _,receipt=self.completed_command('!yes x | head -c 70000; sleep 30')
        self.assertTrue(receipt['timed_out']);self.assertTrue(receipt['output_truncated'])
        text=next(m['text']for m in self.broker.messages if m.get('kind')=='command_output')
        self.assertLess(len(text),MOD.COMMAND_OUTPUT_BYTES+150)
        self.assertIn('[Command timed out]',text)

    def test_local_command_directory_replacement_and_container_host_denial(self):
        self.broker.directory_identity=(0,0)
        _,receipt=self.completed_command('!touch should-not-exist')
        self.assertEqual('failed',receipt['state']);self.assertFalse((self.root/'should-not-exist').exists())
        self.broker.host_commands=False
        self.assertFalse(self.broker.snapshot()['local_commands'])
        with self.assertRaisesRegex(ValueError,'unavailable'):self.broker.dispatch(self.action(action='local_command',text='!pwd'))
        request=self.action(action='prompt',text='!pwd');self.broker.dispatch(request)
        wait(lambda:self.broker.dispatch(request)['state']=='completed')
        self.assertTrue(any('Fixture reply' in m['text']for m in self.broker.messages))

    def test_usage_updates_are_context_snapshots_not_totals_and_do_not_change_activity(self):
        self.assertIsNone(self.broker.snapshot()['usage'])
        self.broker.dispatch(self.action(action='prompt',text='hold'))
        with self.broker.lock:self.broker.update(dict(sessionUpdate='usage_update',used=142000,size=400000,_meta={'_claude/model':'fixture-model','secret':'ignore'},cost={'amount':9}))
        usage=self.broker.snapshot()['usage'];self.assertEqual(142000,usage['used']);self.assertEqual(400000,usage['size']);self.assertEqual('working',self.broker.state);self.assertNotIn('secret',json.dumps(usage));self.assertNotIn('cost',usage)
        with self.broker.lock:self.broker.update(dict(sessionUpdate='usage_update',used=12000,size=400000))
        self.assertEqual(12000,self.broker.snapshot()['usage']['used'])
        with self.broker.lock:self.broker.update(dict(sessionUpdate='usage_update',used=0,size=400000))
        self.assertEqual(0,self.broker.snapshot()['usage']['used'])

    def test_invalid_usage_numbers_do_not_invent_context_or_capacity(self):
        for value in (-1,True,1.5,float('nan'),9007199254740992):
            with self.broker.lock:self.broker.update(dict(sessionUpdate='usage_update',used=value,size=value))
        self.assertIsNone(self.broker.snapshot()['usage'])
        with self.broker.lock:self.broker.update(dict(sessionUpdate='usage_update',used=12,size=0,_meta={'_claude/model':'model-with-unknown-window'}))
        self.assertEqual(12,self.broker.snapshot()['usage']['used']);self.assertIsNone(self.broker.snapshot()['usage']['size'])

    def test_usage_from_other_session_is_ignored(self):
        receipt=self.broker.dispatch(self.action(action='prompt',text='foreign-usage'))
        wait(lambda:self.broker.state=='ready')
        self.assertIsNone(self.broker.snapshot()['usage'])

    def hold_turn(self):
        active=self.broker.dispatch(self.action(action='prompt',text='permission'))
        wait(lambda:self.broker.state=='approval')
        return active

    def finish_permission(self):
        permission=next(iter(self.broker.permissions.values()))
        self.broker.dispatch(self.action(action='permission',permission=permission['id'],revision=permission['revision'],option='deny'))

    def test_working_turn_queues_followups_until_current_turn_completes(self):
        self.broker.dispatch(self.action(action='prompt',text='hold'))
        queued=self.action(action='prompt',text='after hold');self.assertEqual('queued',self.broker.dispatch(queued)['state'])
        self.assertEqual('working',self.broker.state)
        self.broker.dispatch(self.action(action='cancel'))
        wait(lambda:self.broker.dispatch(queued)['state']=='completed')
        self.assertEqual(0,self.broker.snapshot()['queued_prompts'])

    def test_busy_queue_fifo_idempotent_and_private_until_dispatch(self):
        self.hold_turn()
        first=self.action(action='prompt',text='first queued');second=self.action(action='prompt',text='second queued')
        self.assertEqual('queued',self.broker.dispatch(first)['state']);self.assertEqual('queued',self.broker.dispatch(second)['state'])
        self.assertEqual('queued',self.broker.dispatch(first)['state'])
        with self.assertRaisesRegex(ValueError,'reused'):self.broker.dispatch(dict(first,text='different'))
        self.assertEqual(2,self.broker.snapshot()['queued_prompts'])
        self.assertNotIn('first queued',''.join(r[0]for r in self.broker.db.execute('select data from receipts')))
        self.assertEqual('first queued',self.broker.db.execute('select text from prompt_queue order by rowid limit 1').fetchone()[0])
        self.finish_permission();wait(lambda:all(self.broker.dispatch(c)['state']=='completed'for c in (first,second)))
        self.assertEqual(['permission','first queued','second queued'],[m['text']for m in self.broker.messages if m['role']=='user'])
        self.assertEqual(0,self.broker.db.execute('select count(*) from prompt_queue').fetchone()[0])
        self.assertEqual([first['id'],second['id']],[m['turn']for m in self.broker.messages if m['role']=='assistant'])

    def test_cancel_queued_is_durable_and_never_submits_it(self):
        self.hold_turn();command=self.action(action='prompt',text='do not send');self.broker.dispatch(command)
        cancel=self.action(action='cancel_queued',prompt=command['id']);self.assertEqual('completed',self.broker.dispatch(cancel)['state']);self.assertEqual('completed',self.broker.dispatch(cancel)['state']);self.assertEqual('cancelled',self.broker.dispatch(command)['state'])
        self.finish_permission();wait(lambda:self.broker.state=='ready')
        self.assertFalse(any(m.get('turn')==command['id']for m in self.broker.messages))
        self.assertEqual(0,self.broker.snapshot()['queued_prompts'])

    def test_queue_limit_expiry_and_changed_session_instance(self):
        self.hold_turn()
        commands=[self.action(action='prompt',text=str(i))for i in range(MOD.MAX_QUEUED)]
        for command in commands:self.assertEqual('queued',self.broker.dispatch(command)['state'])
        overflow=self.action(action='prompt',text='overflow')
        with self.assertRaisesRegex(ValueError,'full'):self.broker.dispatch(overflow)
        self.assertIsNone(self.broker.db.execute('select id from receipts where id=?',(overflow['id'],)).fetchone())
        self.broker.db.execute('update prompt_queue set expires=0');self.broker.db.commit();self.assertEqual(0,self.broker.snapshot()['queued_prompts'])
        self.assertTrue(all(self.broker.dispatch(c)['state']=='expired'for c in commands))
        changed=self.action(action='prompt',text='wrong instance');self.broker.dispatch(changed)
        self.broker.db.execute("update prompt_queue set instance='replaced'");self.broker.db.commit()
        self.finish_permission();wait(lambda:self.broker.dispatch(changed)['state']=='blocked')
        self.assertFalse(any(m.get('turn')==changed['id']for m in self.broker.messages))

    def test_streaming_active_reply_stays_one_message_when_followup_is_queued(self):
        self.broker.dispatch(self.action(action='prompt',text='hold'))
        with self.broker.lock:self.broker.update(dict(sessionUpdate='agent_message_chunk',content=dict(type='text',text='prefix ')))
        queued=self.action(action='prompt',text='next turn');self.broker.dispatch(queued)
        with self.broker.lock:self.broker.update(dict(sessionUpdate='agent_message_chunk',content=dict(type='text',text='suffix')))
        replies=[m for m in self.broker.messages if m['role']=='assistant']
        self.assertEqual(1,len(replies));self.assertEqual('prefix suffix',replies[0]['text'])
        self.assertEqual(1,len([m for m in self.broker.messages if m['id']==queued['id']]))

    def test_queued_text_keeps_snapshot_bounded_without_dropping_pending_intents(self):
        self.hold_turn()
        with self.broker.lock:self.broker.messages=[dict(id=str(uuid.uuid4()),role='assistant',text='x'*60000)for _ in range(4)]
        commands=[self.action(action='prompt',text='q'*12000)for _ in range(MOD.MAX_QUEUED)]
        for command in commands:self.broker.dispatch(command)
        snapshot=self.broker.snapshot()
        self.assertLessEqual(len(json.dumps(snapshot['messages']).encode()),256000)
        self.assertTrue({c['id']for c in commands}<={m['id']for m in snapshot['messages']})

    def test_duplicate_broker_start_does_not_erase_live_queued_intents(self):
        self.hold_turn();command=self.action(action='prompt',text='retain this intent');self.broker.dispatch(command)
        with self.assertRaises(OSError):MOD.Broker(str(self.root),str(self.root/'fake-agent'),str(self.root))
        self.assertEqual('queued',self.broker.dispatch(command)['state'])
        self.assertEqual('retain this intent',self.broker.db.execute('select text from prompt_queue where id=?',(command['id'],)).fetchone()[0])

    def test_failed_provider_holds_queue_until_explicit_cancellation(self):
        self.broker.dispatch(self.action(action='prompt',text='hold'));command=self.action(action='prompt',text='held after failure');self.broker.dispatch(command)
        self.broker.agent.terminate();self.broker.agent.wait(timeout=5);wait(lambda:self.broker.state in ('failed','exited'))
        self.assertTrue(self.broker.snapshot()['queue_blocked']);self.assertEqual('queued',self.broker.dispatch(command)['state'])
        self.broker.dispatch(self.action(action='cancel_queued',prompt=command['id']));self.assertEqual('cancelled',self.broker.dispatch(command)['state'])

    def test_changed_session_never_dispatches_queued_intent(self):
        self.hold_turn();command=self.action(action='prompt',text='wrong session');self.broker.dispatch(command)
        self.broker.db.execute("update prompt_queue set session='unrelated'");self.broker.db.commit();self.finish_permission();wait(lambda:self.broker.dispatch(command)['state']=='blocked')
        self.assertFalse(any(m.get('turn')==command['id']for m in self.broker.messages))

    def test_uncertain_prompt_blocks_queued_followups_without_replaying(self):
        original=self.broker.write;self.broker.write=Mock(side_effect=OSError('fixture uncertain'))
        failed=self.action(action='prompt',text='uncertain')
        with self.assertRaises(OSError):self.broker.dispatch(failed)
        self.broker.state='ready'
        queued=self.action(action='prompt',text='must wait');self.assertEqual('queued',self.broker.dispatch(queued)['state'])
        self.broker.write.assert_called_once();self.assertEqual('uncertain',self.broker.dispatch(failed)['state']);self.broker.write=original

    def test_claude_load_replays_large_image_without_retaining_bytes(self):
        self.assertEqual('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',self.broker.session)
        self.assertEqual('ready',self.broker.state)
        self.assertEqual([],self.broker.snapshot()['messages'])
        self.assertNotIn('XXXXX',json.dumps(self.broker.snapshot()))
        receipt=self.broker.dispatch(self.action(action='prompt',text='after replay'))
        wait(lambda:self.broker.state=='ready')
        self.assertIn(receipt['state'],('submitted','completed'))
        self.assertTrue(any(m['text']=='Fixture reply' for m in self.broker.snapshot()['messages']))

    def test_claude_load_preserves_native_uuid_and_explicit_handoff(self):
        self.assertEqual('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',self.broker.session)
        self.assertEqual('claude',self.broker.snapshot()['provider']);self.assertTrue(self.broker.snapshot()['handoff_supported'])
        command=self.action(action='handoff');self.assertEqual('completed',self.broker.dispatch(command)['state']);self.assertIsNotNone(self.broker.agent.poll())
        self.assertEqual('completed',self.broker.dispatch(command)['state'])
    def test_claude_handoff_rejects_pending_tools_and_stale_instances(self):
        self.broker.tools['active']={'status':'in_progress'}
        with self.assertRaisesRegex(ValueError,'idle'):self.broker.dispatch(self.action(action='handoff'))
        with self.assertRaisesRegex(ValueError,'Stale'):self.broker.dispatch(dict(self.action(action='handoff'),instance=str(uuid.uuid4())))
        self.assertIsNone(self.broker.agent.poll())

    def test_codex_load_retains_native_thread_and_handoff_is_one_use(self):
        self.assertEqual('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',self.broker.session)
        self.assertTrue(self.broker.snapshot()['handoff_supported'])
        command=self.action(action='handoff')
        self.assertEqual('completed',self.broker.dispatch(command)['state'])
        self.assertIsNotNone(self.broker.agent.poll())
        self.assertEqual('completed',self.broker.dispatch(command)['state'])
        with self.assertRaisesRegex(ValueError,'busy|ready|Ready'):
            self.broker.dispatch(self.action(action='prompt',text='must not send'))

    def test_codex_load_without_capability_fails_without_a_new_session(self):
        path=self.root/'unsupported';path.mkdir(mode=0o700)
        executable=path/'fake';executable.write_text(FAKE.replace("'loadSession':True","'loadSession':False"));executable.chmod(0o700)
        (path/'intent.json').write_text(json.dumps({'id':str(uuid.uuid4()),'prepared':{'provider':'codex'},'resume_session':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));(path/'intent.json').chmod(0o600)
        broker=MOD.Broker(str(path),str(executable),str(path))
        try:
            wait(lambda:broker.state!='starting')
            self.assertEqual('failed',broker.state);self.assertIsNone(broker.session)
            self.assertIn('session/load',broker.failure)
        finally:
            broker.closed=True;broker.agent.terminate();broker.agent.wait(timeout=5);broker.server.close()

    def test_codex_load_cannot_hide_a_permission_emitted_during_replay(self):
        path=self.root/'load-approval';path.mkdir(mode=0o700)
        permission={'jsonrpc':'2.0','id':'load-permission','method':'session/request_permission','params':{'sessionId':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','toolCall':{'toolCallId':'load','title':'Load permission'},'options':[{'optionId':'allow','name':'Allow once','kind':'allow_once'}]}}
        source=FAKE.replace("session=m['params']['sessionId'];result={}","session=m['params']['sessionId'];print("+repr(json.dumps(permission))+",flush=True);result={}")
        executable=path/'fake';executable.write_text(source);executable.chmod(0o700)
        (path/'intent.json').write_text(json.dumps({'id':str(uuid.uuid4()),'prepared':{'provider':'codex'},'resume_session':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));(path/'intent.json').chmod(0o600)
        broker=MOD.Broker(str(path),str(executable),str(path))
        try:
            wait(lambda:broker.state=='approval')
            self.assertTrue(broker.permissions)
            queued=broker.dispatch({'action':'prompt','instance':broker.instance,'id':str(uuid.uuid4()),'text':'not yet'});self.assertEqual('queued',queued['state']);self.assertEqual('approval',broker.state);self.assertTrue(broker.permissions)
        finally:
            broker.closed=True;broker.agent.terminate();broker.agent.wait(timeout=5);broker.server.close()

    def test_codex_handoff_rejects_unresolved_receipts_and_changed_instance(self):
        command=self.action(action='prompt',text='held');self.broker.receipt(command['id'],command)
        with self.assertRaisesRegex(ValueError,'unresolved'):
            self.broker.dispatch(self.action(action='handoff'))
        with self.assertRaisesRegex(ValueError,'Stale'):
            self.broker.dispatch(dict(self.action(action='handoff'),instance=str(uuid.uuid4())))
        self.assertIsNone(self.broker.agent.poll())

    def test_prompt_receipt_dedup_conflict_and_stale_instance(self):
        command = self.action(action='prompt', text='hello')
        self.broker.dispatch(command)
        wait(lambda: self.broker.state == 'ready')
        self.assertEqual('completed', self.broker.dispatch(command)['state'])
        self.assertEqual(1, sum(m['role']=='user' for m in self.broker.snapshot()['messages']))
        with self.assertRaisesRegex(ValueError, 'reused'):
            self.broker.dispatch(dict(command, text='different'))
        with self.assertRaisesRegex(ValueError, 'Stale'):
            self.broker.dispatch(dict(command, instance=str(uuid.uuid4())))

    def test_two_clients_permission_is_explicit_and_claimed_once(self):
        self.broker.dispatch(self.action(action='prompt', text='permission'))
        wait(lambda: self.broker.state == 'approval')
        permission = self.broker.snapshot()['permissions'][0]
        self.assertEqual(2, len(permission['options']))
        self.assertEqual('approval', self.broker.state)
        wrong = self.action(action='permission', permission=permission['id'], revision='old', option='allow')
        with self.assertRaisesRegex(ValueError, 'no longer'):
            self.broker.dispatch(wrong)
        choice = self.action(action='permission', permission=permission['id'], revision=permission['revision'], option='deny')
        self.broker.dispatch(choice)
        wait(lambda: self.broker.state == 'ready')
        self.assertEqual('submitted', self.broker.dispatch(choice)['state'])
        with self.assertRaisesRegex(ValueError, 'no longer'):
            self.broker.dispatch(dict(choice, id=str(uuid.uuid4())))

    def test_socket_disconnect_does_not_own_agent_lifetime(self):
        sock = socket.socket(socket.AF_UNIX)
        sock.connect(str(self.root/'broker.sock'))
        stream = sock.makefile('rwb')
        MOD.send_line(stream, dict(action='snapshot'))
        snapshot = json.loads(stream.readline())['ok']
        self.assertEqual(self.broker.instance, snapshot['instance'])
        stream.close();sock.close()
        self.assertIsNone(self.broker.agent.poll())
        watcher=socket.socket(socket.AF_UNIX);watcher.connect(str(self.root/'broker.sock'));wire=watcher.makefile('rwb')
        MOD.send_line(wire,dict(action='watch',instance=self.broker.instance))
        self.assertEqual(self.broker.instance,json.loads(wire.readline())['ok']['instance'])
        wire.close();watcher.close()
        self.broker.dispatch(self.action(action='prompt', text='after disconnect'))
        wait(lambda: self.broker.state == 'ready')

    def test_failed_io_is_durable_uncertain_and_never_replayed(self):
        original = self.broker.write
        calls=[]
        def failed(message):
            calls.append(message)
            raise OSError('uncertain')
        self.broker.write = failed
        command = self.action(action='prompt', text='hello')
        with self.assertRaises(OSError): self.broker.dispatch(command)
        self.assertEqual('uncertain', self.broker.dispatch(command)['state'])
        self.assertEqual(1, len(calls))
        self.broker.write = original

    def test_hidden_thoughts_and_oversized_history_are_not_retained(self):
        self.broker.update(dict(sessionUpdate='agent_thought_chunk', content={'type':'text','text':'PRIVATE'}))
        self.assertNotIn('PRIVATE', json.dumps(self.broker.snapshot()))
        for i in range(6):
            self.broker.turn = str(i)
            # Avoid writing huge fixtures to the test runner's terminal.
            from unittest.mock import patch
            with patch('builtins.print'):
                self.broker.update(dict(sessionUpdate='agent_message_chunk', content={'type':'text','text':'x'*64000}))
        self.assertLess(len(json.dumps(self.broker.snapshot()).encode()), MOD.MAX_WIRE)

    def test_launch_initial_prompt_is_submitted_once_after_initialization(self):
        other=self.root/'initial';other.mkdir(mode=0o700)
        ident=str(uuid.uuid4());(other/'intent.json').write_text(json.dumps(dict(id=ident,initial_prompt='initial prompt')));(other/'intent.json').chmod(0o600)
        broker=MOD.Broker(str(other),str(self.root/'fake-agent'),str(other))
        try:
            wait(lambda:broker.state=='ready' and any(m.get('role')=='assistant'for m in broker.messages))
            snapshot=broker.snapshot();self.assertNotIn('initial_prompt',json.loads((other/'intent.json').read_text()));self.assertEqual(1,sum(m['id']==ident for m in snapshot['messages']))
            self.assertEqual('completed',next(r['state']for r in snapshot['receipts']if r['id']==ident))
        finally:
            broker.closed=True;broker.agent.terminate();broker.agent.wait(timeout=5);broker.server.close()

if __name__ == '__main__': unittest.main()


class FrameBoundsTests(unittest.TestCase):
    def test_oversize_adapter_frame_fails_closed_with_specific_reason(self):
        broker=SimpleNamespace(agent=SimpleNamespace(stdout=io.BytesIO(b'X'*(MOD.MAX_WIRE+1)+b'\n'),poll=lambda:None),
                               lock=threading.RLock(),permissions={},state='starting',fail=Mock(),emit=Mock(),update=Mock())
        MOD.Broker.read_agent(broker)
        broker.fail.assert_called_once()
        self.assertIn('8 MiB',broker.fail.call_args.args[0])
        broker.update.assert_not_called()
        self.assertEqual('failed',broker.state)
