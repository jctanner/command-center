#!/usr/bin/env python3
"""Explicitly scoped, disposable real-Codex check. No model prompt or live CC agent.
Requires --approve-disposable-native-shell after obtaining human approval.
Uses empty HOME/CODEX_HOME and a loopback mock model endpoint, never real credentials.
"""
import argparse,json,os,queue,signal,subprocess,tempfile,threading,time,urllib.parse,uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import importlib.util


def check(source):
    os.umask(0o077)
    spec=importlib.util.spec_from_file_location('patch',Path(__file__).with_name('apply.py'))
    patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch);patch.apply(source,True)
    source=Path(source).resolve();adapter=source/'dist/index.js'
    if not adapter.is_file():raise ValueError('Build the reviewed patched adapter first')
    requests=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            requests.append(('GET',urllib.parse.urlsplit(self.path).path))
            body=json.dumps({'object':'list','data':[]}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_POST(self):
            requests.append(('POST',urllib.parse.urlsplit(self.path).path))
            self.send_response(500);self.end_headers()
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler);http.daemon_threads=True
    threading.Thread(target=http.serve_forever,daemon=True).start()
    process=None;temporary=None;stderr=None
    try:
        temporary=tempfile.TemporaryDirectory(prefix='cc-native-shell-real-');folder=temporary.name
        root=Path(folder);home=root/'home';home.mkdir(mode=0o700);project=root/'project';project.mkdir(mode=0o700);codex_home=home/'.codex';codex_home.mkdir(mode=0o700)
        # No inherited credentials, SSH agent or user config. Any attempted model HTTP call fails locally.
        env={k:v for k,v in os.environ.items()if k in ('PATH','LANG','LC_ALL','TERM','TMPDIR')}
        env.update(HOME=str(home),CODEX_HOME=str(codex_home),OPENAI_API_KEY='cc-local-fixture-not-a-secret',NO_BROWSER='1',MODEL_PROVIDER='cc_native_test',CODEX_CONFIG=json.dumps({'model_provider':'cc_native_test','model':'gpt-5.4','model_providers':{'cc_native_test':{'name':'CC local no-model test','base_url':f'http://127.0.0.1:{http.server_port}/v1','wire_api':'responses','requires_openai_auth':False}},'mcp_servers':{}}))
        stderr=open(root/'adapter.stderr','w+b');process=subprocess.Popen(['node',str(adapter)],cwd=project,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,start_new_session=True)
        incoming=queue.Queue(maxsize=512)
        def read():
            try:
                while True:
                    raw=process.stdout.readline(8*1024*1024+1)
                    if not raw or len(raw)>8*1024*1024:break
                    incoming.put(json.loads(raw),timeout=2)
            except Exception:pass
            finally:
                try:incoming.put(None,timeout=1)
                except queue.Full:pass
        threading.Thread(target=read,daemon=True).start()
        updates=[]
        def send(method,params,ident=None):
            record={'jsonrpc':'2.0','method':method,'params':params}
            if ident is not None:record['id']=ident
            process.stdin.write((json.dumps(record)+'\n').encode());process.stdin.flush()
        def receive(ident=None,predicate=None,timeout=40):
            deadline=time.monotonic()+timeout
            while time.monotonic()<deadline:
                try:message=incoming.get(timeout=max(.01,deadline-time.monotonic()))
                except queue.Empty:break
                if message is None:raise RuntimeError('Disposable adapter exited before result')
                if message.get('method')=='session/update':updates.append(message)
                if 'method'in message and 'id'in message:raise RuntimeError('Unexpected interactive request; no answer sent')
                if ident is not None and message.get('id')==ident:
                    if 'error'in message:raise RuntimeError('Disposable RPC rejected: '+str(message['error'].get('code')))
                    return message.get('result')
                if predicate and predicate(message):return message
            raise TimeoutError('Disposable native test timed out; no retry')
        def rpc(method,params):
            ident=str(uuid.uuid4());send(method,params,ident);return receive(ident)
        initialized=rpc('initialize',{'protocolVersion':1,'clientInfo':{'name':'cc-scoped-native-shell-test','version':'1'},'clientCapabilities':{}})
        capability=initialized['agentCapabilities']['_meta']['command-center/native-shell']
        assert capability['version']==1 and capability['execution']=='codex_native_full_access'
        session=rpc('session/new',{'cwd':str(project),'mcpServers':[]})['sessionId']
        def native(command):return rpc('_cc/session/shell',{'sessionId':session,'requestId':str(uuid.uuid4()),'command':command,'execution':'codex_native_full_access'})['_meta']['command-center/native-shell']
        pwd=native('pwd');assert pwd['text'].strip()==str(project)and pwd['exitCode']==0 and pwd['contextIncluded'] is True
        marker=native("printf 'CC-NATIVE-%s\\n' 46");assert 'CC-NATIVE-46'in marker['text'] and marker['contextIncluded'] is True
        # Output is computed, not a literal substring of the input, so finding it proves native output persistence.
        persisted=False
        for path in codex_home.rglob('*.jsonl'):
            for line in path.read_text(errors='replace').splitlines():
                try:record=json.loads(line)
                except ValueError:continue
                text=json.dumps(record)
                if 'CC-NATIVE-46'in text and 'user_shell_command'in text:persisted=True
        assert persisted,'Native output was not found in persisted provider context'
        ident=str(uuid.uuid4());command_id=str(uuid.uuid4());send('_cc/session/shell',{'sessionId':session,'requestId':command_id,'command':'printf waiting; sleep 30','execution':'codex_native_full_access'},ident)
        receive(predicate=lambda m:m.get('method')=='session/update'and m.get('params',{}).get('update',{}).get('_meta',{}).get('command-center/native-shell',{}).get('requestId')==command_id)
        send('session/cancel',{'sessionId':session});cancelled=receive(ident)
        assert cancelled.get('stopReason')=='cancelled'
        assert not any(method=='POST'for method,_ in requests),'Unexpected model HTTP request'
        return {'native_pwd':True,'native_output':True,'provider_context_persisted':True,'native_cancel':True,'model_posts':0,'isolated_home':True,'existing_agents_touched':False}
    finally:
        if process:
            # Do not poll/reap before signaling: the owned leader PID remains reserved even on early exit.
            try:os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=3)
            for stream in (process.stdin,process.stdout):
                if stream:stream.close()
        if stderr:stderr.close()
        http.shutdown();http.server_close()
        if temporary:temporary.cleanup()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source');parser.add_argument('--approve-disposable-native-shell',action='store_true');args=parser.parse_args()
    if not args.approve_disposable_native_shell:parser.error('Explicit human scope required before running a real harness; add the approval flag only after approval')
    print(json.dumps(check(args.source)))
