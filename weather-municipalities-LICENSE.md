# Municipal weather overlay boundaries

Source: geoBoundaries gbOpen, BGR ADM2, boundary ID BGR-ADM2-11073933.
https://www.geoboundaries.org/api/current/gbOpen/BGR/ADM2/
Pinned source: https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BGR/ADM2/geoBoundaries-BGR-ADM2.geojson

The source metadata identifies 265 municipalities, represented year 2019, source geoBoundaries / Wikimedia, original boundary licence Public Domain; geoBoundaries is credited in the map and weather information. This is a cartographic boundary dataset, not a cadastral survey or a claim of 2026 boundary revision.

Prepared on 2026-11-18. Transformations: retained all municipality geometries and holes; rounded coordinates to five decimal places; retained name and ID; precomputed overlapping model-cell indexes and geographic bounding boxes. No smoothing, invented outlines, or mockup geometry. audit/build-weather-municipalities.cjs reproduces the preparation from the downloaded source. Only the Bulgaria subset is served as weather-municipalities.geojson.

Weather meaning: a municipality is outlined when any intersecting forecast cell has a relevant WMO code. This indicates a forecast signal in part of the municipality, not uniform conditions across the entire municipality. Missing data are not interpreted as clear/safe weather. Grid resolution remains approximately 25 km. Forecast icing is not a road-surface observation. The map's official NIMH warnings remain separate.
