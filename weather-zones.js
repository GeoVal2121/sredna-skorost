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
  // Merge neighbouring categorical model cells; shared edges never become visible borders.
  function riskZones(d,h){
    var g=d.grid,features=[];
    ['fog','ice'].forEach(function(kind){
      var codes=kind==='fog'?[45,48]:[48,56,57,66,67],remaining=new Set();
      d.cells.forEach(function(c,i){if(c[6]&&codes.includes(c[6][h]))remaining.add(i);});
      while(remaining.size){
        var first=remaining.values().next().value,queue=[first],edges=new Map();remaining.delete(first);
        for(var q=0;q<queue.length;q++){
          var i=queue[q],x=i%g.cols,y=Math.floor(i/g.cols);
          [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].forEach(function(p){var n=p[1]*g.cols+p[0];if(p[0]>=0&&p[0]<g.cols&&p[1]>=0&&p[1]<g.rows&&remaining.delete(n))queue.push(n);});
          var corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
          corners.forEach(function(a,j){var b=corners[(j+1)%4],key=a.join(',')+':'+b.join(','),reverse=b.join(',')+':'+a.join(',');if(!edges.delete(reverse))edges.set(key,[a,b]);});
        }
        var rings=[];
        while(edges.size){
          var edge=edges.values().next().value,ring=[edge[0]],start=edge[0].join(','),current=edge;
          do{edges.delete(current[0].join(',')+':'+current[1].join(','));ring.push(current[1]);if(current[1].join(',')===start)break;var end=current[1].join(',');current=Array.from(edges.values()).find(function(e){return e[0].join(',')===end;});}while(current);
          if(ring.length>=4)rings.push(ring.map(function(p){return [g.west+Math.max(0,Math.min(g.cols-1,p[0]-.5))*g.step,g.south+Math.max(0,Math.min(g.rows-1,p[1]-.5))*g.step];}));
        }
        function area(r){return r.reduce(function(v,p,i){var n=r[(i+1)%r.length];return v+p[0]*n[1]-n[0]*p[1];},0);}
        rings.sort(function(a,b){return Math.abs(area(b))-Math.abs(area(a));});
        // A single corner cut reflects the coarse (~25 km) model boundary without a staircase outline.
        rings=rings.map(function(r){var smooth=[];for(var i=0;i<r.length-1;i++){var a=r[i],b=r[i+1];smooth.push([a[0]*.85+b[0]*.15,a[1]*.85+b[1]*.15],[a[0]*.15+b[0]*.85,a[1]*.15+b[1]*.85]);}smooth.push(smooth[0]);return smooth;});
        if(rings.length)features.push({type:'Feature',properties:{kind:kind},geometry:{type:'Polygon',coordinates:rings}});
      }
    });
    return {type:'FeatureCollection',features:features};
  }
  var api={sample:sample,windAt:windAt,thermometer:thermometer,conditions:conditions,condition:condition,contains:contains,riskZones:riskZones};root.SSWeatherZones=api;if(typeof module!=='undefined')module.exports=api;
  if(typeof document==='undefined')return;
  var map,data,pending,canvas=document.createElement('canvas'),active=false,time=0,mode="precip";
  canvas.width=560;canvas.height=360;
  var ctx=canvas.getContext('2d'),drawnData=null,drawnTime=null,drawnMode=null;
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
  function zoneMarkers(t){
    closeDetails();markers.forEach(function(m){m.remove();});markers=[];
    var h=data?data.times.indexOf((typeof t==='number'?t:time)/1000):-1;if(!active||h<0||!map.getStyle())return;
    var box=map.getContainer().getBoundingClientRect(),occupied=[],seen=new Set(),center=map.getCenter(),bounds=map.getBounds();
    var obstacles=Array.from(document.querySelectorAll('.top,.chips,.side,.spdw,.maplibregl-ctrl,#weatherPanel,#bottomBar,.weather-warning-label,.weather-risk-label')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width&&r.height;});
    var places=[];
    // Reuse names already in the map tiles: no external geocoding or location transfer.
    var placeFeatures=[];new Set(map.getStyle().layers.filter(function(l){return l['source-layer']==='place';}).map(function(l){return l.source;})).forEach(function(source){placeFeatures=placeFeatures.concat(map.querySourceFeatures(source,{sourceLayer:'place'}));});
    placeFeatures.forEach(function(f){
      var p=f.properties,name=p['name:bg']||p.name;
      if(name&&f.geometry.type==='Point'&&['city','town','village','suburb','neighbourhood','hamlet'].includes(p.class))places.push({name:name,point:f.geometry.coordinates,rank:p.class==='city'?0:p.class==='town'?1:2});
    });
    regions.forEach(function(f){var point=SSWeather.areaPoint(f.geometry);if(bounds.contains(point))places.push({name:'Район '+f.properties.name.replace(' (столица)',''),point:point,rank:3});});
    var localPoint=map.unproject([box.width*.42,box.height*.46]),localRegion=regions.find(function(f){return contains(f.geometry,[localPoint.lng,localPoint.lat]);});
    if(localRegion)places.push({name:'Район '+localRegion.properties.name.replace(' (столица)',''),point:[localPoint.lng,localPoint.lat],rank:4});
    places.sort(function(a,b){return a.rank-b.rank||map.project(a.point).dist(map.project(center))-map.project(b.point).dist(map.project(center));});
    // ponytail: at most 3 phone / 6 desktop labels; more places appear as the map moves.
    places.forEach(function(place){
      if((place.rank>=3&&map.getZoom()>10&&markers.length)||(place.rank>=3&&Array.from(seen).some(function(name){return place.name==='Район '+name;}))||markers.length>=(box.width<600?3:6)||seen.has(place.name)||!bounds.contains(place.point))return;
      var v=sample(data,h,place.point[0],place.point[1]);if(!v)return;
      var c=condition(data,h,place.point),temp=v[0]===null?'— °C':Math.round(v[0])+'°C';
      var el=document.createElement('button');el.type='button';el.className='weather-place-label';el.setAttribute('aria-expanded','false');el.setAttribute('aria-label',place.name+': '+c.text+', '+temp+'. Подробности за прогнозата');
      var name=document.createElement('span');name.textContent=place.name;var value=document.createElement('span');value.textContent=temp;
      var symbol=icon(mode==='temperature'?'temperature':mode==='wind'?'wind':mode==='cloud'?'cloud':c.icon);
      if(mode==='wind'){var w=windAt(data,h,place.point[0],place.point[1]);value.textContent=w?Math.round(w.speed)+' км/ч':'— км/ч';if(w&&w.speed>=.5){symbol=icon('arrow-up');symbol.style.transform='rotate('+(w.towards-map.getBearing())+'deg)';}}
      if(mode==='cloud')value.textContent=v[1]===null?'— %':Math.round(v[1])+'%';
      if(mode==='precip')value.textContent=v[2]===null?'— мм/ч':v[2].toLocaleString('bg-BG',{maximumFractionDigits:1})+' мм/ч';
      el.setAttribute('aria-label',place.name+': '+value.textContent+'. Подробности за прогнозата');el.append(name,symbol,value);
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
  var riskMarkers=[],riskData,riskTime,riskFeatures,windCanvas,windAnimation;
  function drawRisks(h){
    riskMarkers.forEach(function(m){m.remove();});riskMarkers=[];if(!map.getStyle())return;
    if(active&&h>=0&&(riskData!==data||riskTime!==time)){riskFeatures=riskZones(data,h);riskData=data;riskTime=time;}
    var fc=active&&h>=0?riskFeatures:{type:'FeatureCollection',features:[]};
    var before=map.getStyle().layers.find(function(l){return l['source-layer']==='building'||l.type==='fill-extrusion'||(l.type==='line'&&l['source-layer']==='transportation');});
    if(!map.getSource('weather-risks')&&active&&h>=0){
      map.addSource('weather-risks',{type:'geojson',data:fc});
      map.addLayer({id:'weather-risk-fill',type:'fill',source:'weather-risks',paint:{'fill-color':['match',['get','kind'],'ice','#edb849','#9abace'],'fill-opacity':.10}},before?before.id:'route');
      ['fog','ice'].forEach(function(kind){map.addLayer({id:'weather-risk-'+kind,type:'line',source:'weather-risks',filter:['==','kind',kind],paint:Object.assign({'line-color':kind==='ice'?'#e5aa39':'#8facbd','line-width':1.2},kind==='ice'?{'line-dasharray':[4,2]}:{})},before?before.id:'route');});
    }else if(map.getSource('weather-risks'))map.getSource('weather-risks').setData(fc);
    if(map.getLayer('weather-risk-fog'))map.setPaintProperty('weather-risk-fog','line-color',document.documentElement.classList.contains('dark')?'#a5ccdf':'#7698ad');
    (fc.features||[]).forEach(function(f){
      var box=map.getContainer().getBoundingClientRect(),candidates=[SSWeather.areaPoint(f.geometry)],obstacles=Array.from(document.querySelectorAll('.top,.chips,.side,.spdw,.maplibregl-ctrl,#weatherPanel,#bottomBar,.weather-warning-label')).map(function(e){return e.getBoundingClientRect();}).filter(function(r){return r.width&&r.height;});
      [.45,.55,.35,.65,.75,.25].forEach(function(y){[.45,.3,.6,.2,.7].forEach(function(x){var ll=map.unproject([box.width*x,box.height*y]);candidates.push([ll.lng,ll.lat]);});});
      var el=document.createElement('div'),ice=f.properties.kind==='ice';el.className='weather-risk-label '+f.properties.kind;
      el.append(icon(ice?'snowflake':'mist'));var text=document.createElement('span');text.textContent=ice?'Риск от заледяване':'Мъгла';el.append(text);
      if(ice){var small=document.createElement('small');small.textContent='Прогнозен риск';text.append(small);}
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
  function stopWind(){cancelAnimationFrame(windAnimation);if(windCanvas)windCanvas.hidden=true;}
  function windFrame(){
    stopWind();var h=data?data.times.indexOf(time/1000):-1;if(!active||mode!=='wind'||h<0||document.hidden||map.isMoving())return;
    if(!windCanvas){windCanvas=document.createElement('canvas');windCanvas.className='weather-wind';windCanvas.setAttribute('aria-hidden','true');map.getCanvasContainer().append(windCanvas);}
    var box=map.getContainer().getBoundingClientRect();windCanvas.width=box.width;windCanvas.height=box.height;windCanvas.hidden=false;
    var c=windCanvas.getContext('2d'),paths=[],spacing=Math.max(90,Math.sqrt(box.width*box.height/65));
    for(var y=40;y<box.height;y+=spacing)for(var x=25;x<box.width;x+=spacing){
      var ll=map.unproject([x,y]),w=windAt(data,h,ll.lng,ll.lat);if(!w||w.speed<.5)continue;
      var a=w.towards*Math.PI/180,end=map.project([ll.lng+Math.sin(a)*.01/Math.cos(ll.lat*Math.PI/180),ll.lat+Math.cos(a)*.01]),dx=end.x-x,dy=end.y-y,n=Math.hypot(dx,dy);if(n<.001)continue;
      paths.push({x:x,y:y,dx:dx/n,dy:dy/n,speed:w.speed,phase:(x+y)%67/67});
    }
    var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,last=0,start=performance.now();
    function frame(now){
      if(now-last>32||reduced){last=now;c.clearRect(0,0,box.width,box.height);c.strokeStyle=document.documentElement.classList.contains('dark')?'rgba(116,218,205,.65)':'rgba(26,132,142,.60)';c.lineWidth=1.1;
        paths.forEach(function(p){var phase=reduced?.5:((now-start)*Math.min(p.speed,100)/18000+p.phase)%1,travel=(phase-.5)*42,px=p.x+p.dx*travel,py=p.y+p.dy*travel;c.globalAlpha=reduced?.7:Math.sin(phase*Math.PI);c.beginPath();c.moveTo(px-p.dx*28,py-p.dy*28);c.lineTo(px,py);c.lineTo(px-p.dx*6-p.dy*3,py-p.dy*6+p.dx*3);c.moveTo(px,py);c.lineTo(px-p.dx*6+p.dy*3,py-p.dy*6-p.dx*3);c.stroke();});
      }
      if(!reduced)windAnimation=requestAnimationFrame(frame);
    }frame(start);
  }
  document.addEventListener('visibilitychange',windFrame);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',windFrame);
  function render(){
    var h=data?data.times.indexOf(time/1000):-1;
    drawRisks(h);windFrame();zoneMarkers();
    if(!active||h<0){
      if(map.getLayer('weather-zones'))map.setLayoutProperty('weather-zones','visibility','none');
      if(active&&data)status('Няма данни за зоните за този час.',true);
      return;
    }
    var g=data.grid,east=g.west+(g.cols-1)*g.step,north=g.south+(g.rows-1)*g.step,changed=drawnData!==data||drawnTime!==time||drawnMode!==mode;
    if(changed){
      var mn=merc(north),ms=merc(g.south),im=ctx.createImageData(canvas.width,canvas.height),values=[],paintFields=[0,1,2,3];
      var cloudColor=[143,158,177],rainColors=[[90,224,205],[63,196,222],[40,155,235],[35,112,232],[49,73,210]],rainAlpha=[.27,.34,.43,.52,.60],stops=[[65,134,235],[94,201,222],[245,213,109],[238,135,66],[218,66,58]],temperatureColor=[0,0,0],snowColor=[180,180,220];
      for(var y=0;y<canvas.height;y++){
        var lat=(2*Math.atan(Math.exp(mn+y/(canvas.height-1)*(ms-mn)))-Math.PI/2)*180/Math.PI;
        for(var x=0;x<canvas.width;x++){
        var lon=g.west+x/(canvas.width-1)*(east-g.west),v=sample(data,h,lon,lat,paintFields,values);
        if(!v)continue;
        var color=cloudColor,alpha=0;
        if(mode==='cloud'&&v[1]!==null){color=cloudColor;alpha=Math.max(0,(v[1]-25)/75)*.22;}
        if(mode==='temperature'&&v[0]!==null){
          var t=Math.max(0,Math.min(3.999,(v[0]+15)/15)),k=Math.floor(t),f=t-k;
          for(var channel=0;channel<3;channel++)temperatureColor[channel]=stops[k][channel]*(1-f)+stops[k+1][channel]*f;color=temperatureColor;alpha=.24;
        }
        if(mode==='precip'&&v[2]!==null&&v[2]>=.15){
          var rain=v[2],band=rain>=3?4:rain>=1.5?3:rain>=.7?2:rain>=.3?1:0;
          color=v[3]!==null&&v[3]>=.1?snowColor:rainColors[band];alpha=rainAlpha[band]*.60;
        }
        var edge=Math.min(1,x/14,y/14,(canvas.width-1-x)/14,(canvas.height-1-y)/14),i=(y*canvas.width+x)*4;
        im.data[i]=color[0];im.data[i+1]=color[1];im.data[i+2]=color[2];im.data[i+3]=Math.round(255*alpha*edge);
      }
      }
      ctx.putImageData(im,0,0);drawnData=data;drawnTime=time;drawnMode=mode;
    }
      if(!map.getSource('weather-zones')){
        changed=true;
        map.addSource('weather-zones',{type:'canvas',canvas:canvas,animate:false,coordinates:[[g.west,north],[east,north],[east,g.south],[g.west,g.south]],attribution:'© <a href="https://open-meteo.com/">Open-Meteo</a>'});
        map.addLayer({id:'weather-zones',type:'raster',source:'weather-zones',paint:{'raster-fade-duration':0}},map.getLayer('weather-risk-fill')?'weather-risk-fill':map.getLayer('weather-warning-fill')?'weather-warning-fill':'route');
      }
    var source=map.getSource('weather-zones');if(source&&changed){source.play();map.once('render',function(){if(map.getSource('weather-zones')===source)source.pause();});}
    if(map.getLayer('weather-zones'))map.setLayoutProperty('weather-zones','visibility',active&&h>=0?'visible':'none');
    map.triggerRepaint();
    if(active&&data)status(h>=0?'Open-Meteo · приблизителни прогнозни зони (~25 км). Рискът от заледяване е моделна оценка, не наблюдавана поледица.':'Няма данни за зоните за този час.',h<0);
  }
  function status(message,failed){document.getElementById('weatherZoneStatus').textContent=message;api.failed=failed;if(api.onstatus)api.onstatus();}
  api.mount=function(m){map=m;map.on('moveend',function(){drawRisks(data?data.times.indexOf(time/1000):-1);zoneMarkers();windFrame();});map.on('movestart',function(){stopWind();});map.on('resize',function(){zoneMarkers();windFrame();});map.on('style.load',function(){if(active)render();});
    var refresh;map.on('sourcedata',function(e){if(!active||e.sourceId==='weather-zones'||e.sourceId==='weather-risks'||e.sourceId==='weather-warnings'||e.sourceId==='weather-forecast')return;clearTimeout(refresh);refresh=setTimeout(function(){if(!map.isMoving()&&!popup)zoneMarkers();},250);});};
  api.preview=function(t){zoneMarkers(t);};
  api.show=function(enabled,t,nextMode){
    active=enabled;time=t;if(nextMode)mode=nextMode;
    if(data&&Date.now()-data.generated>7200000)data=null;
    if(active&&!regions.length&&!regionsPending)regionsPending=fetch('weather-regions.geojson').then(function(r){if(!r.ok)throw new Error('Regions unavailable');return r.json();}).then(function(d){regions=d.features;zoneMarkers();}).catch(function(){}).finally(function(){regionsPending=null;});
    render();if(!active||data||pending)return;
    status('Зареждане на метеорологичните зони…',false);
    pending=fetch('/.netlify/functions/weather-zones?v=4',{signal:AbortSignal.timeout(20000)}).then(function(r){if(!r.ok)throw new Error('Unavailable');return r.json();}).then(function(d){
      if(!d.grid||d.grid.cols!==24||d.grid.rows!==12||!Array.isArray(d.cells)||d.cells.length!==288||!Array.isArray(d.times)||!Number.isFinite(d.generated)||Date.now()-d.generated>7200000||d.windComponents!=='towards-east-north-kmh'||d.cells.some(function(c){return !Array.isArray(c)||c.length!==7||c.some(function(a){return !Array.isArray(a)||a.length!==d.times.length||a.some(function(v){return v!==null&&!Number.isFinite(v);});});}))throw new Error('Invalid grid');
      data=d;api.failed=false;render();
    }).catch(function(){data=null;render();status('Метеорологичните зони са недостъпни.',true);}).finally(function(){pending=null;});
  };
})(typeof window!=='undefined'?window:globalThis);
