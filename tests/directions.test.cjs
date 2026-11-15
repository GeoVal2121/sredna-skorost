const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../core.js'),D=require('../data.js'),G=require('../geometry.js'),DG=require('../direction-geometry.js');
const source=fs.readFileSync('map.js','utf8'),model=C.buildModel(D,{});
const ctx={App:{model:()=>model},SSCore:C,SS_GEO:G,SS_DIRECTION_GEO:DG,geoCache:{}};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('  function sectionsGeo'),source.indexOf('  function camsGeo')),ctx);
const features=ctx.sectionsGeo('24r').features;
assert.equal(features.length,model.sections.length);assert.equal(features.length,86);
assert.equal(features.filter(f=>f.properties.act).length,1);
for(const s of model.sections){const f=features.find(f=>f.properties.id===s.id);assert.equal(f.properties.up,+s.upcoming);assert.equal(f.properties.limit,s.limit);assert.equal(f.properties.L,s.L);}
assert.equal(features.find(f=>f.properties.id==='24f').properties.up,1);
assert.equal(features.find(f=>f.properties.id==='24r').properties.up,0);
assert.equal(Object.keys(DG).length,52);
for(let i=0;i<26;i++){
 const f=C.decodePolyline(DG[i+'f']),r=C.decodePolyline(DG[i+'r']);assert.notDeepEqual(f,r.slice().reverse());
 const row=D.sections[i],a=D.points[row[0]+':'+row[1]],b=D.points[row[0]+':'+row[3]];
 for(const [line,start,end] of [[f,a,b],[r,b,a]]){assert(C.dist(line[0],start)<41);assert(C.dist(line.at(-1),end)<41);}
}
for(let i=26;i<43;i++) assert.deepEqual(features.find(f=>f.properties.id===i+'f').geometry.coordinates,features.find(f=>f.properties.id===i+'r').geometry.coordinates.slice().reverse());
assert.equal(ctx.sectionsGeo(null).features.filter(f=>f.properties.act).length,0);
console.log('PASS 86 directions, 52 distinct carriageways, endpoints, statuses, active direction and shared-road reversal');
