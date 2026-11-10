"""Busy native input: no live processes, native logs or human input."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class BusyInput(unittest.TestCase):
 def observation(self,kind='codex',screen='screen',draft='',spinner='⠼'):
  border='─'*60
  visible=f'tool output {screen}\n── {spinner} Working '+border+'\n'+draft+'\n'+border+'\n~/project (main)\nusage changes '+screen
  return dict(kind=kind,identity='process',screen=screen,context='',visible=visible,in_mode=False,cwd='/project',env={},base=None,args=[],target='$0:@0.%0')
 def state(self,o):return dict(state=o.get('_state','working'),source={'codex':'codex_events','claude':'claude_events','pi':'pi_bridge'}[o['kind']])
 def request(self,o):return dict(action='send',identity='process',screen=o['screen'],input_guard=a.message_input_guard(o,self.state(o)),require_active=True,conversation='conversation',text='Human instruction')
 def run_send(self,observations,request=None,linked=None,fail_enter=False):
  calls=[]
  def tmux(_,*args,**kwargs):
   calls.append(args)
   if fail_enter and args[0]=='send-keys':raise a.Failure(502,'failed')
   return ''
  with patch.object(a,'observe',side_effect=observations),patch.object(a,'provider_activity',side_effect=self.state),patch.object(a,'conversations',return_value=linked if linked is not None else [dict(id='conversation',linked=True)]),patch.object(a,'tmux',side_effect=tmux):
   result=a.execute(request or self.request(observations[0]))
  return result,calls
 def test_verified_busy_providers_use_normal_enter_once_without_interrupt(self):
  for kind in ('codex','claude','pi'):
   o=self.observation(kind);result,calls=self.run_send([o,o])
   self.assertTrue(result['sent']);self.assertTrue(result['submitted_while_working'])
   self.assertEqual(sum(c[0]=='paste-buffer' for c in calls),1)
   self.assertEqual([c[-1] for c in calls if c[0]=='send-keys'],['Enter'])
 def test_busy_output_since_worker_snapshot_can_refresh_before_final_fingerprint(self):
  for kind in ('codex','claude'):
   old=self.observation(kind,screen='old-worker-snapshot');current=self.observation(kind,screen='latest')
   result,calls=self.run_send([current,current],request=self.request(old))
   self.assertTrue(result['sent']);self.assertEqual(sum(c[0]=='paste-buffer' for c in calls),1)
 def test_pi_spinner_output_changes_do_not_change_empty_editor_guard(self):
  before=self.observation('pi');after=self.observation('pi',screen='changed',spinner='⠋')
  self.assertEqual(a.message_input_guard(before,self.state(before)),a.message_input_guard(after,self.state(after)))
  result,_=self.run_send([before,after]);self.assertTrue(result['sent'])
 def test_pi_drafts_or_unfamiliar_layout_do_not_receive_automatic_input(self):
  for o in (self.observation('pi',draft='human draft'),dict(self.observation('pi'),visible='unknown extension dialog')):
   self.assertIsNone(a.message_input_guard(o,self.state(o)))
   result,calls=self.run_send([o]);self.assertEqual(result,dict(sent=False,deferred=True,not_sent=True));self.assertFalse(any(c[0]=='paste-buffer' for c in calls))
 def test_changing_screen_defers_only_before_any_paste(self):
  o=self.observation();result,calls=self.run_send([o,self.observation(screen='changed')])
  self.assertEqual(result,dict(sent=False,deferred=True,not_sent=True));self.assertFalse(any(c[0] in ('paste-buffer','send-keys') for c in calls));self.assertTrue(any(c[0]=='delete-buffer' for c in calls))
 def test_changed_process_conversation_unknown_approval_and_copy_mode_fail_closed(self):
  o=self.observation()
  cases=[([o,dict(o,identity='replacement')],None),([dict(o,_state='unknown')],None),([o,dict(o,_state='approval')],None),([dict(o,in_mode=True)],None),([dict(o,visible='Pick an option. Enter to select; arrow keys navigate')],None),([o],[]),([o],[dict(id='replacement',linked=True)])]
  for observations,linked in cases:
   with self.assertRaises(a.Failure):self.run_send(observations,request=self.request(o),linked=linked)
 def test_failed_enter_after_paste_is_uncertain_not_deferrable(self):
  o=self.observation()
  with self.assertRaises(a.Failure) as error:self.run_send([o,o],fail_enter=True)
  self.assertEqual(error.exception.status,502)

if __name__=='__main__':unittest.main()
