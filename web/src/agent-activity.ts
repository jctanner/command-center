export type AgentActivityEntry = {
  id: string; position: number; order: number; timestamp: string;
  kind: 'thinking' | 'tool'; title: string; status: 'recorded' | 'pending' | 'completed' | 'error' | 'background';
  text: string; arguments?: string; output?: string; truncated?: boolean;
};

export function activityElement(entry: AgentActivityEntry, open = false) {
  const details = document.createElement('details');
  details.className = 'agent-activity'; details.dataset.activityId = entry.id;
  details.dataset.status = entry.status; details.open = open;
  const summary = document.createElement('summary');
  const title = document.createElement('span'); title.textContent = entry.title;
  const status = document.createElement('small');
  status.textContent = ({ recorded: 'Recorded', pending: 'Awaiting result', completed: 'Completed', error: 'Failed', background: 'Started in background' })[entry.status];
  summary.append(title, status); details.append(summary);
  if (entry.timestamp) {
    const stamp = document.createElement('small'); stamp.className = 'activity-time';
    stamp.textContent = new Date(entry.timestamp).toLocaleString(); details.append(stamp);
  }
  const section = (label: string, text?: string) => {
    if (!text) return;
    const heading = document.createElement('strong'); heading.textContent = label;
    const pre = document.createElement('pre'); pre.textContent = text;
    details.append(heading, pre);
  };
  section(entry.kind === 'thinking' ? 'Thinking summary' : 'Details', entry.text);
  section('Input', entry.arguments); section('Result', entry.output);
  if (entry.status === 'pending') {
    const note = document.createElement('p'); note.textContent = 'No result is recorded in this history page yet.'; details.append(note);
  }
  if (entry.truncated) {
    const note = document.createElement('p'); note.textContent = 'Activity shortened for this view. Open the CLI for full details.'; details.append(note);
  }
  return details;
}

export type HistoryEntry={position:number;order:number;element:HTMLElement;activity?:AgentActivityEntry};
/** Only finished adjacent activity is folded; live/error/background entries stay independent. */
export function groupActivityRuns(entries:HistoryEntry[],openMembers:ReadonlySet<string>=new Set()):HTMLElement[]{
 const result:HTMLElement[]=[];let run:HistoryEntry[]=[];
 const flush=()=>{
  if(run.length<2){result.push(...run.map(e=>e.element));run=[];return;}
  const details=document.createElement('details');details.className='agent-activity-run';details.dataset.activityId='run:'+run[0].activity!.id;
  details.dataset.members=JSON.stringify(run.map(e=>e.activity!.id));details.open=run.some(e=>openMembers.has(e.activity!.id)||(e.element as HTMLDetailsElement).open);
  const tools=run.filter(e=>e.activity!.kind==='tool').length,thinking=run.length-tools;
  const summary=document.createElement('summary');summary.textContent=[tools?`${tools} completed ${tools===1?'tool call':'tool calls'}`:'',thinking?`${thinking} thinking ${thinking===1?'entry':'entries'}`:''].filter(Boolean).join(' · ');
  details.append(summary,...run.map(e=>e.element));result.push(details);run=[];
 };
 for(const entry of entries){const a=entry.activity;if(a&&(a.status==='completed'||a.kind==='thinking'&&a.status==='recorded'))run.push(entry);else{flush();result.push(entry.element);}}
 flush();return result;
}
