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
      var base = { road: road, roadName: data.roads[road], L: L, limit: r[5] };
      if (r[6] !== "-") sections.push(Object.assign({ id: i + "f", from: r[1], to: r[3], fromKey: a, toKey: b, upcoming: r[6] === "u" }, base));
      if (r[7] !== "-") sections.push(Object.assign({ id: i + "r", from: r[3], to: r[1], fromKey: b, toKey: a, upcoming: r[7] === "u" }, base));
    });
    return { points: points, sections: sections };
  }

  function applyOverrides(points, overrides) {
    for (var k in overrides || {}) if (points[k]) { points[k].p = overrides[k].p; points[k].src = overrides[k].src; }
  }

  // Наместване на приблизителните точки върху тол рамки от OSM (highway=toll_gantry).
  // Приема се само ако разстоянието между двата края на отсечката съответства на дължината ѝ.
  function snapToGantries(data, gantries, maxM) {
    maxM = maxM || 4000;
    var cand = {}, k, i;
    for (k in data.points) {
      var best = null, bd = Infinity;
      for (i = 0; i < gantries.length; i++) {
        var d = dist(data.points[k], gantries[i]);
        if (d < bd) { bd = d; best = gantries[i]; }
      }
      if (best && bd <= maxM) cand[k] = best;
    }
    var bad = {};
    data.sections.forEach(function (r) {
      var a = r[0] + ":" + r[1], b = r[0] + ":" + r[3], Lm = sectionLength(r) * 1000;
      var pa = cand[a] || data.points[a], pb = cand[b] || data.points[b];
      var slack = (cand[a] && cand[b]) ? 300 : maxM; // и двата края уточнени → строга проверка
      var d = dist(pa, pb);
      if (d > Lm * 1.02 + slack || d < Lm * 0.4) { bad[a] = 1; bad[b] = 1; }
    });
    var out = {};
    for (k in cand) if (!bad[k]) out[k] = { p: cand[k], src: "osm" };
    return out;
  }

  function Tracker(model, opts) {
    this.m = model;
    this.margin = (opts && opts.margin != null) ? opts.margin : 3;
    this.reset();
  }
  Tracker.prototype.reset = function () {
    this.last = null; this.odo = 0; this.speed = 0;
    this.near = {}; this.prevD = {}; this.cands = []; this.active = null; this.announced = {};
    this.lastOver = -1e12;
  };
  Tracker.prototype.radius = function (pt) { return pt.src === "approx" ? 2500 : 250; };

  // fix: { lat, lon, t (ms), speed (m/s или null), acc (m) }
  Tracker.prototype.feed = function (fix) {
    var ev = [], p = [fix.lat, fix.lon], self = this;
    if (fix.acc != null && fix.acc > 100) return ev; // твърде неточна позиция
    var v = fix.speed;
    if (this.last) {
      var dt = (fix.t - this.last.t) / 1000;
      if (dt <= 0) return ev;
      var dd = dist(this.last.p, p);
      if (dd / dt < 90) this.odo += dd; // отсейва скокове над ~320 км/ч
      if (v == null || isNaN(v)) v = dd / dt;
    }
    this.speed = (v || 0) * 3.6;
    this.last = { p: p, t: fix.t };

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

  var api = { sunAlt: sunAlt, CamWatch: CamWatch, bearing: bearing, decodePolyline: decodePolyline, dist: dist, buildModel: buildModel, applyOverrides: applyOverrides, snapToGantries: snapToGantries, Tracker: Tracker };
  if (typeof module !== "undefined") module.exports = api; else root.SSCore = api;
})(this);
