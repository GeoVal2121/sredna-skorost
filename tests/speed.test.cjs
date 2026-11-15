const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('../core.js');
const tracker=new C.Tracker({points:{},sections:[]});
let t=Date.now();const fix=(speed,seconds=1,acc=5)=>({lat:42,lon:23+(t%100000)/1e8,t:t+=seconds*1000,speed,acc});
for(const v of [0,10,20,30,15,0]){tracker.feed(fix(v));assert.equal(tracker.speed,v*3.6);assert(tracker.speedValid);assert(!tracker.speedEstimated);}
tracker.feed(fix(null));assert(tracker.speedValid&&tracker.speedEstimated);
tracker.feed(fix(null,6));assert(!tracker.speedValid);
tracker.feed(fix(20));assert.equal(tracker.speed,72);assert(tracker.speedValid&&!tracker.speedEstimated);
tracker.feed(fix(null,1,70));assert(!tracker.speedValid);
tracker.reset();tracker.feed(fix(null));assert(!tracker.speedValid,'first position cannot supply speed');
tracker.feed(fix(0));assert(tracker.speedValid);assert.equal(tracker.speed,0);
const source=fs.readFileSync('app.js','utf8'),display={};const context={tracker,demoTimer:null,Date,$:()=>display,r0:Math.round};vm.createContext(context);
const line=source.split('\n').find(l=>l.includes('$("spd").textContent = tracker.last'));
tracker.last.t=Date.now();vm.runInContext(line,context);assert.equal(display.textContent,'0');
tracker.last.t=Date.now()-4000;vm.runInContext(line,context);assert.equal(display.textContent,'–');
tracker.last.t=Date.now();tracker.speed=36;tracker.speedEstimated=true;vm.runInContext(line,context);assert.equal(display.textContent,'≈36');
console.log('PASS native speed has no smoothing lag including zero; estimated speed bounded to recent accurate fixes; gap/poor/missing speed and stale display handled');
