// Навигация без UI: маршрут от OSRM, напредък по маршрута, указания на български.
(function (root) {
  "use strict";
  var dist = (typeof SSCore !== "undefined" ? SSCore : require("./core.js")).dist;
  var rad = function (x) { return x * Math.PI / 180; };

  function cum(line) { var c = [0]; for (var i = 1; i < line.length; i++) c.push(c[i - 1] + dist(line[i - 1], line[i])); return c; }

  // проекция на точка върху отсечките [from, to) на линията
  function project(line, c, p, from, to) {
    var best = { d: 0, e: Infinity, q: line[0], i: 1 }, k = Math.cos(rad(p[0]));
    from = Math.max(1, from || 1); to = Math.min(line.length, to || line.length);
    for (var i = from; i < to; i++) {
      var a = line[i - 1], b = line[i];
      var ax = a[1] * k, ay = a[0], dx = b[1] * k - ax, dy = b[0] - ay, L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      var q = [ay + t * dy, (ax + t * dx) / k], e = dist(q, p);
      if (e < best.e) best = { d: c[i - 1] + t * (c[i] - c[i - 1]), e: e, q: q, i: i };
    }
    return best;
  }

  var MOD = { left: "наляво", right: "надясно", "slight left": "леко наляво", "slight right": "леко надясно",
    "sharp left": "рязко наляво", "sharp right": "рязко надясно", straight: "направо", uturn: "обратно" };
  var ORD = ["", "първия", "втория", "третия", "четвъртия", "петия", "шестия", "седмия", "осмия"];

  function road(st) {
    var n = st.name || "", r = st.ref ? st.ref.split(";")[0] : "";
    if (n && r && n.indexOf(r) < 0) return n + " (" + r + ")";
    return n || r;
  }
  function toward(st) { return st.destinations ? " към " + st.destinations.split(",")[0].replace(/^[^:]*:\s*/, "") : ""; }

  function instruction(st) {
    var m = st.maneuver || {}, type = m.type, mod = m.modifier, nm = road(st), on = nm ? " по " + nm : "";
    switch (type) {
      case "depart": return "Тръгнете" + on;
      case "arrive": return "Пристигнахте";
      case "roundabout": case "rotary":
        return "На кръговото движение вземете " + (ORD[m.exit] ? ORD[m.exit] + " изход" : "изхода") + on;
      case "roundabout turn": return "На кръговото завийте " + (MOD[mod] || "") + on;
      case "exit roundabout": case "exit rotary": return "Излезте от кръговото" + on;
      case "on ramp": return "Качете се" + (nm ? " на " + nm : " на пътя") + toward(st);
      case "off ramp": return "Излезте " + (mod && mod.indexOf("left") >= 0 ? "вляво" : "вдясно") + toward(st) + (nm && !st.destinations ? " към " + nm : "");
      case "fork": return "Дръжте се " + (mod && mod.indexOf("left") >= 0 ? "вляво" : mod && mod.indexOf("right") >= 0 ? "вдясно" : "направо") + toward(st) + on;
      case "merge": return "Влейте се " + (mod && mod.indexOf("left") >= 0 ? "вляво" : "вдясно") + on;
      case "end of road": return "В края на пътя завийте " + (MOD[mod] || "") + on;
      case "new name": case "continue": case "notification":
        if (mod && mod !== "straight" && MOD[mod]) return "Завийте " + MOD[mod] + on;
        return "Продължете" + (nm ? " по " + nm : " направо");
      default:
        if (mod === "uturn") return "Обърнете" + on;
        if (mod === "straight") return "Продължете направо" + on;
        return "Завийте " + (MOD[mod] || "") + on;
    }
  }
  // кои стъпки да се съобщават (без „продължете“ по същия път)
  function important(st) {
    var t = st.maneuver.type, mod = st.maneuver.modifier;
    if (t === "depart" || t === "exit roundabout" || t === "exit rotary") return false;
    if ((t === "new name" || t === "continue" || t === "notification") && (!mod || mod === "straight" || mod.indexOf("slight") === 0)) return false;
    return true;
  }

  // osrmRoute: routes[0] от OSRM (geometries=geojson, steps=true)
  function buildRoute(osrmRoute, dest) {
    var line = osrmRoute.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), c = cum(line);
    var steps = [], hint = 1;
    osrmRoute.legs.forEach(function (leg) {
      leg.steps.forEach(function (st) {
        var loc = [st.maneuver.location[1], st.maneuver.location[0]];
        var pr = project(line, c, loc, hint, Math.min(line.length, hint + 4000));
        hint = Math.max(1, pr.i);
        steps.push({ d: pr.d, text: instruction(st), type: st.maneuver.type, mod: st.maneuver.modifier, exit: st.maneuver.exit,
          important: important(st), duration: st.duration, distance: st.distance, loc: loc });
      });
    });
    return { line: line, cum: c, total: c[c.length - 1], duration: osrmRoute.duration, steps: steps, dest: dest };
  }

  // напредък: търси около последната позиция, за да не „прескача“ на успоредни участъци
  function progress(route, p, hintIdx) {
    var from = hintIdx ? hintIdx - 30 : 1, to = hintIdx ? hintIdx + 300 : route.line.length;
    var pr = project(route.line, route.cum, p, from, to);
    if (hintIdx && pr.e > 60) { var all = project(route.line, route.cum, p); if (all.e < pr.e) pr = all; }
    var next = null;
    for (var i = 0; i < route.steps.length; i++) { var s = route.steps[i]; if (s.d > pr.d + 3 && s.type !== "depart" && (s.important || s.type === "arrive")) { next = s; next.idx = i; break; } }
    var remaining = Math.max(route.total - pr.d, 0);
    // оставащо време по стъпките на OSRM (различна скорост по различните пътища)
    var remDur = 0, st = route.steps;
    for (var j = 0; j < st.length; j++) {
      var s0 = st[j], s1 = st[j + 1], end = s1 ? s1.d : route.total;
      if (end <= pr.d) continue;
      var len = Math.max(end - s0.d, 1), part = Math.min(1, (end - Math.max(pr.d, s0.d)) / len);
      remDur += (s0.duration || 0) * part;
    }
    if (!remDur && route.total) remDur = route.duration * remaining / route.total;
    return { along: pr.d, off: pr.e, snapped: pr.q, idx: pr.i, next: next, toNext: next ? next.d - pr.d : remaining, remaining: remaining, remDur: remDur };
  }

  function distText(m) {
    if (m >= 950) { var k = Math.round(m / 100) / 10; return (k >= 10 ? Math.round(k) : String(k).replace(".", ",")) + " км"; }
    if (m >= 100) return Math.round(m / 50) * 50 + " м";
    return Math.max(10, Math.round(m / 10) * 10) + " м";
  }
  function distSpeech(m) {
    if (m >= 950) { var k = Math.round(m / 100) / 10; return k === 1 ? "1 километър" : String(k >= 10 ? Math.round(k) : k).replace(".", ",") + " километра"; }
    return (m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10) + " метра";
  }

  // отсечки за средна скорост, през които минава маршрутът (по реда им)
  function sectionsOnRoute(route, model, geo, decode) {
    var out = [];
    model.sections.forEach(function (s) {
      var idx = parseInt(s.id, 10), pa = model.points[s.fromKey].p, pb = model.points[s.toKey].p;
      var a = project(route.line, route.cum, pa), b = project(route.line, route.cum, pb);
      if (a.e > 400 || b.e > 400 || b.d <= a.d) return;
      if (geo && geo[idx]) { // средата на отсечката също трябва да е по маршрута
        var g = decode(geo[idx]), mid = g[Math.floor(g.length / 2)];
        if (project(route.line, route.cum, mid).e > 150) return;
      }
      out.push({ sec: s, d: a.d });
    });
    return out.sort(function (x, y) { return x.d - y.d; });
  }

  // ---------- имена на места и адреси ----------
  var Q = function (s) { return s; };
  function street(name, kind) {
    if (!name) return "";
    var n = name.replace(/^улица\s+/i, "ул. ").replace(/^булевард\s+/i, "бул. ").replace(/^площад\s+/i, "пл. ").replace(/^ул\.(?=\S)/, "ул. ").replace(/^бул\.(?=\S)/, "бул. ");
    if (/^(ул|бул|пл|кв|ж\.к|жк)\.?\s/i.test(n)) return n;
    if (kind === "square") return "пл. " + n;
    if (/^(residential|living_street|tertiary|secondary|unclassified|service|pedestrian|road)$/.test(kind || "")) return "ул. " + n;
    return n;
  }
  function settlement(name, kind) {
    if (!name) return "";
    if (/^(гр|с|кв|ж\.к)\.\s/.test(name)) return name;
    var pre = { city: "гр. ", town: "гр. ", village: "с. ", hamlet: "с. ", suburb: "кв. ", quarter: "кв. ", neighbourhood: "кв. ", square: "пл. " }[kind];
    return (pre || "") + name;
  }
  function region(st) { return st ? (/^област/i.test(st) ? st.replace(/^област\s+/i, "обл. ") : "обл. " + st) : ""; }
  // Photon (lang=default → имената от OSM, на кирилица)
  function fmtPhoton(p) {
    var k = p.osm_key, v = p.osm_value, sofia = p.state === "София-град", town = p.city || p.town || p.village || (sofia ? "София" : "");
    var where = [town && town !== p.name ? (sofia && town === "София" ? "гр. София" : town) : "", p.district || "", sofia ? "" : region(p.state)].filter(Boolean);
    if (k === "place") {
      return { main: settlement(p.name, v), sub: [{ city: "град", town: "град", village: "село", hamlet: "село", suburb: "квартал", quarter: "квартал", neighbourhood: "квартал", square: "площад" }[v] || "място"].concat(region(p.state) ? [region(p.state)] : []).join(" · "), kind: "place" };
    }
    if (p.housenumber && p.street) return { main: street(p.street, "residential") + " " + p.housenumber, sub: ["адрес"].concat(where).join(" · "), kind: "addr" };
    if (k === "highway" || v === "square") {
      return { main: street(p.name, v === "square" ? "square" : v), sub: [v === "square" || /^пл\./.test(street(p.name, v)) ? "площад" : /^бул\./.test(street(p.name, v)) ? "булевард" : "улица"].concat(where).join(" · "), kind: "street" };
    }
    var addr = p.street ? street(p.street, "residential") + (p.housenumber ? " " + p.housenumber : "") : "";
    var cat = { peak: "връх", station: "гара", halt: "гара", aerodrome: "летище", bus_station: "автогара", fuel: "бензиностанция", hospital: "болница",
      parking: "паркинг", hotel: "хотел", restaurant: "ресторант", supermarket: "магазин", mall: "мол", school: "училище", university: "университет" }[v] || "обект";
    return { main: p.name || addr || town || "Точка", sub: [cat].concat([addr].filter(Boolean), where).join(" · "), kind: "poi" };
  }
  // Nominatim (addressdetails=1, accept-language=bg)
  function fmtNominatim(it) {
    var a = it.address || {}, town = a.city || a.town || a.village || a.hamlet || "", road = a.road || a.pedestrian || a.square || "";
    var main = road ? street(road, a.square && !a.road ? "square" : "residential") + (a.house_number ? " " + a.house_number : "") : (it.name || town);
    var sub = [a.house_number ? "адрес" : road ? "улица" : "място", town ? settlement(town, a.city ? "city" : a.town ? "town" : "village") : "", a.suburb || "", region(a.state)].filter(Boolean).join(" · ");
    return { main: main, sub: sub, exact: !!a.house_number, p: [+it.lat, +it.lon] };
  }

  var api = { fmtPhoton: fmtPhoton, fmtNominatim: fmtNominatim, street: street, settlement: settlement, buildRoute: buildRoute, progress: progress, instruction: instruction, distText: distText, distSpeech: distSpeech, sectionsOnRoute: sectionsOnRoute, project: project, cum: cum };
  if (typeof module !== "undefined") module.exports = api; else root.SSNavCore = api;
})(this);
