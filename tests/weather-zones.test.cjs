const assert=require('node:assert/strict');
const {test}=require('node:test');
const {sample,windAt}=require('../weather-zones.js');
const {areaPoint}=require('../weather.js');
test('weather zones interpolate geographic fields and preserve unknown values',()=>{
  assert.deepEqual(areaPoint({type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}),[1,1]);
  const d={grid:{west:22,south:41,cols:2,rows:2,step:1},cells:[0,2,4,6].map(n=>[[n],[n*10],[n/10],[0]])};
  sample(d,0,22.5,41.5).forEach((n,i)=>assert(Math.abs(n-[3,30,.3,0][i])<1e-10));
  assert.equal(sample(d,0,21,41),null);
  d.cells[0][0][0]=null;assert.equal(sample(d,0,22.5,41.5)[0],null);
});
test('fixed forecast endpoint validates upstream, hours and caches complete grid',async()=>{
  const handler=(await import('../netlify/functions/weather-zones.mjs')).default,original=global.fetch;
  const req=new Request('https://local/.netlify/functions/weather-zones');
  assert.equal((await handler(new Request(req.url+'?url=https://evil'))).status,400);
  assert.equal((await handler(new Request(req.url,{method:'POST'}))).status,405);
  let calls=0,bad=true;
  global.fetch=async url=>{
    calls++;assert.equal(url.hostname,'api.open-meteo.com');assert.equal(url.searchParams.get('latitude').split(',').length,96);
    const time=Array.from({length:60},(_,i)=>Math.floor(Date.now()/3600000)*3600+i*3600);
    return Response.json(Array.from({length:96},()=>({hourly:{time,temperature_2m:time.map(()=>bad?'wrong':2),cloud_cover:time.map(()=>80),precipitation:time.map(()=>.6),snowfall:time.map(()=>0),wind_speed_10m:time.map(()=>25),wind_direction_10m:time.map(()=>225),weather_code:time.map(()=>61)}})));
  };
  try{
    assert.equal((await handler(req)).status,502);bad=false;
    const r=await handler(req);assert.equal(r.status,200);const d=await r.json();assert.equal(d.cells.length,288);assert.equal(d.times.length,60);assert.equal(d.windComponents,'towards-east-north-kmh');assert(Math.abs(windAt(d,0,24,42).speed-25)<.008);assert(Math.abs(windAt(d,0,24,42).towards-45)<1e-8);
    const n=calls;await handler(req);assert.equal(calls,n,'warm cache avoids repeated multi-location requests');
  }finally{global.fetch=original;}
});


test('wind wraps north correctly, calm has zero speed and null remains unknown',()=>{
 const d={windComponents:'towards-east-north-kmh',grid:{west:22,south:41,cols:2,rows:2,step:1},cells:[359,1,359,1].map(deg=>[[0],[0],[0],[0],[-20*Math.sin(deg*Math.PI/180)],[-20*Math.cos(deg*Math.PI/180)]])};
 assert(Math.abs(windAt(d,0,22.5,41.5).towards-180)<1e-8);
 assert.equal(windAt(d,0,20,40),null);
 d.cells[0][4][0]=null;assert.equal(windAt(d,0,22.5,41.5),null);
 d.cells.forEach(c=>{c[4][0]=0;c[5][0]=0;});assert.equal(windAt(d,0,22.5,41.5).speed,0);
});

test('thermometer and regional phenomena preserve model categories',()=>{
 const {thermometer,conditions}=require('../weather-zones.js');
 assert.equal(thermometer(null),null);assert(thermometer(-8).level<thermometer(8).level);assert(thermometer(8).level<thermometer(30).level);
 const d={grid:{west:22,south:41,cols:2,rows:2,step:1},cells:Array.from({length:4},()=>[[-8],[100],[0],[0],[0],[0],[45]])};
 assert.deepEqual(conditions(d,0,22.5,41.5).map(c=>c.kind),['fog']);
 d.cells.forEach(c=>c[6][0]=66);assert.deepEqual(conditions(d,0,22.5,41.5).map(c=>c.kind),['ice']);
 d.cells.forEach(c=>c[6][0]=73);assert.deepEqual(conditions(d,0,22.5,41.5).map(c=>c.kind),['snow']);
 assert.deepEqual(conditions(d,0,10,10),[]);
});

test('regional fallback respects polygon holes and unknown condition',()=>{
 const {contains,condition}=require('../weather-zones.js');
 const ring=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]];
 assert(contains({type:'Polygon',coordinates:[ring,hole]},[.5,.5]));
 assert(!contains({type:'Polygon',coordinates:[ring,hole]},[2,2]));
 assert(!contains({type:'MultiPolygon',coordinates:[[ring]]},[5,5]));
 const d={grid:{west:22,south:41,cols:2,rows:2,step:1},cells:Array.from({length:4},()=>[[null],[null],[null],[null],[null],[null],[null]])};
 assert.equal(condition(d,0,[22.5,41.5]).text,'Няма данни за облачността');
});

test('allocation-free interpolation matches the original numeric formula and reuses output',()=>{
 const d={grid:{west:22,south:41,cols:2,rows:2,step:1},cells:[[-8,70,.1],[12,100,3],[5,60,.6],[-2,90,2]].map(c=>c.map(n=>[n]))};
 const out=[];
 for(let y=0;y<=10;y++)for(let x=0;x<=10;x++){
  const dx=x/10,dy=y/10,w=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy];
  assert.equal(sample(d,0,22+dx,41+dy,[0,1,2],out),out);
  out.forEach((n,f)=>assert(Math.abs(n-d.cells.reduce((v,c,i)=>v+c[f][0]*w[i],0))<1e-10));
 }
 d.cells[0][1][0]=null;assert.equal(sample(d,0,22.5,41.5,[0,1,2],out)[1],null);
});
