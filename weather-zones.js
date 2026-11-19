(function(root){
  'use strict';
  // Bilinear forecast fields; null remains unknown, never dry/clear/zero degrees.
  var defaultFields=[0,1,2,3];
  function sample(data, hour, lon, lat, fields, out) {
    var g=data.grid,x=(lon-g.west)/g.step,y=(lat-g.south)/g.step;
    if(x<0||y<0||x>g.cols-1||y>g.rows-1)return null;
    var a=Math.min(Math.floor(x),g.cols-2),b=Math.min(Math.floor(y),g.rows-2),dx=x-a,dy=y-b;
    var i=b*g.cols+a,c0=data.cells[i],c1=data.cells[i+1],c2=data.cells[i+g.cols],c3=data.cells[i+g.cols+1];
    var w0=(1-dx)*(1-dy),w1=dx*(1-dy),w2=(1-dx)*dy,w3=dx*dy;
    fields=fields||defaultFields;out=out||[];
    for(var f=0;f<fields.length;f++){
      var n=fields[f],v0=c0[n][hour],v1=c1[n][hour],v2=c2[n][hour],v3=c3[n][hour];
      out[f]=v0===null||v1===null||v2===null||v3===null?null:v0*w0+v1*w1+v2*w2+v3*w3;
    }
    return out;
  }
  function windAt(data,h,lon,lat) {
    if(data.windComponents!=='towards-east-north-kmh')return null;
    var v=sample(data,h,lon,lat,[4,5]);if(!v||v.some(function(n){return n===null;}))return null;
    return {speed:Math.hypot(v[0],v[1]),towards:(Math.atan2(v[0],v[1])*180/Math.PI+360)%360};
  }
  function thermometer(t){return t===null?null:{level:Math.max(.08,Math.min(1,(t+20)/60)),color:t<0?'#21b8ff':t<20?'#28dcf0':t<30?'#ffb32c':'#ff652b'};}
  function fogSignal(code,visibility,humidity){
    if(!Number.isFinite(code)||!Number.isFinite(visibility)||!Number.isFinite(humidity))return null;
    return [45,48].includes(code)&&visibility<1000&&humidity>=90;
  }
  function hazardSignal(m,h,kind){
    if(!m||h<0)return null;
    var code=m.weather_code[h],t=m.temperature_2m[h];
    if(kind==='fog')return fogSignal(code,m.visibility[h],m.relative_humidity_2m[h]);
    if([56,57,66,67].includes(code))return 'freezing-rain';
    if(code===48&&Number.isFinite(t)&&t<=0&&fogSignal(code,m.visibility[h],m.relative_humidity_2m[h]))return 'freezing-fog';
    // Screening risk only: air temperature and recent liquid precipitation do not measure road ice.
    if(Number.isFinite(t)&&t<=0)for(var i=Math.max(0,h-3);i<h;i++)if(Number.isFinite(m.temperature_2m[i])&&m.temperature_2m[i]>0&&Number.isFinite(m.precipitation[i])&&m.precipitation[i]>=.2)return 'refreezing';
    return Number.isFinite(code)&&Number.isFinite(t)?false:null;
  }
  function conditions(data,h,lon,lat){
    var v=sample(data,h,lon,lat),g=data.grid;if(!v)return [];
    // WMO categories use the nearest model cell, never interpolation.
    var cell=data.cells[Math.round((lat-g.south)/g.step)*g.cols+Math.round((lon-g.west)/g.step)],code=cell[6]?cell[6][h]:null,result=[];
    var fog=data.model==='icon_eu'&&fogSignal(code,cell[7]&&cell[7][h],cell[8]&&cell[8][h]);
    if([56,57,66,67].includes(code)||(code===48&&fog&&Number.isFinite(cell[0][h])&&cell[0][h]<=0))result.push({kind:'ice',icon:'ice',text:'Риск от заледяване'});
    if(fog)result.push({kind:'fog',icon:'mist',text:'Възможна мъгла'});
    if([71,73,75,77,85,86].includes(code)||v[3]>=.1)result.push({kind:'snow',icon:'snowflake',text:'Сняг'});
    else if(v[2]>=.1&&!result.some(function(c){return c.kind==='ice';}))result.push({kind:'rain',icon:'cloud-rain',text:'Дъжд'});
    var w=windAt(data,h,lon,lat);if(w&&w.speed>=10)result.push({kind:'wind',icon:'wind',text:Math.round(w.speed)+' км/ч',towards:w.towards});
    return result;
  }
  function condition(d,h,point){
    var v=sample(d,h,point[0],point[1]);
    return conditions(d,h,point[0],point[1]).find(function(c){return c.kind!=='wind';})||(!v||v[1]===null?{icon:'cloud',text:'Няма данни за облачността'}:v[1]>=75?{icon:'cloud',text:'Облачно'}:v[1]>=25?{icon:'partly-cloudy',text:'Променлива облачност'}:{icon:'sun',text:'Ясно'});
  }
  function contains(geometry,p){
    function ring(r){var inside=false;for(var i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])inside=!inside;return inside;}
    return (geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).some(function(poly){return ring(poly[0])&&!poly.slice(1).some(ring);});
  }
  // The coarse grid only selects candidates; it must never paint a hazard itself.
  function riskCandidates(d,h,municipalities){
    if(!municipalities||!d||h<0)return [];
    return municipalities.features.filter(function(f){return f.properties.cells.some(function(i){var c=d.cells[i];if(!c||!c[6])return false;
      if([45,48,56,57,66,67].includes(c[6][h]))return true;
      if(Number.isFinite(c[0][h])&&c[0][h]<=0)for(var j=Math.max(0,h-3);j<h;j++)if(Number.isFinite(c[0][j])&&c[0][j]>0&&Number.isFinite(c[2][j])&&c[2][j]>=.2)return true;
      return false;
    });});
  }
  function riskZones(d,h,municipalities,evidence){
    var features=[];
    if(!municipalities||!evidence||h<0||!['west','south','step','cols','rows'].every(function(k){return municipalities.grid[k]===d.grid[k];}))return {type:'FeatureCollection',features:features};
    riskCandidates(d,h,municipalities).forEach(function(f){
      var entry=evidence[f.properties.id];if(!entry||Date.now()-entry.generated>7200000||!entry.points||entry.points.length!==3)return;
      var hour=entry.times.indexOf(d.times[h]);if(hour<0)return;
      ['fog','ice'].forEach(function(kind){
        var models=['icon_eu','gfs_global'],votes=models.map(function(model){return entry.points.map(function(p){return hazardSignal(p.models[model],hour,kind);});});
        var counts=votes.map(function(v){return v.filter(Boolean).length;}),winner=counts[0]>=2?0:counts[1]>=2?1:-1;
        if(winner<0)return;
        var at=votes[winner].findIndex(Boolean),m=entry.points[at].models[models[winner]];
        features.push({type:'Feature',properties:{kind:kind,id:f.properties.id,municipality:f.properties.name,bbox:f.properties.bbox,model:models[winner],supported:counts[winner],disagreement:votes[0].some(function(v,i){return v!==null&&votes[1][i]!==null&&!!v!==!!votes[1][i];}),incomplete:votes.some(function(v){return v.includes(null);}),reason:kind==='fog'?'fog':votes[winner][at],visibility:m.visibility[hour],temperature:m.temperature_2m[hour],generated:entry.generated},geometry:f.geometry});
      });
    });
    return {type:'FeatureCollection',features:features};
  }
  var api={sample:sample,windAt:windAt,thermometer:thermometer,conditions:conditions,condition:condition,contains:contains,riskZones:riskZones,riskCandidates:riskCandidates,fogSignal:fogSignal,hazardSignal:hazardSignal};root.SSWeatherZones=api;if(typeof module!=='undefined')module.exports=api;
  if(typeof document==='undefined')return;
  var map,data,pending,active=false,time=0,mode="overview";
  var $=function(id){return document.getElementById(id);};
  var markers=[],popup,municipalities,municipalitiesPending,municipalityFailed=false;
  var evidence={},evidenceBusy=0,evidencePending=new Set(),evidenceRetry={},evidenceFailed=false;
  function loadRiskEvidence(){
    if(!active||!data||!municipalities||!map.getStyle())return;
    var h=data.times.indexOf(time/1000),bounds=map.getBounds(),now=Date.now();
    var needed=riskCandidates(data,h,municipalities).filter(function(f){var b=f.properties.bbox,id=f.properties.id;return b[2]>=bounds.getWest()&&b[0]<=bounds.getEast()&&b[3]>=bounds.getSouth()&&b[1]<=bounds.getNorth()&&(!evidence[id]||now-evidence[id].generated>3600000)&&!evidencePending.has(id)&&(!evidenceRetry[id]||now-evidenceRetry[id]>60000);}).map(function(f){return f.properties.id;});
    while(needed.length&&evidenceBusy<2){
      (function(ids){
        evidenceBusy++;ids.forEach(function(id){evidencePending.add(id);});
        fetch('/.netlify/functions/weather-risks?ids='+encodeURIComponent(ids.join(',')),{signal:AbortSignal.timeout(18000)}).then(function(r){if(!r.ok)throw Error('Unavailable');return r.json();}).then(function(d){
          if(d.schema!==1||!Array.isArray(d.municipalities)||d.municipalities.length!==ids.length||new Set(d.municipalities.map(function(e){return e.id;})).size!==ids.length)throw Error('Invalid evidence');
          d.municipalities.forEach(function(e){
            if(!ids.includes(e.id)||!Number.isFinite(e.generated)||e.generated>Date.now()+60000||Date.now()-e.generated>7200000||!Array.isArray(e.times)||e.times.length!==63||e.times.some(function(t,i){return !Number.isInteger(t)||(i&&t-e.times[i-1]!==3600);})||!Array.isArray(e.points)||e.points.length!==3)throw Error('Invalid local forecast');
            e.points.forEach(function(p){['icon_eu','gfs_global'].forEach(function(model){['weather_code','visibility','relative_humidity_2m','temperature_2m','precipitation'].forEach(function(k){var a=p.models&&p.models[model]&&p.models[model][k];if(!Array.isArray(a)||a.length!==e.times.length||a.some(function(v){return v!==null&&!Number.isFinite(v);}))throw Error('Invalid fields');});});});
          });
          d.municipalities.forEach(function(e){evidence[e.id]=e;delete evidenceRetry[e.id];});
        }).catch(function(){ids.forEach(function(id){evidenceRetry[id]=Date.now();delete evidence[id];});}).finally(function(){
          ids.forEach(function(id){evidencePending.delete(id);});evidenceBusy--;riskData=null;evidenceFailed=Object.keys(evidenceRetry).length>0;
          if(active){render();loadRiskEvidence();}
        });
      })(needed.splice(0,8));
    }
  }
  function icon(name){var img=document.createElement('img');img.src='lib/weather-icons/'+name+'.svg';img.alt='';return img;}
  function closeDetails(){if(popup){popup.remove();popup=null;}}
  function riskDetails(f,at){
    closeDetails();var p=f.properties,box=document.createElement('div');box.className='weather-place-details';
    var title=document.createElement('strong');title.textContent=p.kind==='fog'?'Възможна мъгла':'Риск от заледяване';box.append(title);
    function row(text){var el=document.createElement('p');el.textContent=text;box.append(el);}
    row('Община '+p.municipality+' · '+new Date(time).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}));
    row('Видимост: '+(Number.isFinite(p.visibility)?Math.round(p.visibility)+' м':'няма данни')+' · '+(Number.isFinite(p.temperature)?p.temperature.toFixed(1)+'°C':'няма температура'));
    row('Основание: '+({fog:'ниска видимост и прогноза за мъгла','freezing-rain':'замръзващ дъжд / ръмеж','freezing-fog':'преохладена мъгла','refreezing':'студ след скорошен валеж'}[p.reason]));
    row(p.disagreement?'Несигурност: моделите се разминават.':p.incomplete?'Част от данните липсват.':'Сходен сигнал от двата модела.');
    row('Обновено: '+new Date(p.generated).toLocaleTimeString('bg-BG',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit'})+' · Open-Meteo');
    var more=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Как е оценено';more.append(summary);
    var explanation=document.createElement('p');explanation.textContent=p.supported+'/3 вътрешни точки · '+p.model.toUpperCase().replace('_','-')+'. Показаните стойности са за една точка, температурата е на въздуха. Контурът не означава риск навсякъде в общината. Моделна прогноза, не предупреждение на НИМХ.'+(p.kind==='ice'?' Няма измерване на температурата и мокротата на пътя.':'');more.append(explanation);box.append(more);
    var rect=map.getContainer().getBoundingClientRect(),position=map.project(at),width=rect.width;
    var top=document.querySelector('.top').getBoundingClientRect().bottom-rect.top,bottom=$('weatherPanel').getBoundingClientRect().top-rect.top,below=position.y<(top+bottom)/2,anchor=below?'top':'bottom';
    if(position.x<125)anchor+='-left';else if(position.x>width-125)anchor+='-right';
    popup=new maplibregl.Popup({className:'weather-place-popup weather-risk-popup '+p.kind,maxWidth:'240px',anchor:anchor,offset:12,closeOnMove:true,focusAfterOpen:true}).setLngLat(at).setDOMContent(box).addTo(map);
    popup.getElement().querySelector('.maplibregl-popup-content').style.maxHeight=Math.max(90,Math.min(270,below?bottom-position.y-24:position.y-top-24))+'px';
    var opened=popup;popup.on('close',function(){if(popup===opened)popup=null;});var close=popup.getElement().querySelector('button');if(close)close.setAttribute('aria-label','Затвори прогнозата');
  }
  function details(place,h,button){
    closeDetails();var v=sample(data,h,place.point[0],place.point[1]),w=windAt(data,h,place.point[0],place.point[1]);
    if(!v)return;
    var box=document.createElement('div');box.className='weather-place-details';
    var title=document.createElement('strong');title.textContent=place.name+' · '+new Date(data.times[h]*1000).toLocaleTimeString('bg-BG',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit'});box.append(title);
    function row(img,text){var p=document.createElement('p');p.append(icon(img),document.createTextNode(text));box.append(p);return p;}
    row('temperature',v[0]===null?'Температура: няма данни':Math.round(v[0])+'°C');
    var wind=row('wind',w?('Вятър '+Math.round(w.speed)+' км/ч'):'Вятър: няма данни');
    if(w&&w.speed>=.5){var arrow=icon('arrow-up');arrow.className='weather-place-arrow';arrow.style.transform='rotate('+(w.towards-map.getBearing())+'deg)';wind.append(arrow);wind.title='Към '+['север','североизток','изток','югоизток','юг','югозапад','запад','северозапад'][Math.round(w.towards/45)%8];}
    row('cloud-rain',v[2]===null?'Валежи: няма данни':'Валежи '+v[2].toLocaleString('bg-BG',{minimumFractionDigits:1,maximumFractionDigits:1})+' мм/ч');
    var c=condition(data,h,place.point);row(c.icon,c.text);
    button.setAttribute('aria-expanded','true');
    var rect=button.getBoundingClientRect(),mapRect=map.getContainer().getBoundingClientRect(),at=map.unproject([rect.x+rect.width/2-mapRect.x,rect.y+rect.height/2-mapRect.y]);
    popup=new maplibregl.Popup({className:'weather-place-popup',maxWidth:'230px',offset:22,closeOnMove:true,focusAfterOpen:true}).setLngLat(at).setDOMContent(box).addTo(map);
    var opened=popup;popup.on('close',function(){button.setAttribute('aria-expanded','false');if(popup===opened)popup=null;});
    var close=popup.getElement().querySelector('button');if(close)close.setAttribute('aria-label','Затвори прогнозата');
  }
  var placePaint=new Map(),placeStyle;
  function placeNames(names){
    if(placeStyle!==map.style){placeStyle=map.style;placePaint.clear();}
    map.getStyle().layers.filter(function(l){return l.type==='symbol'&&l['source-layer']==='place'&&l.id!=='place_continent';}).forEach(function(l){
      if(!placePaint.has(l.id))placePaint.set(l.id,{opacity:map.getPaintProperty(l.id,'text-opacity'),transition:map.getPaintProperty(l.id,'text-opacity-transition')});
      var original=placePaint.get(l.id);
      // Paint hides the original immediately; filters leave fading copies during symbol placement.
      var opacity=names.length?['case',['in',['coalesce',['get','name:bg'],['get','name'],''],['literal',names]],0,original.opacity===undefined?1:original.opacity]:original.opacity;
      map.setPaintProperty(l.id,'text-opacity-transition',names.length?{duration:0,delay:0}:(original.transition||null));
      if(JSON.stringify(map.getPaintProperty(l.id,'text-opacity'))!==JSON.stringify(opacity))map.setPaintProperty(l.id,'text-opacity',opacity===undefined?null:opacity);
    });
  }
  function settlePlaceLabels(){
    if(!active||!markers.length||map.isMoving())return;
    var box=map.getContainer().getBoundingClientRect(),layers=map.getStyle().layers.filter(function(l){return l.type==='symbol'&&l['source-layer']==='place';}).map(function(l){return l.id;});
    if(!layers.length)return;
    var kept=markers.filter(function(marker){
      var el=marker.getElement(),r=el.getBoundingClientRect(),name=el.firstChild.textContent;
      var collision=map.queryRenderedFeatures([[r.left-box.left-4,r.top-box.top-4],[r.right-box.left+4,r.bottom-box.top+4]],{layers:layers}).some(function(f){var n=f.properties['name:bg']||f.properties.name;return n&&n!==name;});
      if(collision)marker.remove();return !collision;
    });
    // Hiding a base label can reveal a neighboring label after MapLibre lays out symbols.
    if(kept.length!==markers.length){markers=kept;placeNames(markers.map(function(m){return m.getElement().firstChild.textContent;}));}
  }
  function zoneMarkers(t){
    closeDetails();markers.forEach(function(m){m.remove();});markers=[];
    var h=data?data.times.indexOf((typeof t==='number'?t:time)/1000):-1;if(!map.getStyle())return;if(!active||h<0){placeNames([]);return;}
    var box=map.getContainer().getBoundingClientRect(),occupied=[],seen=new Set(),center=map.getCenter(),bounds=map.getBounds();
    var obstacles=Array.from(document.querySelectorAll('.top,.chips,.side,.spdw,.maplibregl-ctrl,#weatherPanel,#bottomBar,.weather-warning-label,.weather-risk-label')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width&&r.height;});
    var places=[];
    // Reuse names already in the map tiles: no external geocoding or location transfer.
    var placeFeatures=[];new Set(map.getStyle().layers.filter(function(l){return l['source-layer']==='place';}).map(function(l){return l.source;})).forEach(function(source){placeFeatures=placeFeatures.concat(map.querySourceFeatures(source,{sourceLayer:'place'}));});
    placeFeatures.forEach(function(f){
      var p=f.properties,name=p['name:bg']||p.name;
      if(name&&f.geometry.type==='Point'&&map.getZoom()>=({city:0,town:9,village:12,suburb:13,neighbourhood:13,hamlet:14}[p.class]??Infinity))places.push({name:name,point:f.geometry.coordinates,rank:p.class==='city'?0:p.class==='town'?1:2});
    });
    places.sort(function(a,b){return a.rank-b.rank||map.project(a.point).dist(map.project(center))-map.project(b.point).dist(map.project(center));});
    // ponytail: at most 3 phone / 5 desktop forecasts; minor places appear only at local zoom.
    places.forEach(function(place){
      if(markers.length>=(box.width<600?3:5)||seen.has(place.name)||!bounds.contains(place.point))return;
      var v=sample(data,h,place.point[0],place.point[1]);if(!v)return;
      var c=condition(data,h,place.point),temp=v[0]===null?'— °C':Math.round(v[0])+'°C';
      var el=document.createElement('button');el.type='button';el.className='weather-place-label';el.setAttribute('aria-expanded','false');el.setAttribute('aria-label',place.name+': '+c.text+', '+temp+'. Подробности за прогнозата');
      var name=document.createElement('span');name.textContent=place.name;var value=document.createElement('span');value.textContent=temp;
      var symbol=icon(mode==='temperature'?'temperature':mode==='wind'?'wind':mode==='cloud'?'cloud':c.icon);
      if(mode==='overview'){symbol.src='lib/weather-icons/color/'+c.icon+'.svg';symbol.classList.add('weather-condition-icon');}
      if(mode==='wind'){var w=windAt(data,h,place.point[0],place.point[1]);value.textContent=w?Math.round(w.speed)+' км/ч':'— км/ч';if(w&&w.speed>=.5){symbol=icon('arrow-up');symbol.style.transform='rotate('+(w.towards-map.getBearing())+'deg)';}}
      if(mode==='cloud')value.textContent=v[1]===null?'— %':Math.round(v[1])+'%';
      // Precipitation view matches the approved icon + temperature map labels.
      el.setAttribute('aria-label',place.name+': '+(mode==='overview'?c.text+', ':'')+value.textContent+'. Подробности за прогнозата');el.append(name,symbol,value);
      el.onclick=function(e){e.stopPropagation();details(place,h,el);};
      var marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(place.point).addTo(map),r=el.getBoundingClientRect(),anchor=map.project(place.point),width=r.width,height=r.height;
      var placeLayers=map.getStyle().layers.filter(function(l){return l.type==='symbol'&&l['source-layer']==='place';}).map(function(l){return l.id;});
      var offsets=[[0,14],[0,-14],[0,28],[0,-28]],fits=false;
      for(var i=0;i<offsets.length;i++){
        // Marker transforms update on the next frame; measure candidates from their projected anchor.
        r={left:box.left+anchor.x+offsets[i][0]-width/2,right:box.left+anchor.x+offsets[i][0]+width/2,top:box.top+anchor.y+offsets[i][1]-height/2,bottom:box.top+anchor.y+offsets[i][1]+height/2};
        var nearby=placeLayers.length?map.queryRenderedFeatures([[r.left-box.left-8,r.top-box.top-8],[r.right-box.left+8,r.bottom-box.top+8]],{layers:placeLayers}):[];
        var coversName=nearby.some(function(f){var n=f.properties['name:bg']||f.properties.name;return n&&n!==place.name&&!seen.has(n);});
        var overlaps=obstacles.concat(occupied).some(function(o){return r.left<o.right+8&&r.right>o.left-8&&r.top<o.bottom+8&&r.bottom>o.top-8;});
        if(!coversName&&!overlaps&&r.left>=box.left+8&&r.right<=box.right-8&&r.top>=box.top+8&&r.bottom<=box.bottom-8){fits=true;break;}
      }
      if(!fits){marker.remove();return;}
      marker.setOffset(offsets[i]);occupied.push({left:r.left-24,right:r.right+24,top:r.top-24,bottom:r.bottom+24});markers.push(marker);seen.add(place.name);
    });
    placeNames(Array.from(seen));
  }
  var riskMarkers=[],riskData,riskTime,riskFeatures,riskRenderedSource,riskRenderedFeatures,riskRenderedView;
  function drawRisks(h){
    if(!map.getStyle())return;
    if(active&&h>=0&&(riskData!==data||riskTime!==time)){riskFeatures=riskZones(data,h,municipalities,evidence);riskData=data;riskTime=time;}
    var fc=active&&h>=0?riskFeatures:{type:'FeatureCollection',features:[]};
    var center=map.getCenter(),box=map.getContainer().getBoundingClientRect(),view=[center.lng,center.lat,map.getZoom(),map.getPitch(),map.getBearing(),box.width,box.height].join(',');
    if(active&&h>=0&&riskRenderedFeatures===fc&&riskRenderedView===view&&riskRenderedSource===map.getSource('weather-risks'))return;
    riskMarkers.forEach(function(m){m.remove();});riskMarkers=[];
    var before=map.getStyle().layers.find(function(l){return l['source-layer']==='building'||l.type==='fill-extrusion'||(l.type==='line'&&l['source-layer']==='transportation');});
    if(!map.getSource('weather-risks')&&active&&h>=0){
      map.addSource('weather-risks',{type:'geojson',data:fc,attribution:'Municipal boundaries: <a href="https://www.geoboundaries.org/">geoBoundaries</a> / Wikimedia (2019)'});
      map.addLayer({id:'weather-risk-fill',type:'fill',source:'weather-risks',paint:{'fill-color':['match',['get','kind'],'ice','#9edafa','#fff1a3'],'fill-opacity':0,'fill-outline-color':'rgba(0,0,0,0)'}},before?before.id:'route');
      ['fog','ice'].forEach(function(kind){map.addLayer({id:'weather-risk-'+kind,type:'line',source:'weather-risks',filter:['==','kind',kind],paint:{'line-color':kind==='ice'?'#168ed0':'#e5b000','line-width':1,'line-opacity':.6,'line-blur':.4}},before?before.id:'route');});
    }else if(map.getSource('weather-risks')&&riskRenderedFeatures!==fc)map.getSource('weather-risks').setData(fc);
    riskRenderedSource=map.getSource('weather-risks');riskRenderedFeatures=fc;riskRenderedView=view;
    (fc.features||[]).forEach(function(f){
      var bounds=map.getBounds(),b=f.properties.bbox;
      if(b&&(b[2]<bounds.getWest()||b[0]>bounds.getEast()||b[3]<bounds.getSouth()||b[1]>bounds.getNorth()))return;
      if(b){var corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]].map(function(p){return map.project(p);});if(Math.max.apply(null,corners.map(function(p){return p.x;}))-Math.min.apply(null,corners.map(function(p){return p.x;}))<65||Math.max.apply(null,corners.map(function(p){return p.y;}))-Math.min.apply(null,corners.map(function(p){return p.y;}))<24)return;}

      var box=map.getContainer().getBoundingClientRect(),candidates=[SSWeather.areaPoint(f.geometry)],obstacles=Array.from(document.querySelectorAll('.top,.chips,.side,.spdw,.maplibregl-ctrl,#weatherPanel,#bottomBar,.weather-warning-label')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width&&r.height;});
      [.45,.55,.35,.65,.75,.25].forEach(function(y){[.45,.3,.6,.2,.7].forEach(function(x){var ll=map.unproject([box.width*x,box.height*y]);candidates.push([ll.lng,ll.lat]);});});
      var el=document.createElement('div'),ice=f.properties.kind==='ice';el.className='weather-risk-label '+f.properties.kind;el.setAttribute('aria-label',(ice?'Прогнозен риск от заледяване':'Прогнозна мъгла')+' в части от общината');
      el.append(icon(ice?'snowflake':'mist'));var text=document.createElement('span');text.textContent=ice?'Риск от заледяване':'Възможна мъгла';el.append(text);
      el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',text.textContent+' · '+f.properties.municipality+' · подробности');
      el.addEventListener('click',function(e){e.stopPropagation();riskDetails(f,marker.getLngLat());});el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();riskDetails(f,marker.getLngLat());}});
      var marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(candidates[0]).addTo(map),fits=false;
      for(var n=0;n<candidates.length;n++){
        if(!contains(f.geometry,candidates[n])||!map.getBounds().contains(candidates[n]))continue;
        marker.setLngLat(candidates[n]);var r=el.getBoundingClientRect();
        var covered=obstacles.concat(riskMarkers.map(function(m){return m.getElement().getBoundingClientRect();})).some(function(o){return r.left<o.right+6&&r.right>o.left-6&&r.top<o.bottom+6&&r.bottom>o.top-6;});
        if(covered||r.left<box.left+8||r.right>box.right-8||r.top<box.top+8||r.bottom>box.bottom-8)continue;
        fits=[[r.left,r.top],[r.right,r.top],[r.right,r.bottom],[r.left,r.bottom]].every(function(p){var ll=map.unproject([p[0]-box.left,p[1]-box.top]);return contains(f.geometry,[ll.lng,ll.lat]);});
        if(fits)break;
      }
      if(fits)riskMarkers.push(marker);else marker.remove();
    });
  }
  function render(){
    var h=data?data.times.indexOf(time/1000):-1;
    drawRisks(h);zoneMarkers();
    if(!active||h<0){if(active&&data)status('Няма данни за този час.',true);return;}
    loadRiskEvidence();
    if(active&&data)status(h>=0?'Open-Meteo · ICON-EU за общия слой (~25 км). Рисковете се проверяват отделно в 3 вътрешни точки с ICON-EU и GFS. Общинският контур не е точната граница на явлението. Липсата на зона не изключва локална мъгла или поледица.':'Няма данни за зоните за този час.',h<0);
  }
  function status(message,failed){document.getElementById('weatherZoneStatus').textContent=message+(municipalityFailed?' Общинските граници са недостъпни; рисковите зони не се показват.':'')+(evidenceBusy?' Проверка на местните рискове…':'')+(evidenceFailed?' Част от местните проверки са недостъпни; липсата на зона не означава безопасни условия.':'');api.failed=failed||municipalityFailed||evidenceFailed;if(api.onstatus)api.onstatus();}
  api.mount=function(m){map=m;map.on('idle',settlePlaceLabels);map.on('moveend',function(){drawRisks(data?data.times.indexOf(time/1000):-1);zoneMarkers();loadRiskEvidence();});map.on('resize',function(){drawRisks(data?data.times.indexOf(time/1000):-1);zoneMarkers();loadRiskEvidence();});map.on('style.load',function(){if(active)render();});
    map.on('click',function(e){
      if(!active||!map.getLayer('weather-risk-fill')||e.originalEvent&&e.originalEvent.target.closest('.weather-risk-label,.weather-place-label,.weather-warning-label'))return;
      var priority=['weather-warning-fill','pts-hit','secs','secs-up','cams'].filter(function(id){return !!map.getLayer(id);});if(priority.length&&map.queryRenderedFeatures(e.point,{layers:priority}).length)return;
      var f=map.queryRenderedFeatures(e.point,{layers:['weather-risk-fill']})[0];if(f)riskDetails(f,e.lngLat);
    });
    var refresh;map.on('sourcedata',function(e){if(!active||e.sourceId==='weather-zones'||e.sourceId==='weather-risks'||e.sourceId==='weather-warnings'||e.sourceId==='weather-forecast')return;clearTimeout(refresh);refresh=setTimeout(function(){if(!map.isMoving()&&!popup)zoneMarkers();},250);});};
  api.preview=function(t){zoneMarkers(t);};
  api.show=function(enabled,t,nextMode){
    active=enabled;time=t;if(nextMode)mode=nextMode;
    if(data&&Date.now()-data.generated>7200000)data=null;
    if(active&&!municipalities&&!municipalitiesPending)municipalitiesPending=fetch('weather-municipalities.geojson',{signal:AbortSignal.timeout(15000)}).then(function(r){if(!r.ok)throw new Error('Municipalities unavailable');return r.json();}).then(function(d){
      if(d.type!=='FeatureCollection'||!d.grid||!Array.isArray(d.features)||d.features.length!==265||d.features.some(function(f){return !f.properties||!Array.isArray(f.properties.cells)||!f.properties.cells.length||f.properties.cells.some(function(i){return !Number.isInteger(i)||i<0||i>=288;})||!f.geometry||!['Polygon','MultiPolygon'].includes(f.geometry.type);}))throw new Error('Invalid municipalities');
      municipalities=d;municipalityFailed=false;riskData=null;render();
    }).catch(function(){municipalityFailed=true;render();status('Прогнозата е налична само без общински рискови зони.',false);}).finally(function(){municipalitiesPending=null;});
    render();if(!active||data||pending)return;
    status('Зареждане на метеорологичните зони…',false);
    pending=fetch('/.netlify/functions/weather-zones?v=5',{signal:AbortSignal.timeout(25000)}).then(function(r){if(!r.ok)throw new Error('Unavailable');return r.json();}).then(function(d){
      if(!d.grid||d.grid.cols!==24||d.grid.rows!==12||!Array.isArray(d.cells)||d.cells.length!==288||!Array.isArray(d.times)||!Number.isFinite(d.generated)||Date.now()-d.generated>7200000||d.model!=='icon_eu'||d.windComponents!=='towards-east-north-kmh'||d.cells.some(function(c){return !Array.isArray(c)||c.length!==9||c.some(function(a){return !Array.isArray(a)||a.length!==d.times.length||a.some(function(v){return v!==null&&!Number.isFinite(v);});});}))throw new Error('Invalid grid');
      data=d;api.failed=false;render();
    }).catch(function(){data=null;render();status('Метеорологичните зони са недостъпни.',true);}).finally(function(){pending=null;});
  };
})(typeof window!=='undefined'?window:globalThis);
