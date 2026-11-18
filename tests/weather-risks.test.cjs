const {test}=require('node:test'),assert=require('node:assert/strict');
const locations=require('../netlify/functions/weather-risk-points.json');
test('local hazard endpoint: fixed interior samples, bounded input, same-model fields, cache, missing and malformed data',async()=>{
 const municipalities=require('node:fs').readFileSync('weather-municipalities.geojson','utf8'),{contains}=require('../weather-zones.js');
 for(const f of JSON.parse(municipalities).features){const p=locations.find(p=>p.id===f.properties.id);assert.equal(p.points.length,3);p.points.forEach(point=>assert(contains(f.geometry,point)));}
 const handler=(await import('../netlify/functions/weather-risks.mjs')).default,original=global.fetch,id=locations.find(p=>p.name==='Kostenets').id;
 const url='https://local/.netlify/functions/weather-risks?ids='+id;
 assert.equal((await handler(new Request(url+'&latitude=42'))).status,400);assert.equal((await handler(new Request(url+','+id))).status,400);assert.equal((await handler(new Request(url,{method:'POST'}))).status,405);
 let calls=0,bad=true;
 global.fetch=async u=>{
  calls++;assert.equal(u.hostname,'api.open-meteo.com');assert.equal(u.searchParams.get('models'),'icon_eu,gfs_global');assert.equal(u.searchParams.get('latitude').split(',').length,3);assert.equal(u.searchParams.get('past_hours'),'3');
  const e=require('../audit/weather-zone-fixture.cjs').risks('?ids='+id).municipalities[0];
  return Response.json(e.points.map(p=>{const hourly={time:e.times},hourly_units={};for(const [model,fields]of Object.entries(p.models))for(const [field,a]of Object.entries(fields)){const k=field+'_'+model;hourly[k]=a;hourly_units[k]={weather_code:'wmo code',visibility:bad?'km':'m',relative_humidity_2m:'%',temperature_2m:'°C',precipitation:'mm'}[field];}return {hourly,hourly_units};}));
 };
 try{
  assert.equal((await handler(new Request(url))).status,502,'wrong units must not be interpreted as metres');bad=false;
  const responses=await Promise.all([handler(new Request(url)),handler(new Request(url))]);assert.equal(responses[0].status,200);assert.equal(calls,2,'same request in flight is shared');
  const d=await responses[0].json();assert.equal(d.municipalities[0].points.length,3);assert.equal(d.municipalities[0].points[0].models.icon_eu.visibility[3],800);await handler(new Request(url));assert.equal(calls,2);
  global.fetch=async()=>new Response('Unavailable',{status:429});assert.equal((await handler(new Request('https://local/.netlify/functions/weather-risks?ids='+locations[0].id))).status,502);
 }finally{global.fetch=original;}
});
