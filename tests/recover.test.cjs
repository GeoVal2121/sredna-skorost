// Пропусната начална рамка: отсечката се включва по позицията, средната е близо до истинската.
const assert = require("assert");
const D = require("../data.js"), C = require("../core.js"), DG = require("../direction-geometry.js"), G = require("../geometry.js");
const m = C.buildModel(D, {});
function lineOf(s) {
  const dir = DG[s.id], enc = dir || G[parseInt(s.id, 10)];
  let L = C.decodePolyline(enc); if (!dir && /r$/.test(s.id)) L = L.slice().reverse(); return L;
}
function drive(ids, v, gap) { // gap: [от, до] секунди без GPS
  const tr = new C.Tracker(m, { margin: 3 }), evs = [];
  let path = []; ids.forEach(id => { path = path.concat(lineOf(m.sections.find(s => s.id === id))); });
  const pts = []; let carry = 0;
  for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], d = C.dist(a, b); let s = carry; while (s < d) { pts.push([a[0] + (b[0] - a[0]) * s / d, a[1] + (b[1] - a[1]) * s / d]); s += v; } carry = s - d; }
  let t = 0;
  pts.forEach((p, i) => {
    t += 1000; if (gap && i >= gap[0] && i < gap[1]) return;
    const prev = tr.last, fix = { lat: p[0], lon: p[1], t, speed: v, acc: 5 };
    tr.feed(fix).forEach(e => evs.push(e));
    if (!tr.active) { const s = tr.recover(p, t, prev, lineOf); if (s) evs.push({ type: "recover", sec: s, approx: tr.active.approx }); }
  });
  return evs;
}
// без прекъсване: обичайният път, без възстановяване
let e = drive(["9f", "10f"], 40);
assert.ok(!e.some(x => x.type === "recover"));
assert.ok(e.some(x => x.type === "finish" && x.sec.id === "9f" && Math.abs(x.avg - 144) < 2));
// GPS спрял 2 минути около рамката Полско Пъдарево: отсечката 10f се включва приблизително
const n9 = Math.round(m.sections.find(s => s.id === "9f").L * 1000 / 40);
e = drive(["9f", "10f"], 40, [n9 - 60, n9 + 60]);
const r = e.find(x => x.type === "recover");
assert.ok(r && r.sec.id === "10f" && r.approx === true, "10f трябва да се включи приблизително");
// след презареждане по средата на отсечката (без предишна позиция извън нея)
const tr = new C.Tracker(m, {}), L = lineOf(m.sections.find(s => s.id === "10f"));
const at = s => { let acc = 0; for (let i = 1; i < L.length; i++) { const d = C.dist(L[i - 1], L[i]); if (acc + d >= s) { const f = (s - acc) / d; return [L[i - 1][0] + (L[i][0] - L[i - 1][0]) * f, L[i - 1][1] + (L[i][1] - L[i - 1][1]) * f]; } acc += d; } };
tr.feed({ lat: at(5000)[0], lon: at(5000)[1], t: 100000, speed: 40, acc: 5 });
const prev = tr.last; tr.feed({ lat: at(5040)[0], lon: at(5040)[1], t: 101000, speed: 40, acc: 5 });
const got = tr.recover(at(5040), 101000, prev, lineOf);
assert.ok(got && got.id === "10f" && tr.active.approx);
assert.ok(Math.abs((101000 - tr.active.t0) / 1000 - 5040 / 40) < 2, "t0 по скоростта");
// обратната посока не се включва
const tr2 = new C.Tracker(m, {});
tr2.feed({ lat: at(5040)[0], lon: at(5040)[1], t: 100000, speed: 40, acc: 5 });
const prev2 = tr2.last; tr2.feed({ lat: at(5000)[0], lon: at(5000)[1], t: 101000, speed: 40, acc: 5 });
const g2 = tr2.recover(at(5000), 101000, prev2, lineOf);
assert.ok(!g2 || g2.id !== "10f");
console.log("recover.test PASS");
