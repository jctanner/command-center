"""Native consumed human steering; fixtures only, never sends to a provider."""
import copy,importlib.util,json,tempfile,unittest,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
def uid():return str(uuid.uuid4())
class Absorbed(unittest.TestCase):
 def setUp(self):self.session=uid();self.source=uid();self.delivery=uid();self.text='Synthetic human steering';self.remove={'type':'queue-operation','operation':'remove','reason':'absorbed_mid_turn','sessionId':self.session,'commandUuid':self.source,'deliveryId':self.delivery,'content':self.text};self.attachment={'type':'attachment','uuid':uid(),'parentUuid':uid(),'isSidechain':False,'sessionId':self.session,'session_id':self.session,'userType':'external','entrypoint':'cli','renderedRole':'system','rendered':[{'content':'PRIVATE_SYSTEM_CONTEXT must never be shown'}],'attachment':{'type':'queued_command','prompt':self.text,'source_uuid':self.source,'delivery_id':self.delivery,'commandMode':'prompt','humanTurn':True,'origin':{'kind':'human'}}}
 def evidence(self,r=None,att=None):return a.claude_consumed_prompts([(100,self.remove if r is None else r),(200,self.attachment if att is None else att)],self.session)
 def test_exact_consumed_delivery_and_duplicate_attachments(self):
  self.assertEqual(self.evidence(),{200:self.text});duplicate=copy.deepcopy(self.attachment);duplicate['uuid']=uid();self.assertEqual(a.claude_consumed_prompts([(100,self.remove),(200,self.attachment),(300,duplicate)],self.session),{200:self.text})
 def test_no_queue_only_remove_only_or_out_of_order_receipts(self):
  self.assertEqual(a.claude_consumed_prompts([(200,self.attachment)],self.session),{});self.assertEqual(a.claude_consumed_prompts([(100,self.remove)],self.session),{});self.assertEqual(a.claude_consumed_prompts([(100,self.attachment),(200,self.remove)],self.session),{})
  for op in ('enqueue','dequeue','clear'):
   record=dict(self.remove,operation=op);self.assertEqual(self.evidence(r=record),{})
 def test_session_origin_kind_sidechain_and_identity_must_match(self):
  for key,value in [('sessionId',uid()),('session_id',uid()),('isSidechain',True),('isMeta',True),('userType','internal'),('entrypoint','sdk'),('renderedRole','user'),('uuid','bad'),('parentUuid',None)]:
   with self.subTest(key=key):record=copy.deepcopy(self.attachment);record[key]=value;self.assertEqual(self.evidence(att=record),{})
  for key,value in [('type','system_reminder'),('origin',{'kind':'agent'}),('humanTurn',False),('commandMode','command'),('source_uuid',uid()),('delivery_id',uid()),('prompt','Different text')]:
   with self.subTest(key=key):record=copy.deepcopy(self.attachment);record['attachment'][key]=value;self.assertEqual(self.evidence(att=record),{})
  for key,value in [('sessionId',uid()),('reason','cancelled'),('commandUuid',uid()),('deliveryId',uid()),('content','Different text')]:
   with self.subTest(key=key):record=dict(self.remove);record[key]=value;self.assertEqual(self.evidence(r=record),{})
 def test_conflicting_consumed_ids_fail_closed_and_repeated_text_has_unique_offsets(self):
  conflicting=dict(self.remove,content='Different');self.assertEqual(a.claude_consumed_prompts([(100,self.remove),(150,conflicting),(200,self.attachment)],self.session),{})
  other=copy.deepcopy(self.attachment);other['uuid']=uid();other['attachment']['source_uuid']=uid();other['attachment']['delivery_id']=uid();removed=dict(self.remove,commandUuid=other['attachment']['source_uuid'],deliveryId=other['attachment']['delivery_id']);self.assertEqual(a.claude_consumed_prompts([(100,self.remove),(200,self.attachment),(300,removed),(400,other)],self.session),{200:self.text,400:self.text})
 def test_history_preserves_offset_and_exact_digest_without_rendered_or_request_context(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/(self.session+'.jsonl');header=dict(type='user',cwd=directory,sessionId=self.session,message=dict(role='user',content='Initial'))
   records=[header,self.remove,self.attachment,dict(type='api-request-blob',message=dict(role='user',content=[dict(type='text',text='PRIVATE_REQUEST_CONTEXT')])),dict(type='assistant',message=dict(role='assistant',content='Reply'))];lines=[json.dumps(r)+'\n'for r in records];path.write_text(''.join(lines));offset=len(''.join(lines[:2]).encode());page=a.history(path,'claude');user=page['messages'][1];self.assertEqual(user['id'],str(offset));self.assertEqual(user['text'],self.text);self.assertEqual(user['input_hash'],a.input_hash(self.text));self.assertNotIn('PRIVATE_',json.dumps(page));self.assertEqual(len(page['messages']),3);self.assertEqual(len(a.history(path,'claude',before=offset)['messages']),1)
if __name__=='__main__':unittest.main()
