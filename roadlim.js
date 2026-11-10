// Ограничение на скоростта на пътя, по който се движите.
// Данни: lim/*.json – ограниченията от OpenStreetMap за България, свалени предварително (плочки 0,5°).
// Без данни: магистрала 140; малка улица в населено място (по картата) 50; иначе без знак.
(function (root) {
  function dist(a, b) {
    var k = Math.cos((a[0] + b[0]) * Math.PI / 360), dy = (b[0] - a[0]) * 111320, dx = (b[1] - a[1]) * 111320 * k;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function brg(a, b) {
    return (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
  }
  function segDist(p, a, b) {
    var k = Math.cos(p[0] * Math.PI / 180), ax = a[1] * k, ay = a[0], dx = b[1] * k - ax, dy = b[0] - ay, l = dx * dx + dy * dy;
    var t = l ? Math.max(0, Math.min(1, ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / l)) : 0;
    return dist(p, [ay + t * dy, (ax + t * dx) / k]);
  }
  function decode(s) {
    var i = 0, la = 0, lo = 0, out = [];
    function nx() { var r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; }
    while (i < s.length) { la += nx(); lo += nx(); out.push([la / 1e5, lo / 1e5]); }
    return out;
  }
  // запис [напред, назад, флагове (1 еднопосочен, 2 магистрала), полилиния] → път
  function way(r) { return { f: r[0] || (r[2] & 2 ? 140 : 0), b: r[1] || (r[2] & 2 ? 140 : 0), one: !!(r[2] & 1), g: decode(r[3]) }; }

  // най-близкият път до 25 м; посоката на движение избира между близки пътища и посоката на пътя
  function match(ways, p, heading) {
    var best = null, bs = Infinity;
    ways.forEach(function (w) {
      for (var i = 1; i < w.g.length; i++) {
        var d = segDist(p, w.g[i - 1], w.g[i]);
        if (d > 25) continue;
        var fwd = true, pen = 0;
        if (heading != null) {
          var diff = Math.abs(((brg(w.g[i - 1], w.g[i]) - heading) % 360 + 540) % 360 - 180);
          if (diff > 120) { fwd = false; if (w.one) continue; }
          else if (diff > 60) pen = 15;
        }
        if (d + pen < bs) { bs = d + pen; best = { w: w, fwd: fwd }; }
      }
    });
    if (!best) return null;
    return (best.fwd ? best.w.f : best.w.b) || null;
  }

  // плочката под позицията (и съседната, ако сте на по-малко от ~5 км от ръба) се зарежда при нужда и остава в паметта
  var BASE = "lim/", index = null, tiles = {}, shown = null, cand = null, candN = 0;
  function tileKey(la, lo) { return Math.floor(la * 2) + "_" + Math.floor(lo * 2); }
  function ensure(p) {
    if (index === null) {
      index = false;
      fetch(BASE + "index.json").then(function (r) { return r.json(); })
        .then(function (j) { index = {}; j.tiles.forEach(function (k) { index[k] = 1; }); })
        .catch(function () { index = null; });
      return;
    }
    if (!index) return;
    for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) {
      var k = tileKey(p[0] + di * 0.05, p[1] + dj * 0.07);
      if (!index[k] || tiles[k] !== undefined) continue;
      tiles[k] = null;
      (function (k) {
        fetch(BASE + k + ".json").then(function (r) { return r.json(); })
          .then(function (a) { tiles[k] = a.map(way); })
          .catch(function () { delete tiles[k]; });
      })(k);
    }
  }
  function waysAt(p) { return tiles[tileKey(p[0], p[1])] || []; }

  // roadAt(p) → { cls, urban } от картата (по желание)
  function feed(p, heading, kmh, roadAt) {
    ensure(p);
    var v = match(waysAt(p), p, kmh > 7 ? heading : null);
    if (!v && roadAt) {
      var r = roadAt(p);
      if (r && r.cls === "motorway") v = 140;
      else if (r && r.cls === "minor" && r.urban) v = 50;
    }
    v = v || null;
    if (v === shown) { candN = 0; return shown; }
    if (v === cand) candN++; else { cand = v; candN = 1; }
    if (candN >= 2) { shown = v; candN = 0; }
    return shown;
  }

  var api = { feed: feed, match: match, way: way, decode: decode };
  if (typeof module !== "undefined") module.exports = api; else root.SSRoadLim = api;
})(this);
