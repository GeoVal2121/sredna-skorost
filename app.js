(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("ss_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("ss_" + k, JSON.stringify(v)); } catch (e) { } }
  };
  var cfg = Object.assign({ margin: 3, voice: true, beep: true }, store.get("cfg", {}));
  var manual = store.get("manual", {});           // ръчни калибрации
  var osmCache = store.get("osm", null);          // { t, g:[[lat,lon]] }
  var model, tracker, watchId = null, wake = null, demoTimer = null, lastFix = null;

  function overrides() {
    var o = osmCache ? SSCore.snapToGantries(SS_DATA, osmCache.g) : {};
    for (var k in manual) o[k] = { p: manual[k], src: "manual" };
    return o;
  }
  function rebuild() {
    if (!model) {
      model = SSCore.buildModel(SS_DATA, overrides());
      tracker = new SSCore.Tracker(model, { margin: +cfg.margin });
    } else { // обновява точките на място, без да прекъсва текущата отсечка
      for (var k in model.points) { model.points[k].p = SS_DATA.points[k]; model.points[k].src = "approx"; }
      SSCore.applyOverrides(model.points, overrides());
    }
    osmChip(); renderList();
  }

  // ---------- звук и глас ----------
  var ac = null;
  function unlockAudio() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) { }
    try { speechSynthesis.getVoices(); } catch (e) { }
  }
  function beep(n) {
    if (!cfg.beep || !ac) return;
    for (var i = 0; i < (n || 2); i++) {
      var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.28;
      o.frequency.value = 1150; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.22);
    }
  }
  function say(text, urgent) {
    if (!cfg.voice || !window.speechSynthesis) return;
    try {
      if (urgent) speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "bg-BG"; u.rate = 1.05;
      var v = speechSynthesis.getVoices().filter(function (x) { return /^bg/i.test(x.lang); })[0];
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  function kmText(m) {
    if (m < 950) return Math.round(m / 100) * 100 + " метра";
    var k = Math.round(m / 100) / 10;
    return (k === 1 ? "1 километър" : String(k).replace(".", ",") + " километра");
  }
  function r0(x) { return Math.round(x); }

  // ---------- събития от тракера ----------
  function onEvent(e) {
    var s = e.sec, nm = s ? s.from + " – " + s.to : "";
    if (e.type === "approach") {
      say((e.approx ? "Наближаваш" : "След " + kmText(e.dist) + ",") + " отсечка за средна скорост " + nm + ". Ограничение " + s.limit + (s.upcoming ? ". Отсечката още не е въведена." : "."));
    } else if (e.type === "enter") {
      $("res").hidden = true;
      say("Начало на отсечка " + nm + ", " + String(Math.round(s.L * 10) / 10).replace(".", ",") + " километра, ограничение " + s.limit + ".", true);
    } else if (e.type === "over") {
      beep(3);
      say("Внимание. Средната скорост е " + r0(e.avg) + ". Карай най-много " + r0(e.rec) + ".", true);
    } else if (e.type === "finish") {
      if (e.over) beep(2);
      say("Край на отсечката. Средна скорост " + r0(e.avg) + (e.over ? ", над ограничението." : "."), true);
      var res = $("res");
      res.hidden = false; res.className = "card result" + (e.over ? " over" : "");
      res.innerHTML = "<h2>Последна отсечка</h2><div class='sec-name'><div><small>" + s.roadName + "</small>" + nm +
        "</div></div><p style='margin-top:6px;font-size:20px'>Средна: <b style='color:" + (e.over ? "var(--bad)" : "var(--ok)") + "'>" +
        r0(e.avg) + " км/ч</b> <span class='mut'>(ограничение " + s.limit + ", " + r0(e.minutes) + " мин.)</span></p>";
      store.set("last", { name: nm, road: s.roadName, avg: e.avg, limit: s.limit, t: Date.now() });
    } else if (e.type === "abort") {
      say("Излезе от отсечката " + nm + ".");
      toast("Излезе от отсечката " + nm);
    }
  }

  // ---------- позиция ----------
  function onFix(fix) {
    lastFix = fix;
    var evs = tracker.feed(fix);
    evs.forEach(onEvent);
    render(fix.t);
    var g = $("gps");
    g.textContent = "GPS ±" + r0(fix.acc || 0) + " м";
    g.className = "chip " + ((fix.acc || 0) <= 30 ? "ok" : (fix.acc || 0) > 100 ? "bad" : "");
  }
  function start() {
    unlockAudio();
    if (!("geolocation" in navigator)) { toast("Устройството няма GPS достъп."); return; }
    if (!window.isSecureContext) toast("GPS изисква HTTPS адрес.");
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords;
      onFix({ lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now(), speed: c.speed, acc: c.accuracy });
    }, function (err) {
      var g = $("gps"); g.className = "chip bad";
      g.textContent = err.code === 1 ? "GPS: отказан" : "GPS: няма сигнал";
      if (err.code === 1) toast("Разреши достъп до местоположението в настройките на браузъра.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    keepAwake();
    $("go").textContent = "Стоп"; $("go").classList.add("on");
    $("nearest").textContent = "Търся GPS сигнал…";
    if (!osmCache || Date.now() - osmCache.t > 30 * 864e5) loadOsm(false);
  }
  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; stopDemo();
    if (wake) { try { wake.release(); } catch (e) { } wake = null; }
    $("go").textContent = "Старт"; $("go").classList.remove("on");
    $("gps").textContent = "GPS: изкл."; $("gps").className = "chip";
  }
  function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (w) { wake = w; }).catch(function () { });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && (watchId != null || demoTimer) && !wake) keepAwake();
    if (document.visibilityState === "hidden") wake = null;
  });

  // ---------- OSM рамки ----------
  function loadOsm(manualClick) {
    $("osm").textContent = "OSM…";
    var q = '[out:json][timeout:60];node["highway"="toll_gantry"](41.2,22.3,44.25,28.65);out skel;';
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var g = (j.elements || []).map(function (n) { return [n.lat, n.lon]; });
        if (!g.length) throw new Error("empty");
        osmCache = { t: Date.now(), g: g }; store.set("osm", osmCache);
        rebuild();
        if (manualClick) toast("Заредени " + g.length + " тол рамки от OpenStreetMap.");
      })
      .catch(function () { osmChip(); if (manualClick) toast("OSM не е достъпен. Ползват се приблизителни точки."); });
  }
  function osmChip() {
    var n = 0, total = 0, k;
    for (k in model.points) { total++; if (model.points[k].src !== "approx") n++; }
    var c = $("osm"); c.textContent = "Точни " + n + "/" + total;
    c.className = "chip" + (n === total ? " ok" : "");
  }

  // ---------- калибрация ----------
  function calibrate() {
    var p = tracker.last && tracker.last.p;
    if (!p) { toast("Няма GPS позиция. Натисни „Старт“."); return; }
    var best = null, bd = Infinity;
    for (var k in model.points) { var d = SSCore.dist(model.points[k].p, p); if (d < bd) { bd = d; best = k; } }
    if (!best || bd > 5000) { toast("Няма рамка на отсечка в радиус 5 км."); return; }
    var name = best.split(":"), road = SS_DATA.roads[name[0]];
    dialog("Рамка „" + name.slice(1).join(":") + "“", road + ". Записвам текущото ти място като позиция на рамката (досегашната точка е на " + kmText(bd) + ").",
      function () { manual[best] = p; store.set("manual", manual); rebuild(); toast("Записано. Рамката е калибрирана."); });
  }

  // ---------- изглед ----------
  function fmtMin(m) { var mm = Math.floor(m), ss = Math.round((m - mm) * 60); if (ss === 60) { mm++; ss = 0; } return mm + ":" + (ss < 10 ? "0" : "") + ss; }
  function render(t) {
    $("spd").textContent = tracker.last ? r0(tracker.speed) : "–";
    var st = tracker.activeState(t);
    $("act").hidden = !st; $("idle").hidden = !!st;
    if (st) {
      var s = st.sec;
      $("aRoad").textContent = s.roadName + (s.upcoming ? " · предстояща" : "");
      $("aName").textContent = s.from + " → " + s.to;
      $("aLim").textContent = s.limit;
      $("aBar").style.width = Math.min(100, st.trav / s.L * 100) + "%";
      $("aAvg").textContent = st.avg == null ? "–" : r0(st.avg);
      $("aAvgCell").className = "cell big " + st.status;
      $("act").className = "card" + (st.status === "over" ? " over" : "");
      $("aRec").textContent = st.rec == null ? "–" : r0(st.rec);
      $("aRem").textContent = st.remaining.toFixed(1).replace(".", ",") + " км";
      $("aPred").textContent = r0(st.predicted);
      $("aTime").textContent = fmtMin(st.elapsedMin);
      var pa = model.points[s.fromKey].src, pb = model.points[s.toKey].src;
      $("aNote").textContent = (pa === "approx" || pb === "approx") ? "Рамките на тази отсечка са с приблизителни координати — началото и краят може да се отчетат с до 1–2 км разлика." : "";
    } else {
      var n = tracker.nearest();
      if (tracker.cands.length) $("nearest").textContent = "Мина под рамка — определям посоката…";
      else if (n) $("nearest").innerHTML = "Най-близко начало на отсечка:<br><b style='color:var(--tx)'>" + n.sec.roadName + " · " + n.sec.from + " → " + n.sec.to +
        "</b><br>на " + (n.dist / 1000).toFixed(1).replace(".", ",") + " км по права линия";
    }
  }
  function renderList() {
    $("cnt").textContent = model.sections.length + " направления";
    $("upd").textContent = SS_DATA.updated.split("-").reverse().join(".");
    var tag = function (k) { var s = model.points[k].src; return "<span class='tag " + s + "'>" + (s === "approx" ? "≈" : s === "osm" ? "OSM" : "✓") + "</span>"; };
    $("list").innerHTML = model.sections.map(function (s) {
      return "<div><span>" + s.roadName + ": " + tag(s.fromKey) + " " + s.from + " → " + s.to + " " + tag(s.toKey) +
        (s.upcoming ? " <span class='tag u'>предстояща</span>" : "") + "</span><span class='mut'>" + s.L.toFixed(1).replace(".", ",") + " км · " + s.limit + "</span></div>";
    }).join("");
  }
  var tt;
  function toast(m) { var t = $("toast"); t.textContent = m; t.style.display = "block"; clearTimeout(tt); tt = setTimeout(function () { t.style.display = "none"; }, 3500); }
  function dialog(title, body, yes) {
    $("dlgT").textContent = title; $("dlgB").textContent = body; $("dlg").classList.add("show");
    $("dlgYes").onclick = function () { $("dlg").classList.remove("show"); yes(); };
    $("dlgNo").onclick = function () { $("dlg").classList.remove("show"); };
  }

  // ---------- демо: Трилистник → Опълченец → Чирпан, 20× ускорено ----------
  function demo() {
    stop(); unlockAudio(); keepAwake();
    tracker.reset();
    var P = model.points, A = P["T:Трилистник"].p, B = P["T:Опълченец"].p, Cc = P["T:Чирпан"].p;
    var pre = [A[0] + (A[0] - B[0]) * 0.25, A[1] + (A[1] - B[1]) * 0.25], post = [Cc[0] + (Cc[0] - B[0]) * 0.25, Cc[1] + (Cc[1] - B[1]) * 0.25];
    // междинна точка встрани, така че дължината на пътя = официалната дължина на отсечката
    function bend(a, b, Lkm) {
      var s = SSCore.dist(a, b) / 1000, h = Math.sqrt(Math.max(Lkm * Lkm - s * s, 0)) / 2;
      var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dy = b[0] - a[0], dx = (b[1] - a[1]) * Math.cos(mid[0] * Math.PI / 180), n = Math.hypot(dx, dy);
      return [mid[0] + (dx / n) * h / 111.2, mid[1] - (dy / n) * h / (111.2 * Math.cos(mid[0] * Math.PI / 180))];
    }
    var m1 = bend(A, B, 22.021), m2 = bend(B, Cc, 13.419);
    var legs = [[pre, A, 135], [A, m1, 152], [m1, B, 152], [B, m2, 128], [m2, Cc, 128], [Cc, post, 130]], li = 0, f = 0, t = Date.now();
    $("go").textContent = "Стоп"; $("go").classList.add("on");
    toast("Демо: симулирано пътуване по АМ „Тракия“");
    demoTimer = setInterval(function () {
      var L = legs[li]; if (!L) { stopDemo(); toast("Демото приключи."); return; }
      var m = SSCore.dist(L[0], L[1]), step = L[2] / 3.6 / m;
      f += step; t += 1000;
      var x = Math.min(f, 1);
      onFix({ lat: L[0][0] + (L[1][0] - L[0][0]) * x, lon: L[0][1] + (L[1][1] - L[0][1]) * x, t: t, speed: L[2] / 3.6 + (Math.random() - 0.5), acc: 5 });
      if (f >= 1) { f = 0; li++; }
    }, 50);
  }
  function stopDemo() {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; $("go").textContent = "Старт"; $("go").classList.remove("on"); }
  }

  // ---------- връзки ----------
  $("go").onclick = function () { (watchId != null || demoTimer) ? stop() : start(); };
  $("cal").onclick = calibrate;
  $("setBtn").onclick = function () { $("sheet").classList.add("show"); };
  $("closeSet").onclick = function () { $("sheet").classList.remove("show"); };
  $("introOk").onclick = function () { $("intro").classList.remove("show"); store.set("intro", 1); unlockAudio(); };
  $("margin").value = String(cfg.margin); $("voice").checked = cfg.voice; $("beep").checked = cfg.beep;
  $("margin").onchange = function () { cfg.margin = +this.value; tracker.margin = cfg.margin; store.set("cfg", cfg); };
  $("voice").onchange = function () { cfg.voice = this.checked; store.set("cfg", cfg); };
  $("beep").onchange = function () { cfg.beep = this.checked; store.set("cfg", cfg); };
  $("osmBtn").onclick = function () { loadOsm(true); };
  $("clrBtn").onclick = function () { dialog("Изтриване на калибрациите", "Ще бъдат изтрити " + Object.keys(manual).length + " ръчно записани рамки.", function () { manual = {}; store.set("manual", manual); rebuild(); }); };
  $("demoBtn").onclick = function () { $("sheet").classList.remove("show"); demo(); };
  $("testVoice").onclick = function () { unlockAudio(); beep(1); say("Начало на отсечка Чирпан – Памукчии, ограничение 140."); };
  if (store.get("intro", 0)) $("intro").classList.remove("show");

  rebuild();
  var last = store.get("last", null);
  if (last && Date.now() - last.t < 6 * 3600e3) {
    var res = $("res"); res.hidden = false; res.className = "card result" + (last.avg > last.limit ? " over" : "");
    res.innerHTML = "<h2>Последна отсечка</h2>" + last.road + " · " + last.name + ": <b>" + r0(last.avg) + " км/ч</b>";
  }
  if (/demo/.test(location.hash)) demo();
})();
