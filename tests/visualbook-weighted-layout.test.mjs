import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from '../tools/visualbook.mjs';
const V={Board:class {},palette:{}};
vm.runInNewContext(fs.readFileSync(new URL('../packages/visualbook/compose.js',import.meta.url),'utf8'),{window:{VisualBook:V}});
test('weighted columns respect the smallest declared child width',()=>{
 const options={kind:'columns',weights:[3,1],gap:16,minColumnWidth:200};
 const narrow=V.layout(700,540,2,options),wide=V.layout(850,400,2,options);
 assert.equal(narrow[0].width,700); assert.ok(narrow[1].y>0);
 assert.ok(wide.every(b=>b.width>=200)); assert.equal(wide[1].y,0);
 assert.equal(V.sceneMinimumWidth({type:'compose',visual:{type:'columns',layout:options,children:[{type:'plot'},{type:'readout'}]}}),816);
});
test('nested columns reserve width for a small weighted result panel',()=>{
 const inner={type:'columns',layout:{weights:[2,1],gap:20,minColumnWidth:260},children:[{type:'plot'},{type:'readout'}]};
 const outer={type:'columns',layout:{weights:[1,1],gap:24,minColumnWidth:280},children:[inner,{type:'plot'}]};
 assert.equal(V.sceneMinimumWidth(inner),800); assert.equal(V.sceneMinimumWidth(outer),1624);
 assert.throws(()=>V.layout(850,400,2,{weights:[3,0]}),/Positive/);
});

test('generated structured startup retains the scene for compact-height decisions',()=>{
 const source={title:'Small',sourceSha256:'control',blocks:[{id:'one',type:'paragraph',raw:'One',html:'<p>One</p>',sha256:'control',math:{expected:0}}]};
 const figure={id:'weighted',title:'Weighted panels',afterAnchor:'one',height:300,mobileHeight:500,interaction:'static',scene:{type:'columns',layout:{weights:[3,1],minColumnWidth:240},children:[{type:'readout',props:{items:[{label:'a',value:1}]}},{type:'readout',props:{items:[{label:'b',value:2}]}}]}};
 const html=build(source,{figures:[figure]});const script=html.match(/<script>([\s\S]*)<\/script>/)[1];const boundary=script.indexOf('/* VisualBook figure startup */');
 assert.ok(boundary>0);new vm.Script(script.slice(0,boundary));new vm.Script(script.slice(boundary));assert.match(script.slice(boundary),/},scene},function draw/);
});
