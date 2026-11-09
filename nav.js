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
    $("srch").classList.add("show"); $("q").value = ""; setMode("free");
    setTimeout(function () { $("q").focus(); }, 50);
  }
  function closeSearch() { $("srch").classList.remove("show"); $("q").blur(); }
  function label(f) { return NC.fmtPhoton(f.properties); }
  var ICO = { place: "◉", street: "═", addr: "№", poi: "●" };
  function townOf(p) { return p.city || p.town || p.village || (p.state === "София-град" ? "София" : ""); }
  function renderRows(rows) {
    $("sug").innerHTML = rows.map(function (r, i) {
      return "<div class='sg" + (r.none ? " none" : "") + "' data-i='" + i + "'><span class='ico'>" + (r.ico || "") + "</span><div><b>" + esc(r.main) + "</b><small>" + esc(r.sub || "") + "</small></div></div>";
    }).join("");
    Array.prototype.forEach.call($("sug").querySelectorAll(".sg:not(.none)"), function (el) {
      el.onclick = function () { var r = rows[+el.dataset.i]; if (r.pick) return r.pick(); closeSearch(); preview({ p: r.p, name: r.name }); };
    });
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
    var found = feats.filter(function (f) { return f.properties.osm_key !== "boundary"; }).map(function (f) {
      var l = label(f); l.p = [f.geometry.coordinates[1], f.geometry.coordinates[0]]; return l; });
    NC.sortResults(found).forEach(function (l) {
      var key = l.main + "|" + l.sub; if (seen[key]) return; seen[key] = 1;
      rows.push({ main: l.main, sub: l.sub, p: l.p, name: l.main, ico: ICO[l.kind] }); });
    if ($("q").value.trim() && !rows.length) rows.push({ main: "Няма резултати", sub: "Опитай с „Град, улица, номер“", none: 1 });
    renderRows(rows);
  }

  // ---------- адрес: град, улица, номер ----------
  var aCity = null, aStreet = null, aTimer = null, aSeq = 0;
  function setMode(m) {
    $("tabFree").classList.toggle("on", m === "free"); $("tabAddr").classList.toggle("on", m === "addr");
    $("q").hidden = m !== "free"; $("addrForm").hidden = m !== "addr";
    if (m === "free") { renderSuggestions([]); $("q").focus(); } else { renderRows([]); $("fCity").focus(); }
  }
  function photon(q, tags, near, cb) {
    var seq = ++aSeq, c = near || here() || App.mapCenter() || [42.7, 25.3];
    fetch(PHOTON + "api/?lang=default&limit=12&q=" + encodeURIComponent(q) + tags.map(function (t) { return "&osm_tag=" + t; }).join("") + "&lat=" + c[0] + "&lon=" + c[1], { signal: AbortSignal.timeout(10000) })
      .then(function (r) { return r.json(); }).then(function (j) { if (seq === aSeq) cb(j.features || []); })
      .catch(function () { if (seq === aSeq) renderRows([{ main: "Търсенето не отговаря", sub: "Провери връзката", none: 1 }]); });
  }
  function cityInput() {
    aCity = null; aStreet = null; var q = $("fCity").value.trim(); clearTimeout(aTimer);
    if (q.length < 2) { renderRows([]); return; }
    aTimer = setTimeout(function () {
      photon(q, ["place:city", "place:town", "place:village", "place:hamlet"], null, function (fs) {
        var seen = {};
        renderRows(NC.sortResults(fs.map(function (f) { var l = label(f); return { main: l.main, sub: l.sub, p: [f.geometry.coordinates[1], f.geometry.coordinates[0]], ico: "◉",
          raw: f.properties.name, key: l.main + l.sub, rank: l.rank }; })).filter(function (r) { if (seen[r.key]) return false; seen[r.key] = 1; return true; })
          .map(function (r) { r.pick = function () { aCity = { name: r.raw, label: r.main, p: r.p }; $("fCity").value = r.main; renderRows([{ main: "Град: " + r.main, sub: "Сега въведи улица", none: 1 }]); $("fStreet").focus(); }; return r; }));
      });
    }, 300);
  }
  function streetInput() {
    aStreet = null; var q = $("fStreet").value.trim(); clearTimeout(aTimer);
    if (q.length < 2) { renderRows([]); return; }
    if (!aCity) { renderRows([{ main: "Първо избери град от списъка", none: 1 }]); return; }
    aTimer = setTimeout(function () {
      photon(q + " " + aCity.name, ["highway", "place:square"], aCity.p, function (fs) {
        var seen = {};
        var rows = fs.filter(function (f) {
          var t = townOf(f.properties), c = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
          var pr = f.properties, isSq = pr.osm_value === "square";
          return (pr.osm_key === "highway" || isSq) && (t === aCity.name || SSCore.dist(c, aCity.p) < 15000);
        }).map(function (f) { var l = label(f); return { main: aCity.label + ", " + l.line, sub: l.sub, p: [f.geometry.coordinates[1], f.geometry.coordinates[0]], ico: "═", raw: f.properties.name, line: l.line, rank: l.rank }; })
          .filter(function (r) { if (seen[r.main]) return false; seen[r.main] = 1; return true; })
          .map(function (r) { r.pick = function () { aStreet = { name: r.raw, label: r.line, p: r.p }; $("fStreet").value = r.line; renderRows([{ main: aCity.label + ", " + r.line, sub: "Въведи номер или натисни „Намери адреса“", none: 1 }]); $("fNum").focus(); }; return r; });
        rows = NC.sortResults(rows);
        renderRows(rows.length ? rows : [{ main: "Няма такава улица в " + aCity.label, sub: "Провери изписването", none: 1 }]);
      });
    }, 300);
  }
  function findAddress() {
    var num = $("fNum").value.trim(), st = aStreet ? aStreet.name : $("fStreet").value.trim();
    if (!aCity) { renderRows([{ main: "Избери град от списъка", none: 1 }]); return; }
    if (!st) { closeSearch(); preview({ p: aCity.p, name: aCity.label }); return; }
    renderRows([{ main: "Търся адреса…", none: 1 }]);
    var u = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=bg&countrycodes=bg&limit=6" +
      "&street=" + encodeURIComponent((num ? num + " " : "") + st) + "&city=" + encodeURIComponent(aCity.name);
    fetch(u, { signal: AbortSignal.timeout(12000) }).then(function (r) { return r.json(); }).then(function (list) {
      var seen = {};
      var rows = (list || []).map(function (it) { var f = NC.fmtNominatim(it); return { main: f.main, sub: f.sub, p: f.p, name: f.main, ico: f.exact ? "№" : "═", exact: f.exact }; })
        .filter(function (r) { var k = r.main + "|" + r.sub; if (seen[k]) return false; seen[k] = 1; return true; });
      var exact = rows.filter(function (r) { return r.exact; });
      if (num && exact.length === 1) { closeSearch(); preview({ p: exact[0].p, name: exact[0].name }); return; }
      if (num && !exact.length) {
        // номерът го няма в картата — предлага улицата
        var fall = aStreet ? [{ main: aCity.label + ", " + aStreet.label, sub: "№ " + num + " не е отбелязан в картата · води до улицата", p: aStreet.p, name: aCity.label + ", " + aStreet.label + " " + num, ico: "═" }] : [];
        var others = rows.filter(function (r) { return !aStreet || r.main.indexOf(aStreet.label) < 0; });
        renderRows(fall.concat(others).length ? fall.concat(others) : [{ main: "Не намерих адреса", sub: "Опитай без номер", none: 1 }]); return;
      }
      if (!rows.length && aStreet) rows = [{ main: aCity.label + ", " + aStreet.label, sub: "улица", p: aStreet.p, name: aCity.label + ", " + aStreet.label, ico: "═" }];
      renderRows(rows.length ? rows : [{ main: "Не намерих адреса", sub: "Провери улицата", none: 1 }]);
    }).catch(function () { renderRows([{ main: "Търсенето на адрес не отговаря", sub: "Опитай пак след малко", none: 1 }]); });
  }
  function search(q) {
    var seq = ++qSeq, c = here() || App.mapCenter() || [42.7, 25.3];
    fetch(PHOTON + "api/?lang=default&limit=10&q=" + encodeURIComponent(q) + "&lat=" + c[0] + "&lon=" + c[1], { signal: AbortSignal.timeout(10000) })
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
    $("navTxt").textContent = !n ? "Следвайте маршрута" : n.type === "arrive" ? "Към " + dest.name : n.text;
    $("navLeft").textContent = fmtDur(pr.remDur);
    $("navEta").textContent = NC.distText(pr.remaining) + " · пристигане " + clock(pr.remDur);
  }

  // ---------- задържане върху картата ----------
  function onLongPress(p) {
    var nm = p[0].toFixed(5) + ", " + p[1].toFixed(5);
    preview({ p: p, name: nm });
    fetch(PHOTON + "reverse?lang=default&lat=" + p[0] + "&lon=" + p[1], { signal: AbortSignal.timeout(8000) }).then(function (r) { return r.json(); }).then(function (j) {
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
  $("tabFree").onclick = function () { setMode("free"); };
  $("tabAddr").onclick = function () { setMode("addr"); };
  $("fCity").oninput = cityInput; $("fStreet").oninput = streetInput;
  $("fNum").onkeydown = function (e) { if (e.key === "Enter") findAddress(); };
  $("fGo").onclick = findAddress;
  $("goNav").onclick = start;
  $("cancelNav").onclick = cancel;
  $("endNav").onclick = function () { cancel(); App.say("Навигацията е спряна."); };
  $("saveHome").onclick = function () { savePlace("home"); };
  $("saveWork").onclick = function () { savePlace("work"); };

  window.SSNav = { state: function () { return { active: active, lastPr: lastPr && { remaining: lastPr.remaining, off: lastPr.off, along: lastPr.along }, total: route && route.total, offCount: offCount }; }, onFix: onFix, onLongPress: onLongPress, active: function () { return active; }, hasRoute: function () { return !!route; } };
})();
