"""Whiteboard REST behavior on a temporary database and isolated backend only."""
import json, os, socket, subprocess, tempfile, time, unittest, uuid, sys
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError
from test_openapi import validate
ROOT=Path(__file__).resolve().parents[1]
def uid(): return str(uuid.uuid4())
class WhiteboardApi(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory(prefix='cc-whiteboard-api-');cls.root=Path(cls.tmp.name);(cls.root/'config.toml').write_text('hosts = []\n');cls.log=(cls.root/'log').open('wb');cls.opener=build_opener(ProxyHandler({}));cls.start()
 @classmethod
 def start(cls):
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  cls.url=f'http://127.0.0.1:{port}';cls.process=subprocess.Popen([os.environ.get('CC_BINARY',str(ROOT/'target/release/command-center')),'--config',str(cls.root/'config.toml'),'--listen',f'127.0.0.1:{port}','--web-dir',str(ROOT/'web/dist-next')],stdout=cls.log,stderr=cls.log)
  for _ in range(200):
   try:
    with cls.opener.open(cls.url+'/api/v1/health',timeout=1):return
   except OSError:time.sleep(.03)
  raise RuntimeError('Fixture backend did not start')
 @classmethod
 def stop(cls):cls.process.terminate();cls.process.wait(timeout=5)
 @classmethod
 def tearDownClass(cls):cls.stop();cls.log.close();cls.tmp.cleanup()
 def call(self,path,method='GET',body=None,status=200,origin=True):
  headers={'Origin':self.url}if origin else {}
  if body is not None:headers['Content-Type']='application/json'
  try:response=self.opener.open(Request(self.url+'/api/v1/'+path,data=json.dumps(body).encode()if body is not None else None,method=method,headers=headers),timeout=10)
  except HTTPError as error:response=error
  with response:
   self.assertEqual(response.status,status,response.read()if response.status!=status else '')
   if status==204:return None
   data=response.read();return json.loads(data)if data and response.headers.get('Content-Type','').startswith('application/json')else data.decode()
 def create(self):return self.call('whiteboards','POST',{'id':uid(),'name':'Fixture board'})
 def graph(self,board):
  nodes=[{'id':uid(),'label':label}for label in ['Browser','Rust API','Database']];body={'operation_id':uid(),'actor':'Coordinator fixture','nodes':nodes,'edges':[{'id':uid(),'from':nodes[i]['id'],'to':nodes[i+1]['id']}for i in range(2)]};return body,self.call(f'whiteboards/{board["id"]}/graph','POST',body)
 def test_graph_layout_readback_idempotence_and_restart(self):
  board=self.create();path='whiteboards/'+board['id'];body,scene=self.graph(board);validate(scene,{'$ref':'#/components/schemas/WhiteboardScene'});validate(body,{'$ref':'#/components/schemas/WhiteboardGraph'});self.assertEqual(len(scene['elements']),5);self.assertGreater(scene['elements'][1]['x'],scene['elements'][0]['x']);self.assertEqual(self.call(path+'/graph','POST',body)['revision'],scene['revision']);self.assertEqual(len(self.call(path)['elements']),5)
  self.assertIn('Rust API',self.call(path+'/description')['description']);self.assertEqual(self.call(path+'/operations/'+body['operation_id'])['revision'],scene['revision']);self.assertTrue(self.call(path+'/history')['history']);self.assertEqual(self.call(path+'/export')['scene']['id'],board['id'])
  self.stop();self.start();self.assertEqual(len(self.call(path)['elements']),5);self.assertIn(board['id'],[v['id']for v in self.call('whiteboards')['whiteboards']])
 def test_metadata_ticket_binding_and_logical_delete(self):
  board=self.create();path='whiteboards/'+board['id'];ticket=self.call('board/tickets','POST',{'id':uid(),'title':'Fixture','description':'','status':'review','priority':'normal','context':{},'checklist':[]})
  saved=self.call(path,'PATCH',{'revision':board['metadata_revision'],'name':'Linked','ticket':ticket['id']});self.assertEqual(saved['ticket'],ticket['id']);self.call(path,'PATCH',{'revision':board['metadata_revision'],'name':'Stale'},409)
  self.call(path,'DELETE',{'revision':board['revision']},409);self.call(path,'DELETE',{'revision':saved['revision']},204);self.call(path,status=404);self.assertNotIn(board['id'],[v['id']for v in self.call('whiteboards')['whiteboards']])
 def test_element_patch_checks_dependencies_and_exact_operation_intent(self):
  board=self.create();path='whiteboards/'+board['id'];_,scene=self.graph(board);node=scene['elements'][0];deps={e['id']:e['revision']for e in scene['elements']};edit={'operation_id':uid(),'actor':'Human fixture','revision':node['revision'],'changes':{'text':'Updated label'}}
  self.call(path+'/elements/'+node['id'],'PATCH',edit,409);edit['dependencies']=deps;saved=self.call(path+'/elements/'+node['id'],'PATCH',edit);self.assertEqual(saved['elements'][0]['text'],'Updated label');self.assertEqual(saved['elements'][0]['created_by'],'Coordinator fixture');self.assertEqual(saved['elements'][0]['author'],'Human fixture');self.assertEqual(self.call(path+'/elements/'+node['id'],'PATCH',edit)['revision'],saved['revision'])
  self.call(path+'/elements/'+node['id'],'PATCH',{**edit,'actor':'different'},409);self.call(path+'/operations','POST',{'operation_id':uid(),'actor':'Human','deletes':[{'id':node['id'],'revision':saved['elements'][0]['revision']}],'dependencies':{e['id']:e['revision']for e in saved['elements']}},409);self.assertEqual(len(self.call(path)['elements']),5)
 def test_coordinator_helper_draw_and_read_only_recovery(self):
  tool=ROOT/'coordinator/tools/cc_whiteboard.py';intent=self.root/'intent.json'
  def run(*args,success=True):
   result=subprocess.run([sys.executable,'-B',str(tool),'--url',self.url,*args],capture_output=True,text=True,timeout=10);self.assertEqual(result.returncode,0 if success else 1,result.stderr);return json.loads(result.stdout)if success else result.stderr
  body={'id':uid(),'name':'CLI fixture'};intent.write_text(json.dumps(body));board=run('create','--input',str(intent));self.assertEqual(run('get','--board',board['id'])['name'],'CLI fixture')
  node=uid();graph={'operation_id':uid(),'actor':'Coordinator fixture','nodes':[{'id':node,'label':'CLI box'}]};intent.write_text(json.dumps(graph));drawn=run('draw','--board',board['id'],'--input',str(intent));self.assertEqual(drawn['elements'][0]['text'],'CLI box');self.assertIn('CLI box',run('description','--board',board['id'])['description']);self.assertEqual(run('check','--board',board['id'],'--operation',graph['operation_id'])['revision'],drawn['revision'])

 def test_live_stream_committed_writes_reconnect_and_failed_or_replayed_operations(self):
  def connect():
   response=self.opener.open(self.url+'/api/v1/whiteboards/events',timeout=3)
   self.assertTrue(response.headers['Content-Type'].startswith('text/event-stream'))
   self.assertIn('no-store',response.headers['Cache-Control']);self.assertEqual(response.headers['X-Accel-Buffering'],'no')
   return response
  def event(response):
   lines=[]
   while True:
    line=response.readline().decode().strip()
    if not line and lines:break
    if line:lines.append(line)
   self.assertIn('event: whiteboards',lines)
   return json.loads(next(v[6:]for v in lines if v.startswith('data: ')))
  with connect() as response:
   initial=event(response);board=self.create();created=event(response)
   self.assertEqual(created['epoch'],initial['epoch']);self.assertGreater(created['sequence'],initial['sequence'])
   body,scene=self.graph(board);changed=event(response);self.assertGreater(changed['sequence'],created['sequence'])
   path='whiteboards/'+board['id'];self.call(path+'/graph','POST',body)
   self.call(path,'PATCH',{'revision':uid(),'name':'Rejected'},409)
   with connect() as again:self.assertEqual(event(again),changed)
   saved=self.call(path,'PATCH',{'revision':scene['metadata_revision'],'name':'Remote rename','ticket':None});renamed=event(response);self.assertGreater(renamed['sequence'],changed['sequence'])
   self.call(path,'DELETE',{'revision':saved['revision']},204);deleted=event(response);self.assertGreater(deleted['sequence'],renamed['sequence'])
  with connect() as again:self.assertEqual(event(again),deleted)

 def test_origin_and_payload_guards(self):
  for page,expected in [('whiteboard.html','SAMEORIGIN'),('whiteboard-prototype.html','DENY'),('','DENY')]:
   with self.opener.open(self.url+'/'+page)as response:self.assertEqual(response.headers.get('X-Frame-Options'),expected)
  self.call('whiteboards','POST',{'id':uid(),'name':'Rejected'},403,origin=False);self.call('whiteboards','POST',{'id':'not-a-uuid','name':'Rejected'},400);board=self.create();self.call('whiteboards/'+board['id']+'/graph','POST',{'operation_id':uid(),'actor':'Fixture','nodes':[{'id':uid(),'label':'No images','kind':'image'}]},400);self.call('whiteboards/'+board['id']+'/operations/'+uid(),status=404)
if __name__=='__main__':unittest.main()
