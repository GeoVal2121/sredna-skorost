const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../app.js', 'utf8');
const handler = source.slice(source.indexOf('  $("shareBtn").onclick'), source.indexOf('  $("setBtn").onclick'));
async function run(navigator) {
  const button = {}, calls = [];
  vm.runInNewContext(handler, { $: () => button, navigator, toast: m => calls.push(['toast', m]), window: { prompt: (m, url) => calls.push(['prompt', url]) } });
  await button.onclick();
  return calls;
}
(async () => {
  const url = 'https://sredna-skorost.netlify.app/';
  let shared, copied;
  assert.deepEqual(await run({ share: async data => { shared = data; } }), []);
  assert.equal(shared.url, url);
  assert.deepEqual(await run({ share: async () => { throw { name: 'AbortError' }; }, clipboard: { writeText: () => assert.fail('Cancelled sharing must not copy') } }), []);
  assert.equal((await run({ clipboard: { writeText: async value => { copied = value; } } }))[0][0], 'toast');
  assert.equal(copied, url);
  assert.deepEqual(await run({}), [['prompt', url]]);
  assert.deepEqual(await run({ share: async () => { throw { name: 'NotAllowedError' }; } }), [['prompt', url]]);
  console.log('PASS sharing: native, cancellation, clipboard, manual fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
