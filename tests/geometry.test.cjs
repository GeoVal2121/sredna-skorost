const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../core.js"), D = require("../data.js"), G = require("../geometry.js");
const recovered = require("./fixtures/restored-geometries.json");
assert.equal(Object.keys(recovered).length,9);
for (const [i, row] of D.sections.entries()) {
  const line=C.decodePolyline(G[i]);
  assert(line.length>=2 && line.every(p=>p.every(Number.isFinite)),`invalid geometry ${i}`);
  const ends=[D.points[row[0]+":"+row[1]],D.points[row[0]+":"+row[3]]];
  assert(C.dist(line[0],ends[0])<20 && C.dist(line.at(-1),ends[1])<20,`disconnected endpoints ${i}`);
  if(recovered[i] || i===8) {
    if(recovered[i]) assert.equal(G[i],recovered[i],`recovery mismatch ${i}`);
    const length=line.slice(1).reduce((s,p,j)=>s+C.dist(line[j],p),0);
    assert(Math.abs(length-Math.abs(row[4]-row[2])*1000)<30,`wrong length ${i}`);
  }
}
assert.deepEqual(D.points["T:Памукчии"],[42.32938,25.62941]);
assert(!D.exact.includes("T:Памукчии"),"chainage-derived endpoint must stay approximate");
assert.equal(D.sections[8][2],172.447);
assert.equal(D.sections[8][4],205.326);
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const asset=m[1].split("?")[0];
  if(!/^(https?:|#|data:)/.test(asset)) assert(fs.existsSync(path.join(__dirname,"..",asset)),`missing asset ${asset}`);
}
assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,"../version.json"),"utf8")).v,"2026.11.14-4");
console.log("PASS: 10 corrected geometries; 43 endpoint pairs; approximate endpoint status; local HTML assets; version");
