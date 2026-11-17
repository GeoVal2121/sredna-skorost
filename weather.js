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

  var $=function(id){return document.getElementById(id);}, map, enabled=false, layer='precip', selected=hour(Date.now());
  var warningMarkers=[],alerts=[], fetched=0, updated=0, regions, busy=false, seq=0, popup, tileFailed=false, warningFailed=false, warningCount=0;
  function badge() {
    var failed=tileFailed||warningFailed||(root.SSWeatherZones&&SSWeatherZones.failed), b=$('weatherInfoBtn');
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
  function popupFor(p,lngLat) {
    if (popup) popup.remove();
    var box=document.createElement('div');box.className='weather-popup';
    var title=document.createElement('strong');title.textContent=p.title+' · '+p.area;box.append(title);
    ['НИМХ · '+({2:'жълт',3:'оранжев',4:'червен'}[p.level])+' код',label(p.start)+' – '+label(p.end),p.description,p.instruction].filter(Boolean).forEach(function(s){var n=document.createElement('p');n.textContent=s;box.append(n);});
    var a=document.createElement('a');a.href='https://weather.bg/obshtini/';a.target='_blank';a.rel='noopener';a.textContent='Официален източник: НИМХ';box.append(a);
    popup=new maplibregl.Popup({maxWidth:'290px'}).setLngLat(lngLat).setDOMContent(box).addTo(map);
  }
  function updateWarnings() {
    if (!map || !map.getSource('weather-warnings')) return;
    var data=sourceData();map.getSource('weather-warnings').setData(data);
    warningMarkers.forEach(function(m){m.remove();});warningMarkers=[];
    if(enabled){var labeled=new Set();data.features.forEach(function(f){
      var p=f.properties,key=p.id+':'+p.area;if(labeled.has(key))return;labeled.add(key);
      var el=document.createElement('button');el.type='button';el.className='weather-warning-label';el.style.setProperty('--warning-color',p.color);
      var icon=document.createElement('span');icon.textContent='⚠';el.append(icon,document.createTextNode(p.title+' · НИМХ'));
      el.setAttribute('aria-label',p.title+' · '+p.area+' · НИМХ');var point=areaPoint(f.geometry);
      el.onclick=function(e){e.stopPropagation();popupFor(p,point);};
      warningMarkers.push(new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat(point).addTo(map));
    });}

    var list=$('weatherList');list.replaceChildren();var seen=new Set();
    data.features.map(function(f){return f.properties;}).concat(data.unmapped).forEach(function(p){
      var k=p.id+':'+p.area;if(seen.has(k))return;seen.add(k);
      var li=document.createElement('li'),b=document.createElement('button');b.type='button';b.textContent=p.title+' · '+p.area+' · '+({2:'жълт',3:'оранжев',4:'червен'}[p.level])+' код';
      b.onclick=function(){$('weatherInfo').close();popupFor(p,map.getCenter());};li.append(b);list.append(li);
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
      map.addSource('weather-forecast',{type:'raster',tiles:[tileURL(layer,selected)],tileSize:256,maxzoom:6,attribution:'© <a href="https://www.weatherapi.com/">WeatherAPI</a>'});
      map.addLayer({id:'weather-forecast',type:'raster',source:'weather-forecast',paint:{'raster-opacity':0.18,'raster-fade-duration':0}},before);
      map.addSource('weather-warnings',{type:'geojson',data:sourceData()});
      map.addLayer({id:'weather-warning-fill',type:'fill',source:'weather-warnings',paint:{'fill-color':['get','color'],'fill-opacity':0.13}},before);
      map.addLayer({id:'weather-warning-line',type:'line',source:'weather-warnings',paint:{'line-color':['get','color'],'line-width':2.5}},before);
    }
    ['weather-forecast','weather-warning-fill','weather-warning-line'].forEach(function(id){map.setLayoutProperty(id,'visibility',enabled?'visible':'none');});
    labelContrast();
    updateWarnings();
    if(root.SSWeatherZones)SSWeatherZones.show(enabled&&layer==='precip',selected);
    // A theme reload can recreate the canvas before the warning layers exist.
    if(map.getLayer('weather-zones'))map.moveLayer('weather-zones','weather-warning-fill');
  }
  function forecast() {
    tileFailed=false;badge();
    $('weatherTime').textContent='Прогноза: '+label(selected);
    $('weatherHour').setAttribute('aria-valuetext',label(selected)+' българско време');
    $('weatherStatus').textContent='Зареждане на прогнозата…';
    $('weatherLegend').src='https://weathermaps.weatherapi.com/img/legend_'+(layer==='precip'?'precip':'wind_ms')+'_gradient.png';
    $('weatherLegend').alt=layer==='precip'?'Валежи — милиметри на час':'Вятър — метри в секунда';
    $('weatherUnits').textContent=layer==='precip'?'Валежи (мм/ч)':'Вятър (м/с)';
    $('weatherRain').setAttribute('aria-pressed',String(layer==='precip'));$('weatherWind').setAttribute('aria-pressed',String(layer==='wind'));
    if(map && map.getSource('weather-forecast')) map.getSource('weather-forecast').setTiles([tileURL(layer,selected)]);
    style();if(popup){popup.remove();popup=null;}
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
  function toggle() {
    enabled=!enabled;seq++;$('weatherPanel').hidden=!enabled;$('weatherSwitches').hidden=!enabled;$('weatherToggle').setAttribute('aria-pressed',String(enabled));
    document.body.classList.toggle('weather-open',enabled);
    if(enabled){selected=hour(Date.now());$('weatherHour').value=0;forecast();refreshWarnings();}else{style();if(popup)popup.remove();}
  }
  api.mount=function(m){
    map=m;
    if(root.SSWeatherZones){SSWeatherZones.onstatus=badge;SSWeatherZones.mount(m);}
    map.on('style.load',function(){labelPaint={};if(enabled)style();});
    map.on('error',function(e){if(enabled && e.sourceId==='weather-forecast'){tileFailed=true;badge();$('weatherStatus').textContent='Прогнозният слой не е достъпен за този час.';}});
    map.on('sourcedata',function(e){if(enabled && e.sourceId==='weather-forecast' && e.isSourceLoaded && !tileFailed)$('weatherStatus').textContent='Прогнозен модел · обща картина, не точност по улици';});
    map.on('click','weather-warning-fill',function(e){
      if(!enabled)return;
      var ids=['pts-hit','secs','secs-up','cams'].filter(function(id){return !!map.getLayer(id);});
      if(ids.length && map.queryRenderedFeatures(e.point,{layers:ids}).length)return;
      popupFor(e.features[0].properties,e.lngLat);
    });
    $('weatherToggle').onclick=toggle;$('weatherClose').onclick=toggle;
    $('weatherInfoBtn').onclick=function(){$('weatherInfo').showModal();};
    $('weatherRain').onclick=function(){layer='precip';forecast();};$('weatherWind').onclick=function(){layer='wind';forecast();};
    $('weatherHour').oninput=function(){selected=hour(Date.now())+Number(this.value)*3600000;$('weatherTime').textContent='Прогноза: '+label(selected);};
    $('weatherHour').onchange=forecast;
    $('weatherNow').onclick=function(){selected=hour(Date.now());$('weatherHour').value=0;forecast();refreshWarnings();};
    $('weatherLegend').onerror=function(){this.hidden=true;$('weatherStatus').textContent='Легендата не е достъпна.';};
    $('weatherLegend').onload=function(){this.hidden=false;};
    document.addEventListener('visibilitychange',function(){if(enabled&&!document.hidden)refreshWarnings();});
    setInterval(function(){if(enabled&&!document.hidden){updateWarnings();refreshWarnings();if(root.SSWeatherZones)SSWeatherZones.show(layer==='precip',selected);}},60000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
