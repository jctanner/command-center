from pathlib import Path
import json,time
class Call:
 def __init__(self,value): self.value=value
 def execute(self): return self.value
class GmailClientWrapper:
 def __init__(self,credentials):self.gmail=self
 def users(self):return self
 def messages(self):return self
 def threads(self):return self
 def fixture(self):return json.loads(Path('fixture.json').read_text())
 def log(self,op,args):
  with Path('calls.jsonl').open('a') as f:f.write(json.dumps({'operation':op,**args})+'\n')
  fixture=self.fixture()
  if fixture.get('delay'):
   Path('started').touch();time.sleep(1)
  if fixture.get('error'):
   class E(Exception):pass
   e=E('PRIVATE_AUTH_SECRET');e.resp=type('Response',(),{'status':fixture['error']})();raise e
 def list_labels(self):self.log('labels',{});return self.fixture().get('labels',[{'id':'INBOX','name':'INBOX'},{'id':'Label_1','name':'Projects'}])
 def list(self,**args):
  self.log('messages.list',args);f=self.fixture();messages=f.get('messages',[])
  if args.get('pageToken'):messages=f.get('older',[])
  if args.get('q'):messages=[m for m in messages if args['q'].lower() in m.get('subject','').lower()]
  if args.get('labelIds')==['Label_1']:messages=[m for m in messages if 'Label_1' in m.get('label_ids',[])]
  return Call({'messages':[{'id':m['id']} for m in messages],'nextPageToken':f.get('cursor','') if not args.get('pageToken') else ''})
 def _get_message_metadata(self,id):
  self.log('messages.metadata',{'id':id});f=self.fixture();return next((m for m in f.get('messages',[])+f.get('older',[]) if m['id']==id),None)
 def get(self,**args):
  self.log('threads.get',args);return Call({'messages':self.fixture().get('thread',[])})
 def _parse_message(self,m):return m
