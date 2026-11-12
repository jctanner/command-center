"""Stored raster uploads/scene exports on disposable boards, never live drawings."""
import json,sqlite3,struct,zlib,unittest
from urllib.request import Request
from urllib.error import HTTPError
import test_whiteboard_api as fixtures
from test_whiteboard_api import uid
from test_openapi import validate

def png(w=32,h=16,rgba=(250,10,20,255)):
 def chunk(k,v):return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'tEXt',b'Comment\0private synthetic metadata')+chunk(b'IDAT',zlib.compress((b'\0'+bytes(rgba)*w)*h))+chunk(b'IEND',b'')
class Images(fixtures.WhiteboardApi):
 def upload(self,b,content=None,status=200,mime='application/octet-stream',origin=True):
  req=Request(self.url+f'/api/v1/whiteboards/{b["id"]}/images?revision={b["revision"]}',data=content if content is not None else png(),method='POST',headers={'Content-Type':mime,**({'Origin':self.url}if origin else{})})
  try:r=self.opener.open(req,timeout=20)
  except HTTPError as error:r=error
  with r:self.assertEqual(r.status,status);return json.loads(r.read())if r.headers.get('Content-Type','').startswith('application/json')else r.read()
 def place(self,b,r):
  elem=dict(kind='image',image=r,x=40,y=60,w=64,h=32,text='',color='ink',seed=1,clean=True)
  return self.call(f'whiteboards/{b["id"]}/elements','POST',dict(operation_id=uid(),actor='Human',upserts=[dict(id=uid(),expected_revision=None,element=elem)]))
 def test_upload_sniff_metadata_dedup_board_scope_revision_and_limit(self):
  b=self.create();r=self.upload(b,mime='text/plain');validate(r,{'$ref':'#/components/schemas/WhiteboardImage'});self.assertEqual((r['width'],r['height']),(32,16));self.assertEqual(self.upload(b),r)
  with self.opener.open(self.url+f'/api/v1/whiteboards/{b["id"]}/images/{r["id"]}')as response:raw=response.read();self.assertEqual(response.headers['Content-Type'],'image/png');self.assertEqual(response.headers['Cache-Control'],'no-store');self.assertNotIn(b'private synthetic',raw)
  other=self.create();self.call(f'whiteboards/{other["id"]}/images/{r["id"]}',status=404)
  self.call(f'whiteboards/{other["id"]}/elements','POST',dict(operation_id=uid(),actor='Human',upserts=[dict(id=uid(),expected_revision=None,element=dict(kind='image',image=r,x=0,y=0,w=32,h=16))]),400)
  self.upload({**b,'revision':b['revision']+1},status=409);self.upload(b,b'<svg/>',400,mime='image/png');self.upload(b,png()[:25],400);self.upload(b,png(4000,2001),400);self.upload(b,b'x'*(4*1024*1024+1),413);self.upload(b,origin=False,status=403)
 def test_normal_scene_history_attribution_sync_exports_and_deletion(self):
  b=self.create();r=self.upload(b);scene=self.place(b,r);validate(scene,{'$ref':'#/components/schemas/WhiteboardScene'});e=scene['elements'][0];self.assertEqual(e['author'],'Human');self.assertEqual(e['created_by'],'Human')
  patch=dict(operation_id=uid(),actor='Image editor',revision=e['revision'],changes=dict(x=90,w=128,h=64),dependencies={})
  path='whiteboards/'+b['id'];moved=self.call(path+'/elements/'+e['id'],'PATCH',patch);self.call(path+'/elements/'+e['id'],'PATCH',{**patch,'operation_id':uid()},409);self.upload(b,status=409)
  self.assertEqual(self.call(path)['elements'][0]['x'],90);self.assertEqual(moved['elements'][0]['image'],r);self.assertEqual(moved['elements'][0]['created_by'],'Human');self.assertEqual(moved['elements'][0]['author'],'Image editor')
  desc=self.call(path+'/description')['description'];self.assertIn('image 32×16 pixels',desc)
  export=self.call(path+'/export','POST',dict(id=uid(),revision=moved['revision'],theme='light',scale=2));self.assertEqual(export['state'],'ready',export)
  for fmt in ['png','svg','json','text']:
   with self.opener.open(self.url+export['artifacts'][fmt]['url'])as response:data=response.read()
   if fmt=='svg':self.assertIn(b'<image',data);self.assertIn(b'data:image/png;base64,',data);self.assertNotIn(b'http',data.replace(b'http://www.w3.org/2000/svg',b''))
   if fmt=='json':self.assertEqual(json.loads(data)['scene']['elements'][0]['image'],r);self.assertNotIn(b'base64',data)
   if fmt=='text':self.assertIn(b'image 32',data)
  self.call(path,'DELETE',{'revision':moved['revision']},204);self.call(path+'/images/'+r['id'],status=404)
  with sqlite3.connect(self.root/'config.board.sqlite3')as db:self.assertEqual(db.execute('SELECT count(*) FROM whiteboard_images WHERE board=?',(b['id'],)).fetchone()[0],0)
 def test_selection_exports_only_included_images_and_orphan_uploads_expire(self):
  import base64
  b=self.create();first=self.upload(b);other=self.upload(b,png(rgba=(10,20,250,255)));scene=self.place(b,first);scene=self.place(b,other);path='whiteboards/'+b['id']
  export=self.call(path+'/export','POST',dict(id=uid(),revision=scene['revision'],scope=dict(kind='selection',elements=[scene['elements'][0]['id']]),theme='dark',scale=1));self.assertEqual(export['state'],'ready')
  with self.opener.open(self.url+export['artifacts']['svg']['url'])as response:svg=response.read()
  with self.opener.open(self.url+f'/api/v1/{path}/images/{other["id"]}')as response:other_bytes=response.read()
  self.assertNotIn(base64.b64encode(other_bytes),svg);self.assertNotIn(scene['elements'][1]['id'].encode(),svg)
  unused=self.create();orphan=self.upload(unused)
  with sqlite3.connect(self.root/'config.board.sqlite3')as db:db.execute('UPDATE whiteboard_images SET created=0 WHERE board=?',(unused['id'],))
  self.call(f'whiteboards/{unused["id"]}/images/{orphan["id"]}',status=404)
if __name__=='__main__':unittest.main()
