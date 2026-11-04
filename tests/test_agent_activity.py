"""Provider-visible activity contracts; no real sessions or model calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)

class AgentActivity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'log.jsonl'
    def write(self,records):
        self.path.write_text(''.join(json.dumps(record)+'\n' for record in records))
    def test_claude_pairs_results_and_excludes_hidden_records(self):
        self.write([
            dict(type='assistant',message=dict(role='assistant',content=[dict(type='thinking',thinking='Provider-visible summary',signature='SIGNATURE_SECRET'),dict(type='tool_use',id='call',name='Read',input={'file_path':'<script>.rs'}),dict(type='text',text='Checking a file')])),
            dict(type='assistant',isSidechain=True,message=dict(role='assistant',content=[dict(type='tool_use',id='side',name='SIDECHAIN_SECRET')])),
            dict(type='user',message=dict(role='user',content=[dict(type='tool_result',tool_use_id='unmatched',content='UNMATCHED_SECRET'),dict(type='tool_result',tool_use_id='call',content=[dict(type='text',text='File content <img src=x>'),dict(type='image',source={'data':'IMAGE_SECRET'})],is_error=True)])),
            dict(type='assistant',isMeta=True,message=dict(role='assistant',content=[dict(type='thinking',thinking='META_SECRET')]))])
        page=agent.history(self.path,'claude');entries=page['activities']
        self.assertEqual([m['text'] for m in page['messages']],['Checking a file'])
        self.assertEqual(page['messages'][0]['order'],2)
        self.assertEqual([e['kind'] for e in entries],['thinking','tool'])
        self.assertEqual(entries[1]['status'],'error');self.assertIn('File content',entries[1]['output'])
        encoded=json.dumps(page)
        for secret in ['SIGNATURE_SECRET','SIDECHAIN_SECRET','UNMATCHED_SECRET','IMAGE_SECRET','META_SECRET']:self.assertNotIn(secret,encoded)
    def test_codex_summaries_and_both_tool_formats_preserve_reply_cursor(self):
        records=[dict(type='response_item',payload=dict(type='message',role='assistant',content='Visible reply'))]
        self.write(records)
        chosen={'id':'fixture','path':str(self.path)};reply=agent.reply_observation(chosen,'codex')['cursor']
        records += [
            dict(type='response_item',payload=dict(type='reasoning',summary=[dict(type='summary_text',text='Readable summary')],content=[dict(type='text',text='RAW_SECRET')],encrypted_content='ENCRYPTED_SECRET')),
            dict(type='response_item',payload=dict(type='function_call',name='exec',call_id='a',arguments='{"cmd":"pwd"}')),
            dict(type='response_item',payload=dict(type='custom_tool_call',name='apply_patch',call_id='b',input='patch details')),
            dict(type='response_item',payload=dict(type='custom_tool_call_output',call_id='b',output='Done')),
            dict(type='response_item',payload=dict(type='function_call_output',call_id='a',output='directory')),
            dict(type='response_item',payload=dict(type='message',role='developer',content='DEVELOPER_SECRET'))]
        self.write(records);page=agent.history(self.path,'codex')
        self.assertEqual([e['status'] for e in page['activities']],['recorded','completed','completed'])
        self.assertEqual(page['activities'][0]['text'],'Readable summary')
        self.assertEqual(agent.reply_observation(chosen,'codex')['cursor'],reply)
        for secret in ['RAW_SECRET','ENCRYPTED_SECRET','DEVELOPER_SECRET']:self.assertNotIn(secret,json.dumps(page))
    def test_pi_activity_follows_only_selected_branch_and_before_boundary(self):
        self.write([
            dict(type='session',version=3,id='session'),
            dict(type='message',id='u',parentId=None,message=dict(role='user',content='Question')),
            dict(type='message',id='old',parentId='u',message=dict(role='assistant',content=[dict(type='toolCall',id='bad',name='ABANDONED_SECRET',arguments={})])),
            dict(type='message',id='call',parentId='u',message=dict(role='assistant',content=[dict(type='thinking',thinking='Visible thought'),dict(type='toolCall',id='pi-call',name='bash',arguments={'command':'pwd'})])),
            dict(type='message',id='result',parentId='call',message=dict(role='toolResult',toolCallId='pi-call',content=[dict(type='text',text='directory')],isError=False)),
            dict(type='message',id='a',parentId='result',message=dict(role='assistant',content='Answer'))])
        page=agent.history(self.path,'pi')
        self.assertEqual([e['kind'] for e in page['activities']],['thinking','tool'])
        self.assertEqual(page['activities'][1]['status'],'completed');self.assertNotIn('ABANDONED_SECRET',json.dumps(page))
        active=agent.history(self.path,'pi',active_leaf='call')
        self.assertEqual(active['activities'][1]['status'],'pending');self.assertNotIn('Answer',json.dumps(active))
        before=page['activities'][0]['position']
        self.assertEqual(agent.history(self.path,'pi',before=before)['activities'],[])
    def test_activity_before_first_text_is_not_lost(self):
        self.write([
            dict(type='response_item',payload=dict(type='reasoning',summary=[dict(type='summary_text',text='Before the reply')])),
            dict(type='response_item',payload=dict(type='message',role='assistant',content='Reply'))])
        page=agent.history(self.path,'codex')
        self.assertEqual(len(page['activities']),1)
        self.assertLess(page['activities'][0]['position'],int(page['messages'][0]['id']))

    def test_activity_only_pages_bounds_and_incomplete_appends(self):
        self.write([dict(type='response_item',payload=dict(type='custom_tool_call',name='exec',call_id=str(i),input='x'*20000)) for i in range(230)])
        with self.path.open('a') as stream:stream.write('{"type":"response_item"')
        page=agent.history(self.path,'codex');self.assertEqual(len(page['activities']),100);self.assertTrue(page['activity_limited'])
        self.assertLessEqual(sum(len(e.get(k,'')) for e in page['activities'] for k in ['text','arguments','output']),256000)
        older=agent.history(self.path,'codex',before=page['older_cursor'])
        self.assertTrue(set(e['id'] for e in older['activities']).isdisjoint(e['id'] for e in page['activities']))
        self.assertTrue(all(e['status']=='pending' for e in page['activities']))
        self.assertEqual(agent.history(self.path,'codex',include_activity=False)['activities'],[])

if __name__=='__main__':unittest.main()
