// Навигация: търсене, запазени места, маршрут (OSRM), гласови указания, преизчисляване.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); }, App = window.SSApp, NC = window.SSNavCore;
  var OSRM = "https://router.project-osrm.org/route/v1/driving/", PHOTON = "https://photon.komoot.io/";
  var route = null, dest = null, active = false, lastIdx = 0, offCount = 0, lastReroute = 0, said = {}, routing = false;
  var places = load();

  function load() { try { return Object.assign({ home: null, work: null, recent: [] }, JSON.parse(localStorage.getItem("ss_places") || "{}")); } catch (e) { return { home: null, work: null, recent: [] }; } }
  function save() { try { localStorage.setItem("ss_places", JSON.stringify(places)); } catch (e) { } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function here() { var t = App.tracker(); return t.last ? t.last.p : null; }
  function fmtDur(s) { var m = Math.round(s / 60); return m < 60 ? m + " мин" : Math.floor(m / 60) + " ч " + (m % 60) + " мин"; }
  function durSpeech(s) { var m = Math.max(1, Math.round(s / 60)), h = Math.floor(m / 60), r = m % 60;
    var mins = function (x) { return x === 1 ? "1 минута" : x + " минути"; };
    return h ? (h === 1 ? "1 час" : h + " часа") + (r ? " и " + mins(r) : "") : mins(m); }
  function clock(s) { var d = new Date(Date.now() + s * 1000); return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }

  // ---------- търсене ----------
  var qTimer = null, qSeq = 0;
  function openSearch() {
    $("srch").classList.add("show"); $("q").value = ""; renderSuggestions([]);
    setTimeout(function () { $("q").focus(); }, 50);
  }
  function closeSearch() { $("srch").classList.remove("show"); $("q").blur(); }
  function label(f) {
    var p = f.properties, main = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || p.city || "Точка";
    var sub = [p.name && p.street ? p.street + (p.housenumber ? " " + p.housenumber : "") : "", p.city || p.county || "", p.country && p.country !== "България" && p.country !== "Bulgaria" ? p.country : ""]
      .filter(function (x) { return x && x !== main; }).join(", ");
    var v = p.osm_value, kind = p.osm_key === "place" ? ({ city: "град", town: "град", village: "село", hamlet: "махала", suburb: "квартал", neighbourhood: "квартал" }[v] || "място")
      : p.osm_key === "highway" ? "улица" : p.housenumber ? "адрес" : "обект";
    return { main: main, sub: kind + (sub ? " · " + sub : "") };
  }
  function renderSuggestions(feats) {
    var rows = [];
    if (!$("q").value.trim()) {
      if (places.home) rows.push({ main: "Вкъщи", sub: places.home.name, p: places.home.p, name: places.home.name, ico: "⌂" });
      if (places.work) rows.push({ main: "Работа", sub: places.work.name, p: places.work.p, name: places.work.name, ico: "▣" });
      places.recent.forEach(function (r) { rows.push({ main: r.name, sub: "скорошна", p: r.p, name: r.name, ico: "↺" }); });
      if (!rows.length) rows.push({ main: "Напиши адрес, град или обект", sub: "или задръж пръст върху картата", none: 1 });
    }
    var seen = {};
    feats.filter(function (f) { return f.properties.osm_key !== "boundary"; }).forEach(function (f) {
      var l = label(f), key = l.main + "|" + l.sub; if (seen[key]) return; seen[key] = 1; rows.push({ main: l.main, sub: l.sub, p: [f.geometry.coordinates[1], f.geometry.coordinates[0]], name: l.main + (f.properties.city && f.properties.city !== l.main ? ", " + f.properties.city : ""), ico: "◎" }); });
    $("sug").innerHTML = rows.map(function (r, i) {
      return "<div class='sg" + (r.none ? " none" : "") + "' data-i='" + i + "'><span class='ico'>" + (r.ico || "") + "</span><div><b>" + esc(r.main) + "</b><small>" + esc(r.sub || "") + "</small></div></div>";
    }).join("");
    Array.prototype.forEach.call($("sug").querySelectorAll(".sg:not(.none)"), function (el) {
      el.onclick = function () { var r = rows[+el.dataset.i]; closeSearch(); preview({ p: r.p, name: r.name }); };
    });
  }
  function search(q) {
    var seq = ++qSeq, c = here() || App.mapCenter() || [42.7, 25.3];
    fetch(PHOTON + "api/?limit=10&q=" + encodeURIComponent(q) + "&lat=" + c[0] + "&lon=" + c[1], { signal: AbortSignal.timeout(10000) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (seq === qSeq) renderSuggestions(j.features || []); })
      .catch(function () { if (seq === qSeq) $("sug").innerHTML = "<div class='sg none'><div><b>Търсенето не отговаря</b><small>Провери връзката и опитай пак</small></div></div>"; });
  }

  // ---------- маршрут ----------
  function fetchRoute(from, to) {
    return fetch(OSRM + from[1] + "," + from[0] + ";" + to[1] + "," + to[0] + "?overview=full&geometries=geojson&steps=true", { signal: AbortSignal.timeout(15000) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.routes || !j.routes[0]) throw new Error(j.code || "no route"); return NC.buildRoute(j.routes[0], to); });
  }
  function preview(d) {
    var from = here(), fromCenter = false;
    if (!from) { from = App.mapCenter(); fromCenter = true; }
    if (!from) { App.toast("Няма начална позиция."); return; }
    dest = d; showPrev("<b>" + esc(d.name) + "</b><p class='mut'>Изчислявам маршрута…</p>", false);
    SSMap.setDest(d.p);
    fetchRoute(from, d.p).then(function (r) {
      route = r; SSMap.setRoute(r.line, true);
      var secs = NC.sectionsOnRoute(r, App.model(), window.SS_GEO, SSCore.decodePolyline);
      var secHtml = secs.length ? "<p class='secs'>По маршрута: " + secs.length + " отсечки за средна скорост<br><small>" +
        secs.map(function (x) { return esc(x.sec.roadName + " " + x.sec.from + " → " + x.sec.to + " (" + x.sec.limit + ")"); }).join("<br>") + "</small></p>" : "<p class='mut'>По маршрута няма отсечки за средна скорост.</p>";
      showPrev("<b>" + esc(d.name) + "</b><p class='sum'><span>" + fmtDur(r.duration) + "</span> · " + NC.distText(r.total) + " · пристигане " + clock(r.duration) + "</p>" +
        (fromCenter ? "<p class='mut'>Без GPS: маршрутът е от центъра на картата.</p>" : "") + secHtml, true);
    }).catch(function () { showPrev("<b>" + esc(d.name) + "</b><p class='mut'>Не намерих маршрут. Провери връзката.</p>", false); });
  }
  function showPrev(html, ok) {
    $("prevBody").innerHTML = html; $("prev").hidden = false; $("goNav").disabled = !ok;
    $("bottomBar").hidden = true;
  }
  function closePrev() { $("prev").hidden = true; $("bottomBar").hidden = false; }
  function cancel() {
    closePrev(); active = false; route = null; dest = null; said = {};
    SSMap.setRoute(null); SSMap.setDest(null); $("navb").hidden = true; document.body.classList.remove("navigating"); App.render();
  }
  function start() {
    if (!route) return;
    closePrev(); active = true; lastIdx = 0; offCount = 0; said = {};
    places.recent = [dest].concat(places.recent.filter(function (r) { return r.name !== dest.name; })).slice(0, 8); save();
    $("navb").hidden = false; document.body.classList.add("navigating");
    App.ensureRunning();
    SSMap.setRoute(route.line, false); SSMap.follow();
    var first = route.steps.filter(function (s) { return s.important; })[0];
    if (first) said[route.steps.indexOf(first)] = { cont: 1 };
    App.say("Тръгваме. " + durSpeech(route.duration) + " до " + dest.name + ".", true);
    if (first) App.say("След " + NC.distSpeech(first.d) + " " + first.text.charAt(0).toLowerCase() + first.text.slice(1) + ".");
    update(null);
  }
  function reroute(p) {
    if (routing) return; routing = true; lastReroute = Date.now();
    App.say("Преизчислявам маршрута.", true);
    fetchRoute(p, dest.p).then(function (r) { route = r; lastIdx = 0; said = {}; offCount = 0; SSMap.setRoute(r.line, false); })
      .catch(function () { App.toast("Няма връзка за нов маршрут."); })
      .then(function () { routing = false; });
  }

  // ---------- по време на движение ----------
  var lastPr = null;
  function onFix(fix) {
    if (!route) return null;
    var p = [fix.lat, fix.lon], pr = NC.progress(route, p, lastIdx);
    if (!active) return pr.off < 35 ? pr.snapped : null;
    lastIdx = pr.idx;
    var acc = fix.acc || 0, speed = App.tracker().speed;
    if (pr.off > 60 && acc < 40) offCount++; else if (pr.off < 35) offCount = 0;
    if (offCount >= 3 && Date.now() - lastReroute > 12000) { reroute(p); return null; }
    if (pr.remaining < 30 || (pr.next && pr.next.type === "arrive" && pr.toNext < 30)) {
      App.say("Пристигнахте. " + dest.name + ".", true); cancel(); return null;
    }
    // гласови указания: далечно и близко
    var n = pr.next;
    // гласови указания: рано, подготовка, сега; след завой — колко да продължи
    var lc = function (t) { return t.charAt(0).toLowerCase() + t.slice(1); };
    if (n) {
      var k = n.idx, s = said[k] || (said[k] = {});
      var early = speed > 90 ? 2000 : speed > 50 ? 1000 : 400, prep = speed > 90 ? 800 : speed > 50 ? 400 : 150, now = speed > 90 ? 350 : speed > 50 ? 150 : 40;
      if (n.type === "arrive") {
        if (!s.prep && pr.toNext < prep && pr.toNext > 60) { s.prep = 1; App.say("След " + NC.distSpeech(pr.toNext) + " ще пристигнете."); }
      } else {
        if (!s.cont && !s.early && pr.toNext > early * 1.5 && pr.toNext > 3000 && n.idx > 0) {
          s.cont = 1; App.say("Продължете " + NC.distSpeech(pr.toNext) + " до следващия завой.");
        }
        if (!s.early && pr.toNext < early && pr.toNext > prep * 1.3) { s.early = 1; App.say("След " + NC.distSpeech(pr.toNext) + " " + lc(n.text) + "."); }
        if (!s.prep && pr.toNext < prep && pr.toNext > now * 1.3) { s.prep = s.early = 1; App.say("След " + NC.distSpeech(pr.toNext) + " " + lc(n.text) + "."); }
        if (!s.now && pr.toNext <= now) { s.now = s.prep = s.early = 1; App.say("Сега " + lc(n.text) + ".", true); }
      }
    }
    lastPr = pr; update(pr);
    return pr.off < 35 ? pr.snapped : null;
  }
  function icon(n) {
    if (!n) return "";
    if (n.type === "arrive") return "<svg viewBox='0 0 40 40'><circle cx='20' cy='17' r='9' fill='none' stroke='#fff' stroke-width='4'/><path d='M20 26 L20 37' stroke='#fff' stroke-width='4'/></svg>";
    if (n.type === "roundabout" || n.type === "rotary") return "<svg viewBox='0 0 40 40'><circle cx='20' cy='22' r='9' fill='none' stroke='#fff' stroke-width='4'/><text x='20' y='27' font-size='12' font-weight='700' fill='#fff' text-anchor='middle'>" + (n.exit || "") + "</text><path d='M20 13 L20 3 M14 8 L20 2 L26 8' stroke='#fff' stroke-width='4' fill='none' stroke-linecap='round'/></svg>";
    var a = { straight: 0, "slight right": 40, right: 90, "sharp right": 135, uturn: 180, "slight left": -40, left: -90, "sharp left": -135 }[n.mod] || 0;
    if ((n.type === "off ramp" || n.type === "fork" || n.type === "merge") && Math.abs(a) > 45) a = a > 0 ? 40 : -40;
    return "<svg viewBox='0 0 40 40'><path d='M20 37 L20 22' stroke='#fff' stroke-width='5' stroke-linecap='round'/><g transform='rotate(" + a + " 20 22)'><path d='M20 22 L20 6 M12 13 L20 5 L28 13' stroke='#fff' stroke-width='5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></g></svg>";
  }
  function update(pr) {
    if (!active || !route) return;
    pr = pr || NC.progress(route, here() || route.line[0], lastIdx);
    var n = pr.next;
    $("navIco").innerHTML = icon(n);
    $("navDist").textContent = n ? NC.distText(pr.toNext) : "";
    $("navTxt").textContent = n ? n.text : "Следвайте маршрута";
    $("navEta").textContent = clock(pr.remDur) + " · " + NC.distText(pr.remaining) + " · " + fmtDur(pr.remDur);
  }

  // ---------- задържане върху картата ----------
  function onLongPress(p) {
    var nm = p[0].toFixed(5) + ", " + p[1].toFixed(5);
    preview({ p: p, name: nm });
    fetch(PHOTON + "reverse?lat=" + p[0] + "&lon=" + p[1], { signal: AbortSignal.timeout(8000) }).then(function (r) { return r.json(); }).then(function (j) {
      var f = j.features && j.features[0]; if (!f || !dest || dest.p !== p) return;
      var l = label(f); dest.name = l.main;
      var b = $("prevBody").querySelector("b"); if (b) b.textContent = dest.name;
    }).catch(function () { });
  }
  function savePlace(kind) {
    if (!dest) return;
    places[kind] = { p: dest.p, name: dest.name }; save();
    App.toast((kind === "home" ? "Вкъщи" : "Работа") + ": " + dest.name);
  }

  // ---------- връзки ----------
  $("searchBtn").onclick = openSearch;
  $("srchClose").onclick = closeSearch;
  $("q").oninput = function () {
    var q = this.value.trim(); clearTimeout(qTimer);
    if (q.length < 2) { renderSuggestions([]); return; }
    qTimer = setTimeout(function () { search(q); }, 350);
  };
  $("q").onkeydown = function (e) { if (e.key === "Enter") { clearTimeout(qTimer); search(this.value.trim()); } };
  $("goNav").onclick = start;
  $("cancelNav").onclick = cancel;
  $("endNav").onclick = function () { cancel(); App.say("Навигацията е спряна."); };
  $("saveHome").onclick = function () { savePlace("home"); };
  $("saveWork").onclick = function () { savePlace("work"); };

  window.SSNav = { state: function () { return { active: active, lastPr: lastPr && { remaining: lastPr.remaining, off: lastPr.off, along: lastPr.along }, total: route && route.total, offCount: offCount }; }, onFix: onFix, onLongPress: onLongPress, active: function () { return active; }, hasRoute: function () { return !!route; } };
})();
