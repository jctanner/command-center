import type {ITheme} from '@xterm/xterm';
import paletteData from './theme-palettes.json';

type Theme={id:string;name:string;colors:Record<string,string|undefined>&{mode:string;background:string;foreground:string;accent:string}};
export const themes:readonly Theme[]=paletteData.themes;
const storageKey='cc.theme';
let selected=themes[0];
const find=(id:string|null|undefined)=>themes.find(theme=>theme.id===id)||themes[0];
export function currentTheme(){return selected;}
export function onThemeChange(listener:()=>void){window.addEventListener('cc-theme-change',listener);return()=>window.removeEventListener('cc-theme-change',listener);}
export function setTheme(id:string,persist=true){
 selected=find(id);document.documentElement.dataset.theme=selected.id;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',selected.colors.background);
 const field=document.getElementById('theme-select') as HTMLSelectElement|null;if(field)field.value=selected.id;
 const preview=document.getElementById('theme-preview');
 if(preview){preview.replaceChildren(...['background','foreground','accent','red','green','yellow','blue','magenta'].map(key=>{const swatch=document.createElement('span');swatch.style.backgroundColor=selected.colors[key]||selected.colors.foreground;swatch.title=key;return swatch;}));}
 const detail=document.getElementById('theme-description');if(detail)detail.textContent=`${selected.name} · ${selected.colors.mode==='light'?'Light':'Dark'} · This browser`;
 if(persist)try{localStorage.setItem(storageKey,selected.id);}catch{/* The selection still works when browser storage is unavailable. */}
 window.dispatchEvent(new Event('cc-theme-change'));
}
export function initializeThemes(){
 const field=document.getElementById('theme-select') as HTMLSelectElement;
 field.replaceChildren(...themes.map(theme=>new Option(theme.name+(theme.colors.mode==='light'?' · Light':''),theme.id)));
 field.onchange=()=>setTheme(field.value);
 let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{/* Optional browser persistence. */}
 setTheme(find(saved).id,false);
 window.addEventListener('storage',event=>{if(event.key===storageKey||event.key===null)setTheme(find(event.key===null?null:event.newValue).id,false);});
}
export function terminalTheme():ITheme{
 const p=selected.colors;
 return{background:p.background,foreground:p.foreground,cursor:p.accent,cursorAccent:p.background,selectionBackground:p.selection||p.accent,selectionForeground:p.foreground,black:p.dark_background||p.background,red:p.red,green:p.green,yellow:p.yellow,blue:p.blue,magenta:p.magenta,cyan:p.cyan,white:p.foreground,brightBlack:p.dark_foreground||p.foreground,brightRed:p.bright_red||p.red,brightGreen:p.bright_green||p.green,brightYellow:p.bright_yellow||p.yellow,brightBlue:p.bright_blue||p.blue,brightMagenta:p.bright_magenta||p.magenta,brightCyan:p.bright_cyan||p.cyan,brightWhite:p.bright_foreground||p.foreground};
}
