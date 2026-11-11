"""Server image exports and private coordinator downloads on isolated fixtures."""
import hashlib,json,os,sqlite3,struct,subprocess,sys,uuid,socket,time
from urllib.parse import urlsplit
from pathlib import Path
from urllib.request import Request
import test_whiteboard_api as fixtures
from test_whiteboard_api import uid,ROOT
from test_openapi import validate
class Exports(fixtures.WhiteboardApi):
 def rendered(self,board,scope=None,scale=1,theme='dark',export_id=None):
  scene=self.call('whiteboards/'+board['id']);body={'id':export_id or uid(),'revision':scene['revision'],'scope':scope or {'kind':'board'},'scale':scale,'theme':theme};result=self.call('whiteboards/'+board['id']+'/export','POST',body);self.assertEqual(result['state'],'ready',result);validate(result,{'$ref':'#/components/schemas/WhiteboardExportManifest'});return body,result
 def bytes(self,manifest,format):
  record=manifest['artifacts'][format]
  with self.opener.open(self.url+record['url'])as response:
   self.assertEqual(response.headers['Content-Type'],record['content_type']);self.assertEqual(response.headers['Cache-Control'],'no-store');self.assertIn('attachment;',response.headers['Content-Disposition']);value=response.read()
  self.assertEqual(len(value),record['bytes']);self.assertEqual(hashlib.sha256(value).hexdigest(),record['sha256']);return value
 def test_rendered_formats_scale_theme_and_exact_idempotency(self):
  board=self.create();_,scene=self.graph(board);body,dark=self.rendered(board,scale=2);png=self.bytes(dark,'png');self.assertEqual(png[:8],b'\x89PNG\r\n\x1a\n');self.assertEqual(struct.unpack('>II',png[16:24]),(dark['width'],dark['height']));svg=self.bytes(dark,'svg');self.assertIn(b'Liberation Sans',svg);self.assertIn(b'Rust API',svg);self.assertIn(b'data:font/ttf;base64,',svg);self.assertNotIn(b'<script',svg);self.assertNotIn(b'http://',svg.replace(b'http://www.w3.org/2000/svg',b''));self.assertEqual(len(json.loads(self.bytes(dark,'json'))['scene']['elements']),5);self.assertIn(b'Browser',self.bytes(dark,'text'))
  again=self.call('whiteboards/'+board['id']+'/export','POST',body);self.assertEqual(again,dark);self.call('whiteboards/'+board['id']+'/export','POST',{**body,'theme':'light'},409)
  _,light=self.rendered(board,theme='light');self.assertNotEqual(self.bytes(light,'png'),png);self.assertNotEqual(self.bytes(light,'svg'),svg)
  self.stop();self.start();self.assertEqual(self.bytes(dark,'png'),png)
 def test_selection_excludes_other_labels_ids_and_binding_metadata(self):
  board=self.create();_,scene=self.graph(board);arrow=scene['elements'][3];_,manifest=self.rendered(board,{'kind':'selection','elements':[arrow['id']]});native=json.loads(self.bytes(manifest,'json'));self.assertEqual(len(native['scene']['elements']),1);self.assertNotIn('from',native['scene']['elements'][0]);self.assertNotIn('to',native['scene']['elements'][0]);
  for format in ['svg','json','text']:
   value=self.bytes(manifest,format)
   for omitted in scene['elements'][:3]:self.assertNotIn(omitted['id'].encode(),value);self.assertNotIn(omitted['text'].encode(),value)
  self.call('whiteboards/'+board['id']+'/export','POST',{'id':uid(),'revision':scene['revision'],'scope':{'kind':'selection','elements':[uid()]}},400)
 def test_named_frame_and_group_scopes_are_revision_checked(self):
  board=self.create();_,scene=self.graph(board);element=scene['elements'][0];path='whiteboards/'+board['id'];frame={'id':uid(),'scene_revision':scene['revision'],'name':'First box','kind':'frame','elements':[element['id']],'bounds':{k:element[k]for k in ['x','y','w','h']}};saved=self.call(path+'/regions','POST',frame);scope={'kind':'frame','id':saved['id'],'revision':saved['revision']};_,export=self.rendered(board,scope,scale=2);self.assertEqual((export['width'],export['height']),(400,200));self.assertEqual(json.loads(self.bytes(export,'json'))['scene']['elements'][0]['id'],element['id']);
  group=self.call(path+'/regions','POST',{'id':uid(),'scene_revision':scene['revision'],'name':'Group','kind':'group','elements':[element['id']]});_,group_export=self.rendered(board,{'kind':'group','id':group['id'],'revision':group['revision']});self.assertEqual(group_export['element_ids'],[element['id']]);self.assertEqual(len(self.call(path+'/regions')['regions']),2)
  self.call(path+'/regions','POST',{**saved,'name':'Changed'});self.call(path+'/export','POST',{'id':uid(),'revision':scene['revision'],'scope':scope},409)
 def test_limits_expiry_and_failed_artifacts_remain_unavailable(self):
  board=self.create();_,scene=self.graph(board);path='whiteboards/'+board['id'];self.call(path+'/export','POST',{'id':uid(),'revision':scene['revision'],'scale':0},400);self.call(path+'/export','POST',{'id':uid(),'revision':scene['revision']-1},409);self.call(path+'/export','POST',{'id':uid(),'revision':scene['revision']},403,origin=False)
  frame=self.call(path+'/regions','POST',{'id':uid(),'scene_revision':scene['revision'],'name':'Huge frame','kind':'frame','elements':[scene['elements'][0]['id']],'bounds':{'x':0,'y':0,'w':100000,'h':100000}});failed=self.call(path+'/export','POST',{'id':uid(),'revision':scene['revision'],'scope':{'kind':'frame','id':frame['id'],'revision':frame['revision']}});self.assertEqual(failed['state'],'failed');self.call('whiteboard-exports/'+failed['id']+'/png',status=409)
  body,manifest=self.rendered(board)
  with sqlite3.connect(self.root/'config.board.sqlite3')as c:c.execute("UPDATE whiteboard_exports SET metadata=json_set(metadata,'$.expires_at',0) WHERE id=?",(manifest['id'],))
  self.assertEqual(self.call('whiteboard-exports/'+manifest['id'])['state'],'expired');self.call('whiteboard-exports/'+manifest['id']+'/png',status=410);self.rendered(board)
  with sqlite3.connect(self.root/'config.board.sqlite3')as c:self.assertIsNone(c.execute('SELECT png FROM whiteboard_exports WHERE id=?',(manifest['id'],)).fetchone()[0])
  self.assertEqual(self.call(path+'/export','POST',body)['state'],'expired')
 def test_http_disconnect_does_not_cancel_or_replay_a_committed_render(self):
  board=self.create();_,scene=self.graph(board);path='whiteboards/'+board['id'];frame=self.call(path+'/regions','POST',{'id':uid(),'scene_revision':scene['revision'],'name':'Large fixture','kind':'frame','elements':[scene['elements'][0]['id']],'bounds':{'x':0,'y':0,'w':2000,'h':4000}});body={'id':uid(),'revision':scene['revision'],'scope':{'kind':'frame','id':frame['id'],'revision':frame['revision']}};payload=json.dumps(body).encode();url=urlsplit(self.url);sock=socket.create_connection((url.hostname,url.port));sock.sendall((f'POST /api/v1/{path}/export HTTP/1.1\r\nHost: {url.netloc}\r\nOrigin: {self.url}\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n').encode()+payload)
  observed=False
  for _ in range(100):
   with sqlite3.connect(self.root/'config.board.sqlite3')as c:row=c.execute('SELECT metadata FROM whiteboard_exports WHERE id=?',(body['id'],)).fetchone()
   if row:observed=json.loads(row[0])['state']=='rendering';break
   time.sleep(.003)
  sock.close();self.assertTrue(observed,'Test must disconnect during the retained render')
  for _ in range(100):
   result=self.call('whiteboard-exports/'+body['id'])
   if result['state']!='rendering':break
   time.sleep(.01)
  self.assertEqual(result['state'],'ready',result);self.assertTrue(self.bytes(result,'png').startswith(b'\x89PNG'))

 def test_coordinator_downloads_are_private_checked_and_never_overwrite(self):
  board=self.create();self.graph(board);tool=ROOT/'coordinator/tools/cc_whiteboard.py';output=self.root/'exports'
  def run(*args,success=True):
   result=subprocess.run([sys.executable,'-B',str(tool),'--url',self.url,*args],capture_output=True,text=True,timeout=30);self.assertEqual(result.returncode,0 if success else 1,result.stderr);return json.loads(result.stdout)if success else result.stderr
  scene=self.call('whiteboards/'+board['id']);element=scene['elements'][0];intent=self.root/'region.json';intent.write_text(json.dumps({'id':uid(),'scene_revision':scene['revision'],'name':'CLI frame','kind':'frame','elements':[element['id']],'bounds':{k:element[k]for k in ['x','y','w','h']}}));region=run('region','--board',board['id'],'--input',str(intent));self.assertEqual(len(run('regions','--board',board['id'])['regions']),1)
  saved=run('export','--board',board['id'],'--output-dir',str(output),'--theme','light','--scope','frame','--region',region['id']);export_id=saved['export']['id'];directory=Path(saved['directory']);self.assertEqual(directory.stat().st_mode&0o777,0o700)
  for file in directory.iterdir():self.assertEqual(file.stat().st_mode&0o777,0o600)
  repeated=run('download','--export-id',export_id,'--output-dir',str(output));self.assertEqual(saved['files'],repeated['files']);png=Path(saved['files']['png']);png.write_bytes(b'keep this');error=run('download','--export-id',export_id,'--output-dir',str(output),success=False);self.assertIn('not overwritten',error);self.assertEqual(png.read_bytes(),b'keep this')
  outside=self.root/'outside';outside.mkdir(mode=0o700);link=self.root/'linked';link.symlink_to(outside,target_is_directory=True);run('download','--export-id',export_id,'--output-dir',str(link),success=False);self.assertEqual(list(outside.iterdir()),[])
if __name__=='__main__':import unittest;unittest.main()
