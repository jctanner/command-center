"""Binary helper safety and streaming behavior; no real machines or agents."""
import json,os,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HELPER=ROOT/'src/file_download_remote.py'
class Download(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def start(self,path,**kwargs):
  p=subprocess.Popen(['python3',str(HELPER)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);self.addCleanup(lambda:p.poll()is None and p.kill());p.stdin.write(json.dumps(dict(path=str(path),**kwargs)).encode()+b'\n');p.stdin.close();return p
 def result(self,path,**kwargs):
  p=self.start(path,**kwargs);header=json.loads(p.stdout.readline());data=p.stdout.read();code=p.wait(timeout=5);error=p.stderr.read();p.stdout.close();p.stderr.close();return header,data,code,error
 def test_large_binary_and_literal_unicode_filename_without_execution(self):
  path=self.root/"clip ' café $(not-a-command) #1.mp4";data=bytes(range(256))*8193;path.write_bytes(data)
  header,body,code,error=self.result(path);self.assertEqual(code,0);self.assertEqual(body,data);self.assertEqual(header['ok']['name'],path.name);self.assertEqual(header['ok']['size'],len(data));self.assertEqual(error,b'')
 def test_empty_file_and_download_version_are_exact(self):
  path=self.root/'empty.html';path.write_bytes(b'');h,body,code,_=self.result(path);self.assertEqual((body,code),(b'',0));old=h['ok']['version'];path.write_bytes(b'changed');h,body,code,_=self.result(path,version=old);self.assertEqual(h['status'],409);self.assertEqual(body,b'');self.assertNotEqual(code,0)
 def test_nonregular_missing_relative_and_oversized_fail_before_bytes(self):
  fifo=self.root/'fifo';os.mkfifo(fifo);large=self.root/'huge.mp4'
  with large.open('wb')as f:f.truncate(8*1024*1024*1024+1)
  for path,status in [(fifo,415),(self.root,415),(self.root/'absent',404),('relative.txt',400),(large,413)]:
   h,body,code,_=self.result(path);self.assertEqual(h['status'],status);self.assertEqual(body,b'');self.assertNotEqual(code,0)
 def test_file_mutation_under_backpressure_aborts_without_final_chunk(self):
  path=self.root/'changing.mp4';path.write_bytes(b'x'*(2*1024*1024));p=self.start(path);h=json.loads(p.stdout.readline());path.write_bytes(b'changed');data=p.stdout.read();self.assertNotEqual(p.wait(timeout=5),0);self.assertLess(len(data),h['ok']['size']);p.stdout.close();p.stderr.close()
 def test_disconnect_stops_the_producer(self):
  path=self.root/'cancel.mp4';path.write_bytes(b'x'*(2*1024*1024));p=self.start(path);self.assertIn('ok',json.loads(p.stdout.readline()));p.stdout.close();self.assertNotEqual(p.wait(timeout=5),0);p.stderr.close()
