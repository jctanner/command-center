#!/usr/bin/env python3
import json,sys
pending=None
session="fake-session"
for line in sys.stdin:
 m=json.loads(line);method=m.get('method')
 if method=='initialize':result={'protocolVersion':1,'agentCapabilities':{'loadSession':True}}
 elif method=='session/new':result={'sessionId':session}
 elif method=='session/load':
  session=m['params']['sessionId'];result={}
 elif method=='session/prompt':
  pending=m['id']
  if m['params']['prompt'][0]['text']=='hold':continue
  if m['params']['prompt'][0]['text']=='permission':
   print(json.dumps({'jsonrpc':'2.0','id':'permission-call','method':'session/request_permission','params':{'sessionId':session,'toolCall':{'toolCallId':'tool1','title':'Fixture tool','rawInput':{'command':'echo test'}},'options':[{'optionId':'allow','name':'Allow once','kind':'allow_once'},{'optionId':'deny','name':'Reject once','kind':'reject_once'}]}}),flush=True);continue
  if m['params']['prompt'][0]['text']in('usage','compact-usage','foreign-usage'):
   print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':'unrelated'if m['params']['prompt'][0]['text']=='foreign-usage'else session,'update':{'sessionUpdate':'usage_update','used':12000 if m['params']['prompt'][0]['text']=='compact-usage'else 142000,'size':400000,'_meta':{'_claude/model':'fixture-model'},'cost':{'amount':1.23,'currency':'USD'}}}}),flush=True)
  print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':session,'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'Fixture reply'}}}}),flush=True)
  result={'stopReason':'end_turn'}
 elif method=='session/cancel':
  if pending:print(json.dumps({'jsonrpc':'2.0','id':pending,'result':{'stopReason':'cancelled'}}),flush=True);pending=None
  continue
 elif m.get('id')=='permission-call':
  print(json.dumps({'jsonrpc':'2.0','id':pending,'result':{'stopReason':'end_turn'}}),flush=True);continue
 else:continue
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':result}),flush=True)
