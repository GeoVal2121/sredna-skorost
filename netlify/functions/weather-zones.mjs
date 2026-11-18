// Fixed regional grid: no route, device location, API key or arbitrary proxy URL.
const grid = {west:22, south:41.1, step:0.3, cols:24, rows:12};
const fields = ['temperature_2m','cloud_cover','precipitation','snowfall','wind_speed_10m','wind_direction_10m','weather_code','visibility','relative_humidity_2m'];
let cached;
export default async function handler(request) {
  if (request.method !== 'GET') return new Response('Method not allowed',{status:405});
  if (new URL(request.url).search && !['?v=3','?v=4','?v=5'].includes(new URL(request.url).search)) return new Response('No parameters supported',{status:400});
  try {
    if (!cached || Date.now()-cached.generated>3600000) {
      const points=Array.from({length:grid.cols*grid.rows},(_,i)=>[
        (grid.south+Math.floor(i/grid.cols)*grid.step).toFixed(2),
        (grid.west+i%grid.cols*grid.step).toFixed(2)]);
      const batches=await Promise.all([0,48,96,144,192,240].map(async start=>{
        const batch=points.slice(start,start+48);
        const url=new URL('https://api.open-meteo.com/v1/forecast');
        url.search=new URLSearchParams({latitude:batch.map(p=>p[0]).join(','),longitude:batch.map(p=>p[1]).join(','),hourly:fields.join(','),models:'icon_eu',forecast_hours:'60',past_hours:'3',timezone:'GMT',timeformat:'unixtime',wind_speed_unit:'kmh'});
        const r=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});
        if (!r.ok || !/json/i.test(r.headers.get('content-type')||'')) throw new Error('Unavailable');
        const body=await r.json();
        if (!Array.isArray(body) || body.length!==batch.length) throw new Error('Incomplete grid');
        return body;
      }));
      const results=batches.flat(), times=results[0].hourly?.time;
      if (!Array.isArray(times) || times.length!==63 || times.some((t,i)=>!Number.isInteger(t)||i&&t-times[i-1]!==3600) || Math.abs(times[3]*1000-Date.now())>3600000) throw new Error('Invalid times');
      const cells=results.map(p=>{
        if (JSON.stringify(p.hourly?.time)!==JSON.stringify(times)) throw new Error('Mismatched hours');
        const values=fields.map(f=>{
          const a=p.hourly[f];
          if (!Array.isArray(a)||a.length!==times.length||a.some(v=>v!==null&&(!Number.isFinite(v)||v < (f==='temperature_2m'?-100:0)||v>(['cloud_cover','relative_humidity_2m'].includes(f)?100:f==='visibility'?200000:f==='temperature_2m'?70:f==='wind_direction_10m'?360:f==='wind_speed_10m'?500:1000)))) throw new Error('Invalid values');
          if(f==='weather_code'&&a.some(v=>v!==null&&![0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99].includes(v))) throw new Error('Invalid weather code');
          return a;
        });
        // Round components to 0.01 km/h (vector error <0.008 km/h), avoiding long JSON decimals.
        // Interpolate vectors, not compass angles (359° and 1° are neighbours).
        const speed=values[4],direction=values[5];
        values[4]=speed.map((v,i)=>v===null||direction[i]===null?null:Math.round(-v*Math.sin(direction[i]*Math.PI/180)*100)/100);
        values[5]=speed.map((v,i)=>v===null||direction[i]===null?null:Math.round(-v*Math.cos(direction[i]*Math.PI/180)*100)/100);
        return values;
      });
      cached={grid,times,cells,model:'icon_eu',windComponents:'towards-east-north-kmh',generated:Date.now()};
    }
    return Response.json(cached,{headers:{'Cache-Control':'public, max-age=300, s-maxage=3600','X-Content-Type-Options':'nosniff'}});
  } catch {
    return new Response('Regional forecast unavailable',{status:502,headers:{'Cache-Control':'no-store'}});
  }
}
