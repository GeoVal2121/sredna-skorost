(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  // ---------- нова версия: ако телефонът е запазил стара, презарежда се автоматично ----------
  var APP_VERSION = "2026.11.09-1";
  try {
    fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.v && j.v !== APP_VERSION && sessionStorage.getItem("ss_reload") !== j.v) {
        sessionStorage.setItem("ss_reload", j.v);
        location.replace(location.pathname + "?v=" + encodeURIComponent(j.v) + location.hash);
      }
    }).catch(function () { });
  } catch (e) { }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("ss_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("ss_" + k, JSON.stringify(v)); } catch (e) { } }
  };
  var cfg = Object.assign({ margin: 3, voice: true, beep: true, headUp: true, cams: true }, store.get("cfg", {}));
  var camWatch = new SSCore.CamWatch(window.SS_CAMS || []);
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
    if (window.SSMap) SSMap.refresh();
  }

  // ---------- звук и глас ----------
  var ac = null;
  var primed = false;
  function unlockAudio() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) { }
    // iOS/Android пускат гласа само ако първото изговаряне е при докосване
    try { if (!primed && window.speechSynthesis) { primed = true; var u = new SpeechSynthesisUtterance(" "); u.volume = 0; u.lang = "bg-BG"; speechSynthesis.speak(u); } } catch (e) { }
    loadVoices();
    if (useBuiltin() && window.SSTTS) SSTTS.preload().catch(function () { });
  }
  // ---------- гласове ----------
  // „builtin“ = вграденият български глас; използва се и когато телефонът няма български глас
  function hasBg() { return voices.some(function (v) { return /^bg/i.test(v.lang); }); }
  function useBuiltin() { return !!window.SSTTS && (cfg.voiceName === "builtin" || (!cfg.voiceName && !hasBg()) || !window.speechSynthesis); }
  var voices = [];
  function loadVoices() {
    if (!window.speechSynthesis) return;
    try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var sel = $("voiceSel"); if (!sel) return;
    var bg = voices.filter(function (v) { return /^bg/i.test(v.lang); }), others = voices.filter(function (v) { return !/^bg/i.test(v.lang); });
    sel.innerHTML = (window.SSTTS ? "<option value='builtin'>Вграден български глас</option>" : bg.length ? "" : "<option value=''>Няма български глас</option>") +
      bg.concat(others.slice(0, 40)).map(function (v) { return "<option value='" + v.name.replace(/'/g, "&#39;") + "'>" + v.name + " (" + v.lang + ")</option>"; }).join("");
    var cur = pickVoice(); sel.value = useBuiltin() ? "builtin" : cur ? cur.name : "";
    $("voiceNote").hidden = bg.length > 0;
  }
  function pickVoice() {
    var bg = voices.filter(function (v) { return /^bg/i.test(v.lang); });
    var chosen = cfg.voiceName && cfg.voiceName !== "builtin" && voices.filter(function (v) { return v.name === cfg.voiceName; })[0];
    return chosen || bg.filter(function (v) { return v.localService; })[0] || bg[0] || null;
  }
  if (window.speechSynthesis) try { speechSynthesis.onvoiceschanged = loadVoices; } catch (e) { }
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
    if (!cfg.voice) return;
    if (!voices.length) loadVoices();
    if (useBuiltin() && window.SSTTS) {
      SSTTS.speak(text, urgent, ac).catch(function () { toast("Вграденият глас не се зареди."); });
      return;
    }
    if (!window.speechSynthesis) return;
    try {
      if (urgent) speechSynthesis.cancel();
      if (!voices.length) loadVoices();
      var u = new SpeechSynthesisUtterance(text), v = pickVoice();
      u.lang = v ? v.lang : "bg-BG"; u.rate = 1.0;
      if (v) u.voice = v;
      if (speechSynthesis.paused) speechSynthesis.resume();
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
      say("Внимание, " + (e.approx ? "наближавате" : "след " + kmText(e.dist) + " навлизате в") + " зона за средна скорост " + nm + ". Ограничение " + s.limit + (s.upcoming ? ". Зоната още не е въведена." : "."));
    } else if (e.type === "enter") {
      $("res").hidden = true;
      say("Навлизате в зона за средна скорост " + nm + ". Дължина " + String(Math.round(s.L * 10) / 10).replace(".", ",") + " километра, ограничение " + s.limit + ".", true);
    } else if (e.type === "over") {
      beep(3);
      say("Превишавате средната скорост. Средна " + r0(e.avg) + " при ограничение " + s.limit + "." +
        (e.rec != null && e.rec >= 50 ? " Намалете до " + r0(e.rec) + "." : " До края на зоната вече не може да се компенсира."), true);
    } else if (e.type === "back") {
      say("Средната скорост вече е под ограничението.");
    } else if (e.type === "finish") {
      if (e.over) beep(2);
      say("Напускате зоната за средна скорост. Вашата средна скорост е " + r0(e.avg) + (e.over ? ", над ограничението " + s.limit + "." : ", в рамките на ограничението."), true);
      var res = $("res");
      res.hidden = false; res.className = "card result" + (e.over ? " over" : "");
      res.innerHTML = "<h2>Последна отсечка</h2><div class='sec-name'><div><small>" + s.roadName + "</small>" + nm +
        "</div></div><p style='margin-top:6px;font-size:20px'>Средна: <b style='color:" + (e.over ? "var(--bad)" : "var(--ok)") + "'>" +
        r0(e.avg) + " км/ч</b> <span class='mut'>(ограничение " + s.limit + ", " + r0(e.minutes) + " мин.)</span></p>";
      store.set("last", { name: nm, road: s.roadName, avg: e.avg, limit: s.limit, t: Date.now() });
    } else if (e.type === "abort") {
      say("Напускате зоната за средна скорост " + nm + ".");
      toast("Излязохте от отсечката " + nm);
    }
  }

  // ---------- стационарни камери ----------
  function onCam(e) {
    var lim = e.cam[2];
    if (e.type === "cam") {
      say("Камера за скорост след " + kmText(Math.max(100, e.dist)) + "." + (lim ? " Ограничение " + lim + "." : ""));
      toast("Камера за скорост" + (lim ? " · " + lim + " км/ч" : "") + " · " + e.cam[3]);
    } else if (e.type === "camOver") {
      beep(2); say("Намалете. Ограничение " + lim + ".", true);
    }
  }

  // ---------- позиция ----------
  function onFix(fix) {
    lastFix = fix;
    var evs = tracker.feed(fix);
    evs.forEach(onEvent);
    if (cfg.cams) camWatch.feed({ p: [fix.lat, fix.lon], t: fix.t, speed: tracker.speed, heading: fix.heading }).forEach(onCam);
    render(fix.t);
    var snap = window.SSNav ? SSNav.onFix(fix) : null;
    if (window.SSMap) SSMap.onFix(fix, snap);
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
      onFix({ lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now(), speed: c.speed, acc: c.accuracy, heading: c.heading });
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
    // километражът свети в червено, когато средната в зоната е над лимита; оранжев кант при текуща скорост над лимита
    $("spdBox").classList.toggle("over", !!st && st.status === "over");
    $("spdBox").classList.toggle("fast", !!st && st.status !== "over" && tracker.speed > st.sec.limit);
    if (st) {
      var s = st.sec;
      $("aRoad").textContent = s.roadName + (s.upcoming ? " · предстояща" : "");
      $("aName").textContent = s.from + " → " + s.to;
      $("aLim").textContent = s.limit;
      $("aBar").style.width = Math.min(100, st.trav / s.L * 100) + "%";
      $("aAvg").textContent = st.avg == null ? "–" : r0(st.avg);
      $("aAvgCell").className = "cell big " + st.status;
      $("act").className = "card" + (st.status === "over" ? " over" : "");
      $("aRec").textContent = st.rec == null || st.rec < 50 ? "–" : r0(st.rec);
      $("aRem").textContent = st.remaining.toFixed(1).replace(".", ",");
      $("aPred").textContent = r0(st.predicted);
      $("aTime").textContent = fmtMin(st.elapsedMin);
      var pa = model.points[s.fromKey].src, pb = model.points[s.toKey].src;
      $("aNote").textContent = (pa === "approx" || pb === "approx") ? "Приблизителни рамки: началото и краят може да се отчетат с 1–2 км разлика." : "";
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
    if (window.SSMap) SSMap.resetTrack();
    var P = model.points, A = P["T:Трилистник"].p, B = P["T:Опълченец"].p, Cc = P["T:Чирпан"].p;
    var pre = [A[0] + (A[0] - B[0]) * 0.25, A[1] + (A[1] - B[1]) * 0.25], post = [Cc[0] + (Cc[0] - B[0]) * 0.25, Cc[1] + (Cc[1] - B[1]) * 0.25];
    // междинна точка встрани, така че дължината на пътя = официалната дължина на отсечката
    function bend(a, b, Lkm) {
      var s = SSCore.dist(a, b) / 1000, h = Math.sqrt(Math.max(Lkm * Lkm - s * s, 0)) / 2;
      var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dy = b[0] - a[0], dx = (b[1] - a[1]) * Math.cos(mid[0] * Math.PI / 180), n = Math.hypot(dx, dy);
      return [mid[0] + (dx / n) * h / 111.2, mid[1] - (dy / n) * h / (111.2 * Math.cos(mid[0] * Math.PI / 180))];
    }
    var legs;
    if (window.SS_GEO && SS_GEO[6] && SS_GEO[7]) { // по реалния път: Трилистник → Опълченец → Чирпан
      legs = [[pre, A, 135]];
      [[6, 152], [7, 128]].forEach(function (x) {
        var pts = SSCore.decodePolyline(SS_GEO[x[0]]);
        for (var i = 1; i < pts.length; i++) legs.push([pts[i - 1], pts[i], x[1]]);
      });
      legs.push([Cc, post, 130]);
    } else {
      var m1 = bend(A, B, 22.021), m2 = bend(B, Cc, 13.419);
      legs = [[pre, A, 135], [A, m1, 152], [m1, B, 152], [B, m2, 128], [m2, Cc, 128], [Cc, post, 130]];
    }
    var li = 0, f = 0, t = Date.now();
    $("go").textContent = "Стоп"; $("go").classList.add("on");
    toast("Демо: симулирано пътуване по АМ „Тракия“");
    demoTimer = setInterval(function () {
      var L = legs[li]; if (!L) { stopDemo(); toast("Демото приключи."); return; }
      var rest = L[2] / 3.6, v = L[2]; // метри за 1 секунда; продължава през късите участъци
      while (L) {
        var m = SSCore.dist(L[0], L[1]) || 0.01, left = (1 - f) * m;
        if (rest < left) { f += rest / m; break; }
        rest -= left; f = 0; li++; L = legs[li];
      }
      t += 1000;
      if (!L) { L = legs[legs.length - 1]; f = 1; }
      onFix({ lat: L[0][0] + (L[1][0] - L[0][0]) * f, lon: L[0][1] + (L[1][1] - L[0][1]) * f, t: t, speed: v / 3.6 + (Math.random() - 0.5), acc: 5 });
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
  $("margin").value = String(cfg.margin); $("voice").checked = cfg.voice; $("beep").checked = cfg.beep; $("headUp").checked = cfg.headUp; $("camsOn").checked = cfg.cams;
  $("camsOn").onchange = function () { cfg.cams = this.checked; store.set("cfg", cfg); if (window.SSMap) SSMap.refresh(); };
  $("headUp").onchange = function () { cfg.headUp = this.checked; store.set("cfg", cfg); if (window.SSMap) SSMap.recenter(); };
  $("margin").onchange = function () { cfg.margin = +this.value; tracker.margin = cfg.margin; store.set("cfg", cfg); };
  $("voice").onchange = function () { cfg.voice = this.checked; store.set("cfg", cfg); };
  $("beep").onchange = function () { cfg.beep = this.checked; store.set("cfg", cfg); };
  $("osmBtn").onclick = function () { loadOsm(true); };
  $("clrBtn").onclick = function () { dialog("Изтриване на калибрациите", "Ще бъдат изтрити " + Object.keys(manual).length + " ръчно записани рамки.", function () { manual = {}; store.set("manual", manual); rebuild(); }); };
  $("demoBtn").onclick = function () { $("sheet").classList.remove("show"); demo(); };
  $("testVoice").onclick = function () { unlockAudio(); beep(1); say("След 500 метра завийте надясно. Начало на отсечка Чирпан – Памукчии, ограничение 140.", true); };
  $("voiceSel").onchange = function () { cfg.voiceName = this.value || null; store.set("cfg", cfg); say("Здравейте. Това е гласът за навигация.", true); };
  loadVoices();
  if (store.get("intro", 0)) $("intro").classList.remove("show");

  window.SSApp = { model: function () { return model; }, tracker: function () { return tracker; }, cfg: cfg, toast: toast, say: say,
    mapCenter: function () { return window.SSMap ? SSMap.center() : null; },
    ensureRunning: function () { if (watchId == null && !demoTimer) start(); },
    render: function () { render(Date.now()); } };
  rebuild();
  var last = store.get("last", null);
  if (last && Date.now() - last.t < 6 * 3600e3) {
    var res = $("res"); res.hidden = false; res.className = "card result" + (last.avg > last.limit ? " over" : "");
    res.innerHTML = "<h2>Последна отсечка</h2>" + last.road + " · " + last.name + ": <b>" + r0(last.avg) + " км/ч</b>";
  }
  if (/demo/.test(location.hash)) demo();
})();
