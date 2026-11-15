const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const path = require('node:path'), core = require('../core.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
let now = 0, features = [];
const map = { project: () => ({x:0,y:0}), queryRenderedFeatures: () => features,
  getSource: () => ({setData(){}}) };
class Marker { setLngLat(p){this.p=p;return this} addTo(){return this} setRotation(h){this.h=h;return this} }
const ctx = { SSCore: core, SSApp: { isDark:()=>false, tracker:()=>({speed:36,active:null}) },
  maplibregl:{Marker}, document:{getElementById:()=>({classList:{toggle(){}}})},
  performance:{now:()=>now}, requestAnimationFrame:()=>1, clearTimeout(){}, Date };
ctx.window=ctx; vm.createContext(ctx);
vm.runInContext(read('map.js').replace('  init();', `
  map = testMap; ready = true; carEl = {style:{}};
  window.qa = {onFix, updateHeading, animPos, roadSnap, forwardPath, along,
    state:()=>({heading,hasHeading,anim,track}),
    reset:()=>{heading=0;hasHeading=false;headingAnchor=null;lastP=null;anim.to=null;track=[];prevSnap=null;},
    route:(line)=>{routeLine=line;routeHead=null;routeFrom=0;}};`), Object.assign(ctx,{testMap:map}));
const q=ctx.qa, base=[42,23];
const east=m=>[42,23+m/(111320*Math.cos(42*Math.PI/180))];
const fix=(m,extra={})=>({lat:east(m)[0],lon:east(m)[1],t:Date.now()+m*1000,acc:3,speed:1,heading:null,...extra});
const near=(a,b)=>assert(Math.abs(a-b)<0.1,`${a} != ${b}`);
q.updateHeading(fix(0));for(let m=2;m<=10;m+=2)q.updateHeading(fix(m));
near(q.state().heading,90); assert(q.state().hasHeading,'small movements accumulate');
q.updateHeading(fix(12,{heading:270,speed:0})); near(q.state().heading,90);
q.updateHeading(fix(14,{heading:270,speed:10,acc:80}));near(q.state().heading,90);
q.updateHeading(fix(16,{heading:270,speed:10}));near(q.state().heading,270);
function road(line){return {sourceLayer:'transportation',properties:{class:'primary'},geometry:{type:'LineString',coordinates:line.map(p=>[p[1],p[0]])}}}
features=[road([east(-100),east(100)])];q.reset();
q.onFix({...fix(0,{heading:95,speed:10}),lat:42+5/111320},null);
near(q.state().heading,90);assert(core.dist(q.state().anim.to,base)<0.1,'arrow snaps to road, not only trail');
q.reset();q.onFix(fix(0,{heading:270,speed:10}),null);near(q.state().heading,270);
assert(q.state().anim.path[1][1]<23,'reverse travel follows reverse geometry');
assert.equal(q.roadSnap(base,0),null,'perpendicular road rejected');
q.reset();q.onFix(fix(0,{heading:90,speed:10,acc:80}),null);
assert.equal(q.state().anim.v,0);assert.equal(q.state().anim.path,null);
features=[];q.route([east(-100),east(100)]);q.reset();
q.onFix(fix(0,{heading:270,speed:10}),base);
assert.equal(q.state().anim.path,null,'opposite route cannot force travel direction');
q.reset();q.onFix(fix(0,{heading:90,speed:10}),base);
assert(q.state().anim.path,'confirmed route follows its geometry');
const early=q.animPos(2000),late=q.animPos(60000);
assert(core.dist(early.p,late.p)<0.01,'no fabricated 60-second tunnel motion');
near(core.dist(base,late.p),15);
q.reset();q.onFix(fix(0,{heading:90,speed:10}),null);
assert.equal(q.state().anim.path,null,'stale route ignored when off route');
const corner=[base,east(5),[42+30/111320,east(5)[1]]];
near(q.along(corner,10).h,0);near(q.along([base,base,east(10)],0).h,90);
// Exercise the shared GPS ingress: rejected fixes must reach none of its consumers.
const app=read('app.js'), gps={}, feeds=[];
const ingress={lastFix:null,lastRecv:0,demoTimer:null,tracker:{last:null,feed:f=>{feeds.push(f);return[]},speed:0},
  $:()=>gps,SSCore:core,r0:Math.round,Date,cfg:{cams:false},onEvent(){},render(){},roadLimit(){},window:{}};
vm.createContext(ingress);vm.runInContext(app.slice(app.indexOf('  function onFix(fix)'),app.indexOf('  function start()')),ingress);
for(const bad of [{acc:200},{acc:NaN},{lat:NaN},{lon:181},{t:Date.now()-10000}]) ingress.onFix({...fix(0),...bad});
assert.equal(feeds.length,0);ingress.onFix(fix(0));assert.equal(feeds.length,1);
ingress.tracker.last={p:base,t:Date.now()};ingress.lastFix=fix(0);
ingress.onFix(fix(0,{t:ingress.tracker.last.t}));assert.equal(feeds.length,1);
ingress.onFix(fix(5000,{t:ingress.tracker.last.t+1000}));assert.equal(feeds.length,1);
// Preview routes and weak fixes must not supply navigation snapping.
const nav = read('nav.js'), nc = {route:{},active:false,Number};
vm.createContext(nc);vm.runInContext(nav.slice(nav.indexOf('  function onFix(fix)'),nav.indexOf('  function icon(n)')),nc);
assert.equal(nc.onFix(fix(0)),null);nc.active=true;
assert.equal(nc.onFix(fix(0,{acc:80})),null);
// Accelerated demo timestamps cannot poison the next real GPS session.
let resets=0;
const dc={demoTimer:1,clearInterval(){},tracker:{reset(){resets++}},lastFix:fix(0),window:{},render(){},Date,
  $:()=>({classList:{remove(){}}})};
vm.createContext(dc);vm.runInContext(app.slice(app.indexOf('  function stopDemo()'),app.indexOf('  // ---------- връзки')),dc);
dc.stopDemo();assert.equal(resets,1);assert.equal(dc.lastFix,null);assert.equal(dc.demoTimer,null);
console.log('PASS GPS: accumulated course, stopped/poor accuracy, road alignment both directions, intersections, route mismatch, bounded prediction, invalid/stale/jumping fixes');
