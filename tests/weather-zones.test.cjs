const assert=require('node:assert/strict');
const {test}=require('node:test');
const {sample}=require('../weather-zones.js');
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
    return Response.json(Array.from({length:96},()=>({hourly:{time,temperature_2m:time.map(()=>bad?'wrong':2),cloud_cover:time.map(()=>80),precipitation:time.map(()=>.6),snowfall:time.map(()=>0)}})));
  };
  try{
    assert.equal((await handler(req)).status,502);bad=false;
    const r=await handler(req);assert.equal(r.status,200);const d=await r.json();assert.equal(d.cells.length,288);assert.equal(d.times.length,60);
    const n=calls;await handler(req);assert.equal(calls,n,'warm cache avoids repeated multi-location requests');
  }finally{global.fetch=original;}
});

