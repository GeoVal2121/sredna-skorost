(function(root){
  'use strict';
  // Bilinear forecast fields; null remains unknown, never dry/clear/zero degrees.
  function sample(data, hour, lon, lat) {
    var g=data.grid,x=(lon-g.west)/g.step,y=(lat-g.south)/g.step;
    if(x<0||y<0||x>g.cols-1||y>g.rows-1)return null;
    var a=Math.min(Math.floor(x),g.cols-2),b=Math.min(Math.floor(y),g.rows-2),dx=x-a,dy=y-b;
    var ids=[b*g.cols+a,b*g.cols+a+1,(b+1)*g.cols+a,(b+1)*g.cols+a+1],weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy];
    return [0,1,2,3].map(function(f){var v=ids.map(function(i){return data.cells[i][f][hour];});return v.some(function(n){return n===null;})?null:v.reduce(function(s,n,i){return s+n*weights[i];},0);});
  }
  var api={sample:sample};root.SSWeatherZones=api;if(typeof module!=='undefined')module.exports=api;
  if(typeof document==='undefined')return;
  var map,data,pending,canvas=document.createElement('canvas'),markers=[],active=false,time=0;
  canvas.width=560;canvas.height=360;
  var ctx=canvas.getContext('2d'),drawnData=null,drawnTime=null,drawnActive=null;
  function merc(lat){return Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));}
  function clearMarkers(){markers.forEach(function(m){m.remove();});markers=[];}
  function labels(){
    clearMarkers();if(!active||!data)return;
    var h=data.times.indexOf(time/1000);if(h<0)return;
    var candidates=[],g=data.grid,box=map.getContainer().getBoundingClientRect();
    var obstacles=Array.from(document.querySelectorAll('.top,.side,.spdw,.chips,.maplibregl-ctrl,#weatherPanel,#bottomBar')).filter(function(e){return !e.hidden;}).map(function(e){return e.getBoundingClientRect();});
    data.cells.forEach(function(c,i){
      var temp=c[0][h],cloud=c[1][h],rain=c[2][h],snow=c[3][h],kind=snow>=0.1?'snow':rain>=0.2?'rain':temp!==null&&temp<=3?'cold':cloud>=65?'cloud':null;
      if(!kind)return;
      var pos=[g.west+i%g.cols*g.step,g.south+Math.floor(i/g.cols)*g.step],p=map.project(pos);
      if(p.x<60||p.x>box.width-60||p.y<150||p.y>box.height-180)return;
      if(obstacles.some(function(r){return r.width&&r.height&&p.x+box.left+58>r.left&&p.x+box.left-58<r.right&&p.y+box.top+32>r.top&&p.y+box.top-32<r.bottom;}))return;
      var priority={snow:4,rain:3,cold:2,cloud:1}[kind],strength=kind==='rain'?rain:kind==='snow'?snow:kind==='cold'?-temp:cloud/100;
      candidates.push({kind:kind,pos:pos,p:p,priority:priority,strength:strength,temp:temp,cloud:cloud,rain:rain,snow:snow});
    });
    candidates.sort(function(a,b){return b.priority-a.priority||b.strength-a.strength;});
    var placed=[],kinds=new Set();
    candidates.forEach(function(c){
      if(kinds.has(c.kind)||placed.length>=3||placed.some(function(p){return Math.hypot(p.x-c.p.x,(p.y-c.p.y)*1.25)<125;}))return;
      placed.push(c.p);kinds.add(c.kind);
      var el=document.createElement('div');el.className='weather-zone-label '+c.kind;
      var icon=document.createElement('span');icon.className='weather-zone-icon';icon.textContent={cloud:'☁',cold:'❄',rain:'☂',snow:'❄'}[c.kind];
      var title=document.createElement('span');title.textContent=c.kind==='cold'?'Студ · '+Math.round(c.temp)+'°':c.kind==='cloud'?'Облачност':c.kind==='snow'?'Сняг · '+c.snow.toFixed(1)+' см/ч':'Дъжд · '+c.rain.toFixed(1)+' мм/ч';
      el.append(icon,title);el.setAttribute('role','img');el.setAttribute('aria-label',title.textContent+' · прогнозен модел Open-Meteo');
      markers.push(new maplibregl.Marker({element:el}).setLngLat(c.pos).addTo(map));
    });
  }
  function render(){
    if(drawnData===data&&drawnTime===time&&drawnActive===active&&(!active||map.getSource('weather-zones'))){labels();return;}
    drawnData=data;drawnTime=time;drawnActive=active;
    clearMarkers();ctx.clearRect(0,0,canvas.width,canvas.height);
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
      labels();
    }
    var source=map.getSource('weather-zones');if(source){source.play();map.once('render',function(){if(map.getSource('weather-zones')===source)source.pause();});}
    if(map.getLayer('weather-zones'))map.setLayoutProperty('weather-zones','visibility',active&&h>=0?'visible':'none');
    map.triggerRepaint();
    if(active&&data)status(h>=0?'Зони: облачност, дъжд и студ ≤ 3°C · Open-Meteo. Приблизителни граници (~25 км), не предупреждения за поледица.':'Няма данни за зоните за този час.',h<0);
  }
  function status(message,failed){document.getElementById('weatherZoneStatus').textContent=message;api.failed=failed;if(api.onstatus)api.onstatus();}
  api.mount=function(m){map=m;map.on('moveend',labels);map.on('resize',labels);map.on('style.load',function(){if(active)render();});};
  api.show=function(enabled,t){
    active=enabled;time=t;
    if(data&&Date.now()-data.generated>7200000)data=null;
    render();if(!active||data||pending)return;
    status('Зареждане на облачност и температурни зони…',false);
    pending=fetch('/.netlify/functions/weather-zones',{signal:AbortSignal.timeout(20000)}).then(function(r){if(!r.ok)throw new Error('Unavailable');return r.json();}).then(function(d){
      if(!d.grid||d.grid.cols!==24||d.grid.rows!==12||!Array.isArray(d.cells)||d.cells.length!==288||!Array.isArray(d.times)||!Number.isFinite(d.generated)||Date.now()-d.generated>7200000)throw new Error('Invalid grid');
      data=d;api.failed=false;render();
    }).catch(function(){data=null;render();status('Облачността и температурните зони са недостъпни.',true);}).finally(function(){pending=null;});
  };
})(typeof window!=='undefined'?window:globalThis);
