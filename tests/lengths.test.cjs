const assert=require('node:assert/strict');
const C=require('../core.js'), D=require('../data.js');
const model=C.buildModel(D);
for(const [index,km] of [[15,17.875],[26,7.475]]) {
  for(const direction of ['f','r']) {
    const sec=model.sections.find(s=>s.id===index+direction);
    assert.equal(sec.L,km);
    const tracker=new C.Tracker(model,{margin:3});
    tracker.active={sec,t0:0,odo0:0};tracker.odo=1000;tracker.speed=60;
    const state=tracker.activeState(60000);
    assert.equal(state.remaining,km-1);
    assert(Math.abs(state.rec-Math.min(sec.limit,(km-1)/(km/(sec.limit-3)-1/60)))<1e-9);
    const events=[];
    tracker.pass(sec.toKey,{t:600000,odo:km*1000,p:model.points[sec.toKey].p},events);
    assert(Math.abs(events.find(e=>e.type==='finish').avg-km*6)<1e-9);
  }
}
// Other sections still use their original chainage, and invalid explicit lengths fail loudly.
assert.equal(model.sections.find(s=>s.id==='0f').L,Math.abs(D.sections[0][4]-D.sections[0][2]));
for(const value of [0,-1,NaN,Infinity,'7475']) {
  const row=D.sections[26].slice();row[8]=value;
  assert.throws(()=>C.buildModel({...D,sections:[row]}),/Invalid section length/);
}
console.log('PASS: published lengths in both directions; remaining distance; recommendation; final average; fallback; validation');
