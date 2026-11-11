"""Native question detection is read-only; no provider, terminal or user data."""
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
import unittest

spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
QUESTION='''Old tool output that is not part of the question
────────────────────────────────────────
 ☐ Destination

│ Which fixture should receive the diagram?
│ Choose one test destination.

❯ 1. New fixture (Recommended)
     Start a disposable agent for this test.
  2. Existing fixture
     Use the selected fixture.
  3. Type something.
────────────────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
'''
class Questions(unittest.TestCase):
 def observation(self,**updates):return dict(kind='claude',target='$1:@1.%1',identity='process',screen='screen',visible=QUESTION,context=QUESTION,in_mode=False,base=None,cwd='/fixture',env={},args=[],**updates)
 def test_live_question_has_context_and_attention_but_no_tool_permission(self):
  o=self.observation();q=a.input_question(o);self.assertIn('Which fixture',q['title']);self.assertIn('New fixture',q['context']);self.assertNotIn('Old tool output',q['context']);self.assertIsNone(a.approval_menu(o));self.assertNotIn('token',q);self.assertTrue(q['choices']);self.assertTrue(all('key' not in c for c in q['choices']))
  activity=a.provider_activity(o);self.assertEqual((activity['state'],activity['source']),('approval','terminal_question'));self.assertEqual(activity['transition'],q['id'])
  changed={**o,'visible':QUESTION.replace('Which fixture','Which machine')};self.assertNotEqual(q['id'],a.input_question(changed)['id'])
  history={**o,'visible':QUESTION.replace('Old tool output','Different old tool output')};self.assertEqual(q['id'],a.input_question(history)['id'])
 def test_stale_unverified_other_providers_and_unfamiliar_menus_do_not_match(self):
  original=self.observation()
  changes=[dict(identity=None),dict(in_mode=True),dict(kind='codex'),dict(kind='pi'),dict(visible=QUESTION+'Running again\n'),dict(visible=QUESTION.replace('☐ Destination','Normal output')),dict(visible=QUESTION.replace('❯ 1.','  1.')),dict(visible=QUESTION.replace('  2.','❯ 2.')),dict(visible=QUESTION.replace('Type something.','Something else')),dict(visible=QUESTION.replace('  2.','  6.')),dict(visible='x'*48001)]
  for change in changes:
   with self.subTest(change=list(change)):self.assertIsNone(a.input_question({**original,**change}))
 def test_detail_reports_read_only_input_and_blocks_generic_messages(self):
  o=self.observation()
  with patch.object(a,'observe',return_value=o),patch.object(a,'conversations',return_value=[]),patch.object(a,'observed_background_tasks',return_value=None),patch.object(a,'tmux',return_value='120'):
   detail=a.execute(dict(action='details'));self.assertIsNotNone(detail['input_request']);self.assertIsNone(detail['approval']);self.assertFalse(detail['send_available']);self.assertIn('native dialog',detail['send_reason'])
 def test_old_message_and_approval_grants_cannot_answer_a_question(self):
  o=self.observation()
  for request in [dict(action='send',identity='process',screen='screen',text='Not an answer'),dict(action='approval',identity='process',screen='screen',approval_id=a.input_question(o)['id'],choice='1')]:
   with patch.object(a,'observe',return_value=o),patch.object(a,'tmux')as tmux:
    with self.assertRaises(a.Failure)as error:a.execute(request)
    self.assertEqual(error.exception.status,409);tmux.assert_not_called()
if __name__=='__main__':unittest.main()
