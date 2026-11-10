"""Native kind-only environment envelopes are not human messages."""
import importlib.util,copy,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('a',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class EnvironmentEnvelope(unittest.TestCase):
 def payload(self):
  return dict(type='message',id='msg_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',role='user',content=[dict(type='input_text',text='<environment_context>Private machine context</environment_context>')],internal_chat_message_metadata_passthrough=dict(turn_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',create_time=1794310207.789,content_item_kinds=['environments.environment_context']))
 def test_known_native_envelope_filtered_but_literal_xml_and_lifecycle_preserved(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'session.jsonl';p=self.payload();now=int(time.time())
   records=[dict(type='response_item',payload=p),dict(type='response_item',payload=dict(type='message',role='user',content=[dict(type='input_text',text=p['content'][0]['text'])])),dict(type='response_item',payload=dict(type='message',role='assistant',content='Visible reply')),dict(type='event_msg',timestamp=now,payload=dict(type='task_complete',turn_id='root',root_turn_id='root'))]
   path.write_text(''.join(json.dumps(r)+'\n' for r in records));h=a.history(path,'codex')
   self.assertTrue(a.codex_internal_user(p));self.assertEqual([m['role'] for m in h['messages']],['user','assistant']);self.assertEqual(h['messages'][0]['text'],p['content'][0]['text'])
   self.assertEqual(a.codex_activity(path,now)['state'],'ready');self.assertEqual(a.launch_title(dict(path=str(path)),'codex'),p['content'][0]['text'])
 def test_ambiguous_mixed_and_contradictory_envelopes_remain_literal(self):
  variants=[]
  for field,value in [('turn_id',None),('turn_id','not-a-uuid'),('create_time',None),('create_time',True),('create_time','1794310207'),('create_time',float('nan')),('content_item_metadata',None),('content_item_metadata',[]),('content_item_metadata',[dict(provenance=dict(type='user'))]),('content_item_kinds',['generic.turn_aborted']),('content_item_kinds',['future.kind'])]:
   p=copy.deepcopy(self.payload());p['internal_chat_message_metadata_passthrough'][field]=value;variants.append(p)
  for field,value in [('id',None),('id','message'),('role','assistant'),('content',[dict(type='output_text',text='literal')])]:
   p=copy.deepcopy(self.payload());p[field]=value;variants.append(p)
  p=copy.deepcopy(self.payload());p['content']*=2;p['internal_chat_message_metadata_passthrough']['content_item_kinds']=['environments.environment_context','user.text'];variants.append(p)
  for p in variants:
   with self.subTest(payload=p):self.assertFalse(a.codex_internal_user(p))
 def test_cache_upgrade_and_receipts_keep_native_reply_version_and_cursor(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'session.jsonl';records=[dict(type='response_item',payload=self.payload()),dict(type='response_item',payload=dict(type='message',role='user',content='Human input')),dict(type='response_item',payload=dict(type='message',role='assistant',content='Reply'))];path.write_text(''.join(json.dumps(r)+'\n' for r in records))
   candidate=dict(id='linked',session='session',path=str(path),linked=True);observation=dict(kind='codex',identity='process',base=None,cwd=directory,env={},args=[],target='$0:@0.%0',visible='',context='',screen='screen',in_mode=False)
   old=a.reply_observation(candidate,'codex')
   with patch.object(a,'observe',return_value=observation),patch.object(a,'conversations',return_value=[candidate]),patch.object(a,'provider_activity',return_value=dict(state='ready')),patch.object(a,'observed_background_tasks',return_value=None):
    page=a.execute(dict(action='conversation',known_version='codex-visible-v1:'+old['version']))
    self.assertTrue(page['history_reset']);self.assertTrue(page['history_version'].startswith('codex-visible-v2:'));self.assertEqual([m['text'] for m in page['messages']],['Human input','Reply'])
    self.assertEqual(page['_outbox_observation']['users'][0]['digest'],a.input_hash('Human input'));self.assertEqual(len(page['_outbox_observation']['users']),1)
    self.assertEqual(page['reply']['version'],old['version']);self.assertEqual(page['reply']['cursor'],old['cursor'])
    status=a.execute(dict(action='outbox_status',identity='process'));self.assertEqual([u['digest'] for u in status['users']],[a.input_hash('Human input')])
if __name__=='__main__':unittest.main()
