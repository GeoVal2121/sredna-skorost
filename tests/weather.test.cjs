const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../weather.js');
assert.match(W.tileURL('precip',Date.parse('2026-11-17T23:45:00Z')),/2026111723/);
assert.match(W.tileURL('wind',Date.parse('2026-11-18T00:00:00Z')),/2026111800/);
assert.throws(()=>W.tileURL('../x',Date.now()));assert.throws(()=>W.tileURL('wind',NaN));
const old={id:'old',refs:[],features:[{properties:{start:0,end:100}}],unmapped:[]};
assert.equal(W.combine([old],99).features.length,1);
assert.equal(W.combine([old],100).features.length,0);
assert.equal(W.combine([old,{id:'cancel',refs:['old'],features:[],unmapped:[]}],50).features.length,0);
assert.equal(W.combine([old,old],50).features.length,1);
const regions=JSON.parse(fs.readFileSync(path.join(__dirname,'../weather-regions.geojson'),'utf8'));
assert.equal(regions.features.length,28);
// Independent city centres catch swapped region metadata/geometries.
const centres={BG001:[23.094,42.021],BG002:[27.462,42.504],BG003:[27.915,43.214],BG004:[25.629,43.076],BG005:[22.872,43.996],BG006:[23.552,43.210],BG007:[25.334,42.875],BG008:[27.827,43.572],BG009:[25.373,41.642],BG010:[22.691,42.284],BG011:[24.715,43.137],BG012:[23.225,43.408],BG013:[24.332,42.192],BG014:[23.033,42.605],BG015:[24.620,43.417],BG016:[24.750,42.142],BG017:[26.521,43.526],BG018:[25.954,43.848],BG019:[27.267,44.117],BG020:[26.323,42.681],BG021:[24.712,41.578],BG022:[23.322,42.697],BG023:[23.786,42.907],BG024:[25.634,42.425],BG025:[26.573,43.247],BG026:[25.556,41.934],BG027:[26.936,43.271],BG028:[26.510,42.484]};
function ring(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
for(const f of regions.features){const g=f.geometry,ps=g.type==='Polygon'?[g.coordinates]:g.coordinates;assert(ps.some(r=>ring(centres[f.properties.code],r[0])&&!r.slice(1).some(h=>ring(centres[f.properties.code],h))),f.properties.code+' city outside region');}
(async()=>{
 const handler=(await import('../netlify/functions/weather-warnings.mjs')).default,original=global.fetch;
 try{
  let calls=0;global.fetch=async()=>{calls++;return new Response('<feed/>',{headers:{'content-type':'application/atom+xml'}})};
  assert.equal((await handler(new Request('http://local/?id=../../private'))).status,400);
  assert.equal((await handler(new Request('http://local/?url=https://evil.example'))).status,400);
  assert.equal((await handler(new Request('http://local/',{method:'POST'}))).status,405);assert.equal(calls,0);
  const ok=await handler(new Request('http://local/'));assert.equal(ok.status,200);assert.equal(await ok.text(),'<feed/>');
  global.fetch=async()=>new Response('not xml',{headers:{'content-type':'text/html'}});
  assert.equal((await handler(new Request('http://local/'))).status,502);
  global.fetch=async()=>{throw Error('offline')};assert.equal((await handler(new Request('http://local/'))).status,502);
 }finally{global.fetch=original;}
 console.log('PASS weather: UTC rollover, expiry/cancellation, all 28 region centres, bounded proxy and upstream failure');
})().catch(e=>{console.error(e);process.exitCode=1});

// Different CAP identifiers must not duplicate an identical area warning label.
const warning={id:'a',area:'Stara Zagora',title:'Wind',level:2,start:0,end:100};
assert.equal(W.warningKey(warning),W.warningKey({...warning,id:'b'}));
for(const change of [{area:'Plovdiv'},{title:'Fog'},{level:3},{start:10},{end:200},{description:'Different hazard detail'},{instruction:'Different instruction'}])assert.notEqual(W.warningKey(warning),W.warningKey({...warning,...change}));

assert.equal(W.warningZoneKey(warning),W.warningZoneKey({...warning,id:'b',description:'Other details'}));
assert.notEqual(W.warningZoneKey(warning),W.warningZoneKey({...warning,area:'Plovdiv'}));

assert.equal(W.warningDisplayKey(warning),W.warningDisplayKey({...warning,area:'Ruse',id:'b'}));
for(const change of [{title:'Fog'},{level:3},{start:10},{end:200}])assert.notEqual(W.warningDisplayKey(warning),W.warningDisplayKey({...warning,...change}));
