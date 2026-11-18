import points from './weather-risk-points.json' with {type:'json'};
const locations=new Map(points.map(p=>[p.id,p]));
const models=['icon_eu','gfs_global'],fields=['weather_code','visibility','relative_humidity_2m','temperature_2m','precipitation'];
const codes=[0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99];
const cache=new Map(),pending=new Map();
// Bounded by the 265 public municipalities; no arbitrary locations/URLs and no user GPS.
export default async function handler(request){
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const query=new URL(request.url).searchParams,ids=(query.get('ids')||'').split(',');
 if([...query.keys()].some(k=>k!=='ids')||query.getAll('ids').length!==1||ids.length>8||new Set(ids).size!==ids.length||ids.some(id=>!locations.has(id)))return new Response('Invalid municipality IDs',{status:400});
 const missing=ids.filter(id=>!cache.has(id)||Date.now()-cache.get(id).generated>3600000),key=missing.slice().sort().join(',');
 try{
  if(missing.length){
   if(!pending.has(key))pending.set(key,(async()=>{
    const coords=missing.flatMap(id=>locations.get(id).points),url=new URL('https://api.open-meteo.com/v1/forecast');
    url.search=new URLSearchParams({latitude:coords.map(p=>p[1]).join(','),longitude:coords.map(p=>p[0]).join(','),models:models.join(','),hourly:fields.join(','),forecast_hours:'60',past_hours:'3',timezone:'GMT',timeformat:'unixtime'});
    const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!r.ok||!/json/i.test(r.headers.get('content-type')||''))throw Error('Unavailable');
    const rows=await r.json();if(!Array.isArray(rows)||rows.length!==coords.length)throw Error('Incomplete locations');
    const times=rows[0].hourly?.time;
    if(!Array.isArray(times)||times.length!==63||times.some((t,i)=>!Number.isInteger(t)||(i&&t-times[i-1]!==3600))||Math.abs(times[3]*1000-Date.now())>3600000)throw Error('Invalid times');
    const samples=rows.map((row,i)=>{
     if(JSON.stringify(row.hourly?.time)!==JSON.stringify(times))throw Error('Mismatched hours');
     const result={coordinates:coords[i],models:{}};
     for(const model of models){result.models[model]={};for(const field of fields){
      const k=field+'_'+model,a=row.hourly[k],max=field==='visibility'?200000:field==='temperature_2m'?70:field==='relative_humidity_2m'?100:1000;
      const units={weather_code:'wmo code',visibility:'m',relative_humidity_2m:'%',temperature_2m:'°C',precipitation:'mm'};
      if(row.hourly_units?.[k]!==units[field]||!Array.isArray(a)||a.length!==times.length||a.some(v=>v!==null&&(!Number.isFinite(v)||v<(field==='temperature_2m'?-100:0)||v>max||(field==='weather_code'&&!codes.includes(v)))))throw Error('Invalid model field');
      result.models[model][field]=a;
     }}return result;
    });
    const generated=Date.now();missing.forEach((id,i)=>cache.set(id,{id,generated,times,points:samples.slice(i*3,i*3+3)}));
   })());
   try{await pending.get(key);}finally{pending.delete(key);}
  }
  return Response.json({schema:1,models,municipalities:ids.map(id=>cache.get(id))},{headers:{'Cache-Control':'public, max-age=300, s-maxage=3600','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('Local hazard forecast unavailable',{status:502,headers:{'Cache-Control':'no-store'}});}
}
