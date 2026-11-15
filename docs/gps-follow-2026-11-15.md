# Forward-facing follow camera — 2026-11-15

Version 2026.11.15-3. Local technical PASS; not deployed. Physical phone acceptance pending.

User reported the marker moving along the road while the map remained fixed. The prior browser check deliberately disabled follow to verify world-space marker alignment; it did not establish the requested forward-facing driving experience.

Confirmed code paths: camera bearing was gated above 8 km/h; Start did not restore follow or a saved north-up preference; touchcancel was not handled; recenter held a separate easing flag until a moveend listener registered after easeTo. These are reproduced/tested code behaviors, not remote telemetry from the user's phone.

Changes:
- Start and demo enable and persist travel-direction mode, update its checkbox and restore following. The user can still explicitly select north-up afterward.
- Camera and marker use the same already-interpolated course, including low-speed reliable direction. No second lagging camera interpolation. Unknown bearing preserves camera orientation; stationary heading remains stable.
- Touch cancellation and window blur release interaction state. Explicit follow/recenter clears stale touch state.
- Recenter stops existing camera animation and updates immediately; no moveend/easing latch can block following.
- Existing map padding retains the marker below center with road ahead. Selected 2D/3D pitch remains respected.

Validation:
- All seven tests/*.test.cjs checks PASS; map-controls now exercises slow travel, turns, stop, north-up, unknown bearing and recenter without requiring moveend.
- audit/gps-follow-check.cjs PASS: local Chromium with synthetic road and GPS callback, no external requests. Begins with saved headUp:false and interrupted follow; Start restores course-up. At 1 m/s, cumulative positions without native heading reverse course to west; map follows to 270 degrees and rendered marker points up. Touchstart/touchcancel and recenter recover. No page errors.
- audit/gps-follow-forward.png inspected: marker facing screen-up, below center, road ahead at displayed 4 km/h.
- Existing audit/gps-browser-check.cjs still passes projected marker alignment for pitches 0/50 and bearings 0/45/135, plus bounded signal-loss prediction.

Root/publish copies synchronized. No Git mutations or deployment. Actual device test still required; no physical GPS trace was collected.
