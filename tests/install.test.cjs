const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../install.js'), 'utf8');
function setup(nav = {}, standalone = false) {
  const events = {}, buttons = [0,1].map(() => ({ addEventListener(n, f) { this[n] = f; } }));
  const help = { open:false, showModal(){this.open=true}, close(){this.open=false} }, text = {};
  const handoff={},copy={addEventListener(n,f){this[n]=f}},link={focus(){},select(){this.selected=true}};
  const media = {matches:standalone,addEventListener(n,f){this.change=f}};
  vm.runInNewContext(source, {navigator:{userAgent:'Android',...nav},window:{matchMedia:()=>media,addEventListener:(n,f)=>events[n]=f},
    document:{querySelectorAll:()=>buttons,getElementById:id=>({installHelp:help,installSteps:text,installHandoff:handoff,installCopy:copy,installLink:link,installSafari:{},installSafariTitle:{}})[id]}});
  return {events,buttons,help,text,media,handoff,copy,link};
}
(async()=>{
  let s=setup(),calls=0;
  assert(!s.buttons[0].hidden);await s.buttons[0].click();assert(s.help.open);assert.match(s.text.textContent,/Chrome/);
  s.help.close();let prevented=false;
  s.events.beforeinstallprompt({preventDefault(){prevented=true},prompt:async()=>{calls++},userChoice:Promise.resolve({outcome:'dismissed'})});
  assert(prevented);assert.equal(calls,0,'no unsolicited prompt');
  await s.buttons[0].click();assert.equal(calls,1);assert(!s.buttons[0].hidden);
  await s.buttons[0].click();assert.equal(calls,1,'event used once');assert(s.help.open);
  s.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{calls++},userChoice:Promise.resolve({outcome:'accepted'})});
  await s.buttons[1].click();assert(s.buttons.every(b=>b.hidden&&!b.disabled));assert(!s.help.open);
  s=setup();s.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{throw Error('unavailable')}});
  await s.buttons[0].click();assert(s.help.open);assert(!s.buttons[0].disabled);
  s.events.appinstalled();assert(s.buttons.every(b=>b.hidden));assert(!s.help.open);
  for(const nav of [{userAgent:'iPhone'},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}]){
    s=setup(nav);await s.buttons[0].click();assert.match(s.text.textContent,/Safari/);
  }
  s=setup({userAgent:'iPhone',clipboard:{writeText:async u=>{assert.equal(u,'https://sredna-skorost.netlify.app/')}}});
  await s.buttons[0].click();assert(!s.handoff.hidden);await s.copy.click();assert.match(s.copy.textContent,/Копирано/);
  s=setup({userAgent:'iPhone'});await s.buttons[0].click();await s.copy.click();assert(!s.link.hidden&&s.link.selected);
  assert(setup({},true).buttons.every(b=>b.hidden));
  assert(setup({standalone:true}).buttons.every(b=>b.hidden));
  s=setup();s.media.matches=true;s.media.change();assert(s.buttons.every(b=>b.hidden));
  s=setup();let release;
  s.events.beforeinstallprompt({preventDefault(){},prompt:()=>new Promise(r=>release=r),userChoice:Promise.resolve({outcome:'dismissed'})});
  const first=s.buttons[0].click();assert(s.buttons.every(b=>b.disabled));await s.buttons[1].click();release();await first;
  assert(s.buttons.every(b=>!b.disabled));
  console.log('PASS install: user gesture, accepted/dismissed, single-use event, errors, install event, iPhone/iPad help, standalone, double click');
})().catch(e=>{console.error(e);process.exitCode=1});
