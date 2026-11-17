import importlib.util
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
        executable.write_text(FAKE)
        executable.chmod(0o700)
        if self._testMethodName.startswith(('test_codex_','test_claude_')):
            (self.root/'intent.json').write_text(json.dumps({'id':str(uuid.uuid4()),'prepared':{'provider':'claude'if self._testMethodName.startswith('test_claude_')else'codex'},'resume_session':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}));(self.root/'intent.json').chmod(0o600)
        self.broker = MOD.Broker(str(self.root), str(executable), str(self.root))
        wait(lambda: self.broker.state == 'ready')

    def tearDown(self):
        self.broker.closed = True
        self.broker.agent.terminate()
        self.broker.agent.wait(timeout=5)
        self.broker.server.close()
        self.temp.cleanup()

    def action(self, **kwargs):
        return dict(instance=self.broker.instance, id=str(uuid.uuid4()), **kwargs)

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
            with self.assertRaisesRegex(ValueError,'ready|busy|Ready'):broker.dispatch({'action':'prompt','instance':broker.instance,'id':str(uuid.uuid4()),'text':'not yet'})
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
