"""Fixed transport simulations: every key/paste targets a synthetic question."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('agent',ROOT/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
SOURCE=(ROOT/'src/agent_questions.py').read_text()
class ResponseTransport(unittest.TestCase):
 def setUp(self):self.selected=1;self.text=None;self.calls=[];self.fail_enter=False;self.change=False;self.conversation='conversation';self.width=120
 def observation(self):
  rows=[('First choice','First detail'),('Second choice','Second detail'),(self.text or 'Type something.',''),('Chat about this','')]
  lines=['☐ Destination','','│ Which fixture should receive it?','']
  for number,(label,description)in enumerate(rows,1):
   if number==4:lines.append('────────────────────')
   lines.append(('❯ 'if number==self.selected else'  ')+str(number)+'. '+label)
   if description:lines.append('     '+description)
  lines.append('Enter to select · ↑/↓ to navigate · Esc to cancel')
  visible='\n'.join(lines)
  return dict(kind='claude',identity='replacement'if self.change else'process',target='$1:@1.%1',screen=hashlib.sha256(visible.encode()).hexdigest(),context=visible,visible=visible,in_mode=False)
 def tmux(self,request,*args,input=None):
  self.calls.append((args,input))
  if args[0]=='display-message':return str(self.width)
  if args[0]=='send-keys':
   key=args[-1]
   if key=='Down':self.selected+=1
   if key=='Up':self.selected-=1
   if key=='Enter'and self.fail_enter:a.fail(409,'fixture Enter failure')
  if args[0]=='load-buffer':self.paste=input.decode()
  if args[0]=='paste-buffer':self.text=self.paste
  return ''
 def request(self,choice='2',text=None):
  o=self.observation();return dict(action='question_answer',identity='process',screen=o['screen'],menu_id=a.input_question(o)['id'],request_id='native-request',question_id=hashlib.sha256((a.input_question(o)['id']+'/native-request').encode()).hexdigest(),conversation='conversation',choice=choice,text=text,_question_code=SOURCE)
 def execute(self,request):
  with patch.object(a,'observe',side_effect=lambda _:self.observation()),patch.object(a,'tmux',side_effect=self.tmux),patch.object(a,'conversations',side_effect=lambda _:[dict(id=self.conversation,linked=True)]),patch.object(a,'question_request_id',return_value='native-request'):return a.execute(request)
 def keys(self):return[c[0][-1]for c in self.calls if c[0][0]=='send-keys']
 def test_choice_navigation_then_exactly_one_enter(self):
  self.assertEqual(self.execute(self.request())['submitted'],True);self.assertEqual(self.keys(),['Down','Enter']);self.assertFalse(any(c[0][0]=='paste-buffer'for c in self.calls))
 def test_already_selected_choice_and_up_navigation(self):
  self.assertTrue(self.execute(self.request('1'))['submitted']);self.assertEqual(self.keys(),['Enter']);self.calls=[];self.selected=2;self.assertTrue(self.execute(self.request('1'))['submitted']);self.assertEqual(self.keys(),['Up','Enter'])
 def test_other_paste_readback_then_one_enter(self):
  text='Use the fixture named alpha & beta';self.assertTrue(self.execute(self.request('other',text))['submitted']);self.assertEqual(self.keys(),['Down','Down','Enter']);pastes=[c for c in self.calls if c[0][0]=='paste-buffer'];self.assertEqual(len(pastes),1);self.assertIn('-p',pastes[0][0]);self.assertEqual(self.text,text)
 def test_prompt_claim_is_stable_when_only_selection_changes(self):
  first=a.input_question(self.observation());self.selected=2;second=a.input_question(self.observation());self.assertEqual(first['id'],second['id']);self.assertNotEqual(first['context'],second['context'])
 def test_stale_screen_process_conversation_or_invalid_answer_sends_nothing(self):
  for mutation in [lambda r:r.update(screen='stale'),lambda r:r.update(identity='replaced'),lambda r:r.update(conversation='different'),lambda r:r.update(choice='4'),lambda r:r.update(choice='other',text='bad\ntext'),lambda r:r.update(choice='other',text=' '*2),lambda r:r.update(text='unexpected')]:
   with self.subTest(mutation=mutation):
    self.calls=[];r=self.request();mutation(r);result=self.execute(r);self.assertTrue(result['not_sent']);self.assertEqual(self.keys(),[])
 def test_too_wide_other_rejected_before_navigation_or_paste(self):
  self.width=20;self.assertTrue(self.execute(self.request('other','too long for this width'))['not_sent']);self.assertEqual(self.keys(),[])
 def test_enter_failure_after_navigation_is_uncertain_not_retryable(self):
  self.fail_enter=True
  with self.assertRaises(a.Failure)as error:self.execute(self.request())
  self.assertEqual(error.exception.status,502);self.assertEqual(self.keys(),['Down','Enter'])
 def test_process_change_after_navigation_never_sends_enter(self):
  original=self.tmux
  def changed(request,*args,input=None):
   result=original(request,*args,input=input)
   if args[0]=='send-keys':self.change=True
   return result
  self.tmux=changed
  with self.assertRaises(a.Failure)as error:self.execute(self.request())
  self.assertEqual(error.exception.status,502);self.assertEqual(self.keys(),['Down'])
 def test_unverified_paste_never_sends_enter(self):
  original=self.tmux
  def corrupt(request,*args,input=None):
   result=original(request,*args,input=input)
   if args[0]=='paste-buffer':self.text='different text'
   return result
  self.tmux=corrupt
  with self.assertRaises(a.Failure)as error:self.execute(self.request('other','Intended answer'))
  self.assertEqual(error.exception.status,502);self.assertNotIn('Enter',self.keys())

class RequestAnchors(unittest.TestCase):
 def setUp(self):
  import tempfile,os,time
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.home=self.root/'home';(self.home/'sessions').mkdir(parents=True);self.session='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';self.base,self.start,_=a.proc(os.getpid());self.now=int(time.time()*1000)
  self.log=self.root/'native.jsonl';self.log.write_text('')
  self.record=dict(pid=os.getpid(),procStart=self.start,sessionId=self.session,cwd=str(self.root),tmux='1:@2.%3',startedAt=self.now-10000,status='waiting',statusUpdatedAt=self.now,updatedAt=self.now)
  self.registry=self.home/'sessions'/f'{os.getpid()}.json';self.registry.write_text(__import__('json').dumps(self.record));self.o=dict(kind='claude',identity='verified',base=self.base,target='$1:@2.%3',cwd=str(self.root),env={'CLAUDE_CONFIG_DIR':str(self.home)},args=[])
  self.menu=dict(supported=True,title='Which fixture?',choices=[dict(id='1',label='First')]);self.candidate=dict(linked=True,id='conversation',session=self.session,path=str(self.log))
 def anchor(self):return a.question_request_id(self.o,self.menu,[self.candidate])
 def write_question(self,call='native-call',**changes):
  import json
  record=dict(type='assistant',sessionId=self.session,message=dict(role='assistant',content=[dict(type='tool_use',name='AskUserQuestion',id=call,input=dict(questions=[dict(question='Which fixture?',options=[dict(label='First')],multiSelect=False)]))]));record.update(changes);self.log.write_text(json.dumps(record)+'\n')
 def test_waiting_transition_is_owned_stable_and_not_a_heartbeat(self):
  import json
  first=self.anchor();self.assertIsNotNone(first);self.registry.write_text(json.dumps(dict(self.record,updatedAt=self.now+1000)));self.assertEqual(self.anchor(),first);self.registry.write_text(json.dumps(dict(self.record,statusUpdatedAt=self.now+1000,updatedAt=self.now+1000)));self.assertNotEqual(self.anchor(),first)
 def test_invalid_registry_ownership_status_or_time_cannot_anchor_terminal_text(self):
  import json
  for changes in [dict(procStart='wrong'),dict(pid=1),dict(tmux='1:@2.%9'),dict(pidDomain='wrong'),dict(status='working'),dict(statusUpdatedAt=self.now+100000),dict(updatedAt=0)]:
   self.registry.write_text(json.dumps(dict(self.record,**changes)));self.assertIsNone(self.anchor(),changes)
 def test_pending_provider_call_fallback_distinguishes_identical_questions(self):
  import json
  self.registry.unlink();self.write_question();first=self.anchor();self.assertIsNotNone(first);self.write_question(call='next-native-call');self.assertNotEqual(self.anchor(),first)
  with self.log.open('a')as f:f.write(json.dumps(dict(type='user',sessionId=self.session,message=dict(role='user',content=[dict(type='tool_result',tool_use_id='next-native-call',content='Answer') ])))+'\n')
  self.assertIsNone(self.anchor())
 def test_hidden_unmatched_and_multiple_questions_are_not_answer_capabilities(self):
  self.registry.unlink()
  for changes in [dict(isSidechain=True),dict(isMeta=True),dict(sessionId='different')]:self.write_question(**changes);self.assertIsNone(self.anchor())
  self.write_question();self.menu['title']='Different question?';self.assertIsNone(self.anchor());self.menu['title']='Which fixture?';self.menu['choices'][0]['label']='Different option';self.assertIsNone(self.anchor())

if __name__=='__main__':unittest.main()
