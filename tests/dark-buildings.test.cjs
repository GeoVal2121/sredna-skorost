const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../map.js'), 'utf8');
const building = { id: 'building', source: 'openmaptiles', 'source-layer': 'building' };
let layers = [building, { id: 'road' }], added = [];
const ctx = { isDark: true, map: {
  getStyle: () => ({ layers }), getLayer: id => layers.find(l => l.id === id),
  addLayer: (layer, before) => { added.push({ layer, before }); layers.push(layer); }
} };
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('  function addDarkBuildings'), source.indexOf('  // смяна светло/тъмно')), ctx);
ctx.addDarkBuildings();
assert.equal(added.length, 1); assert.equal(added[0].before, 'road');
const layer = added[0].layer;
assert.equal(layer.type, 'fill-extrusion'); assert.equal(layer.source, building.source);
assert.equal(layer['source-layer'], 'building'); assert.equal(layer.minzoom, 14);
assert.equal(layer.paint['fill-extrusion-height'][1], 'render_height');
assert.equal(layer.paint['fill-extrusion-base'][1], 'render_min_height');
assert.equal(layer.filter[1][1], 'hide_3d');
ctx.addDarkBuildings(); assert.equal(added.length, 1);
layers = []; ctx.addDarkBuildings(); assert.equal(added.length, 1);
layers = [building]; ctx.isDark = false; ctx.addDarkBuildings(); assert.equal(added.length, 1);
ctx.isDark = true; ctx.addDarkBuildings(); assert.equal(added.length, 2);
assert.match(source, /map.on\("style.load", function \(\) \{\s+addDarkBuildings\(\)/);
console.log('PASS: dark building heights, layer order, no duplicates, offline/light unchanged, theme reload');
