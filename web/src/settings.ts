export type FeatureFlags={slack:boolean;email:boolean;jira:boolean};
type Snapshot={revision:string;features:FeatureFlags};
type Machines={activate():void;canLeave():boolean};
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export class SettingsWorkspace {
 private request=0;private visible=false;private section:'machines'|'features'='machines';private saved?:Snapshot;private draftRevision='';private dirty=false;private busy=false;private conflict=false;
 private fields=new Map<keyof FeatureFlags,HTMLInputElement>();private feedback=el('features-feedback');
 constructor(private machines:Machines,private changed:(flags:FeatureFlags)=>void,private open:(workspace:keyof FeatureFlags)=>void){
  el('settings-machines-tab').onclick=()=>this.select('machines');el('settings-features-tab').onclick=()=>this.select('features');
  for(const name of ['slack','email','jira'] as const){const field=el<HTMLInputElement>('feature-'+name);this.fields.set(name,field);field.onchange=()=>{this.dirty=JSON.stringify(this.draft())!==JSON.stringify(this.saved?.features);this.controls();};el('open-feature-'+name).onclick=()=>{if(this.saved?.features[name]&&this.canLeave())this.open(name);};}
  el('save-features').onclick=()=>void this.save();el('reload-features').onclick=()=>{if(!this.busy&&(!this.dirty||confirm('Discard unsaved feature changes?')))void this.refresh(true);};
  this.controls();
 }
 private draft():FeatureFlags{return{slack:this.fields.get('slack')!.checked,email:this.fields.get('email')!.checked,jira:this.fields.get('jira')!.checked};}
 private controls(){for(const [name,field] of this.fields){field.disabled=this.busy||!this.saved;el<HTMLButtonElement>('open-feature-'+name).disabled=!this.saved?.features[name]||this.busy;}el<HTMLButtonElement>('save-features').disabled=this.busy||!this.saved||!this.dirty||this.conflict;el<HTMLButtonElement>('reload-features').disabled=this.busy;}
 private receive(value:Snapshot,reset=false){
  this.saved=value;
  if(!this.dirty||reset){this.dirty=false;this.conflict=false;this.draftRevision=value.revision;for(const [name,field] of this.fields)field.checked=value.features[name];}
  else if(this.draftRevision!==value.revision){this.conflict=true;this.feedback.textContent='Features changed elsewhere. Your choices are kept; reload saved settings before editing again.';}
  this.controls();this.changed(value.features);
 }
 async refresh(reset=false){
  if(this.busy)return;const request=++this.request;
  try{const r=await fetch('/api/v1/settings/features',{cache:'no-store',signal:AbortSignal.timeout(15000)});const data=await r.json();if(request!==this.request)return;if(!r.ok)throw Error(data.error||'Feature settings unavailable');this.receive(data,reset);if(reset)this.feedback.textContent='Saved feature settings reloaded.';}
  catch(error){if(request===this.request)this.feedback.textContent=String(error);}
 }
 private async save(){
  if(this.busy||!this.saved||this.conflict)return;++this.request;this.busy=true;this.controls();this.feedback.textContent='Saving features…';
  try{const r=await fetch('/api/v1/settings/features',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:this.draftRevision,features:this.draft()}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok){if(r.status===409)this.conflict=true;throw Error(data.error||'Could not save features');}this.receive(data,true);this.feedback.textContent='Features saved for all clients. Source settings and saved data are retained.';}
  catch(error){this.feedback.textContent=String(error);}finally{this.busy=false;this.controls();}
 }
 canLeave(){if(this.section==='machines')return this.machines.canLeave();if(this.busy)return false;if(this.dirty&&!confirm('Discard unsaved feature changes?'))return false;this.dirty=false;if(this.saved)this.receive(this.saved,true);return true;}
 select(section:'machines'|'features',force=false){if(section!==this.section&&!force&&!this.canLeave())return;this.section=section;el('settings-machines').hidden=section!=='machines';el('settings-features').hidden=section!=='features';el('settings-machines-tab').setAttribute('aria-pressed',String(section==='machines'));el('settings-features-tab').setAttribute('aria-pressed',String(section==='features'));if(this.visible){if(section==='machines')this.machines.activate();else void this.refresh();}}
 setVisible(visible:boolean){const entering=visible&&!this.visible;this.visible=visible;el('settings-pane').hidden=!visible;if(entering){if(this.section==='machines')this.machines.activate();else void this.refresh();}}
}
