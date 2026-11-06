"""Restart plans/guards with synthetic logs and mocked tmux; no live agents."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Restart(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.log=self.root/'session.jsonl';self.log.write_text('{}\n')
  self.session='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';self.id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  self.obs=dict(identity='old',kind='claude',cwd=str(self.root),env={},args=[],target='$0:@0.%0')
  self.request=dict(identity='old',restart_id=self.id)
  self.candidate=dict(id='conversation',session=self.session,path=str(self.log),linked=True)
 def test_provider_resume_commands_are_exact_and_have_no_prompt_or_last(self):
  for kind,tail in [('claude',['--resume',self.session]),('pi',['--session',str(self.log)]),('codex',['resume',self.session])]:
   with patch.object(a,'conversations',return_value=[self.candidate]),patch.object(a,'launch_executable',return_value=('/bin/true','exe','/bin')):
    plan=a.restart_plan(self.request,dict(self.obs,kind=kind))
   self.assertEqual(plan['command'],['/bin/true',*tail]);self.assertEqual(plan['project'],str(self.root))
 def test_missing_ambiguous_or_replaced_process_is_never_stopped(self):
  for linked in [[],[dict(self.candidate,linked=False)],[self.candidate,self.candidate]]:
   with patch.object(a,'conversations',return_value=linked),patch.object(a,'tmux') as tmux:
    with self.assertRaises(a.Failure):a.restart_plan(self.request,self.obs)
    tmux.assert_not_called()
  with self.assertRaises(a.Failure):a.restart_plan(self.request,dict(self.obs,identity='replacement'))
 def test_changed_resume_plan_and_final_process_race_fail_before_respawn(self):
  with patch.object(a,'conversations',return_value=[self.candidate]),patch.object(a,'launch_executable',return_value=('/bin/true','exe','/bin')):
   plan=a.restart_plan(self.request,self.obs)
   with patch.object(a,'tmux') as tmux:
    with self.assertRaises(a.Failure):a.restart_agent(dict(self.request,plan=dict(plan,session='wrong')),self.obs)
    tmux.assert_not_called()
   calls=[]
   with patch.object(a,'tmux',side_effect=lambda _,*args,**kw:calls.append(args) or ''),patch.object(a,'observe',return_value=dict(self.obs,identity='replacement')):
    with self.assertRaises(a.Failure):a.restart_agent(dict(self.request,plan=plan),self.obs)
   self.assertFalse(any(c[0]=='respawn-pane' for c in calls))
 def test_status_rejects_unrelated_process_and_requires_exact_session_marker(self):
  plan=dict(identity='old',provider='claude',project=str(self.root),session=self.session,conversation='conversation')
  request=dict(self.request,plan=plan)
  new=dict(self.obs,identity='new',env={'CC_RESTART_ID':self.id})
  with patch.object(a,'observe',return_value=new),patch.object(a,'tmux',return_value=json.dumps(dict(id=self.id,old='old'))),patch.object(a,'conversations',return_value=[self.candidate]):
   self.assertEqual(a.restart_status(request),dict(state='complete',instance='new'))
  for changed in [dict(new,env={}),dict(new,cwd='/elsewhere'),dict(new,kind='pi')]:
   with patch.object(a,'observe',return_value=changed):
    with self.assertRaises(a.Failure):a.restart_status(request)
  with patch.object(a,'observe',return_value=new),patch.object(a,'tmux',return_value='{}'):
   with self.assertRaises(a.Failure):a.restart_status(request)
