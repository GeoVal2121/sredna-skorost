# Dark 3D buildings — 2026-11-15

Version: 2026.11.15-1. Local correction; not deployed.

Confirmed cause: the current OpenFreeMap liberty style includes building-3d (fill-extrusion, minimum zoom 14). The fiord style contains only a flat building fill. Styles downloaded into audit/style-liberty.json and audit/style-fiord.json from https://tiles.openfreemap.org/styles/liberty and https://tiles.openfreemap.org/styles/fiord.

map.js now inserts a dark fill-extrusion building layer on every style.load, using the existing building source, render_height/render_min_height and hide_3d filter. It preserves existing 3D layers and skips the offline style. Light style is unchanged.

PASS: node tests/dark-buildings.test.cjs; node tests/map-controls.test.cjs; node tests/geometry.test.cjs; node --check map.js.
PASS: node audit/dark-buildings-check.cjs with real public vector tiles, Chromium at 390x750. Light-dark-light switching retains 55-degree pitch; 24 building features rendered in the dark layer at central Sofia, zoom 16.5. No uncaught page errors. Screenshot audit/buildings-dark.png inspected. The harness switches map themes directly (UI theme is independent). Initial QA assertions were corrected to use getPaintProperty and floating-point tolerance; the final run passed.

Root and publish files synchronized locally. Physical iPhone acceptance and deployment pending.
