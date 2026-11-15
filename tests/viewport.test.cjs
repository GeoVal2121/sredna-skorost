const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../viewport.js'), 'utf8');
const style = {}, events = {}, pageEvents = {};
const viewport = { height: 650, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1,
  addEventListener: (name, fn) => events[name] = fn };
vm.runInNewContext(source, { window: { visualViewport: viewport, addEventListener: (n, f) => pageEvents[n] = f },
  document: { getElementById: () => ({ style }) } });
assert.equal(style.height, '650px');
Object.assign(viewport, { height: 340, offsetTop: 42 }); events.resize();
assert.equal(style.height, '340px'); assert.equal(style.top, '42px');
viewport.offsetTop = 60; events.scroll(); assert.equal(style.top, '60px');
viewport.scale = 2; viewport.height = 170; events.resize(); assert.equal(style.height, '340px');
Object.assign(viewport, { scale: 1, height: 390, width: 844, offsetTop: 0 }); pageEvents.pageshow();
assert.equal(style.width, '844px'); assert.equal(style.height, '390px'); assert.equal(style.top, '0px');
vm.runInNewContext(source, { window: {}, document: { getElementById: () => ({ style: {} }) } });
console.log('PASS: visible viewport, keyboard, scroll, pinch zoom, restoration, CSS fallback');

const boundedStyle={},boundedEvents={};
const win={innerHeight:560,visualViewport:{...viewport,height:700,addEventListener(){}},addEventListener:(n,f)=>boundedEvents[n]=f};
vm.runInNewContext(source,{window:win,document:{getElementById:()=>({style:boundedStyle})}});
assert.equal(boundedStyle.height,'560px');win.innerHeight=640;boundedEvents.resize();assert.equal(boundedStyle.height,'640px');
