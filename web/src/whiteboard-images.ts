import type {ImageRef} from './whiteboard-sync';
// Keep normalized bytes in bounded board-local memory, rather than refetching
// no-store images on every pointer-move SVG redraw. Never persist image bytes.
export class WhiteboardImages {
 private board='';private entries=new Map<string,{ref:ImageRef;url?:string;failed?:boolean}>();private queue:string[]=[];private active=0;private bytes=0;private controller=new AbortController();
 constructor(private redraw:()=>void){}
 source(board:string,ref:ImageRef){
  if(board!==this.board){this.controller.abort();for(const e of this.entries.values())if(e.url)URL.revokeObjectURL(e.url);this.board=board;this.entries.clear();this.queue=[];this.bytes=0;this.controller=new AbortController();}
  let e=this.entries.get(ref.id);if(!e){e={ref};this.entries.set(ref.id,e);this.queue.push(ref.id);this.pump();}return e.url;
 }
 failed(id:string){return !!this.entries.get(id)?.failed;}
 private pump(){while(this.active<4&&this.queue.length){const id=this.queue.shift()!,entry=this.entries.get(id)!,board=this.board,signal=this.controller.signal;this.active++;void(async()=>{
  try{const r=await fetch(`/api/v1/whiteboards/${board}/images/${id}`,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});if(!r.ok||r.headers.get('Content-Type')!=='image/png')throw Error('Stored image unavailable');const b=await r.blob();if(signal.aborted)return;if(b.size>4*1024*1024||this.bytes+b.size>16*1024*1024)throw Error('Image memory budget exceeded');this.bytes+=b.size;entry.url=URL.createObjectURL(b);}catch{entry.failed=true;}finally{this.active--;if(!signal.aborted)this.redraw();this.pump();}
 })();}}
}
