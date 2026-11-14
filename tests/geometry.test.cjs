const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../core.js"), D = require("../data.js"), G = require("../geometry.js");
const recovered = require("./fixtures/restored-geometries.json");
const reference = require("./fixtures/road-reference.json");
assert.equal(Object.keys(recovered).length,9);
assert.equal(D.sections.length,43);
assert.equal(reference.sections.length,43);
function corridor(i) {
  const sy=111195, sx=sy*Math.cos(D.points[D.sections[i][0]+":"+D.sections[i][1]][0]*Math.PI/180);
  const xy=p=>[p[1]*sx,p[0]*sy];
  const segments=reference.sections[i].ways.flatMap(w=>w.line.slice(1).map((p,j)=>[xy(w.line[j]),xy(p)]));
  assert(segments.length>0,`missing road reference ${i}`);
  return p=>{
    const [x,y]=xy(p);let best=Infinity;
    for(const [[a,b],[c,d]] of segments){
      const dx=c-a,dy=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy)||0));
      best=Math.min(best,Math.hypot(x-a-t*dx,y-b-t*dy));
    }
    return best;
  };
}
function maxOffset(line,nearest) {
  let max=0;
  for(let j=1;j<line.length;j++){
    const a=line[j-1],b=line[j],n=Math.max(1,Math.ceil(C.dist(a,b)/25));
    for(let k=0;k<=n;k++)max=Math.max(max,nearest(a.map((v,z)=>v+(b[z]-v)*k/n)));
  }
  return max;
}
for (const [i, row] of D.sections.entries()) {
  const line=C.decodePolyline(G[i]);
  assert(line.length>=2 && line.every(p=>p.every(Number.isFinite)),`invalid geometry ${i}`);
  const ends=[D.points[row[0]+":"+row[1]],D.points[row[0]+":"+row[3]]];
  assert(C.dist(line[0],ends[0])<20 && C.dist(line.at(-1),ends[1])<20,`disconnected endpoints ${i}`);
  const nearest=corridor(i);
  assert(maxOffset(line,nearest)<5,`geometry leaves road ${i}`);
  assert(ends.every(p=>nearest(p)<15),`endpoint off road ${i}`);

}
// These historical detours passed the old length-only test; the road check must reject them.
for(const i of [26,28,30,31,34,37,39,42]) assert(maxOffset(C.decodePolyline(recovered[i]),corridor(i))>20,`negative regression ${i}`);
for(const [key,g] of Object.entries(reference.gantries)) {
  assert(C.dist(D.points[key],g.p)<1,`wrong gantry ${key}`);
  assert(D.exact.includes(key),`missing mapped status ${key}`);
}
// BG TOLL's I-2 map places Struyno north-west of Shumen, not the reverse.
assert(D.points["I-2:Струйно"][0]>D.points["I-2:Шумен"][0]);
assert(D.points["I-2:Струйно"][1]<D.points["I-2:Шумен"][1]);
const official=require("./fixtures/official-endpoints.json");
assert.equal(Object.keys(official.points).length,32);
assert.equal(D.exact.length,69);
for(const [key,p] of Object.entries(official.points)) {
  assert.deepEqual(D.points[key],p.p,`wrong official coordinate ${key}`);
  assert(D.official.includes(key),`wrong source ${key}`);
  assert.equal(C.buildModel(D).points[key].src,"bgtoll");
}
const i8=C.decodePolyline(G[41]), length8=i8.slice(1).reduce((s,p,j)=>s+C.dist(i8[j],p),0);
assert(Math.abs(length8-11472)<30,"Ihtiman–Mirovo endpoint regression");
assert.equal(D.sections[8][2],172.447);
assert.equal(D.sections[8][4],205.326);
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const asset=m[1].split("?")[0];
  if(!/^(https?:|#|data:)/.test(asset)) assert(fs.existsSync(path.join(__dirname,"..",asset)),`missing asset ${asset}`);
}
assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,"../version.json"),"utf8")).v,"2026.11.14-7");
console.log("PASS: 43 road corridors; 86 endpoints; mapped gantries; 32 official endpoints; 8 negative regressions; assets; version");
