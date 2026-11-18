// Browser-test data ONLY. Never loaded by the application.
module.exports=function(){
 const grid={west:22,south:41.1,step:.3,cols:24,rows:12};
 const times=Array.from({length:60},(_,i)=>Math.floor(Date.now()/3600000)*3600+i*3600);
 const cells=Array.from({length:288},(_,i)=>{
  const lon=22+i%24*.3,lat=41.1+Math.floor(i/24)*.3;
  const cold=Math.exp(-((lon-23.2)**2+(lat-42.7)**2)/.3),rain=Math.exp(-((lat-(41.9+(lon-24)*.55))**2/.055+(lon-24.6)**2/1.4)),cloud=Math.exp(-((lon-24.7)**2+(lat-43)**2)/.6);
  return [times.map((_,h)=>h===24?15:12-17*cold),times.map((_,h)=>h===24?0:Math.max(cloud,cold,rain)*100),times.map((_,h)=>h===24?0:4*rain),times.map(()=>0),times.map(()=>25/Math.sqrt(2)),times.map(()=>25/Math.sqrt(2)),times.map((_,h)=>h===24?0:cold>.3?73:lon>25.5?66:lat>43?45:61)];
 });cells.forEach(c=>{c.push(times.map((_,h)=>[45,48].includes(c[6][h])?800:20000),times.map(()=>98));});return {grid,times,cells,model:'icon_eu',windComponents:'towards-east-north-kmh',generated:Date.now()};
};

module.exports.risks=function(search,code=45){
 const ids=new URLSearchParams(search).get('ids').split(','),locations=require('../netlify/functions/weather-risk-points.json');
 const times=Array.from({length:63},(_,i)=>Math.floor(Date.now()/3600000)*3600+(i-3)*3600);
 return {schema:1,models:['icon_eu','gfs_global'],municipalities:ids.map(id=>({id,generated:Date.now(),times,points:locations.find(p=>p.id===id).points.map(coordinates=>({coordinates,models:Object.fromEntries(['icon_eu','gfs_global'].map(model=>[model,{weather_code:times.map(()=>code),visibility:times.map(()=>800),relative_humidity_2m:times.map(()=>98),temperature_2m:times.map(()=>code===66?-2:11),precipitation:times.map(()=>0)}]))}))}))};
};

module.exports.warning=function(search){
 const now=Date.now(),id='11111111-1111-4111-8111-111111111111';
 if(!search)return `<feed xmlns="http://www.w3.org/2005/Atom"><updated>${new Date(now).toISOString()}</updated><entry><link type="application/cap+xml" href="https://feeds.meteoalarm.org/api/v1/warnings/feeds-bulgaria/${id}"/></entry></feed>`;
 return `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>test-preview</identifier><status>Actual</status><scope>Public</scope><msgType>Alert</msgType><info><language>bg-BG</language><event>Обилен дъжд</event><severity>Moderate</severity><onset>${new Date(now-3600000).toISOString()}</onset><expires>${new Date(now+3600000*6).toISOString()}</expires><description>ТЕСТОВИ ДАННИ — не е реално предупреждение.</description><parameter><valueName>awareness_type</valueName><value>10</value></parameter><area><areaDesc>Пазарджик</areaDesc><geocode><valueName>EMMA_ID</valueName><value>BG013</value></geocode></area></info></alert>`;
};
