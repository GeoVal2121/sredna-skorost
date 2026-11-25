const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../map.js'),'utf8');
let click,pitch=0,pitchChanged;
const compass={dataset:{},setAttribute(k,v){this[k]=v},addEventListener(type,fn,capture){assert.equal(type,'click');assert.equal(capture,true);click=fn}};
const ctx={App:{cfg:{headUp:true}},map:{getContainer:()=>({querySelector:()=>compass}),getPitch:()=>pitch,on:(name,fn)=>{assert.equal(name,'pitch');pitchChanged=fn},easeTo:opts=>{pitch=opts.pitch;pitchChanged()}}};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('  var selectedPitch'),source.indexOf('  var geoCache')),ctx);
vm.runInContext(source.slice(source.indexOf('    // The existing compass'),source.indexOf('    // без интернет/плочки')),ctx);
assert.equal(compass.dataset.view,'3D');
const event={preventDefault(){},stopImmediatePropagation(){}};
click(event);assert.equal(pitch,50);assert.equal(compass.dataset.view,'2D');assert.equal(ctx.targetPitch(),50);
click(event);assert.equal(pitch,0);assert.equal(compass.dataset.view,'3D');assert.equal(ctx.targetPitch(),0);
ctx.App.cfg.headUp=false;assert.equal(ctx.targetPitch(),0);
assert(source.includes('pitch: targetPitch()'));assert(source.includes('(targetPitch() - map.getPitch())'));
console.log('PASS: 3D/2D label, toggle, selected pitch respected by following and recentering');

// Full follow camera: slow travel and stop use the same interpolated course as the arrow.
let camera, stopped=0;
Object.assign(ctx,{follow:true,touching:false,hasHeading:true,car:{setLngLat(){return this},setRotation(){}},carEl:{style:{}},
  anim:{to:[42,23],lastFix:0},animPos:()=>({p:[42,23],h:90,t:1}),performance:{now:()=>0},
  requestAnimationFrame:()=>1,raf:null,camBearing:null,window:{},userZoomUntil:0});
ctx.App.tracker=()=>({speed:6});
ctx.map={getCanvas:()=>({clientHeight:750}),getPitch:()=>0,getZoom:()=>15,getBearing:()=>30,
  jumpTo:o=>camera=o,stop:()=>stopped++};
vm.runInContext(source.slice(source.indexOf('  function pad()'),source.indexOf('  var ROADS =')),ctx);
ctx.App.cfg.headUp=true;ctx.frame();assert.equal(camera.bearing,90,'slow travel must point forward');
ctx.animPos=()=>({p:[42.001,23],h:180,t:1});ctx.frame();assert.equal(camera.bearing,180,'turn follows arrow without extra camera lag');
ctx.App.tracker=()=>({speed:0});ctx.frame();assert.equal(camera.bearing,180,'stop preserves reliable heading');
ctx.App.cfg.headUp=false;ctx.frame();assert.equal(camera.bearing,0,'explicit north-up remains available');
ctx.App.cfg.headUp=true;ctx.hasHeading=false;ctx.frame();assert.equal(camera.bearing,30,'unknown heading must not invent north');
ctx.hasHeading=true;
vm.runInContext(source.slice(source.indexOf('  function recenter()'),source.indexOf('  function refresh()')),ctx);
ctx.recenter();assert.equal(stopped,1);ctx.frame();assert.equal(camera.bearing,180,'recenter cannot leave follow locked behind moveend');
console.log('PASS: forward camera at low speed, turns, stop, north-up, unknown bearing, recenter resume');

ctx.updateSettlement(true);ctx.updateSettlement(true);ctx.frame();assert.equal(camera.zoom,undefined);
ctx.updateSettlement(true);ctx.frame();assert(camera.zoom>15,'entering a settlement zooms in without a route');
ctx.map.getZoom=()=>17;
ctx.updateSettlement(false);ctx.updateSettlement(null);ctx.updateSettlement(false);ctx.updateSettlement(false);
ctx.frame();assert.equal(camera.zoom,undefined,'missing data resets exit confirmation');
ctx.updateSettlement(false);ctx.frame();assert(camera.zoom<17,'leaving zooms out');
ctx.userZoomUntil=Date.now()+20000;ctx.frame();assert.equal(camera.zoom,undefined,'manual zoom takes priority');
