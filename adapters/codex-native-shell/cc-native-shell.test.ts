// Apache-2.0. Installed in upstream src/__tests__/CodexACPAgent/ by CC's patch helper.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {connectSession,itemCompleted,itemStarted,settle,sessionId,turnStarted,turnCompleted,turnFinished,type PromptSession} from './v2-prompt-harness';
import {CC_SHELL_METHOD,CC_SHELL_META,CC_SHELL_EXECUTION,nativeShellParams,NativeShellReceipts} from '../../CcNativeShell';
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const params={sessionId,requestId,command:'pwd',execution:CC_SHELL_EXECUTION} as const;
const nativeItem=(extra={})=>({type:'commandExecution' as const,id:'native-shell',command:'pwd',cwd:'/project',processId:null,
 source:'userShell' as const,status:'inProgress' as const,commandActions:[],aggregatedOutput:null,exitCode:null,durationMs:null,pluginId:null,scriptPath:null,...extra});
describe('CC native Codex shell extension',()=>{
 let client:PromptSession;afterEach(()=>client?.connection.close());
 it('uses native thread shell, never model turn/start, including completion before acknowledgement',async()=>{
  client=await connectSession(1);const shell=vi.fn(async p=>{
   expect(p).toEqual({threadId:sessionId,command:'pwd',timeoutMs:120000});
   client.emit(turnStarted('native-turn'));client.emit(itemStarted(nativeItem(),'native-turn'));
   client.emit({method:'item/commandExecution/outputDelta',params:{threadId:sessionId,turnId:'native-turn',itemId:'native-shell',delta:'/project\n'}});
   client.emit(itemCompleted(nativeItem({status:'completed',aggregatedOutput:'/project\n',exitCode:0}),'native-turn'));
   client.emit(turnCompleted('native-turn'));return {};
  });client.setCodexResponse('thread/shellCommand',shell);
  const result=await client.request(CC_SHELL_METHOD,params);expect(shell).toHaveBeenCalledOnce();expect(client.turnStartParams).toHaveLength(0);
  expect(await client.request(CC_SHELL_METHOD,params)).toEqual(result);expect(shell).toHaveBeenCalledOnce();
  await expect(client.request(CC_SHELL_METHOD,{...params,command:'different'})).rejects.toThrow();expect(shell).toHaveBeenCalledOnce();
  expect(result._meta[CC_SHELL_META]).toMatchObject({version:1,requestId,text:'/project\n',exitCode:0,contextIncluded:true,done:true});
  expect(client.scopedUpdates.some(x=>(x.update._meta as Record<string,unknown> | undefined)?.[CC_SHELL_META]!==undefined)).toBe(true);
 });
 it('ignores foreign thread/turn/item output and bounds cumulative stdout',async()=>{
  client=await connectSession(1);client.setCodexResponse('thread/shellCommand',async()=>({}));
  const pending=client.request(CC_SHELL_METHOD,params);await settle();
  client.emit(turnStarted('native-turn'));client.emit(itemStarted(nativeItem(),'native-turn'));
  client.emit({method:'item/commandExecution/outputDelta',params:{threadId:'other',turnId:'native-turn',itemId:'native-shell',delta:'secret'}});
  client.emit({method:'item/commandExecution/outputDelta',params:{threadId:sessionId,turnId:'native-turn',itemId:'native-shell',delta:'x'.repeat(40000)}});
  for(let i=0;i<256;i++)client.emit({method:'item/commandExecution/outputDelta',params:{threadId:sessionId,turnId:'native-turn',itemId:'native-shell',delta:'noisy-extra'}});
  client.emit(itemCompleted(nativeItem({status:'completed',exitCode:7,aggregatedOutput:'x'.repeat(40000)}),'native-turn'));
  client.emit(turnCompleted('native-turn'));const result=await pending;const output=result._meta[CC_SHELL_META];
  expect(output.text).toHaveLength(32768);expect(output.text).not.toContain('secret');expect(output.truncated).toBe(true);expect(output.exitCode).toBe(7);expect(client.scopedUpdates.filter(x=>(x.update._meta as Record<string,unknown> | undefined)?.[CC_SHELL_META]!==undefined).length).toBeLessThanOrEqual(4);expect(client.turnStartParams).toHaveLength(0);
 });
 it('does not fall back to model prompts when the native method is unsupported',async()=>{
  client=await connectSession(1);const shell=vi.fn(async()=>{throw new Error('Method not found');});client.setCodexResponse('thread/shellCommand',shell);
  await expect(client.request(CC_SHELL_METHOD,params)).rejects.toThrow();expect(shell).toHaveBeenCalledOnce();expect(client.turnStartParams).toHaveLength(0);
 });
 it('routes cancel to the exact native turn and preserves interrupted outcome',async()=>{
  client=await connectSession(1);const shell=vi.fn(async()=>({}));client.setCodexResponse('thread/shellCommand',shell);
  const pending=client.request(CC_SHELL_METHOD,params);await vi.waitFor(()=>expect(shell).toHaveBeenCalledOnce());client.emit(turnStarted('native-turn'));await settle();
  await client.cancel();await vi.waitFor(()=>expect(client.turnInterruptCalls()).toContainEqual({threadId:sessionId,turnId:'native-turn'}));
  client.emit(itemStarted(nativeItem(),'native-turn'));client.emit(itemCompleted(nativeItem({status:'declined',exitCode:-15,aggregatedOutput:'cancelled'}),'native-turn'));client.emit(turnFinished('interrupted','native-turn'));
  expect((await pending).stopReason).toBe('cancelled');expect(client.turnStartParams).toHaveLength(0);
 });
 it('bounds adapter receipts at the broker receipt limit without evicting old outcomes',async()=>{
  const receipts=new NativeShellReceipts();let count=0;
  const run=async()=>({sequence:++count});
  for(let i=0;i<512;i++)await receipts.run({...params,requestId:i.toString(16).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},run);
  await expect(receipts.run({...params,requestId:'ffffffff-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},run)).rejects.toThrow('capacity');
  expect(await receipts.run({...params,requestId:'00000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},run)).toEqual({sequence:1});expect(count).toBe(512);
 });
 it('rejects missing explicit execution scope and unrecognized options',()=>{
  for(const extra of [{execution:undefined},{execution:'sandboxed'},{cwd:'/elsewhere'},{timeoutMs:0},{command:'x'.repeat(12001)},{command:'echo\u0000x'}])expect(()=>nativeShellParams({...params,...extra})).toThrow();
 });
});
