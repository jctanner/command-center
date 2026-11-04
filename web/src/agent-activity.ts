export type AgentActivityEntry = {
  id: string; position: number; order: number; timestamp: string;
  kind: 'thinking' | 'tool'; title: string; status: 'recorded' | 'pending' | 'completed' | 'error';
  text: string; arguments?: string; output?: string; truncated?: boolean;
};

export function activityElement(entry: AgentActivityEntry, open = false) {
  const details = document.createElement('details');
  details.className = 'agent-activity'; details.dataset.activityId = entry.id;
  details.dataset.status = entry.status; details.open = open;
  const summary = document.createElement('summary');
  const title = document.createElement('span'); title.textContent = entry.title;
  const status = document.createElement('small');
  status.textContent = ({ recorded: 'Recorded', pending: 'Awaiting result', completed: 'Completed', error: 'Failed' })[entry.status];
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
