const assert=require('node:assert/strict'),C=require('../core.js'),D=require('../data.js'),m=C.buildModel(D);
const measure=(...keys)=>C.measureSections(m,keys);
let r=measure('I-5:Самоводене','I-5:Полски Тръмбеш');assert.equal(r.error,null);assert.equal(r.sections.length,2);assert(Math.abs(r.total-27.568)<1e-9);
let step=measure('I-5:Самоводене','I-5:Поликраище','I-5:Полски Тръмбеш');assert.equal(step.total,r.total);
assert.equal(measure('I-5:Полски Тръмбеш','I-5:Самоводене').total,r.total);
r=measure('T:Крушовица','T:Радиново');assert.equal(r.error,null);assert.equal(r.sections.length,4);assert(r.gaps>0);assert.equal(r.total,r.sections.reduce((n,s)=>n+s.L,0));assert(r.total<Math.abs(m.points['T:Радиново'].km-m.points['T:Крушовица'].km));
assert(measure('T:Крушовица','I-5:Самоводене').error);
assert(measure('I-5:Самоводене','I-5:Самоводене').error);
assert(measure('I-5:Самоводене','I-5:Поликраище','I-5:Самоводене').error);
assert(measure('M:Момково','M:Свиленград').error);assert.equal(measure('M:Свиленград','M:Момково').sections.length,1);
assert.equal(measure('H:Девня','H:Игнатиево').total,17.875);
assert.equal(measure('I-5:Самоводене').total,0);assert.equal(measure().total,0);
console.log('PASS measurement: endpoints/automatic intermediate sections, incremental sum, reverse, excluded gaps/upcoming, road mismatch, duplicate coverage, published lengths');

assert.match(measure('T:Крушовица','I-5:Самоводене').error,/няма сертифицирана отсечка/);
assert.match(measure('T:Крушовица','T:Вакарел','I-5:Самоводене').error,/В момента измервате друго разстояние/);
assert.match(measure('T:Ихтиман','T:Щърково').error,/няма сертифицирана отсечка/);
