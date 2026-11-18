// Forecast tiles and official NIMH warnings distributed by EUMETNET–MeteoAlarm.
(function (root) {
  'use strict';
  var CAP = 'urn:oasis:names:tc:emergency:cap:1.2', ATOM = 'http://www.w3.org/2005/Atom';
  var ENDPOINT = '/.netlify/functions/weather-warnings';
  var types = {1:'Силен вятър',2:'Сняг / поледица',3:'Гръмотевици',4:'Мъгла',5:'Горещини',6:'Ниски температури',7:'Крайбрежна опасност',8:'Пожарна опасност',9:'Лавини',10:'Обилен дъжд',12:'Наводнение',13:'Дъжд и наводнение',14:'Морска опасност',15:'Суша'};
  var colors = {2:'#d9a300',3:'#ec7900',4:'#d93025'};
  function hour(t) { return Math.floor(t / 3600000) * 3600000; }
  function tileURL(layer, t) {
    if (['precip','wind'].indexOf(layer) < 0 || !Number.isFinite(t)) throw new Error('Invalid forecast');
    return 'https://weathermaps.weatherapi.com/' + layer + '/tiles/' + new Date(hour(t)).toISOString().slice(0,13).replace(/[-T:]/g,'') + '/{z}/{x}/{y}.png';
  }
  function xml(s) {
    if (typeof s !== 'string' || s.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error('Invalid XML');
    var doc = new DOMParser().parseFromString(s, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
    return doc;
  }
  function nodes(el, ns, name) { return Array.from(el.getElementsByTagNameNS(ns,name)); }
  function text(el, name, ns) { var a = nodes(el, ns || CAP, name)[0]; return a ? a.textContent.trim() : ''; }
  function parameter(el, name) {
    var p = nodes(el,CAP,'parameter').find(function (x) { return text(x,'valueName') === name; });
    return p ? parseInt(text(p,'value'),10) : NaN;
  }
  function feed(s, now) {
    var doc = xml(s), el = doc.documentElement;
    if (el.localName !== 'feed' || el.namespaceURI !== ATOM) throw new Error('Invalid feed');
    var updated = Date.parse(text(el,'updated',ATOM));
    if (!Number.isFinite(updated) || updated > now + 300000 || now - updated > 3600000) throw new Error('Stale feed');
    var ids = new Set();
    nodes(el,ATOM,'entry').forEach(function (entry) {
      // Fetch cancellations too, so their referenced alerts cannot remain visible.
      var links=nodes(entry,ATOM,'link').filter(function (x) { return x.getAttribute('type') === 'application/cap+xml'; });
      if(!links.length)throw new Error('Missing CAP link');
      links.forEach(function (link) {
        var m = /^https:\/\/feeds\.meteoalarm\.org\/api\/v1\/warnings\/feeds-bulgaria\/([0-9a-f-]{36})$/i.exec(link.getAttribute('href') || '');
        if (!m) throw new Error('Unexpected warning link');
        ids.add(m[1]);
      });
    });
    if (nodes(el,ATOM,'entry').length && !ids.size) throw new Error('Missing CAP links');
    if (ids.size > 160) throw new Error('Too many warnings');
    return {updated:updated, ids:Array.from(ids)};
  }
  function polygon(s) {
    var ring = s.trim().split(/\s+/).map(function (p) { var c = p.split(',').map(Number); return [c[1],c[0]]; });
    if (ring.length < 4 || ring.some(function (p) { return !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0])>180 || Math.abs(p[1])>90; })) throw new Error('Invalid polygon');
    if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) throw new Error('Unclosed polygon');
    return ring;
  }
  function parseAlert(s, regions) {
    var doc = xml(s), el = doc.documentElement;
    if (el.localName !== 'alert' || el.namespaceURI !== CAP) throw new Error('Invalid CAP');
    var id = text(el,'identifier'), refs = text(el,'references').split(/\s+/).filter(Boolean).map(function (r) { return r.split(',')[1]; });
    if (!id) throw new Error('Missing identifier');
    var result = {id:id, refs:refs, features:[], unmapped:[]};
    if (text(el,'status') !== 'Actual' || text(el,'scope') !== 'Public') { result.refs=[]; return result; }
    if (text(el,'msgType') === 'Cancel') return result;
    if (!['Alert','Update'].includes(text(el,'msgType'))) { result.refs=[]; return result; }
    var infos = nodes(el,CAP,'info'), language = infos.some(function (i) { return /^bg/i.test(text(i,'language')); }) ? 'bg' : 'en';
    var selected = infos.filter(function (i) { return text(i,'language').slice(0,2) === language; });
    if (!selected.length) selected = infos.filter(function (i) { return text(i,'language') === text(infos[0],'language'); });
    selected.forEach(function (info) {
      var level = parameter(info,'awareness_level') || {Moderate:2,Severe:3,Extreme:4}[text(info,'severity')];
      var start = Date.parse(text(info,'onset') || text(info,'effective')), end = Date.parse(text(info,'expires'));
      if (!colors[level] || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid warning interval');
      nodes(info,CAP,'area').forEach(function (area) {
        var properties = {id:id, area:text(area,'areaDesc'), level:level, color:colors[level], start:start, end:end,
          title:types[parameter(info,'awareness_type')] || text(info,'event'), description:text(info,'description'), instruction:text(info,'instruction')};
        var polygons = nodes(area,CAP,'polygon'), geometries = [];
        if (polygons.length) geometries = [{type:'MultiPolygon',coordinates:polygons.map(function (p) { return [polygon(p.textContent)]; })}];
        else {
          nodes(area,CAP,'geocode').forEach(function (g) {
            var scheme=text(g,'valueName'), code=text(g,'value');
            var areaName=properties.area.toLowerCase().replace(/^(област|обл\.)\s*/,'').trim();
            var match=regions.features.find(function (f) {
              // A dated EMMA mapping must agree with the current CAP name as well as its code.
              var nameMatches=[f.properties.name,f.properties.english].some(function(n){return n.toLowerCase()===areaName;});
              return (scheme==='EMMA_ID' && f.properties.code===code && nameMatches) || (scheme==='NUTS3' && f.properties.nuts===code);
            });
            if (match) geometries.push(match.geometry);
          });
        }
        if (!geometries.length) result.unmapped.push(properties);
        geometries.forEach(function (geometry) { result.features.push({type:'Feature',properties:properties,geometry:geometry}); });
      });
    });
    if (!infos.length) throw new Error('Missing warning information');
    return result;
  }
  function combine(alerts, t) {
    var replaced = new Set(alerts.flatMap(function (a) { return a.refs; })), seen = new Set(), features=[], unmapped=[];
    alerts.forEach(function (a) {
      if (replaced.has(a.id) || seen.has(a.id)) return;
      seen.add(a.id);
      function active(p) { return p.start <= t && t < p.end; }
      features.push.apply(features,a.features.filter(function (f) { return active(f.properties); }));
      unmapped.push.apply(unmapped,a.unmapped.filter(active));
    });
    return {type:'FeatureCollection',features:features,unmapped:unmapped};
  }
  function areaPoint(geometry) {
    var ring=geometry.type==='Polygon'?geometry.coordinates[0]:geometry.coordinates[0][0];
    var ys=ring.map(function(p){return p[1];}),y=(Math.min.apply(null,ys)+Math.max.apply(null,ys))/2,xs=[];
    for(var i=1;i<ring.length;i++){var a=ring[i-1],b=ring[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
    xs.sort(function(a,b){return a-b;});var point=ring[0],width=0;
    for(var j=0;j+1<xs.length;j+=2)if(xs[j+1]-xs[j]>width){width=xs[j+1]-xs[j];point=[(xs[j]+xs[j+1])/2,y];}
    return point;
  }
  var api = {areaPoint:areaPoint,hour:hour,tileURL:tileURL,feed:feed,parseAlert:parseAlert,combine:combine};
  if (typeof module !== 'undefined') module.exports=api;
  root.SSWeather=api;
  if (typeof document === 'undefined') return;

  var $=function(id){return document.getElementById(id);}, map, enabled=false, selected=hour(Date.now()), mode="precip";
  var warningMarkers=[],alerts=[], fetched=0, updated=0, regions, busy=false, seq=0, tileFailed=false, warningFailed=false, warningCount=0;
  function badge() {
    var failed=(mode==='precip'&&tileFailed)||warningFailed||(root.SSWeatherZones&&SSWeatherZones.failed), b=$('weatherInfoBtn');
    b.textContent=failed?'!':warningCount?'⚠ '+warningCount:'ⓘ';
    b.style.color=failed||warningCount?'var(--warn)':'';
    b.setAttribute('aria-label',failed?'Част от метеорологичните данни са недостъпни':warningCount?'Предупреждения на НИМХ: '+warningCount:'Подробности за времето и предупрежденията');
  }
  function label(t) { return new Date(t).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
  async function get(url, json) {
    var r=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-cache'});
    if (!r.ok) throw new Error('Unavailable');
    return json ? r.json() : r.text();
  }
  function sourceData() { return fetched && Date.now()-fetched < 900000 ? combine(alerts,selected) : {type:'FeatureCollection',features:[],unmapped:[]}; }
  function positionWarnings() {
    if(!enabled||!root.SSWeatherZones)return;
    var box=map.getContainer().getBoundingClientRect(),obstacles=Array.from(document.querySelectorAll('.top,.chips,.side,.spdw,.maplibregl-ctrl,#weatherPanel,#bottomBar')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width&&r.height;});
    warningMarkers.forEach(function(m){
      var el=m.getElement(),candidates=[areaPoint(m.warningGeometry)],fits=false,fallback=null;el.style.visibility='hidden';
      [.5,.35,.65,.2,.8,.1,.9].forEach(function(y){[.5,.35,.65,.2,.8,.1,.9].forEach(function(x){var ll=map.unproject([box.width*x,box.height*y]);candidates.push([ll.lng,ll.lat]);});});
      for(var n=0;n<candidates.length;n++){
        if(!map.getBounds().contains(candidates[n])||!SSWeatherZones.contains(m.warningGeometry,candidates[n]))continue;
        var size=el.getBoundingClientRect(),screen=map.project(candidates[n]),r={left:box.left+screen.x-size.width/2,right:box.left+screen.x+size.width/2,top:box.top+screen.y-size.height/2,bottom:box.top+screen.y+size.height/2};
        if(r.left<box.left+8||r.right>box.right-8||r.top<box.top+8||r.bottom>box.bottom-8||obstacles.some(function(o){return r.left<o.right+5&&r.right>o.left-5&&r.top<o.bottom+5&&r.bottom>o.top-5;}))continue;
        if(!fallback)fallback={point:candidates[n],rect:r};
        if(![[r.left,r.top],[r.right,r.top],[r.right,r.bottom],[r.left,r.bottom]].every(function(p){var ll=map.unproject([p[0]-box.left,p[1]-box.top]);return SSWeatherZones.contains(m.warningGeometry,[ll.lng,ll.lat]);}))continue;
        fits=true;m.setLngLat(candidates[n]);el.style.visibility='visible';obstacles.push(r);break;
      }
      if(!fits&&fallback){m.setLngLat(fallback.point);fits=true;el.style.visibility='visible';obstacles.push(fallback.rect);}
      el.setAttribute('aria-hidden',String(!fits));
    });
  }
  function updateWarnings() {
    if (!map || !map.getSource('weather-warnings')) return;
    var data=sourceData();map.getSource('weather-warnings').setData(data);
    warningMarkers.forEach(function(m){m.remove();});warningMarkers=[];
    if(enabled){var labeled=new Set();data.features.forEach(function(f){
      var p=f.properties,key=p.id+':'+p.area;if(labeled.has(key))return;labeled.add(key);
      var el=document.createElement('div');el.className='weather-warning-label';el.style.setProperty('--warning-color',p.color);
      var icon=document.createElement('span');icon.className='weather-warning-icon';icon.textContent='⚠';
      var text=document.createElement('span'),title=document.createElement('strong'),until=document.createElement('small');
      title.textContent=p.title+' · НИМХ';until.textContent=({2:'Жълт',3:'Оранжев',4:'Червен'}[p.level])+' код - до '+label(p.end).replace(/(\d{2}\.\d{2}),/,'$1.,');text.append(title,until);el.append(icon,text);
      el.title=p.title+' · '+p.area;el.setAttribute('aria-label',p.title+' · '+p.area+' · '+until.textContent);
      var marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(areaPoint(f.geometry)).addTo(map);marker.warningGeometry=f.geometry;warningMarkers.push(marker);
    });}

    positionWarnings();
    var list=$('weatherList');list.replaceChildren();var seen=new Set();
    data.features.map(function(f){return f.properties;}).concat(data.unmapped).forEach(function(p){
      var k=p.id+':'+p.area;if(seen.has(k))return;seen.add(k);
      var li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=p.title+' · '+p.area+' · '+({2:'жълт',3:'оранжев',4:'червен'}[p.level])+' код';details.append(summary);
      [label(p.start)+' – '+label(p.end),p.description,p.instruction].filter(Boolean).forEach(function(s){var line=document.createElement('p');line.textContent=s;details.append(line);});
      var source=document.createElement('a');source.href='https://weather.bg/obshtini/';source.target='_blank';source.rel='noopener';source.textContent='Официален източник: НИМХ';details.append(source);li.append(details);list.append(li);
    });
    $('weatherDetails').hidden=!seen.size;
    warningCount=seen.size;badge();
    if (fetched && Date.now()-fetched < 900000) {
      // Empty feed is not a guarantee for future dates outside the issued warning horizon.
      $('warningStatus').textContent=seen.size ? 'НИМХ: '+seen.size+' предупреждения за избрания час'+(data.unmapped.length?' · някои райони са без граници':'') : 'НИМХ: няма публикувани предупреждения за този час.';
      $('warningStatus').title='Каналът е обновен на '+label(updated)+'. Липсата на предупреждение не е прогноза за безопасно време.';
    }
  }
  var labelPaint={};
  function labelContrast() {
    var strong=enabled&&root.SSApp&&SSApp.isDark();
    var contrast={'text-color':'#ffffff','text-halo-color':'#172238','text-halo-width':1.5,'text-halo-blur':0};
    (map.getStyle().layers||[]).filter(function(l){return l.type==='symbol'&&l['source-layer']==='transportation_name';}).forEach(function(l){
      if(strong&&!labelPaint[l.id]){
        labelPaint[l.id]={};Object.keys(contrast).forEach(function(k){labelPaint[l.id][k]=map.getPaintProperty(l.id,k);});
      }
      var values=strong?contrast:labelPaint[l.id];if(!values)return;
      Object.keys(values).forEach(function(k){map.setPaintProperty(l.id,k,values[k]===undefined?null:values[k]);});
      if(!strong)delete labelPaint[l.id];
    });
  }
  function style() {
    if (!map || !map.getLayer('route')) return;
    var before=(map.getStyle().layers||[]).find(function(l){return l['source-layer']==='building'||l.type==='fill-extrusion'||(l.type==='line'&&l['source-layer']==='transportation');}) || (map.getStyle().layers||[]).find(function(l){return l.id==='route-case';});
    before=before?before.id:undefined;
    if (!map.getSource('weather-forecast')) {
      map.addSource('weather-forecast',{type:'raster',tiles:[tileURL('precip',selected)],tileSize:256,maxzoom:6,attribution:'© <a href="https://www.weatherapi.com/">WeatherAPI</a>'});
      map.addLayer({id:'weather-forecast',type:'raster',source:'weather-forecast',paint:{'raster-opacity':0.18,'raster-fade-duration':0}},before);
      map.addSource('weather-warnings',{type:'geojson',data:sourceData()});
      map.addLayer({id:'weather-warning-fill',type:'fill',source:'weather-warnings',paint:{'fill-color':['get','color'],'fill-opacity':0.09}},before);
      map.addLayer({id:'weather-warning-line',type:'line',source:'weather-warnings',paint:{'line-color':['get','color'],'line-width':1.2}},before);
    }
    ['weather-forecast','weather-warning-fill','weather-warning-line'].forEach(function(id){map.setLayoutProperty(id,'visibility',enabled&&(id!=='weather-forecast'||mode==='precip')?'visible':'none');});
    labelContrast();
    updateWarnings();
    if(root.SSWeatherZones)SSWeatherZones.show(enabled,selected,mode);
    // A theme reload can recreate the canvas before the warning layers exist.
    ['weather-zones','weather-risk-fill','weather-risk-fog','weather-risk-ice'].forEach(function(id){if(map.getLayer(id))map.moveLayer(id,'weather-warning-fill');});
  }
  function forecast() {
    tileFailed=false;badge();
    $('weatherTime').textContent=layerNames[mode]+' · '+label(selected);
    $('weatherHour').setAttribute('aria-valuetext',label(selected)+' българско време');
    $('weatherStatus').textContent=mode==='precip'?'Зареждане на прогнозата…':'Прогнозен модел · обща картина, не точност по улици';
    $('weatherLegend').src='https://weathermaps.weatherapi.com/img/legend_precip_gradient.png';
    $('weatherLegend').alt='Валежи — милиметри на час';
    $('weatherUnits').textContent=layerNames[mode]+' · '+layerUnits[mode];$('weatherLegend').hidden=mode!=='precip';$('weatherScale').textContent=layerUnits[mode];$('weatherScale').dataset.mode=mode;
    if(mode==='precip' && map && map.getSource('weather-forecast')) map.getSource('weather-forecast').setTiles([tileURL('precip',selected)]);
    style();
  }
  async function refreshWarnings() {
    if (busy || !enabled || (fetched && Date.now()-fetched<300000)) return;
    busy=true;var generation=seq;
    $('warningStatus').textContent='Проверка на предупрежденията на НИМХ…';
    try {
      var f=feed(await get(ENDPOINT),Date.now());
      if (!regions && f.ids.length) regions=await get('weather-regions.geojson',true);
      var out=[], cursor=0;
      // Bounded requests; the server/CDN shares cached CAP responses across visitors.
      await Promise.all(Array.from({length:Math.min(4,f.ids.length)},async function(){
        while(cursor<f.ids.length){var id=f.ids[cursor++];out.push(parseAlert(await get(ENDPOINT+'?id='+id),regions));}
      }));
      if(generation!==seq)return;
      alerts=out;fetched=Date.now();updated=f.updated;warningFailed=false;updateWarnings();
    } catch(e) {
      if(generation!==seq)return;
      alerts=[];fetched=0;warningFailed=true;updateWarnings();$('warningStatus').textContent='НИМХ: данните не са достъпни. Провери официалната карта.';
    } finally {busy=false;if(generation!==seq && enabled)refreshWarnings();}
  }
  var layerNames={temperature:'Температура',precip:'Валежи',wind:'Вятър',cloud:'Облачност'};
  var layerUnits={temperature:'Студено → Топло · °C',precip:'Слаб → Силен валеж · мм/ч',wind:'Слаб → Силен · км/ч',cloud:'Ясно → Облачно · %'};
  function menu(open){
    var el=$('weatherMenu');el.hidden=!open;$('weatherToggle').setAttribute('aria-expanded',String(open));
    if(open){var r=$('weatherToggle').getBoundingClientRect();el.style.left=Math.max(8,r.left-el.offsetWidth-10)+'px';el.style.top=Math.max(8,Math.min(innerHeight-el.offsetHeight-8,r.top-el.offsetHeight+ r.height))+'px';el.querySelector('[data-layer="'+mode+'"]').focus();}
  }
  function choose(next){
    menu(false);if(next==='off'){if(enabled)toggle();}else{mode=next;if(!enabled)toggle();else forecast();}
    document.querySelectorAll('#weatherMenu [data-layer]').forEach(function(b){b.setAttribute('aria-checked',String(enabled&&b.dataset.layer===mode));});
    $('weatherToggle').focus();
  }
  function toggle() {
    enabled=!enabled;seq++;$('weatherPanel').hidden=!enabled;$('weatherToggle').setAttribute('aria-pressed',String(enabled));
    document.body.classList.toggle('weather-open',enabled);
    if(enabled){selected=hour(Date.now());$('weatherHour').value=0;forecast();refreshWarnings();}else{style();}
  }
  api.mount=function(m){
    map=m;
    if(root.SSWeatherZones){SSWeatherZones.onstatus=badge;SSWeatherZones.mount(m);}
    map.on('style.load',function(){labelPaint={};if(enabled)style();});
    map.on('error',function(e){if(enabled && mode==='precip' && e.sourceId==='weather-forecast'){tileFailed=true;badge();$('weatherStatus').textContent='Прогнозният слой не е достъпен за този час.';}});
    map.on('sourcedata',function(e){if(enabled && mode==='precip' && e.sourceId==='weather-forecast' && e.isSourceLoaded && !tileFailed)$('weatherStatus').textContent='Прогнозен модел · обща картина, не точност по улици';});
    var warningFrame=0;
    map.on('move',function(){if(enabled&&!warningFrame)warningFrame=requestAnimationFrame(function(){warningFrame=0;positionWarnings();});});
    map.on('moveend',positionWarnings);map.on('resize',positionWarnings);
    $('weatherToggle').onclick=function(){menu($('weatherMenu').hidden);};$('weatherClose').onclick=function(){choose('off');};
    document.querySelectorAll('#weatherMenu [data-layer]').forEach(function(b){b.onclick=function(){choose(b.dataset.layer);};});
    document.addEventListener('pointerdown',function(e){if(!$('weatherMenu').contains(e.target)&&!$('weatherToggle').contains(e.target))menu(false);});
    document.addEventListener('keydown',function(e){if($('weatherMenu').hidden)return;if(e.key==='Escape'){menu(false);$('weatherToggle').focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();var items=Array.from($('weatherMenu').querySelectorAll('button')),i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}});
    window.addEventListener('resize',function(){menu(false);});
    $('weatherInfoBtn').onclick=function(){$('weatherInfo').showModal();};
    $('weatherHour').oninput=function(){selected=hour(Date.now())+Number(this.value)*3600000;$('weatherTime').textContent=layerNames[mode]+' · '+label(selected);if(root.SSWeatherZones)SSWeatherZones.preview(selected);};
    $('weatherHour').onchange=forecast;
    $('weatherNow').onclick=function(){selected=hour(Date.now());$('weatherHour').value=0;forecast();refreshWarnings();};
    $('weatherLegend').onerror=function(){this.hidden=true;$('weatherStatus').textContent='Легендата не е достъпна.';};
    $('weatherLegend').onload=function(){this.hidden=mode!=='precip';};
    document.addEventListener('visibilitychange',function(){if(enabled&&!document.hidden)refreshWarnings();});
    setInterval(function(){if(enabled&&!document.hidden){updateWarnings();refreshWarnings();if(root.SSWeatherZones)SSWeatherZones.show(enabled,selected,mode);}},60000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
