// Copyright 2026 Command Center contributors. Apache-2.0.
// Native Codex execution: never spawn a shell or send turn/start here.
import type {MessageConnection} from 'vscode-jsonrpc/node';
import type {TurnCompletedNotification} from './app-server/v2';
export const CC_SHELL_METHOD = '_cc/session/shell';
export const CC_SHELL_META = 'command-center/native-shell';
export const CC_SHELL_EXECUTION = 'codex_native_full_access';
export const CC_SHELL_CAPABILITY = {version: 1, method: CC_SHELL_METHOD,
    execution: CC_SHELL_EXECUTION, contextIncluded: true, timeoutMs: 120000, outputBytes: 32768};
export type NativeShell = {command: string; requestId: string; execution: typeof CC_SHELL_EXECUTION;
    output?: ShellOutput; publish?: (output: ShellOutput) => void | Promise<void>};
export type ShellOutput = {requestId: string; turnId: string; text: string; exitCode: number | null;
    truncated: boolean; contextIncluded: boolean; done: boolean; version: number; execution: string};
export function nativeShellParams(value: Record<string, unknown>): {sessionId: string} & NativeShell {
    if (Object.keys(value).some(k => !['sessionId', 'command', 'requestId', 'execution'].includes(k)) ||
        typeof value['sessionId'] !== 'string' || !value['sessionId'] || value['sessionId'].length > 512 ||
        typeof value['command'] !== 'string' || !value['command'].trim() || Buffer.byteLength(value['command']) > 12000 ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(value['command']) ||
        typeof value['requestId'] !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value['requestId']) ||
        value['execution'] !== CC_SHELL_EXECUTION) throw new Error('Invalid explicit native shell request');
    return value as {sessionId: string} & NativeShell;
}
export async function runNativeShell(connection: MessageConnection, threadId: string, shell: NativeShell,
    onTurnStarted: ((turnId: string) => void) | undefined,
    subscribe: (method: string, callback: (event: any) => void) => {dispose():void}): Promise<TurnCompletedNotification> {
    let turnId: string | undefined, itemId: string | undefined, bytes = Buffer.alloc(0), truncated = false;
    let exitCode: number | null = null, nativeItemCompleted = false;
    let resolve!: (value: TurnCompletedNotification) => void, reject!: (error: Error) => void;
    const completed = new Promise<TurnCompletedNotification>((yes, no) => {resolve = yes; reject = no;});
    void completed.catch(() => {});
    let publication = Promise.resolve(), publishing = false, pending: ShellOutput | undefined;
    let finished = false;
    const publish = (done: boolean, contextIncluded: boolean) => {
        const output: ShellOutput = {version:1, execution:CC_SHELL_EXECUTION, requestId:shell.requestId,
            turnId:turnId ?? '', text:bytes.toString('utf8'), exitCode, truncated, done, contextIncluded};
        shell.output = output; pending = output;
        if(publishing) return;
        publishing = true;
        publication = (async () => {
            try {
                while(pending) {
                    const next = pending; pending = undefined;
                    if(!next.done) await new Promise(resolve => setTimeout(resolve,50));
                    await shell.publish?.(next);
                }
            } finally {publishing = false;}
        })();
        void publication.catch(reject);
    };
    const bounded = (text: string, replace: boolean): boolean => {
        if(!replace && bytes.length >= 32768) {
            const changed = !truncated && text.length > 0; truncated ||= text.length > 0; return changed;
        }
        const next = Buffer.from(text.slice(0,32768)); if(replace) bytes = Buffer.alloc(0);
        const left = Math.max(0,32768-bytes.length); truncated ||= next.length > left || text.length > 32768;
        bytes = Buffer.concat([bytes,next.subarray(0,left)]); return true;
    };
    const listeners = [
        subscribe('turn/started', (event: any) => {
            if(finished || event.threadId !== threadId) return;
            if(turnId !== undefined && turnId !== event.turn.id) {reject(new Error('Native shell turn changed')); return;}
            if(turnId === event.turn.id) return;
            turnId = event.turn.id; onTurnStarted?.(event.turn.id);
        }),
        subscribe('item/started', (event: any) => {
            if(!finished && event.threadId === threadId && event.turnId === turnId && event.item.type === 'commandExecution' && event.item.source === 'userShell') {
                if(itemId && itemId !== event.item.id) {reject(new Error('Native shell item changed')); return;}
                itemId = event.item.id; publish(false,false);
            }
        }),
        subscribe('item/commandExecution/outputDelta', (event: any) => {
            if(finished || event.threadId !== threadId || event.turnId !== turnId || event.itemId !== itemId || typeof event.delta !== 'string') return;
            if(bounded(event.delta,false)) publish(false,false);
        }),
        subscribe('item/completed', (event: any) => {
            if(finished || event.threadId !== threadId || event.turnId !== turnId || event.item.id !== itemId || event.item.type !== 'commandExecution' || event.item.source !== 'userShell') return;
            if(typeof event.item.aggregatedOutput === 'string') bounded(event.item.aggregatedOutput,true);
            exitCode = Number.isSafeInteger(event.item.exitCode) ? event.item.exitCode : null;
            nativeItemCompleted = true; publish(false,false);
        }),
        subscribe('turn/completed', (event: TurnCompletedNotification) => {
            if(finished || event.threadId !== threadId || event.turn.id !== turnId) return;
            finished = true;publish(true,nativeItemCompleted);
            resolve(event);
        }),
        connection.onClose?.(() => reject(new Error('Native shell connection lost; inspect receipt, never retry'))),
        connection.onDispose?.(() => reject(new Error('Native shell connection disposed; never retry'))),
    ];
    const timer = setTimeout(() => reject(new Error('Native shell result unavailable; never retry')),130000);
    try {
        // Register every listener before IO: native execution may complete before its empty acknowledgement.
        await connection.sendRequest('thread/shellCommand',{threadId,command:shell.command,timeoutMs:120000});
        const result = await completed; await publication; return result;
    } finally {clearTimeout(timer); for(const listener of listeners) listener?.dispose();}
}

// CC has durable receipts; this additional in-process barrier also prevents a
// duplicate ACP request from executing twice before/after an empty native ack.
export class NativeShellReceipts {
    private readonly entries = new Map<string,{intent:string;result:Promise<Record<string,unknown>>}>();
    run(shell: {sessionId:string}&NativeShell, action:()=>Promise<Record<string,unknown>>):Promise<Record<string,unknown>> {
        const intent=JSON.stringify([shell.sessionId,shell.command,shell.execution]);
        const previous=this.entries.get(shell.requestId);
        if(previous) {
            if(previous.intent!==intent)return Promise.reject(new Error('Native shell UUID reused for a different intent'));
            return previous.result;
        }
        if(this.entries.size>=512)return Promise.reject(new Error('Native shell receipt capacity reached'));
        const result=Promise.resolve().then(action);this.entries.set(shell.requestId,{intent,result});
        void result.catch(()=>{});return result;
    }
}
