#!/usr/bin/env python3
import json,sys,os
from pathlib import Path
native_enabled=(Path(__file__).parent/"enable-native-shell").exists()
native_pending=None
native_context=""
pending=None
session="fake-session"
for line in sys.stdin:
 m=json.loads(line);method=m.get('method')
 if method=='initialize':
  result={'protocolVersion':1,'agentCapabilities':{'loadSession':True}}
  if native_enabled:result['agentCapabilities']['_meta']={'command-center/native-shell':{'version':1,'method':'_cc/session/shell','execution':'codex_native_full_access','contextIncluded':True,'timeoutMs':120000,'outputBytes':32768}}
 elif method=='session/new':result={'sessionId':session}
 elif method=='session/load':
  session=m['params']['sessionId'];result={}
 elif method=='_cc/session/shell':
  args=m['params'];native_context=os.getcwd()+'\n'if args['command']=='pwd'else'Native fixture output\n'
  with open('native-fixture-calls.jsonl','a')as log:log.write(json.dumps({'method':method,'params':args})+'\n')
  output={'version':1,'execution':'codex_native_full_access','requestId':args['requestId'],'turnId':'native-turn','text':native_context,'exitCode':0,'truncated':False,'contextIncluded':True,'done':True}
  if args['command']=='unsupported':
   print(json.dumps({'jsonrpc':'2.0','id':m['id'],'error':{'code':-32601,'message':'Unsupported native shell'}}),flush=True);continue
  if args['command']=='invalid-proof':output['execution']='wrong'
  if args['command']=='missing-context':output['contextIncluded']=False
  if args['command']=='hold-native':
   native_pending=(m['id'],output);output=dict(output,done=False,contextIncluded=False)
   print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':session,'update':{'sessionUpdate':'tool_call_update','toolCallId':'native','status':'in_progress','_meta':{'command-center/native-shell':output}}}}),flush=True);continue
  print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':session,'update':{'sessionUpdate':'tool_call_update','toolCallId':'native','status':'completed','_meta':{'command-center/native-shell':output}}}}),flush=True)
  result={'stopReason':'end_turn','_meta':{'command-center/native-shell':output}}
 elif method=='session/prompt':
  pending=m['id']
  if native_enabled:
   with open('native-fixture-calls.jsonl','a')as log:log.write(json.dumps({'method':method,'params':m['params']})+'\n')
  if m['params']['prompt'][0]['text']=='hold':continue
  if m['params']['prompt'][0]['text']=='permission':
   print(json.dumps({'jsonrpc':'2.0','id':'permission-call','method':'session/request_permission','params':{'sessionId':session,'toolCall':{'toolCallId':'tool1','title':'Fixture tool','rawInput':{'command':'echo test'}},'options':[{'optionId':'allow','name':'Allow once','kind':'allow_once'},{'optionId':'deny','name':'Reject once','kind':'reject_once'}]}}),flush=True);continue
  if m['params']['prompt'][0]['text']in('usage','compact-usage','foreign-usage'):
   print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':'unrelated'if m['params']['prompt'][0]['text']=='foreign-usage'else session,'update':{'sessionUpdate':'usage_update','used':12000 if m['params']['prompt'][0]['text']=='compact-usage'else 142000,'size':400000,'_meta':{'_claude/model':'fixture-model'},'cost':{'amount':1.23,'currency':'USD'}}}}),flush=True)
  print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':session,'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':native_context if m['params']['prompt'][0]['text']=='native-context' else 'Fixture reply'}}}}),flush=True)
  result={'stopReason':'end_turn'}
 elif method=='session/cancel':
  if native_pending:
   ident,output=native_pending;native_pending=None;output=dict(output,done=True,exitCode=-15,contextIncluded=True)
   print(json.dumps({'jsonrpc':'2.0','id':ident,'result':{'stopReason':'cancelled','_meta':{'command-center/native-shell':output}}}),flush=True);continue
  if pending:print(json.dumps({'jsonrpc':'2.0','id':pending,'result':{'stopReason':'cancelled'}}),flush=True);pending=None
  continue
 elif m.get('id')=='permission-call':
  print(json.dumps({'jsonrpc':'2.0','id':pending,'result':{'stopReason':'end_turn'}}),flush=True);continue
 else:continue
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':result}),flush=True)
