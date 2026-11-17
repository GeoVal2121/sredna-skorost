(function(root){
  'use strict';
  // Bilinear forecast fields; null remains unknown, never dry/clear/zero degrees.
  function sample(data, hour, lon, lat, fields) {
    var g=data.grid,x=(lon-g.west)/g.step,y=(lat-g.south)/g.step;
    if(x<0||y<0||x>g.cols-1||y>g.rows-1)return null;
    var a=Math.min(Math.floor(x),g.cols-2),b=Math.min(Math.floor(y),g.rows-2),dx=x-a,dy=y-b;
    var ids=[b*g.cols+a,b*g.cols+a+1,(b+1)*g.cols+a,(b+1)*g.cols+a+1],weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy];
    return (fields||[0,1,2,3]).map(function(f){var v=ids.map(function(i){return data.cells[i][f][hour];});return v.some(function(n){return n===null;})?null:v.reduce(function(s,n,i){return s+n*weights[i];},0);});
  }
  function windAt(data,h,lon,lat) {
    if(data.windComponents!=='towards-east-north-kmh')return null;
    var v=sample(data,h,lon,lat,[4,5]);if(!v||v.some(function(n){return n===null;}))return null;
    return {speed:Math.hypot(v[0],v[1]),towards:(Math.atan2(v[0],v[1])*180/Math.PI+360)%360};
  }
  function thermometer(t){return t===null?null:{level:Math.max(.08,Math.min(1,(t+20)/60)),color:t<0?'#21b8ff':t<20?'#28dcf0':t<30?'#ffb32c':'#ff652b'};}
  function conditions(data,h,lon,lat){
    var v=sample(data,h,lon,lat),g=data.grid;if(!v)return [];
    // WMO categories use the nearest model cell, never interpolation.
    var cell=data.cells[Math.round((lat-g.south)/g.step)*g.cols+Math.round((lon-g.west)/g.step)],code=cell[6]?cell[6][h]:null,result=[];
    if([48,56,57,66,67].includes(code))result.push({kind:'ice',icon:'ice',text:'Риск от заледяване'});
    if([45,48].includes(code))result.push({kind:'fog',icon:'mist',text:'Мъгла'});
    if([71,73,75,77,85,86].includes(code)||v[3]>=.1)result.push({kind:'snow',icon:'snowflake',text:'Сняг'});
    else if(v[2]>=.1&&!result.some(function(c){return c.kind==='ice';}))result.push({kind:'rain',icon:'cloud-rain',text:'Дъжд'});
    var w=windAt(data,h,lon,lat);if(w&&w.speed>=10)result.push({kind:'wind',icon:'wind',text:Math.round(w.speed)+' км/ч',towards:w.towards});
    return result;
  }
  function condition(d,h,point){
    var v=sample(d,h,point[0],point[1]);
    return conditions(d,h,point[0],point[1]).find(function(c){return c.kind!=='wind';})||(!v||v[1]===null?{icon:'cloud',text:'Няма данни за облачността'}:v[1]>=50?{icon:'cloud',text:'Облачно'}:{icon:'sun',text:'Ясно'});
  }
  function contains(geometry,p){
    function ring(r){var inside=false;for(var i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])inside=!inside;return inside;}
    return (geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).some(function(poly){return ring(poly[0])&&!poly.slice(1).some(ring);});
  }
  var api={sample:sample,windAt:windAt,thermometer:thermometer,conditions:conditions,condition:condition,contains:contains};root.SSWeatherZones=api;if(typeof module!=='undefined')module.exports=api;
  if(typeof document==='undefined')return;
  var map,data,pending,canvas=document.createElement('canvas'),active=false,time=0;
  canvas.width=560;canvas.height=360;
  var ctx=canvas.getContext('2d'),drawnData=null,drawnTime=null,drawnActive=null;
  function merc(lat){return Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));}
  var $=function(id){return document.getElementById(id);};
  var markers=[],regions=[],regionsPending,popup;
  function icon(name){var img=document.createElement('img');img.src='lib/weather-icons/'+name+'.svg';img.alt='';return img;}
  function closeDetails(){if(popup){popup.remove();popup=null;}}
  function details(place,h,button){
    closeDetails();var v=sample(data,h,place.point[0],place.point[1]),w=windAt(data,h,place.point[0],place.point[1]);
    if(!v)return;
    var box=document.createElement('div');box.className='weather-place-details';
    var title=document.createElement('strong');title.textContent=place.name+' · '+new Date(data.times[h]*1000).toLocaleTimeString('bg-BG',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit'});box.append(title);
    function row(img,text){var p=document.createElement('p');p.append(icon(img),document.createTextNode(text));box.append(p);return p;}
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
  function zoneMarkers(t){
    closeDetails();markers.forEach(function(m){m.remove();});markers=[];
    var h=data?data.times.indexOf((typeof t==='number'?t:time)/1000):-1;if(!active||h<0)return;
    var box=map.getContainer().getBoundingClientRect(),occupied=[],seen=new Set(),center=map.getCenter(),bounds=map.getBounds();
    var obstacles=Array.from(document.querySelectorAll('.top,.chips,.side,.spdw,.maplibregl-ctrl,#weatherPanel,#bottomBar,.weather-warning-label')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width&&r.height;});
    var places=[];
    // Reuse names already in the map tiles: no external geocoding or location transfer.
    var placeFeatures=[];new Set(map.getStyle().layers.filter(function(l){return l['source-layer']==='place';}).map(function(l){return l.source;})).forEach(function(source){placeFeatures=placeFeatures.concat(map.querySourceFeatures(source,{sourceLayer:'place'}));});
    placeFeatures.forEach(function(f){
      var p=f.properties,name=p['name:bg']||p.name;
      if(name&&f.geometry.type==='Point'&&['city','town','village','suburb','neighbourhood','hamlet'].includes(p.class))places.push({name:name,point:f.geometry.coordinates,rank:p.class==='city'?0:p.class==='town'?1:2});
    });
    regions.forEach(function(f){var point=SSWeather.areaPoint(f.geometry);if(bounds.contains(point))places.push({name:'Район '+f.properties.name,point:point,rank:3});});
    var localPoint=map.unproject([box.width*.42,box.height*.46]),localRegion=regions.find(function(f){return contains(f.geometry,[localPoint.lng,localPoint.lat]);});
    if(localRegion)places.push({name:'Район '+localRegion.properties.name.replace(' (столица)',''),point:[localPoint.lng,localPoint.lat],rank:4});
    places.sort(function(a,b){return a.rank-b.rank||map.project(a.point).dist(map.project(center))-map.project(b.point).dist(map.project(center));});
    // ponytail: at most 3 phone / 6 desktop labels; more places appear as the map moves.
    places.forEach(function(place){
      if((place.rank>=3&&map.getZoom()>10&&markers.length)||(place.rank>=3&&Array.from(seen).some(function(name){return place.name==='Район '+name;}))||markers.length>=(box.width<600?3:6)||seen.has(place.name)||!bounds.contains(place.point))return;
      var v=sample(data,h,place.point[0],place.point[1]);if(!v)return;
      var c=condition(data,h,place.point),temp=v[0]===null?'— °C':Math.round(v[0])+'°C';
      var el=document.createElement('button');el.type='button';el.className='weather-place-label';el.setAttribute('aria-expanded','false');el.setAttribute('aria-label',place.name+': '+c.text+', '+temp+'. Подробности за прогнозата');
      var name=document.createElement('span');name.textContent=place.name;var value=document.createElement('span');value.textContent=temp;el.append(name,icon(c.icon),value);
      el.onclick=function(e){e.stopPropagation();details(place,h,el);};
      var marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(place.point).addTo(map),r=el.getBoundingClientRect();
      var offsets=[[0,0],[-45,0],[45,0],[0,-35],[0,35],[-65,-35],[65,-35]],fits=false;
      for(var i=0;i<offsets.length;i++){
        marker.setOffset(offsets[i]);r=el.getBoundingClientRect();
        var overlaps=obstacles.concat(occupied).some(function(o){return r.left<o.right+8&&r.right>o.left-8&&r.top<o.bottom+8&&r.bottom>o.top-8;});
        if(!overlaps&&r.left>=box.left+8&&r.right<=box.right-8&&r.top>=box.top+8&&r.bottom<=box.bottom-8){fits=true;break;}
      }
      if(!fits){marker.remove();return;}
      occupied.push(r);markers.push(marker);seen.add(place.name);
    });
  }
  function render(){
    if(drawnData===data&&drawnTime===time&&drawnActive===active&&(!active||map.getSource('weather-zones'))){zoneMarkers();return;}
    drawnData=data;drawnTime=time;drawnActive=active;
    zoneMarkers();ctx.clearRect(0,0,canvas.width,canvas.height);
    var h=data?data.times.indexOf(time/1000):-1;
    if(active&&h>=0){
      var g=data.grid,east=g.west+(g.cols-1)*g.step,north=g.south+(g.rows-1)*g.step,mn=merc(north),ms=merc(g.south),im=ctx.createImageData(canvas.width,canvas.height);
      for(var y=0;y<canvas.height;y++)for(var x=0;x<canvas.width;x++){
        var lon=g.west+x/(canvas.width-1)*(east-g.west),lat=(2*Math.atan(Math.exp(mn+y/(canvas.height-1)*(ms-mn)))-Math.PI/2)*180/Math.PI,v=sample(data,h,lon,lat);
        if(!v)continue;
        var cold=v[0]!==null&&v[0]<=3,cloud=v[1]===null?0:v[1],rain=v[2]===null?0:v[2];
        // Model-derived intensity bands match a weather map; no decorative blobs.
        var color=[143,158,177],alpha=cloud>=85?.12:cloud>=65?.07:0;
        if(cold){color=v[0]<=0?[112,133,222]:[160,181,238];alpha=v[0]<=-3?.43:v[0]<=0?.34:.24;}
        if(rain>=.15){
          var band=rain>=3?4:rain>=1.5?3:rain>=.7?2:rain>=.3?1:0;
          color=[[90,224,205],[63,196,222],[40,155,235],[35,112,232],[49,73,210]][band];alpha=[.27,.34,.43,.52,.60][band];
        }
        var edge=Math.min(1,x/14,y/14,(canvas.width-1-x)/14,(canvas.height-1-y)/14),i=(y*canvas.width+x)*4;
        im.data[i]=color[0];im.data[i+1]=color[1];im.data[i+2]=color[2];im.data[i+3]=Math.round(255*alpha*edge);
      }
      ctx.putImageData(im,0,0);
      if(!map.getSource('weather-zones')){
        map.addSource('weather-zones',{type:'canvas',canvas:canvas,animate:false,coordinates:[[g.west,north],[east,north],[east,g.south],[g.west,g.south]],attribution:'© <a href="https://open-meteo.com/">Open-Meteo</a>'});
        map.addLayer({id:'weather-zones',type:'raster',source:'weather-zones',paint:{'raster-fade-duration':0}},map.getLayer('weather-warning-fill')?'weather-warning-fill':'route');
      }

    }
    var source=map.getSource('weather-zones');if(source){source.play();map.once('render',function(){if(map.getSource('weather-zones')===source)source.pause();});}
    if(map.getLayer('weather-zones'))map.setLayoutProperty('weather-zones','visibility',active&&h>=0?'visible':'none');
    map.triggerRepaint();
    if(active&&data)status(h>=0?'Зони: облачност, дъжд и студ ≤ 3°C · Open-Meteo. Приблизителни граници (~25 км), не предупреждения за поледица.':'Няма данни за зоните за този час.',h<0);
  }
  function status(message,failed){document.getElementById('weatherZoneStatus').textContent=message;api.failed=failed;if(api.onstatus)api.onstatus();}
  api.mount=function(m){map=m;map.on('moveend',zoneMarkers);map.on('resize',zoneMarkers);map.on('style.load',function(){if(active)render();});
    var refresh;map.on('sourcedata',function(e){if(!active||e.sourceId==='weather-zones'||e.sourceId==='weather-warnings'||e.sourceId==='weather-forecast')return;clearTimeout(refresh);refresh=setTimeout(function(){if(!map.isMoving()&&!popup)zoneMarkers();},250);});};
  api.preview=function(t){zoneMarkers(t);};
  api.show=function(enabled,t){
    active=enabled;time=t;
    if(data&&Date.now()-data.generated>7200000)data=null;
    if(active&&!regions.length&&!regionsPending)regionsPending=fetch('weather-regions.geojson').then(function(r){if(!r.ok)throw new Error('Regions unavailable');return r.json();}).then(function(d){regions=d.features;zoneMarkers();}).catch(function(){}).finally(function(){regionsPending=null;});
    render();if(!active||data||pending)return;
    status('Зареждане на облачност и температурни зони…',false);
    pending=fetch('/.netlify/functions/weather-zones?v=3',{signal:AbortSignal.timeout(20000)}).then(function(r){if(!r.ok)throw new Error('Unavailable');return r.json();}).then(function(d){
      if(!d.grid||d.grid.cols!==24||d.grid.rows!==12||!Array.isArray(d.cells)||d.cells.length!==288||!Array.isArray(d.times)||!Number.isFinite(d.generated)||Date.now()-d.generated>7200000||d.windComponents!=='towards-east-north-kmh'||d.cells.some(function(c){return !Array.isArray(c)||c.length!==7||c.some(function(a){return !Array.isArray(a)||a.length!==d.times.length||a.some(function(v){return v!==null&&!Number.isFinite(v);});});}))throw new Error('Invalid grid');
      data=d;api.failed=false;render();
    }).catch(function(){data=null;render();status('Облачността и температурните зони са недостъпни.',true);}).finally(function(){pending=null;});
  };
})(typeof window!=='undefined'?window:globalThis);
