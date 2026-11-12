import type {Drawing} from './whiteboard-sync';
import type {RoughGenerator} from 'roughjs/bin/generator';
export type Bounds={x:number;y:number;w:number;h:number};
export type Palette=Record<string,string|undefined>&{mode:string;background:string;foreground:string;accent:string};
export function drawingEnds(item:Drawing,items:Drawing[]):{x:number;y:number}[];
export function drawingGeometry(generator:RoughGenerator,item:Drawing,items:Drawing[],palette:Palette):{paths:{d:string;fill:string;stroke:string;strokeWidth:number;round?:boolean}[];label:null|{lines:string[];x:number;y:number;fontSize:number;anchor:string;fill:string}};
export function drawingBounds(items:Drawing[]):Bounds;
export function sceneSVG(generator:RoughGenerator,items:Drawing[],palette:Palette,bounds:Bounds|null,scale:number,font?:string,images?:Record<string,string>):string;
