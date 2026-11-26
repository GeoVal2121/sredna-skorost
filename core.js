// Логика без UI: геометрия, модел на отсечките, проследяване на средната скорост.
(function (root) {
  "use strict";
  var R = 6371000;
  function rad(x) { return x * Math.PI / 180; }
  function dist(a, b) { // метри, a/b = [lat, lon]
    var dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Explicit published section length takes precedence over road chainage subtraction.
  function sectionLength(r) {
    if (r[8] == null) return Math.abs(r[4] - r[2]);
    if (!Number.isFinite(r[8]) || r[8] <= 0) throw new Error("Invalid section length");
    return r[8] / 1000;
  }

  // overrides: { "T:Чирпан": { p:[lat,lon], src:"osm"|"manual" } }
  function buildModel(data, overrides) {
    var points = {}, sections = [], k;
    var exact = {}; (data.exact || []).forEach(function (x) { exact[x] = 1; });
    for (k in data.points) points[k] = { key: k, p: data.points[k], src: (data.official || []).indexOf(k) >= 0 ? "bgtoll" : exact[k] ? "osm" : "approx" };
    applyOverrides(points, overrides);
    data.sections.forEach(function (r, i) {
      var road = r[0], a = road + ":" + r[1], b = road + ":" + r[3], L = sectionLength(r);
      points[a].km = r[2]; points[b].km = r[4];
      var base = { road: road, roadName: data.roads[road], L: L, limit: r[5] };
      if (r[6] !== "-") sections.push(Object.assign({ id: i + "f", from: r[1], to: r[3], fromKey: a, toKey: b, upcoming: r[6] === "u" }, base));
      if (r[7] !== "-") sections.push(Object.assign({ id: i + "r", from: r[3], to: r[1], fromKey: b, toKey: a, upcoming: r[7] === "u" }, base));
    });
    return { points: points, sections: sections };
  }

  // Sum certified coverage by road chainage; gaps and upcoming directions are excluded.
  function measureSections(model, keys) {
    var result = { sections: [], points: keys.length ? [keys[0]] : [], total: 0, gaps: 0, error: null };
    for (var i = 1; i < keys.length; i++) {
      var start = model.points[keys[i - 1]], end = model.points[keys[i]], road = keys[i - 1].split(":")[0];
      if (!start || !end || keys[i].split(":")[0] !== road || start.km === end.km) { result.error = result.sections.length ? "В момента измервате друго разстояние. Натиснете „Изчисти“ и изберете две сини точки в участъка, който искате да измерите." : "Между тези точки няма сертифицирана отсечка в избраната посока."; return result; }
      var sign = end.km > start.km ? 1 : -1;
      var legs = model.sections.filter(function (s) {
        var a = model.points[s.fromKey].km, b = model.points[s.toKey].km;
        return s.road === road && !s.upcoming && (b - a) * sign > 0 && (a - start.km) * sign >= 0 && (end.km - b) * sign >= 0;
      }).sort(function (a, b) { return (model.points[a.fromKey].km - model.points[b.fromKey].km) * sign; });
      if (!legs.length) { result.error = "Между тези точки няма сертифицирана отсечка в избраната посока."; return result; }
      var cursor = keys[i - 1];
      for (var j = 0; j < legs.length; j++) {
        var leg = legs[j];
        if (result.sections.some(function (s) { return parseInt(s.id, 10) === parseInt(leg.id, 10); })) { result.error = "В момента измервате друго разстояние. Натиснете „Изчисти“ и изберете две сини точки в участъка, който искате да измерите."; return result; }
        if (cursor !== leg.fromKey) { result.gaps++; result.points.push(leg.fromKey); }
        result.sections.push(leg); result.points.push(leg.toKey); result.total += leg.L; cursor = leg.toKey;
      }
      if (cursor !== keys[i]) { result.gaps++; result.points.push(keys[i]); }
    }
    return result;
  }

  function applyOverrides(points, overrides) {
    for (var k in overrides || {}) if (points[k]) { points[k].p = overrides[k].p; points[k].src = overrides[k].src; }
  }

  function Tracker(model, opts) {
    this.m = model;
    this.margin = (opts && opts.margin != null) ? opts.margin : 3;
    this.reset();
  }
  Tracker.prototype.reset = function () {
    this.last = null; this.odo = 0; this.speed = 0; this.speedValid = false; this.speedEstimated = false;
    this.near = {}; this.prevD = {}; this.cands = []; this.active = null; this.announced = {};
    this.lastOver = -1e12;
  };
  Tracker.prototype.radius = function (pt) { return pt.src === "approx" ? 2500 : 250; };

  // fix: { lat, lon, t (ms), speed (m/s или null), acc (m) }
  Tracker.prototype.feed = function (fix) {
    var ev = [], p = [fix.lat, fix.lon], self = this;
    if (fix.acc != null && fix.acc > 100) return ev; // твърде неточна позиция
    var v = Number.isFinite(fix.speed) && fix.speed >= 0 && fix.speed < 90 ? fix.speed : null;
    this.speedEstimated = false;
    if (this.last) {
      var dt = (fix.t - this.last.t) / 1000;
      if (dt <= 0) return ev;
      var dd = dist(this.last.p, p);
      if (dd / dt < 90) this.odo += dd; // отсейва скокове над ~320 км/ч
      // A position delta is an interval average, never a current speed after a long gap.
      if (v == null && dt >= 0.5 && dt <= 2.5 && fix.acc <= 20 && this.last.acc <= 20 && dd / dt < 90) {
        v = dd / dt; this.speedEstimated = true;
      }
    }
    this.speedValid = v != null;
    this.speed = (v || 0) * 3.6;
    this.last = { p: p, t: fix.t, acc: fix.acc };

    var pts = this.m.points, k;
    for (k in pts) {
      var pt = pts[k], d = dist(pt.p, p), r = this.radius(pt), n = this.near[k];
      // приближаване към начало на отсечка
      var prev = this.prevD[k];
      if (d < 8000) this.prevD[k] = d; else delete this.prevD[k];
      if (prev != null && d < prev && d < r + 1500 && !n && (!this.announced[k] || fix.t - this.announced[k] > 15 * 60000)) {
        var ahead = this.sectionAhead(k, p);
        if (ahead && !(this.active && this.active.sec.toKey === k)) {
          this.announced[k] = fix.t;
          ev.push({ type: "approach", sec: ahead, dist: d, approx: pt.src === "approx" });
        }
      }
      // преминаване през рамка: минимум на разстоянието в радиуса
      if (d < r) {
        if (!n) n = this.near[k] = { min: d, t: fix.t, odo: this.odo, p: p, passed: false };
        else if (d < n.min) { n.min = d; n.t = fix.t; n.odo = this.odo; n.p = p; }
        if (!n.passed && d > n.min + Math.max(80, r * 0.15)) { n.passed = true; this.pass(k, n, ev); }
      } else if (n) {
        if (!n.passed) this.pass(k, n, ev);
        delete this.near[k];
      }
    }

    // потвърждаване на посоката след навлизане
    if (this.cands.length) {
      var keep = [], best = null;
      this.cands.forEach(function (c) {
        var trav = self.odo - c.odo0, need = Math.min(1500, c.sec.L * 300);
        if (trav < need) { keep.push(c); return; }
        var prog = c.dEnd0 - dist(p, pts[c.sec.toKey].p);
        if (prog > 0.5 * trav && (!best || prog > best.prog)) { c.prog = prog; best = c; }
      });
      this.cands = keep;
      if (best && !this.active) {
        this.active = { sec: best.sec, t0: best.t0, odo0: best.odo0, minDEnd: Infinity };
        this.cands = [];
        ev.push({ type: "enter", sec: best.sec });
      }
    }

    if (this.active) {
      var a = this.active, s = a.sec, dEnd = dist(p, pts[s.toKey].p), travKm = (this.odo - a.odo0) / 1000;
      a.minDEnd = Math.min(a.minDEnd, dEnd);
      if (dEnd > a.minDEnd + 3000 || travKm > s.L * 1.3 + 3) {
        ev.push({ type: "abort", sec: s });
        this.active = null;
      } else {
        var st = this.activeState(fix.t);
        // предупреждение веднага при превишаване, после на всеки 60 сек.; съобщение при връщане под лимита
        var isOver = st.status === "over" && travKm > 0.5;
        if (isOver && (!a.over || fix.t - this.lastOver > 60000)) {
          this.lastOver = fix.t; a.over = true;
          ev.push({ type: "over", sec: s, avg: st.avg, rec: st.rec });
        } else if (!isOver && a.over && st.avg != null && st.avg <= s.limit) {
          a.over = false;
          ev.push({ type: "back", sec: s, avg: st.avg });
        }
      }
    }
    return ev;
  };

  Tracker.prototype.sectionAhead = function (key, p) {
    var pts = this.m.points, best = null;
    this.m.sections.forEach(function (s) {
      if (s.fromKey !== key) return;
      var end = pts[s.toKey].p;
      if (dist(p, end) > dist(pts[key].p, end)) best = s; // краят е зад рамката → тази посока
    });
    return best;
  };

  Tracker.prototype.pass = function (key, n, ev) {
    var a = this.active, pts = this.m.points, self = this;
    if (a && a.sec.toKey === key) {
      var hours = (n.t - a.t0) / 3600000, avg = hours > 0 ? a.sec.L / hours : 0;
      ev.push({ type: "finish", sec: a.sec, avg: avg, over: avg > a.sec.limit, minutes: hours * 60 });
      this.active = null;
    }
    this.m.sections.forEach(function (s) {
      if (s.fromKey !== key) return;
      if (self.cands.some(function (c) { return c.sec === s; })) return;
      self.cands.push({ sec: s, t0: n.t, odo0: n.odo, dEnd0: dist(n.p, pts[s.toKey].p) });
    });
  };

  Tracker.prototype.activeState = function (t) {
    var a = this.active; if (!a) return null;
    var s = a.sec, h = Math.max((t - a.t0) / 3600000, 0), trav = Math.max((this.odo - a.odo0) / 1000, 0);
    var remaining = Math.max(s.L - trav, 0), target = s.limit - this.margin;
    var avg = h > 10 / 3600 ? trav / h : null;
    var remT = s.L / target - h, rec;
    if (remaining < 0.05) rec = null;
    else if (remT <= 0) rec = s.limit;
    else rec = Math.min(s.limit, remaining / remT);
    var v = Math.max(this.speed, 1), predicted = s.L / (h + remaining / v);
    var status = avg == null ? "ok" : avg > s.limit ? "over" : avg > target ? "warn" : "ok";
    return { sec: s, elapsedMin: h * 60, trav: trav, remaining: remaining, avg: avg, rec: rec, predicted: predicted, status: status };
  };

  // Включване на отсечка без засечена начална рамка (пропусната рамка или презареждане).
  // t0 = времето при началната рамка; trav = изминато от рамката, км.
  Tracker.prototype.adopt = function (sec, t0, trav, approx) {
    this.cands = [];
    this.active = { sec: sec, t0: t0, odo0: this.odo - trav * 1000, minDEnd: Infinity, approx: !!approx };
  };

  // Ако позицията е по линията на отсечка, по нейната посока, но рамката не е засечена:
  // време на влизане по интерполация от предишната позиция (approx при пауза над 10 с) или по скоростта.
  Tracker.prototype.recover = function (p, now, prev, lineOf) {
    if (this.active || this.cands.length || !prev || now - prev.t > 15 * 60e3) return null;
    var self = this, pts = this.m.points, found = null;
    this.m.sections.forEach(function (s) {
      if (found) return;
      var a = pts[s.fromKey].p, b = pts[s.toKey].p;
      if (dist(p, a) + dist(p, b) > s.L * 1300 + 500) return;
      var L = lineOf(s), q = project(L, p);
      if (q.d > 60 || q.s < 200 || q.s > q.len - 200) return;
      var q0 = project(L, prev.p), s0;
      if (q0.d <= 60 && q0.s > 0) s0 = q0.s;
      else if (dist(prev.p, a) < 5000) s0 = -dist(prev.p, a);
      else return;
      if (q.s - s0 < 20) return;
      var t0, approx;
      if (s0 <= 0) { t0 = prev.t + (now - prev.t) * (-s0) / (q.s - s0); approx = now - prev.t > 10000; }
      else {
        var v = (q.s - s0) / Math.max((now - prev.t) / 1000, 0.5);
        if (!(v > 3 && v < 70)) return;
        t0 = prev.t - s0 / v * 1000; approx = true;
      }
      self.adopt(s, t0, q.s / 1000, approx);
      found = s;
    });
    return found;
  };

  // Проекция на точка върху линия [[lat,lon],...]: s = метри от началото по линията, d = отклонение, len = обща дължина.
  function project(line, p) {
    var best = { s: 0, d: Infinity, len: 0 }, acc = 0, k = Math.cos(rad(p[0])) * 111320;
    for (var i = 1; i < line.length; i++) {
      var a = line[i - 1], b = line[i], seg = dist(a, b);
      var ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * 110540, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * 110540;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var d = Math.sqrt(Math.pow(ax + t * dx, 2) + Math.pow(ay + t * dy, 2));
      if (d < best.d) { best.d = d; best.s = acc + t * seg; }
      acc += seg;
    }
    best.len = acc;
    return best;
  }

  // Най-близко начало на отсечка (за празния екран)
  Tracker.prototype.nearest = function () {
    if (!this.last) return null;
    var p = this.last.p, pts = this.m.points, best = null, bd = Infinity;
    this.m.sections.forEach(function (s) {
      var d = dist(p, pts[s.fromKey].p);
      if (d < bd) { bd = d; best = s; }
    });
    return best ? { sec: best, dist: bd } : null;
  };

  // ---------- стационарни камери: предупреждение само когато камерата е напред по посоката ----------
  function bearing(a, b) {
    var y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])),
      x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function CamWatch(cams) { this.cams = cams || []; this.said = {}; this.last = null; this.heading = null; }
  // fix: { p:[lat,lon], t (ms), speed (км/ч), heading (°|null) }
  CamWatch.prototype.feed = function (fix) {
    var ev = [], self = this, p = fix.p;
    if (fix.heading != null && !isNaN(fix.heading) && fix.speed > 5) this.heading = fix.heading;
    else if (this.last && dist(this.last, p) > 15) this.heading = bearing(this.last, p);
    if (!this.last || dist(this.last, p) > 15) this.last = p;
    if (this.heading == null) return ev;
    var far = fix.speed > 80 ? 800 : 450;
    this.cams.forEach(function (c, i) {
      var d = dist(p, [c[0], c[1]]); if (d > far) return;
      var diff = Math.abs(((bearing(p, [c[0], c[1]]) - self.heading + 540) % 360) - 180);
      if (diff > 40 && d > 40) return; // камерата не е пред нас
      var s = self.said[i] || (self.said[i] = { t: -1e12 });
      if (fix.t - s.t > 600000) { s.t = fix.t; s.over = false; ev.push({ type: "cam", cam: c, dist: d }); }
      if (c[2] && fix.speed > c[2] + 2 && d < 350 && !s.over) { s.over = true; ev.push({ type: "camOver", cam: c, dist: d, speed: fix.speed }); }
    });
    return ev;
  };

  function decodePolyline(s) { // Google polyline, 5 знака → [[lat, lon]]
    var i = 0, la = 0, lo = 0, out = [];
    while (i < s.length) {
      for (var k = 0; k < 2; k++) {
        var r = 0, sh = 0, c;
        do { c = s.charCodeAt(i++) - 63; r |= (c & 31) << sh; sh += 5; } while (c >= 32);
        var d = (r & 1) ? ~(r >> 1) : (r >> 1);
        if (k) lo += d; else la += d;
      }
      out.push([la / 1e5, lo / 1e5]);
    }
    return out;
  }

  // височина на слънцето в градуси (точност ~0,5°); под -0,833° = след залез / преди изгрев
  function sunAlt(lat, lon, t) {
    var d = t / 864e5 - 10957.5, g = rad(357.529 + 0.98560028 * d), q = 280.459 + 0.98564736 * d;
    var L = rad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)), e = rad(23.439 - 3.6e-7 * d);
    var dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var H = rad(280.46061837 + 360.98564736629 * d + lon) - ra;
    return Math.asin(Math.sin(rad(lat)) * Math.sin(dec) + Math.cos(rad(lat)) * Math.cos(dec) * Math.cos(H)) * 180 / Math.PI;
  }

  var api = { measureSections: measureSections, sunAlt: sunAlt, CamWatch: CamWatch, bearing: bearing, decodePolyline: decodePolyline, dist: dist, buildModel: buildModel, applyOverrides: applyOverrides, project: project, Tracker: Tracker };
  if (typeof module !== "undefined") module.exports = api; else root.SSCore = api;
})(this);
