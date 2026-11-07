// Browser-local synthesized audio; no external assets or conversation data.
const preference='cc.notifications.sound.enabled';
const volumeKey='cc.notifications.sound.volume';
export class NotificationSound {
 private context?:AudioContext;
 private unlocking?:Promise<void>;
 private problem='';
 private localEnabled?:boolean;
 private localVolume?:number;
 constructor(private allowed:()=>boolean){
  const unlock=(event:Event)=>{if(event.isTrusted&&this.enabled()&&this.allowed()&&!this.ready())void this.arm().catch(()=>{});};
  window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);
  window.addEventListener('storage',event=>{if(event.key===preference||event.key===volumeKey||event.key===null){if(event.key===preference||event.key===null)this.localEnabled=undefined;if(event.key===volumeKey||event.key===null)this.localVolume=undefined;if(!this.enabled())void this.context?.suspend().catch(()=>{});this.changed();}});
 }
 private changed(){window.dispatchEvent(new Event('cc-notification-sound'));}
 available(){return typeof window.AudioContext==='function';}
 enabled(){if(this.localEnabled!==undefined)return this.localEnabled;try{return localStorage.getItem(preference)==='true';}catch{return false;}}
 volume(){if(this.localVolume!==undefined)return this.localVolume;try{const value=localStorage.getItem(volumeKey);const number=value===null ? .35 : Number(value);return Number.isFinite(number)?Math.max(0,Math.min(1,number)):.35;}catch{return .35;}}
 setVolume(value:number){const normalized=Math.max(0,Math.min(1,Number.isFinite(value)?value:.35));try{localStorage.setItem(volumeKey,String(normalized));this.localVolume=undefined;this.problem='';}catch{this.localVolume=normalized;this.problem='Volume applies in this tab only; browser storage could not save it.';}this.changed();}
 ready(){return this.context?.state==='running';}
 canAlert(){return this.enabled()&&this.allowed()&&this.ready()&&this.volume()>0;}
 status(){
  if(!this.available())return 'This browser does not support notification audio.';
  if(!this.allowed())return 'Enable desktop notifications to use sound alerts.';
  if(this.problem)return this.problem;
  if(!this.enabled())return 'Sound off. Enable a chime for new replies, completion updates and approval/input requests.';
  if(!this.volume())return 'Sound enabled at 0% (muted).';
  if(!this.ready())return 'Sound enabled. Use Test sound or interact with this tab to allow audio after a reload.';
  return `Sound on · ${Math.round(this.volume()*100)}%. Keep a CC tab open; browser suspension and system mute can silence alerts.`;
 }
 async arm(){
  if(!this.available()||!this.allowed())throw Error('Desktop notification audio is unavailable.');
  if(this.unlocking)return this.unlocking;
  this.unlocking=(async()=>{
   let timeout=0;
   try{
    if(!this.context||this.context.state==='closed')this.context=new AudioContext();this.context.onstatechange=()=>this.changed();
    if(this.context.state!=='running')await Promise.race([this.context.resume(),new Promise<never>((_,reject)=>{timeout=window.setTimeout(()=>reject(Error('Audio permission timed out')),1500);})]);
    if(this.context.state!=='running')throw Error('Audio is suspended');this.problem='';
   }catch{this.problem='Browser audio is blocked or paused. Use Test sound to retry.';throw Error(this.problem);}
   finally{clearTimeout(timeout);this.changed();}
  })().finally(()=>{this.unlocking=undefined;});
  return this.unlocking;
 }
 async setEnabled(value:boolean){
  if(value){await this.arm();try{localStorage.setItem(preference,'true');this.localEnabled=undefined;this.problem='';}catch{this.localEnabled=false;this.problem='Browser storage is unavailable; sound could not be enabled.';}}
  else{this.localEnabled=false;try{localStorage.removeItem(preference);this.localEnabled=undefined;this.problem='';}catch{this.problem='Sound is off in this tab; browser storage could not save that choice.';}void this.context?.suspend().catch(()=>{});}
  this.changed();
 }
 async preview(){await this.arm();this.chime();}
 alert(){if(!this.canAlert())return;this.chime();}
 private chime(){
  const context=this.context;if(!context||context.state!=='running'||!this.volume())return;
  try{for(const [offset,frequency] of [[0,880],[.14,1174]]){
   const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+offset,end=start+.18;
   oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,this.volume()*.12),start+.015);gain.gain.exponentialRampToValueAtTime(.0001,end);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(start);oscillator.stop(end+.01);
  }this.problem='';}catch{this.problem='Notification audio could not be played. Use Test sound to retry.';this.changed();}
 }
}
