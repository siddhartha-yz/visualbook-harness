import test from 'node:test';
import assert from 'node:assert/strict';
import {captionLayoutFindings} from '../packages/visualbook/caption-layout.mjs';
const columns={type:'columns',layout:{minColumnWidth:280,gap:24},children:[{type:'plot'},{type:'plot'}]};
test('a responsive four-dimensional projection caption cannot point left/right on mobile',()=>{
 const f={id:'projection',scene:{type:'compose',visual:columns},summary:'两个坐标投影记录同一个四维解：自由分量在左，主分量在右。'};
 assert.equal(captionLayoutFindings(f)[0].kind,'responsive-positional-caption');
 assert.deepEqual(captionLayoutFindings({...f,summary:'自由分量图记录(x₂,x₄)，主分量图记录(x₁,x₃)。'}),[]);
});
test('signed coordinates and fixed single plots are not mistaken for responsive panels',()=>{
 assert.deepEqual(captionLayoutFindings({scene:columns,summary:'负值在左，正值在右，以零线为基准。'}),[]);
 assert.deepEqual(captionLayoutFindings({scene:{type:'plot'},summary:'A在左，B在右。'}),[]);
 assert.deepEqual(captionLayoutFindings({scene:{...columns,layout:{minColumnWidth:100}},summary:'A在左，B在右。'}),[]);
});
