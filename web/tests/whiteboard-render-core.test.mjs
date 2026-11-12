import assert from 'node:assert/strict';
import rough from 'roughjs';
import {drawingGeometry,drawingColor,drawingSoft} from '../src/whiteboard-render-core.js';
const shape={kind:'rectangle',x:0,y:0,w:100,h:80,color:'future-color',fill:'soft',seed:1,text:'',clean:true};
for(const palette of [undefined,null,{}, {mode:'light',foreground:''}, {foreground:'#123456',red:'not-a-color',red_soft:'url(https://example.org)'}]){
 const drawing=drawingGeometry(rough.generator(),shape,[shape],palette);assert(drawing.paths.length);assert(drawing.paths.some(p=>p.stroke===drawingColor(palette,shape.color)));for(const p of drawing.paths){assert.match(p.stroke,/^(none|#[0-9a-f]{6})$/i);assert.match(p.fill,/^(none|#[0-9a-f]{6})$/i);}assert.match(drawingColor(palette,'red'),/^#[0-9a-f]{6}$/i);assert.match(drawingSoft(palette,'red'),/^#[0-9a-f]{6}$/i);
}
assert.equal(drawingColor({foreground:'#123456',accent:'#abcdef'},'unsupported'),'#123456');console.log('Missing/invalid palette and unknown paint fallback pass');
