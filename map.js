// Карта (MapLibre + OpenFreeMap): позиция, посока, рамки, отсечки, изминат път.
(function () {
  "use strict";
  var App = window.SSApp, $ = function (id) { return document.getElementById(id); };
  var map = null, ready = false, follow = true, track = [], car = null, carEl = null;
  var heading = 0, lastP = null, lastActiveId = null, offline = false, handlers = false;
  var COL = { approx: "#f5b041", osm: "#4da3ff", manual: "#2ecc71" };

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
      f.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[m.points[s.fromKey].p[1], m.points[s.fromKey].p[0]], [m.points[s.toKey].p[1], m.points[s.toKey].p[0]]] },
        properties: { act: act ? 1 : 0, name: s.roadName + ": " + s.from + " – " + s.to, L: s.L, limit: s.limit, up: s.upcoming ? 1 : 0 } });
    });
    return { type: "FeatureCollection", features: f };
  }
  function trackGeo() { return { type: "Feature", geometry: { type: "LineString", coordinates: track.length > 1 ? track : [] }, properties: {} }; }

  function init() {
    if (!window.maplibregl) { App.toast("Картата не се зареди. Следенето работи и без нея."); return; }
    try {
      map = new maplibregl.Map({
        container: "map", style: "https://tiles.openfreemap.org/styles/dark",
        center: [25.4, 42.7], zoom: 6.2, attributionControl: { compact: true }, maxPitch: 60
      });
    } catch (e) { App.toast("Картата не се поддържа от този браузър."); return; }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    // без интернет/плочки: празен тъмен фон, но рамките, отсечките и пътят пак се виждат
    var fallback = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#10151c" } }] };
    var fbTimer = setTimeout(function () { if (!ready) { offline = true; map.setStyle(fallback); } }, 15000);
    map.on("error", function (e) { if (!ready && !offline && /styles\/dark/.test(String(e && e.error && e.error.message))) { clearTimeout(fbTimer); offline = true; map.setStyle(fallback); } });
    map.on("style.load", function () {
      if (map.getSource("secs")) return;
      map.addSource("secs", { type: "geojson", data: sectionsGeo(null) });
      map.addSource("pts", { type: "geojson", data: pointsGeo() });
      map.addSource("trk", { type: "geojson", data: trackGeo() });
      map.addLayer({ id: "secs", type: "line", source: "secs", layout: { "line-cap": "round" },
        paint: { "line-color": ["case", ["==", ["get", "act"], 1], "#ff4d4d", ["==", ["get", "up"], 1], "#8a7a50", "#e0a030"],
          "line-width": ["case", ["==", ["get", "act"], 1], 7, 4], "line-opacity": 0.85, "line-dasharray": [2, 1.2] } });
      map.addLayer({ id: "trk", type: "line", source: "trk", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#4da3ff", "line-width": 5, "line-opacity": 0.8 } });
      map.addLayer({ id: "pts", type: "circle", source: "pts",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 8, 16, 11], "circle-color": ["get", "col"],
          "circle-stroke-color": "#111", "circle-stroke-width": 2 } });
      if (!offline) map.addLayer({ id: "pts-lbl", type: "symbol", source: "pts", minzoom: 9,
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#e8eef5", "text-halo-color": "#000", "text-halo-width": 1.5 } });
      map.on("click", "pts", function (e) {
        var p = e.features[0].properties, srcT = p.src === "approx" ? "приблизителна (по населеното място)" : p.src === "osm" ? "от OpenStreetMap" : "калибрирана от теб";
        new maplibregl.Popup({ offset: 10 }).setLngLat(e.lngLat)
          .setHTML("<b>" + p.name + "</b><br>" + p.road + (p.km != null ? ", км " + String(p.km).replace(".", ",") : "") + "<br><span style='color:#8696a8'>Позиция: " + srcT + "</span>").addTo(map);
      });
      map.on("click", "secs", function (e) {
        var p = e.features[0].properties;
        new maplibregl.Popup({ offset: 6 }).setLngLat(e.lngLat)
          .setHTML("<b>" + p.name + "</b><br>" + String((+p.L).toFixed(1)).replace(".", ",") + " км · ограничение " + p.limit + (p.up == 1 ? "<br>предстояща" : "")).addTo(map);
      });
      if (handlers) { ready = true; refresh(); return; }
      handlers = true;
      ["pts", "secs"].forEach(function (l) {
        map.on("mouseenter", l, function () { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; });
      });
      ready = true;
    });
    // ръчно местене на картата спира следването
    map.on("dragstart", function () { setFollow(false); });
    map.on("rotatestart", function (e) { if (e.originalEvent) setFollow(false); });
    carEl = document.createElement("div");
    carEl.className = "car";
    carEl.innerHTML = '<svg viewBox="0 0 48 48" width="48" height="48"><defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.8" flood-color="#000" flood-opacity=".55"/></filter></defs><path d="M24 5 L39 40 L24 32 L9 40 Z" fill="#1a73e8" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" filter="url(#sh)"/></svg>';
    $("center").onclick = function () { setFollow(true); recenter(); };
  }

  function setFollow(on) { follow = on; $("center").classList.toggle("off", !on); }

  function bearingDeg(a, b) {
    var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r),
      x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  function onFix(fix) {
    if (!map) return;
    var p = [fix.lat, fix.lon];
    if (fix.heading != null && !isNaN(fix.heading) && (fix.speed || 0) > 2) heading = fix.heading;
    else if (lastP && SSCore.dist(lastP, p) > 8) heading = bearingDeg(lastP, p);
    if (!lastP || SSCore.dist(lastP, p) > 8) {
      lastP = p;
      track.push([fix.lon, fix.lat]); if (track.length > 6000) track.shift();
    }
    if (!car) car = new maplibregl.Marker({ element: carEl, rotationAlignment: "map", pitchAlignment: "viewport" }).setLngLat([fix.lon, fix.lat]).addTo(map);
    car.setLngLat([fix.lon, fix.lat]).setRotation(heading);
    if (ready) {
      map.getSource("trk").setData(trackGeo());
      var st = App.tracker().active, id = st ? st.sec.id : null;
      if (id !== lastActiveId) { lastActiveId = id; map.getSource("secs").setData(sectionsGeo(id)); }
    }
    if (follow) recenter(true);
  }

  function recenter(soft) {
    if (!map || !lastP) return;
    var up = App.cfg.headUp, moving = App.tracker().speed > 8;
    var now = Date.now(), dur = soft ? Math.min(900, (now - (recenter.t || 0)) * 0.9) : 600;
    recenter.t = now;
    if (map.getZoom() < 12) { map.jumpTo({ center: [lastP[1], lastP[0]], zoom: 15 }); dur = 0; }
    var opt = { center: [lastP[1], lastP[0]], duration: dur,
      bearing: up ? (moving ? heading : map.getBearing()) : 0, pitch: up ? 50 : 0,
      padding: { top: 120, bottom: 220, left: 0, right: 0 } };
    map.easeTo(opt);
  }

  function refresh() {
    if (!ready) return;
    map.getSource("pts").setData(pointsGeo());
    map.getSource("secs").setData(sectionsGeo(lastActiveId));
  }
  function resetTrack() { track = []; lastP = null; if (ready) map.getSource("trk").setData(trackGeo()); setFollow(true); }

  window.SSMap = { onFix: onFix, refresh: refresh, recenter: function () { setFollow(true); recenter(); }, resetTrack: resetTrack };
  init();
})();
