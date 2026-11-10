// Карта (MapLibre + OpenFreeMap): позиция, посока, рамки, отсечки, изминат път.
(function () {
  "use strict";
  var App = window.SSApp, $ = function (id) { return document.getElementById(id); };
  var map = null, ready = false, follow = true, track = [], car = null, carEl = null;
  var heading = 0, lastP = null, lastActiveId = null, offline = false, handlers = false;
  var routeLine = null, destMarker = null, touching = false, refollowT = null, userZoomUntil = 0, pressT = null, pressXY = null;
  var geoCache = {}, isDark = !!App.isDark(), fallback = null;
  function styleUrl(d) { return "https://tiles.openfreemap.org/styles/" + (d ? "fiord" : "liberty"); }
  // смяна светло/тъмно: новият стил минава пак през style.load и слоевете ни се добавят наново
  function setTheme(d) {
    if (d === isDark) return;
    isDark = d;
    if (!map) return;
    ready = false;
    map.setStyle(offline ? fallback() : styleUrl(d), { diff: false });
  }
  var COL = { approx: "#f29900", osm: "#1a73e8", manual: "#188038" };

  function pointsGeo() {
    var m = App.model(), km = {}, f = [];
    SS_DATA.sections.forEach(function (r) { km[r[0] + ":" + r[1]] = r[2]; km[r[0] + ":" + r[3]] = r[4]; });
    for (var k in m.points) {
      var p = m.points[k], parts = k.split(":");
      f.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.p[1], p.p[0]] },
        properties: { key: k, name: parts.slice(1).join(":"), road: SS_DATA.roads[parts[0]], km: km[k], src: p.src, col: COL[p.src] } });
    }
    return { type: "FeatureCollection", features: f };
  }
  function sectionsGeo(activeId) {
    var m = App.model(), seen = {}, f = [];
    m.sections.forEach(function (s) {
      var pair = [s.fromKey, s.toKey].sort().join("|"), act = s.id === activeId;
      if (seen[pair] && !act) return; seen[pair] = 1;
      var idx = parseInt(s.id, 10), enc = window.SS_GEO && SS_GEO[idx];
      var coords = enc ? geoCache[idx] || (geoCache[idx] = SSCore.decodePolyline(enc).map(function (q) { return [q[1], q[0]]; }))
        : [[m.points[s.fromKey].p[1], m.points[s.fromKey].p[0]], [m.points[s.toKey].p[1], m.points[s.toKey].p[0]]];
      f.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords },
        properties: { act: act ? 1 : 0, name: s.roadName + ": " + s.from + " – " + s.to, L: s.L, limit: s.limit, up: s.upcoming ? 1 : 0 } });
    });
    return { type: "FeatureCollection", features: f };
  }
  function camsGeo() {
    var on = App.cfg.cams !== false;
    return { type: "FeatureCollection", features: on ? (window.SS_CAMS || []).map(function (c) {
      return { type: "Feature", geometry: { type: "Point", coordinates: [c[1], c[0]] }, properties: { lim: c[2] ? String(c[2]) : "", town: c[3], loc: c[4] } };
    }) : [] };
  }
  function camIcon() { // тъмен квадрат с бяла камера, 2x
    var cv = document.createElement("canvas"); cv.width = cv.height = 52; var g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(2, 2, 48, 48, 12); g.fill();
    g.fillStyle = "#3c4043"; g.beginPath(); g.roundRect(6, 6, 40, 40, 9); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(12, 18, 22, 16, 3); g.fill();
    g.beginPath(); g.moveTo(34, 23); g.lineTo(42, 18); g.lineTo(42, 34); g.lineTo(34, 29); g.closePath(); g.fill();
    g.fillStyle = "#3c4043"; g.beginPath(); g.arc(20, 26, 4, 0, 7); g.fill();
    var d = g.getImageData(0, 0, 52, 52); return { width: 52, height: 52, data: d.data };
  }
  function trackGeo() { return { type: "Feature", geometry: { type: "LineString", coordinates: track.length > 1 ? track : [] }, properties: {} }; }

  function init() {
    if (!window.maplibregl) { App.toast("Картата не се зареди. Следенето работи и без нея."); return; }
    try {
      map = new maplibregl.Map({
        container: "map", style: styleUrl(App.isDark()),
        center: [25.4, 42.7], zoom: 6.2, attributionControl: { compact: true }, maxPitch: 60
      });
    } catch (e) { App.toast("Картата не се поддържа от този браузър."); return; }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    // без интернет/плочки: празен тъмен фон, но рамките, отсечките и пътят пак се виждат
    fallback = function () { return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": isDark ? "#2b3550" : "#eef1f4" } }] }; };
    var fbTimer = setTimeout(function () { if (!ready) { offline = true; map.setStyle(fallback()); } }, 15000);
    map.on("error", function (e) { if (!ready && !offline && /styles\/(liberty|fiord)/.test(String(e && e.error && e.error.message))) { clearTimeout(fbTimer); offline = true; map.setStyle(fallback()); } });
    map.on("style.load", function () {
      if (map.getSource("secs")) return;
      map.addSource("secs", { type: "geojson", data: sectionsGeo(null) });
      map.addSource("pts", { type: "geojson", data: pointsGeo() });
      map.addSource("trk", { type: "geojson", data: trackGeo() });
      map.addSource("route", { type: "geojson", data: routeGeo() });
      // линиите под надписите и номерата на пътищата от картата
      // над пътищата, под надписите (в някои стилове има надписи и преди пътищата)
      var ls = map.getStyle().layers || [], lastRoad = -1;
      ls.forEach(function (l, i) { if (l.type === "line" && /highway|road|transportation|motorway/.test(l.id)) lastRoad = i; });
      var sym = ls.filter(function (l, i) { return l.type === "symbol" && i > lastRoad; })[0], below = sym ? sym.id : undefined;
      var addBelow = function (l) { map.addLayer(l, below); };
      addBelow({ id: "route-case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1557b0", "line-width": 11, "line-opacity": 0.9 } });
      addBelow({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#4b8ef5", "line-width": 7 } });
      addBelow({ id: "secs", type: "line", source: "secs", layout: { "line-cap": "round" },
        paint: { "line-color": ["case", ["==", ["get", "act"], 1], "#d93025", ["==", ["get", "up"], 1], "#a08a5a", "#e8710a"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["==", ["get", "act"], 1], 8, 6],
            14, ["case", ["==", ["get", "act"], 1], 12, 10], 17, ["case", ["==", ["get", "act"], 1], 26, 22]], "line-opacity": 0.75 } });
      addBelow({ id: "trk", type: "line", source: "trk", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": isDark ? "#8c95ab" : "#9aa0a6", "line-width": 5, "line-opacity": 0.8 } });
      // стационарни камери: икона + ограничение
      if (!map.hasImage("cam")) map.addImage("cam", camIcon(), { pixelRatio: 2 });
      map.addSource("cams", { type: "geojson", data: camsGeo() });
      map.addLayer({ id: "cams", type: "symbol", source: "cams", minzoom: 8,
        layout: { "icon-image": "cam", "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 1], "icon-allow-overlap": true,
          "text-field": offline ? "" : ["get", "lim"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": isDark ? "#ff8a80" : "#d93025", "text-halo-color": isDark ? "#26314f" : "#fff", "text-halo-width": 1.8 } });
      map.addLayer({ id: "pts", type: "circle", source: "pts",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 8, 16, 11], "circle-color": ["get", "col"],
          "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });
      if (!offline) map.addLayer({ id: "pts-lbl", type: "symbol", source: "pts", minzoom: 9,
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": isDark ? "#e8eaed" : "#1f2933", "text-halo-color": isDark ? "#26314f" : "#fff", "text-halo-width": 1.8 } });
      if (handlers) { ready = true; refresh(); return; }
      handlers = true;
      map.on("click", "pts", function (e) {
        var p = e.features[0].properties, srcT = p.src === "approx" ? "приблизителна (по населеното място)" : p.src === "osm" ? "от OpenStreetMap" : "калибрирана от теб";
        new maplibregl.Popup({ offset: 10 }).setLngLat(e.lngLat)
          .setHTML("<b>" + p.name + "</b><br>" + p.road + (p.km != null ? ", км " + String(p.km).replace(".", ",") : "") + "<br><span style='color:#5f6b7a'>Позиция: " + srcT + "</span>").addTo(map);
      });
      map.on("click", "secs", function (e) {
        var p = e.features[0].properties;
        new maplibregl.Popup({ offset: 6 }).setLngLat(e.lngLat)
          .setHTML("<b>" + p.name + "</b><br>" + String((+p.L).toFixed(1)).replace(".", ",") + " км · ограничение " + p.limit + (p.up == 1 ? "<br>предстояща" : "")).addTo(map);
      });
      map.on("click", "cams", function (e) {
        var p = e.features[0].properties;
        new maplibregl.Popup({ offset: 14 }).setLngLat(e.lngLat)
          .setHTML("<b>Стационарна камера</b><br>" + p.town + ", " + p.loc + (p.lim ? "<br>Ограничение <b>" + p.lim + " км/ч</b>" : "") + "<br><span style='color:#5f6b7a'>Източник: OpenStreetMap</span>").addTo(map);
      });
      ["pts", "secs", "cams"].forEach(function (l) {
        map.on("mouseenter", l, function () { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; });
      });
      ready = true;
    });
    // ръчно местене на картата спира следването
    // местене с пръст спира следването за 8 сек.; мащабиране/въртене не го спират
    map.on("dragstart", function () { setFollow(false); });
    map.on("zoomstart", function (e) { if (e.originalEvent) userZoomUntil = Date.now() + 20000; });
    var cv = map.getCanvasContainer();
    cv.addEventListener("touchstart", function (e) {
      touching = true; clearTimeout(pressT);
      if (e.touches.length !== 1) return;
      var t = e.touches[0], rc = cv.getBoundingClientRect(); pressXY = [t.clientX - rc.left, t.clientY - rc.top];
      pressT = setTimeout(function () { longPress(pressXY); }, 650);
    }, { passive: true });
    cv.addEventListener("touchmove", function (e) {
      if (!pressXY || !e.touches[0]) return; var t = e.touches[0], rc = cv.getBoundingClientRect();
      if (Math.abs(t.clientX - rc.left - pressXY[0]) + Math.abs(t.clientY - rc.top - pressXY[1]) > 12) clearTimeout(pressT);
    }, { passive: true });
    cv.addEventListener("touchend", function () { touching = false; clearTimeout(pressT); }, { passive: true });
    cv.addEventListener("mousedown", function () { touching = true; });
    window.addEventListener("mouseup", function () { touching = false; });
    map.on("contextmenu", function (e) { longPress([e.point.x, e.point.y]); });
    carEl = document.createElement("div");
    carEl.className = "car";
    carEl.innerHTML = '<svg viewBox="0 0 64 64" width="64" height="64"><defs><radialGradient id="carsh"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".55" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".5"/></filter></defs><circle cx="32" cy="34" r="24" fill="url(#carsh)"/><path d="M32 13 L47 48 L32 40 L17 48 Z" fill="#1a73e8" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" filter="url(#sh)"/></svg>';
    $("center").onclick = function () { setFollow(true); recenter(); };
  }

  function setFollow(on) {
    follow = on; $("center").classList.toggle("off", !on); clearTimeout(refollowT);
    if (!on) refollowT = setTimeout(function () { if (window.SSNav && SSNav.hasRoute() && !SSNav.active()) return; if (!touching) { setFollow(true); recenter(); } else setFollow(false); }, 8000);
  }
  function longPress(xy) {
    if (!window.SSNav) return;
    var ll = map.unproject(xy); if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { }
    SSNav.onLongPress([ll.lat, ll.lng]);
  }
  // показва се само оставащият път: от текущата позиция до края
  var routeFrom = 0, routeHead = null;
  function routeGeo() {
    if (!routeLine) return { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} };
    var c = routeLine.slice(routeFrom + (routeHead ? 1 : 0)).map(function (q) { return [q[1], q[0]]; });
    if (routeHead) c.unshift([routeHead[1], routeHead[0]]);
    return { type: "Feature", geometry: { type: "LineString", coordinates: c.length > 1 ? c : [] }, properties: {} };
  }
  function trimRoute(p) {
    if (!routeLine || routeLine.length < 2) return;
    var k = Math.cos(p[0] * Math.PI / 180), best = -1, bd = Infinity, bq = null;
    function scan(i0, i1) {
      for (var i = i0; i < i1; i++) {
        var a = routeLine[i], b = routeLine[i + 1], ax = a[1] * k, ay = a[0], dx = b[1] * k - ax, dy = b[0] - ay, l = dx * dx + dy * dy;
        var t = l ? Math.max(0, Math.min(1, ((p[1] * k - ax) * dx + (p[0] - ay) * dy) / l)) : 0, q = [ay + t * dy, (ax + t * dx) / k], d = SSCore.dist(p, q);
        if (d < bd) { bd = d; best = i; bq = q; }
      }
    }
    scan(routeFrom, Math.min(routeLine.length - 1, routeFrom + 300)); // напред от последната позиция
    if (bd > 60) scan(0, routeLine.length - 1);                          // след отклонение / нов маршрут
    if (bd > 60) return;
    routeFrom = best; routeHead = bq;
    if (ready) map.getSource("route").setData(routeGeo());
  }

  function bearingDeg(a, b) {
    var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r),
      x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  // ---------- плавно движение: стрелката и камерата се интерполират между GPS точките ----------
  // без закъснение: стрелката се плъзга ~0,35 с към новата точка и продължава напред със скоростта и посоката (до 1,2 с без нов сигнал)
  var anim = { from: null, to: null, h0: 0, h1: 0, t0: 0, dur: 350, lastFix: 0, v: 0, vh: 0 }, raf = null, camBearing = null, easing = false;
  function ahead(p, h, d) {
    var r = h * Math.PI / 180;
    return [p[0] + d * Math.cos(r) / 111320, p[1] + d * Math.sin(r) / (111320 * Math.cos(p[0] * Math.PI / 180))];
  }
  function lerpAngle(a, b, t) { var d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; }
  function animPos(now) {
    var t = Math.min(1, (now - anim.t0) / anim.dur), f = anim.from, g = anim.to;
    if (anim.v > 0.7) g = ahead(g, anim.vh, anim.v * Math.min(1.2, (now - anim.t0) / 1000));
    return { p: [f[0] + (g[0] - f[0]) * t, f[1] + (g[1] - f[1]) * t], h: lerpAngle(anim.h0, anim.h1, t), t: t };
  }
  function pad() { return { top: Math.round(map.getCanvas().clientHeight * 0.5), bottom: 100, left: 0, right: 0 }; } // стрелката в долната трета
  function frame() {
    raf = null; if (!anim.to) return;
    var now = performance.now(), c = animPos(now);
    car.setLngLat([c.p[1], c.p[0]]).setRotation(c.h);
    if (follow && !touching && !easing) {
      var up = App.cfg.headUp, moving = App.tracker().speed > 8;
      if (camBearing == null) camBearing = map.getBearing();
      camBearing = up ? (moving ? lerpAngle(camBearing, c.h, 0.12) : camBearing) : lerpAngle(camBearing, 0, 0.12);
      var opt = { center: [c.p[1], c.p[0]], bearing: camBearing, pitch: map.getPitch() + ((up ? 50 : 0) - map.getPitch()) * 0.1, padding: pad() };
      var z = map.getZoom();
      if (z < 12) opt.zoom = 15;
      else if (window.SSNav && SSNav.active() && Date.now() > userZoomUntil) {
        var v = App.tracker().speed, tz = v > 90 ? 15 : v > 50 ? 16 : 17; opt.zoom = z + (tz - z) * 0.03;
      }
      map.jumpTo(opt);
    }
    // анимира докато има движение; спира, ако GPS мълчи над 3 сек.
    if (c.t < 1 || now - anim.lastFix < 3000) raf = requestAnimationFrame(frame);
  }

  function onFix(fix, snap) {
    if (!map) return;
    var p = snap || [fix.lat, fix.lon];
    if (fix.heading != null && !isNaN(fix.heading) && (fix.speed || 0) > 2) heading = fix.heading;
    else if (lastP && SSCore.dist(lastP, p) > 8) heading = bearingDeg(lastP, p);
    var moved = !lastP || SSCore.dist(lastP, p) > 8;
    lastP = p;
    trimRoute(p);
    // следа само от точни позиции (или прилепени към маршрута)
    if (moved && (snap || !fix.acc || fix.acc <= 25)) { track.push([p[1], p[0]]); if (track.length > 6000) track.shift(); }
    if (!car) car = new maplibregl.Marker({ element: carEl, rotationAlignment: "map", pitchAlignment: "viewport" }).setLngLat([p[1], p[0]]).addTo(map);
    var now = performance.now(), cur = anim.to ? animPos(now) : { p: p, h: heading };
    if (anim.to && SSCore.dist(cur.p, p) > 2000) cur = { p: p, h: heading }; // голям скок (демо, нов маршрут) — без анимация
    anim.from = cur.p; anim.h0 = cur.h; anim.to = p; anim.h1 = heading; anim.t0 = now;
    anim.v = (App.tracker().speed || 0) / 3.6; anim.vh = heading; anim.lastFix = now;
    if (!raf) raf = requestAnimationFrame(frame);
    if (ready) {
      map.getSource("trk").setData(trackGeo());
      var st = App.tracker().active, id = st ? st.sec.id : null;
      if (id !== lastActiveId) { lastActiveId = id; map.getSource("secs").setData(sectionsGeo(id)); }
    }
  }

  function recenter() {
    if (!map || !anim.to) return;
    var c = animPos(performance.now()), up = App.cfg.headUp;
    camBearing = up ? c.h : 0; easing = true;
    map.easeTo({ center: [c.p[1], c.p[0]], bearing: camBearing, pitch: up ? 50 : 0, zoom: Math.max(map.getZoom(), 15), padding: pad(), duration: 600 });
    map.once("moveend", function () { easing = false; if (!raf) raf = requestAnimationFrame(frame); });
  }

  function refresh() {
    if (!ready) return;
    map.getSource("pts").setData(pointsGeo());
    if (map.getSource("cams")) map.getSource("cams").setData(camsGeo());
    map.getSource("secs").setData(sectionsGeo(lastActiveId));
  }
  function resetTrack() { track = []; lastP = null; anim.to = null; anim.lastFix = 0; if (ready) map.getSource("trk").setData(trackGeo()); setFollow(true); }

  // вид на пътя под точката и дали е в населено място (жилищна зона или сгради наоколо) – от картата
  function roadAt(p) {
    if (!map || !ready || offline) return null;
    var c = map.project([p[1], p[0]]), cls = null, urban = false, bld = 0;
    map.queryRenderedFeatures([[c.x - 6, c.y - 6], [c.x + 6, c.y + 6]]).forEach(function (f) {
      if (f.sourceLayer === "transportation" && !cls) cls = f.properties["class"];
    });
    map.queryRenderedFeatures([[c.x - 60, c.y - 60], [c.x + 60, c.y + 60]]).forEach(function (f) {
      if (f.sourceLayer === "landuse" && f.properties["class"] === "residential") urban = true;
      if (f.sourceLayer === "building") bld++;
    });
    return { cls: cls, urban: urban || bld >= 3 };
  }

  function setRoute(line, fit) {
    routeLine = line; routeFrom = 0; routeHead = null; if (ready) map.getSource("route").setData(routeGeo());
    if (line && fit && map) {
      var b = new maplibregl.LngLatBounds(); line.forEach(function (q) { b.extend([q[1], q[0]]); });
      setFollow(false); clearTimeout(refollowT);
      map.fitBounds(b, { padding: { top: 90, bottom: 300, left: 40, right: 40 }, bearing: 0, pitch: 0, duration: 700 });
    }
  }
  function setDest(p) {
    if (destMarker) { destMarker.remove(); destMarker = null; }
    if (p && map) destMarker = new maplibregl.Marker({ color: "#d93025" }).setLngLat([p[1], p[0]]).addTo(map);
  }
  function center() { if (!map) return null; var c = map.getCenter(); return [c.lat, c.lng]; }

  window.SSMap = { onFix: onFix, refresh: refresh, recenter: function () { setFollow(true); recenter(); }, resetTrack: resetTrack,
    setRoute: setRoute, setDest: setDest, center: center, setTheme: setTheme, roadAt: roadAt, follow: function () { setFollow(true); recenter(); } };
  init();
})();
