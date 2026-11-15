# GPS and arrow direction — 2026-11-15

Version 2026.11.15-2. Local implementation and technical QA PASS. Device/road acceptance pending. Not deployed.

## Confirmed defects
- roadSnap positioned the trail, but the marker still used raw GPS coordinates.
- Direction fallback compared only consecutive fixes with an 8 m threshold, losing repeated small movements.
- Extrapolation continued for up to 60 seconds on a route, including a route merely previewed or no longer followed.
- Marker pitch alignment was viewport-based while its bearing was map-based, producing an incorrect screen direction on tilted maps.
- Tracker rejected accuracy over 100 m, but app still passed those fixes to map/navigation. Missing accuracy was displayed as zero.

## Corrections
Shared app ingress validates coordinates, time, accuracy and chronological order. Rejects positions older than 5 s, accuracy over 100 m and displacements exceeding 90 m/s plus reported uncertainty. Invalid optional speed becomes null. These checks apply before tracker, map, navigation and camera warnings. Accelerated demo state resets on exit so simulated future timestamps cannot block subsequent real fixes.

Map course uses finite device travel bearing above 2 m/s with accuracy at most 30 m. Otherwise it accumulates displacement beyond max(8 m, sum of endpoint accuracy radii). Explicit stationary speed below 0.7 m/s preserves direction; inaccurate fixes do not set heading. Heading anchors expire after 15 s.

The marker uses the matched road point and oriented tangent; perpendicular road candidates are excluded. Matching remains bounded to 20 m. Route preview does not snap GPS; active route snap requires accuracy at most 30 m, and the marker rejects route direction mismatches over 50 degrees. Stale/off-route geometry is not used to predict movement. Pitch and rotation are both map-aligned. Prediction follows matched geometry for at most 1.5 s, then holds position; stale/uncertain markers are dimmed.

## Verification
- All seven node tests in tests/*.test.cjs pass, including new tests/gps-direction.test.cjs.
- New regression check covers cumulative slow movement, stationary jitter, weak accuracy, both road directions, perpendicular intersections, opposite/stale routes, duplicate vertices, corners, 60 s GPS outage, invalid/old/out-of-order/jumping fixes, preview/weak navigation and demo exit.
- Changed app.js, map.js, nav.js parse successfully.
- audit/gps-browser-check.cjs: local Chromium, actual app GPS callback through tracker/navigation to rendered MapLibre marker; synthetic road, all external requests blocked. Marker screen direction dot product against projected road exceeds 0.999 at pitches 0/50 and bearings 0/45/135. Snapped position lies on road; no uncaught JS errors. Signal outage stops movement and shows missing-GPS status.
- audit/gps-arrow-3d.png visually inspected. Test harness uses preinstalled Playwright path in its first line.

## Limits and device acceptance
This is not a measurement or improvement of the phone GNSS receiver accuracy. High-accuracy requests were already enabled with maximumAge 0. Reported accuracy is an uncertainty estimate, not a proven error or lane-level guarantee. Nearest-road matching cannot reliably distinguish close parallel roads, stacked roads, or junctions from ambiguous GPS alone; missing tiles disable road matching. Thresholds are explicit heuristics needing field validation, not calibrated guarantees. Poor/unknown direction retains the last reliable bearing rather than inventing one.

Physical iPhone/Android road test still needed: straight roads, bends, opposite direction, stops, slow movement, parallel roads and loss/recovery of signal, with an independent reference track. No real trip or personal GPS trace collected. Root and publish files synchronized locally; no Git mutation/deployment.

References: https://www.w3.org/TR/geolocation/ (travel heading/accuracy); https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MarkerOptions/ (pitch/rotation alignment).
