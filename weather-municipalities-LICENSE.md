# Municipal weather overlay boundaries

Source: geoBoundaries gbOpen, BGR ADM2, boundary ID BGR-ADM2-11073933.
https://www.geoboundaries.org/api/current/gbOpen/BGR/ADM2/
Pinned source: https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BGR/ADM2/geoBoundaries-BGR-ADM2.geojson

The source metadata identifies 265 municipalities, represented year 2019, source geoBoundaries / Wikimedia, original boundary licence Public Domain; geoBoundaries is credited in the map and weather information. This is a cartographic boundary dataset, not a cadastral survey or a claim of 2026 boundary revision.

Prepared on 2026-11-18. Transformations: retained all municipality geometries and holes; rounded coordinates to five decimal places; retained name and ID; precomputed overlapping model-cell indexes and geographic bounding boxes. No smoothing, invented outlines, or mockup geometry. audit/build-weather-municipalities.cjs reproduces the preparation from the downloaded source. Only the Bulgaria subset is served as weather-municipalities.geojson.

Weather meaning (updated 2026-11-18): intersecting coarse grid cells only select candidates. A municipality is outlined only after at least two of three fixed interior samples support the hazard within one explicit model. Samples are built by audit/build-weather-risk-points.cjs and stored in netlify/functions/weather-risk-points.json. They are geographic samples, not road stations or independent observations. This screening rule reduces broad outlines; it does not establish probability, physical coverage, or guarantee detection of local hazards. Missing data are not interpreted as clear/safe weather. Forecast icing is not a road-surface observation. The map's official NIMH warnings remain separate.
