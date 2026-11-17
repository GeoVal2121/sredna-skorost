// Fixed regional grid: no route, device location, API key or arbitrary proxy URL.
const grid = {west:22, south:41.1, step:0.3, cols:24, rows:12};
const fields = ['temperature_2m','cloud_cover','precipitation','snowfall'];
let cached;
export default async function handler(request) {
  if (request.method !== 'GET') return new Response('Method not allowed',{status:405});
  if (new URL(request.url).search) return new Response('No parameters supported',{status:400});
  try {
    if (!cached || Date.now()-cached.generated>3600000) {
      const points=Array.from({length:grid.cols*grid.rows},(_,i)=>[
        (grid.south+Math.floor(i/grid.cols)*grid.step).toFixed(2),
        (grid.west+i%grid.cols*grid.step).toFixed(2)]);
      const batches=await Promise.all([0,96,192].map(async start=>{
        const batch=points.slice(start,start+96);
        const url=new URL('https://api.open-meteo.com/v1/forecast');
        url.search=new URLSearchParams({latitude:batch.map(p=>p[0]).join(','),longitude:batch.map(p=>p[1]).join(','),hourly:fields.join(','),forecast_hours:'60',timezone:'GMT',timeformat:'unixtime'});
        const r=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error'});
        if (!r.ok || !/json/i.test(r.headers.get('content-type')||'')) throw new Error('Unavailable');
        const body=await r.json();
        if (!Array.isArray(body) || body.length!==batch.length) throw new Error('Incomplete grid');
        return body;
      }));
      const results=batches.flat(), times=results[0].hourly?.time;
      if (!Array.isArray(times) || times.length<49 || times.length>72 || times.some((t,i)=>!Number.isInteger(t)||i&&t-times[i-1]!==3600) || Math.abs(times[0]*1000-Date.now())>3600000) throw new Error('Invalid times');
      const cells=results.map(p=>{
        if (JSON.stringify(p.hourly?.time)!==JSON.stringify(times)) throw new Error('Mismatched hours');
        return fields.map(f=>{
          const a=p.hourly[f];
          if (!Array.isArray(a)||a.length!==times.length||a.some(v=>v!==null&&(!Number.isFinite(v)||v < (f==='temperature_2m'?-100:0)||v>(f==='cloud_cover'?100:f==='temperature_2m'?70:1000)))) throw new Error('Invalid values');
          return a;
        });
      });
      cached={grid,times,cells,generated:Date.now()};
    }
    return Response.json(cached,{headers:{'Cache-Control':'public, max-age=300, s-maxage=3600','X-Content-Type-Options':'nosniff'}});
  } catch {
    return new Response('Regional forecast unavailable',{status:502,headers:{'Cache-Control':'no-store'}});
  }
}
