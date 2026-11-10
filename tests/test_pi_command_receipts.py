"""Native pi shell input is not user chat or permission to replay input."""
import importlib.util,json,unittest,tempfile
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('a',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class PiCommands(unittest.TestCase):
 def setUp(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.path=Path(tmp.name)/'session.jsonl'
 def test_only_active_branch_typed_bash_metadata_produces_command_evidence(self):
  records=[dict(type='session',version=3,id='session',cwd='/project'),dict(type='message',id='root',parentId=None,message=dict(role='user',content='Human chat')),dict(type='message',id='cmd',parentId='root',message=dict(role='bashExecution',command='12 was merged',output='PRIVATE_SHELL_OUTPUT',exitCode=2,excludeFromContext=False)),dict(type='message',id='abandoned',parentId='root',message=dict(role='bashExecution',command='abandoned command',excludeFromContext=False)),dict(type='message',id='end',parentId='cmd',message=dict(role='assistant',content='Visible reply'))]
  self.path.write_text(''.join(json.dumps(r)+'\n' for r in records));history=a.pi_history(self.path,include_activity=False)
  self.assertEqual(len(history['commands']),1);self.assertEqual(history['commands'][0]['digest'],a.input_hash('!12 was merged'))
  self.assertNotIn('PRIVATE_SHELL_OUTPUT',json.dumps(history));self.assertNotIn('abandoned command',json.dumps(history));self.assertEqual([m['role'] for m in history['messages']],['user','assistant'])
 def test_double_bang_context_exclusion_is_distinct_and_ambiguous_records_stay_unconfirmed(self):
  for marker,count,prefix in [(True,1,'!!'),(False,1,'!'),(None,0,''),('false',0,'')]:
   records=[dict(type='session',version=3,id='session',cwd='/project'),dict(type='message',id='cmd',parentId=None,message=dict(role='bashExecution',command='echo fixture',excludeFromContext=marker))]
   self.path.write_text(''.join(json.dumps(r)+'\n' for r in records));h=a.pi_history(self.path,include_activity=False);self.assertEqual(len(h['commands']),count)
   if count:self.assertEqual(h['commands'][0]['digest'],a.input_hash(prefix+'echo fixture'))
 def test_pi_bang_messages_are_rejected_before_buffer_or_input_io(self):
  o=dict(kind='pi',identity='process',screen='screen',visible='',in_mode=False,context='',target='$0:@0.%0')
  for text in ['!12 was merged','  !12 was merged','!!echo example','\n!ref','\ufeff !ref']:
   with patch.object(a,'observe',return_value=o),patch.object(a,'provider_activity',return_value=dict(state='ready',source='pi_bridge')),patch.object(a,'tmux') as tmux:
    with self.assertRaises(a.Failure) as error:a.execute(dict(action='send',identity='process',screen='screen',text=text))
    self.assertEqual(error.exception.status,400);tmux.assert_not_called()
if __name__=='__main__':unittest.main()
