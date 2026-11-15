"""Native disclosure fixtures and input guards. No real harnesses are launched."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Trust(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=str(Path(self.tmp.name).resolve());self.launch='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';self.obs=dict(kind='claude',identity='verified-pid-start-boot',in_mode=False,cwd=self.root,env={'CC_LAUNCH_ID':self.launch},target='$1:@2.%3',visible='')
  self.marker=dict(launch_id=self.launch,project=self.root,provider='claude',session='$1',window='@2',pane='%3')
  self.patch=patch.object(a,'tmux',return_value=json.dumps(self.marker));self.tmux=self.patch.start();self.addCleanup(self.patch.stop);self.candidates=patch.object(a,'conversations',return_value=[]);self.candidates.start();self.addCleanup(self.candidates.stop)
 def fixture(self,kind='claude',selected=1):
  if kind=='claude': text=f'Accessing workspace:\n\n {self.root}\n\nQuick safety check: Is this a project you created or one you trust?\n 1. Yes, I trust this folder\n 2. No, exit\n\n Enter to confirm · Esc to cancel'
  else:text=f'You are in {self.root}\n\nDo you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.\n 1. Yes, continue\n 2. No, quit\n\n Press enter to continue'
  text=text.replace(f' {selected}.',f'❯ {selected}.');obs=dict(self.obs,kind=kind,visible=text);self.marker['provider']=kind;self.tmux.return_value=json.dumps(self.marker);return obs
 def test_current_claude_refusal_first_picker_has_exact_guarded_down_navigation(self):
  obs=self.fixture();obs['visible']=obs['visible'].replace('❯ 1. Yes, I trust this folder\n 2. No, exit','❯ No, exit\n  Yes, I trust this folder')
  prompt=a.folder_trust(obs);self.assertEqual(prompt['profile'],'claude-folder-v2');self.assertEqual(prompt['selected'],1);self.assertEqual(prompt['trust_choice'],2)
  next_obs=dict(obs,visible=obs['visible'].replace('❯ No, exit','  No, exit').replace('  Yes, I trust this folder','❯ Yes, I trust this folder'))
  self.assertEqual(a.folder_trust(next_obs)['id'],prompt['id'])
  request=dict(identity=obs['identity'],trust_id=prompt['id'],launch_id=self.launch,screen=prompt['screen'],choice='trust')
  with patch.object(a,'observe',side_effect=[obs,next_obs]):
   self.assertTrue(a.answer_folder_trust(request,obs)['submitted'])
  keys=[c.args[-1] for c in self.tmux.call_args_list if 'send-keys' in c.args];self.assertEqual(keys,['Down','Enter'])
 def test_current_codex_back_to_command_center_picker_is_exact(self):
  obs=self.fixture('codex');obs['visible']=f"Folder access\n{self.root}\n\nTrust this folder? Codex can read, edit, and run files here, subject to your permission settings. Your trust decision will be saved.\n\n› 1. Trust and continue\n  2. Back to Agent Command Center\n\nenter continue · esc back"
  prompt=a.folder_trust(obs);self.assertEqual(prompt['profile'],'codex-folder-v3');self.assertEqual(prompt['trust_choice'],1);self.assertEqual(prompt['labels'],['Trust and continue','Back to Agent Command Center'])
  self.assertIsNone(a.folder_trust(dict(obs,visible=obs['visible'].replace('Back to Agent Command Center','Open something else'))))
 def test_recognizes_both_native_profiles_and_binds_full_disclosure(self):
  for kind in ['claude','codex']:
   obs=self.fixture(kind);p=a.folder_trust(obs);self.assertEqual(p['folder'],self.root);self.assertEqual(p['launch_id'],self.launch);self.assertEqual(p['selected'],1)
   other=self.fixture(kind,2);self.assertEqual(a.folder_trust(other)['id'],p['id']);self.assertNotEqual(a.folder_trust(other)['screen'],p['screen'])
   self.assertNotEqual(a.folder_trust(dict(obs,visible=obs['visible'].replace('Quick safety check:','Warning changed. Quick safety check:')))['id'],p['id']) if kind=='claude' else None
   if kind=='codex':
    newer=obs['visible'].replace('You are in '+self.root,'Folder access\n'+self.root).replace('Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.','Trust this folder? Codex can read, edit, and run files here.').replace('Yes, continue','Trust and continue').replace('No, quit','Quit').replace('Press enter to continue','enter continue · esc quit');self.assertIsNotNone(a.folder_trust(dict(obs,visible=newer)))
 def test_wrong_path_marker_process_copy_mode_and_scrollback_fail_closed(self):
  obs=self.fixture()
  for changed in [dict(obs,identity=None),dict(obs,in_mode=True),dict(obs,kind='pi'),dict(obs,env={}),dict(obs,visible=obs['visible'].replace(self.root,'/wrong')),dict(obs,visible=obs['visible']+'\nUser prompt >'),dict(obs,visible=obs['visible'].replace('Yes, I trust this folder','Yes, run command'))]:self.assertIsNone(a.folder_trust(changed))
  self.tmux.return_value=json.dumps(dict(self.marker,launch_id='replaced'));self.assertIsNone(a.folder_trust(obs));self.fixture()
  with patch.object(a,'conversations',return_value=[{'linked':True}]):self.assertIsNone(a.folder_trust(obs))
 def request(self,obs):
  p=a.folder_trust(obs);return dict(identity=obs['identity'],trust_id=p['id'],launch_id=p['launch_id'],screen=p['screen'],choice='trust')
 def test_explicit_confirmation_targets_only_the_verified_pane(self):
  obs=self.fixture();request=self.request(obs)
  with patch.object(a,'observe',return_value=obs):self.assertEqual(a.answer_folder_trust(request,obs),{'submitted':True})
  sends=[c.args for c in self.tmux.call_args_list if len(c.args)>1 and c.args[1]=='send-keys'];self.assertEqual(sends,[(request,'send-keys','-t',obs['target'],'Enter')])
 def test_stale_launch_instance_or_prompt_never_sends_and_decline_sends_no_keys(self):
  obs=self.fixture();request=self.request(obs)
  for changed in [dict(request,identity='wrong'),dict(request,launch_id='wrong'),dict(request,screen='old'),dict(request,trust_id='wrong')]:self.assertTrue(a.answer_folder_trust(changed,obs)['not_sent'])
  with patch.object(a,'observe',return_value=dict(obs,visible='ordinary editor')):self.assertTrue(a.answer_folder_trust(request,obs)['not_sent'])
  with patch.object(a,'observe',return_value=obs):self.assertTrue(a.answer_folder_trust(dict(request,choice='decline'),obs)['declined'])
  self.assertFalse(any(len(c.args)>1 and c.args[1]=='send-keys' for c in self.tmux.call_args_list))
 def test_selection_is_rechecked_before_enter_and_failure_never_confirms(self):
  obs=self.fixture(selected=2);request=self.request(obs);chosen=self.fixture(selected=1)
  with patch.object(a,'observe',side_effect=[obs,chosen]):self.assertTrue(a.answer_folder_trust(request,obs)['submitted'])
  sends=[c.args[-1] for c in self.tmux.call_args_list if len(c.args)>1 and c.args[1]=='send-keys'];self.assertEqual(sends,['Up','Enter']);self.tmux.reset_mock()
  with patch.object(a,'observe',side_effect=[obs,dict(obs,identity='replacement')]):
   with self.assertRaises(a.Failure):a.answer_folder_trust(request,obs)
  sends=[c.args[-1] for c in self.tmux.call_args_list if len(c.args)>1 and c.args[1]=='send-keys'];self.assertEqual(sends,['Up'])
 def test_ordinary_chat_cannot_answer_a_folder_trust_menu(self):
  obs=dict(self.fixture(),screen='screen')
  with patch.object(a,'observe',return_value=obs):
   with self.assertRaises(a.Failure):a.execute(dict(action='send',identity=obs['identity'],screen='screen',text='1'))
  self.assertFalse(any(len(c.args)>1 and c.args[1] in ('send-keys','load-buffer','paste-buffer') for c in self.tmux.call_args_list))
if __name__=='__main__':unittest.main()
