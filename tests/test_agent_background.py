"""Background-task lifecycle evidence. Synthetic logs only, never task output files."""
import importlib.util,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from html import escape
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Background(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=Path(self.tmp.name)/'session.jsonl';self.now=int(time.time());self.session='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 def call(self,id='call',stamp=None,title='Wait for suite',kind='Bash'):
  return dict(type='assistant',sessionId=self.session,timestamp=stamp or self.now-20,message=dict(role='assistant',content=[dict(type='tool_use',id=id,name=kind,input=dict(description=title,run_in_background=True,command='PRIVATE_COMMAND',prompt='PRIVATE_PROMPT'))]))
 def launch(self,id='task',call='call',stamp=None,agent=False):
  result=dict(isAsync=True,agentId=id) if agent else dict(backgroundTaskId=id)
  return dict(type='user',sessionId=self.session,timestamp=stamp or self.now-19,toolUseResult=result,message=dict(role='user',content=[dict(type='tool_result',tool_use_id=call,content='Task launched')]))
 def notice(self,id='task',state='completed',stamp=None,summary='Suite finished',**extra):
  return dict(type='user',sessionId=self.session,timestamp=stamp or self.now-2,origin={'kind':'task-notification'},turnOrigin='task_notification',message=dict(role='user',content=f'<task-notification><task-id>{id}</task-id><tool-use-id>call</tool-use-id><output-file>/PRIVATE_OUTPUT</output-file><status>{state}</status><summary>{escape(summary)}</summary></task-notification>\nRead the output file if needed.'),**extra)
 def fold(self,records):return a.fold_background_tasks(records,self.session,self.now)[0]
 def test_launch_is_not_task_completion_and_notification_finishes_exact_task(self):
  records=[self.call(),self.launch()];tasks=self.fold(records);self.assertEqual(tasks[0]['state'],'running');self.assertEqual(tasks[0]['title'],'Wait for suite')
  records+=[self.notice()];tasks=self.fold(records);self.assertEqual(tasks[0]['state'],'completed');self.assertEqual(tasks[0]['finished_at'],self.now-2)
  records+=[self.launch(stamp=self.now-1)];self.assertEqual(self.fold(records)[0]['state'],'completed')
  self.path.write_text(''.join(json.dumps(r)+'\n' for r in records));page=a.history(self.path,'claude');self.assertEqual(page['messages'],[]);self.assertEqual(page['activities'][0]['status'],'background')
  rendered=json.dumps(tasks)
  for secret in ['PRIVATE_OUTPUT','PRIVATE_PROMPT','PRIVATE_COMMAND','task-notification']:self.assertNotIn(secret,rendered)
 def test_subagents_waiting_failures_stale_and_completion_without_launch(self):
  self.assertEqual(self.fold([self.call(kind='Agent'),self.launch(agent=True)])[0]['state'],'running')
  waiting=self.notice(summary='Agent "Review" is waiting on its own background work')
  self.assertEqual(self.fold([self.call(kind='Agent'),self.launch(agent=True),waiting])[0]['state'],'waiting')
  for state,expected in [('failed','failed'),('killed','cancelled'),('completed','completed')]:
   tasks=self.fold([self.notice(state=state)]);self.assertEqual(tasks[0]['state'],expected);self.assertIsNone(tasks[0]['started_at'])
  self.assertEqual(self.fold([self.call(stamp=self.now-2000),self.launch(stamp=self.now-1999)])[0]['state'],'unverified')
 def test_human_xml_sidechains_foreign_sessions_invalid_times_and_xml_are_not_evidence(self):
  human=self.notice();human.pop('origin');human.pop('turnOrigin')
  future=self.notice(stamp=self.now+100)
  foreign=self.notice();foreign['sessionId']='another-session'
  malformed=self.notice();malformed['message']['content']='<!DOCTYPE x [<!ENTITY x "secret">]><task-notification>&x;</task-notification>'
  missing=self.notice();missing['message']=None
  self.assertEqual(self.fold([human,future,foreign,malformed,missing,self.notice(isSidechain=True)]),[])
 def test_legacy_launch_text_is_accepted_only_for_a_background_request(self):
  launch=self.launch();launch.pop('toolUseResult');launch['message']['content'][0]['content']='Command running in background with ID: task. Output follows.'
  self.assertEqual(self.fold([self.call(),launch])[0]['state'],'running')
  call=self.call();call['message']['content'][0]['input']['run_in_background']=False
  self.assertEqual(self.fold([call,launch]),[])
 def test_ambiguous_launch_metadata_and_unknown_native_status_are_unverified(self):
  launch=self.launch();launch['message']['content'].append(dict(type='tool_result',tool_use_id='other',content='Another tool'))
  self.assertEqual(self.fold([self.call(),launch]),[])
  unknown=self.notice(state='new-provider-state')
  self.assertEqual(self.fold([self.call(),self.launch(),unknown])[0]['state'],'unverified')
 def test_task_notifications_do_not_change_visible_reply_or_become_user_input(self):
  records=[self.call(),self.launch(),dict(type='assistant',sessionId=self.session,timestamp=self.now-5,message=dict(role='assistant',content='I will report the results.'))]
  self.path.write_text(''.join(json.dumps(r)+'\n' for r in records));chosen=dict(id='conversation',path=str(self.path))
  before=a.reply_observation(chosen,'claude');visible=a.history(self.path,'claude')['messages']
  with self.path.open('a') as f:f.write(json.dumps(self.notice())+'\n')
  after=a.reply_observation(chosen,'claude')
  self.assertEqual(before['cursor'],after['cursor']);self.assertEqual(visible,a.history(self.path,'claude')['messages'])
 def test_bounded_process_linked_snapshot_and_partial_append(self):
  self.path.write_text(''.join(json.dumps(r)+'\n' for n in range(12) for r in [self.call(id=f'c{n}'),self.launch(id=f't{n}',call=f'c{n}')]))
  observed=dict(kind='claude');candidate=dict(linked=True,id='conversation',session=self.session,path=str(self.path))
  snapshot=a.observed_background_tasks(observed,candidate);self.assertEqual(len(snapshot['tasks']),8);self.assertTrue(snapshot['limited']);self.assertFalse(snapshot['unavailable'])
  self.assertIsNone(a.observed_background_tasks(observed,dict(candidate,linked=False)))
  self.assertIsNone(a.observed_background_tasks(dict(kind='pi'),candidate))
  with self.path.open('a') as f:f.write('{')
  self.assertTrue(a.observed_background_tasks(observed,candidate)['unavailable'])
