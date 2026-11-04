"""No live agent input: outbox observations and pre-paste readiness contracts."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)

class AgentOutbox(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'log.jsonl'
        self.observation=dict(identity='process',screen='screen',kind='codex',base=Path('/proc')/str(os.getpid()),visible='',context='',in_mode=False,cwd=self.temp.name,env={},args=[],target='$0:@0.%0')
        self.candidate=dict(id='linked',session='session',path=str(self.path),linked=True)
    def write(self,records):self.path.write_text(''.join(json.dumps(r)+'\n' for r in records))
    def test_native_observation_never_uses_project_only_or_ambiguous_logs(self):
        self.write([dict(type='response_item',payload=dict(type='message',role='user',content='PRIVATE_INPUT')),
                    dict(type='response_item',payload=dict(type='message',role='assistant',content='PRIVATE_REPLY'))])
        with patch.object(agent,'observe',return_value=self.observation),patch.object(agent,'provider_activity',return_value={'state':'ready'}):
            for candidates in [[dict(self.candidate,linked=False)],[self.candidate,dict(self.candidate,id='second')]]:
                with patch.object(agent,'conversations',return_value=candidates):
                    result=agent.execute(dict(action='outbox_status',identity='process',conversation='linked'))
                    self.assertIsNone(result['log']);self.assertEqual(result['users'],[])
            with patch.object(agent,'conversations',return_value=[self.candidate]):
                result=agent.execute(dict(action='outbox_status',identity='process'))
                self.assertEqual(result['log']['conversation'],'linked');self.assertEqual(len(result['users']),1)
                self.assertEqual(result['users'][0]['digest'],agent.input_hash('PRIVATE_INPUT'))
                self.assertNotIn('PRIVATE_INPUT',json.dumps(result));self.assertNotIn('PRIVATE_REPLY',json.dumps(result))
            with self.assertRaises(agent.Failure) as error:agent.execute(dict(action='outbox_status',identity='replacement'))
            self.assertEqual(error.exception.status,409)
    def test_claude_and_pi_user_messages_provide_confirmation_evidence(self):
        records={
            'claude':[dict(type='user',message=dict(role='user',content='INPUT')),dict(type='user',message=dict(role='user',content=[dict(type='tool_result',tool_use_id='tool',content='TOOL_OUTPUT')]))],
            'pi':[dict(type='session',version=3,id='session'),dict(type='message',id='u',parentId=None,message=dict(role='user',content=[dict(type='text',text='INPUT')])),dict(type='message',id='t',parentId='u',message=dict(role='toolResult',content=[dict(type='text',text='TOOL_OUTPUT')]))]
        }
        for kind,items in records.items():
            self.write(items)
            with patch.object(agent,'observe',return_value=dict(self.observation,kind=kind)),patch.object(agent,'conversations',return_value=[self.candidate]),patch.object(agent,'provider_activity',return_value={'state':'ready'}):
                observed=agent.execute(dict(action='outbox_status',identity='process'))
            self.assertEqual(len(observed['users']),1,kind)
            self.assertEqual(observed['users'][0]['digest'],agent.input_hash('INPUT'))
            self.assertNotIn('TOOL_OUTPUT',json.dumps(observed))

    def test_confirmation_hash_is_computed_before_display_shortening(self):
        text='long user input '*700
        records=[dict(type='response_item',payload=dict(type='message',role='assistant',content='x'*16000)) for _ in range(99)]
        records.append(dict(type='response_item',payload=dict(type='message',role='user',content=text)))
        self.write(records);message=agent.history(self.path,'codex',include_activity=False)['messages'][-1]
        self.assertTrue(message['truncated']);self.assertEqual(message['input_hash'],agent.input_hash(text))
        self.assertNotEqual(agent.input_hash(message['text']),message['input_hash'])
    def test_busy_or_newly_busy_agent_is_rejected_before_paste(self):
        request=dict(action='send',identity='process',screen='screen',text='NEVER_PASTE',require_ready=True)
        busy=dict(self.observation,_state='working');ready=dict(self.observation,_state='ready')
        for observations in [[busy],[ready,busy]]:
            calls=[]
            def tmux(_request,*args,**kwargs):calls.append(args);return ''
            with patch.object(agent,'observe',side_effect=observations),patch.object(agent,'provider_activity',side_effect=lambda o:{'state':o['_state']}),patch.object(agent,'tmux',side_effect=tmux):
                with self.assertRaises(agent.Failure) as error:agent.execute(request)
                self.assertEqual(error.exception.status,409)
            self.assertFalse(any(c[0] in ('paste-buffer','send-keys') for c in calls))

if __name__=='__main__':unittest.main()
