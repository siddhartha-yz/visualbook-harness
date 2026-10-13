import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('embedded playback measures elapsed frame time without mixing clock origins',()=>{
 const pending=new Map(),events=new Map();let serial=0;
 const attrs=new Map(),svg={style:{},getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),querySelector:()=>null};
 const range={value:0,addEventListener:()=>{}},button={setAttribute:()=>{},addEventListener:()=>{}};
 const element={dataset:{},querySelector:s=>s==='svg'?svg:s==='.vh-canvas'?{clientWidth:800}:s==='.vh-progress'?range:s==='.vh-play'?button:null,querySelectorAll:()=>[]};
 const win={};const media={matches:false,addEventListener:()=>{}};
 const Observer=class{observe(){}};
 vm.runInNewContext(fs.readFileSync(new URL('../packages/visualbook/runtime.js',import.meta.url),'utf8'),{
  window:win,document:{hidden:false,querySelector:()=>null,addEventListener:()=>{}},matchMedia:()=>media,
  addEventListener:(name,fn)=>events.set(name,fn),structuredClone,
  ResizeObserver:Observer,IntersectionObserver:Observer,
  performance:{now:()=>1150},requestAnimationFrame:fn=>{pending.set(++serial,fn);return serial;},cancelAnimationFrame:id=>pending.delete(id),
 });
 const instance=win.VisualBookRuntime.mount(element,{id:'clock',interaction:'timeline',durationMs:1000,height:120},()=>({}),false);
 const frame=t=>{const [id,fn]=pending.entries().next().value;pending.delete(id);fn(t);};
 instance.play();frame(100);frame(350);assert.equal(instance.progress,.25);assert.equal(range.value,.25);
 events.get('wheel')();assert.equal(instance.playing,false);assert.equal(instance.progress,.25);assert.equal(pending.size,0);
 instance.play();frame(500);frame(1000);assert.equal(instance.progress,.5);frame(1500);assert.equal(instance.progress,1);assert.equal(instance.playing,false);
});
