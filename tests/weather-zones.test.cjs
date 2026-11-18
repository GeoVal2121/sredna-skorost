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
    calls++;assert.equal(url.hostname,'api.open-meteo.com');assert.equal(url.searchParams.get('models'),'icon_eu');assert.equal(url.searchParams.get('latitude').split(',').length,48);
    const time=Array.from({length:63},(_,i)=>Math.floor(Date.now()/3600000)*3600+(i-3)*3600);
    return Response.json(Array.from({length:48},()=>({hourly:{time,temperature_2m:time.map(()=>bad?'wrong':2),cloud_cover:time.map(()=>80),precipitation:time.map(()=>.6),snowfall:time.map(()=>0),wind_speed_10m:time.map(()=>25),wind_direction_10m:time.map(()=>225),weather_code:time.map(()=>61),visibility:time.map(()=>20000),relative_humidity_2m:time.map(()=>90)}})));
  };
  try{
    assert.equal((await handler(req)).status,502);bad=false;
    const r=await handler(req);assert.equal(r.status,200);const d=await r.json();assert.equal(d.cells.length,288);assert.equal(d.times.length,63);assert.equal(d.windComponents,'towards-east-north-kmh');assert(Math.abs(windAt(d,0,24,42).speed-25)<.008);assert(Math.abs(windAt(d,0,24,42).towards-45)<1e-8);
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
 const d={model:'icon_eu',grid:{west:22,south:41,cols:2,rows:2,step:1},cells:Array.from({length:4},()=>[[-8],[100],[0],[0],[0],[0],[45],[800],[98]])};
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

test('municipal risks preserve actual boundaries and require a local forecast signal',()=>{
 const {riskZones,contains}=require('../weather-zones.js');
 const municipalities=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../weather-municipalities.geojson'),'utf8'));
 assert.equal(municipalities.features.length,265);
 const kostenets=municipalities.features.find(f=>f.properties.name==='Kostenets');assert(kostenets);assert(contains(kostenets.geometry,[23.85,42.30]));
 const fixture=require('../audit/weather-zone-fixture.cjs'),d=fixture(),evidence=fixture.risks('?ids='+kostenets.properties.id).municipalities[0];
 d.cells.forEach(c=>c[6]=d.times.map(()=>0));const local={[kostenets.properties.id]:evidence};
 assert.equal(riskZones(d,0,municipalities).features.length,0,'cold temperature is not ice');
 d.cells[kostenets.properties.cells[0]][6][0]=45;d.cells[kostenets.properties.cells[0]][6][1]=66;
 evidence.points.forEach(p=>Object.values(p.models).forEach(m=>{m.weather_code[4]=66;}));
 for(const [h,kind] of [[0,'fog'],[1,'ice']]){
  const fc=riskZones(d,h,municipalities,local),f=fc.features.find(f=>f.properties.municipality==='Kostenets');assert.equal(f.properties.kind,kind);assert.deepEqual(f.geometry,kostenets.geometry);assert.equal(fc.features.length,1,'neighbouring municipalities need their own local evidence');
  fc.features.forEach(f=>{const source=municipalities.features.find(m=>m.properties.name===f.properties.municipality);assert(source.properties.cells.includes(kostenets.properties.cells[0]));assert.deepEqual(f.geometry,source.geometry);});
 }
 assert.equal(riskZones(d,0,null).features.length,0,'missing boundaries never fall back to grid tiles');
 assert.equal(riskZones({...d,grid:{...d.grid,step:.5}},0,municipalities).features.length,0,'mapping must match forecast grid');
 d.cells[kostenets.properties.cells[0]][6][0]=48;evidence.points.forEach(p=>Object.values(p.models).forEach(m=>{m.weather_code[3]=48;m.temperature_2m[3]=-2;}));assert.deepEqual(riskZones(d,0,municipalities,local).features.map(f=>f.properties.kind),['fog','ice']);
 assert.equal(riskZones(d,0,municipalities).features.length,0,'coarse signal alone never paints a municipality');
 for(const p of evidence.points)for(const m of Object.values(p.models)){m.weather_code[3]=45;m.visibility[3]=11900;}
 assert.equal(riskZones(d,0,municipalities,local).features.length,0,'audit case: fog code with 11.9 km visibility is not fog evidence');
 for(const p of evidence.points)p.models.icon_eu.visibility[3]=840;
 let f=riskZones(d,0,municipalities,local).features[0];assert(f.properties.disagreement);assert.equal(f.properties.visibility,840);
 evidence.points[1].models.icon_eu.visibility[3]=null;evidence.points[2].models.icon_eu.visibility[3]=20000;
 assert.equal(riskZones(d,0,municipalities,local).features.length,0,'one point cannot activate a whole municipality');
 evidence.points[1].models.gfs_global.visibility[3]=840;
 assert.equal(riskZones(d,0,municipalities,local).features.length,0,'do not pool one positive point from each model');
 evidence.points[1].models.icon_eu.visibility[3]=840;evidence.generated=Date.now()-7200001;
 assert.equal(riskZones(d,0,municipalities,local).features.length,0,'stale local evidence never paints a hazard');
 municipalities.features.forEach(f=>{assert(f.properties.cells.length);f.properties.cells.forEach(i=>assert(Number.isInteger(i)&&i>=0&&i<288));});
});

test('fog and ice risk keep unknowns and cold/dry separate from supported signals',()=>{
 const {fogSignal,hazardSignal}=require('../weather-zones.js');
 assert.equal(fogSignal(45,1000,99),false);assert.equal(fogSignal(45,999,99),true);assert.equal(fogSignal(45,null,99),null);assert.equal(fogSignal(61,400,99),false);assert.equal(fogSignal(45,400,60),false);
 const m={weather_code:[0,0,0,0],visibility:[20000,20000,20000,20000],relative_humidity_2m:[80,80,80,80],temperature_2m:[2,2,1,-2],precipitation:[0,0,0,0]};
 assert.equal(hazardSignal(m,3,'ice'),false);m.precipitation[1]=.5;assert.equal(hazardSignal(m,3,'ice'),'refreezing');m.temperature_2m[3]=null;assert.equal(hazardSignal(m,3,'ice'),null);
 m.weather_code[3]=48;m.temperature_2m[3]=4;assert.equal(hazardSignal(m,3,'ice'),false);
});
