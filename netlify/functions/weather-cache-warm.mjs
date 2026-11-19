// Run only on published deploys. UTC minute 7 of every hour (same minute in Sofia).
export const config={schedule:'7 * * * *'};
export default async function(){
  // Use the public route so this fills the shared durable CDN, not an isolated process cache.
  const response=await fetch('https://sredna-skorost.netlify.app/.netlify/functions/weather-zones?v=5',{
    signal:AbortSignal.timeout(25000),redirect:'error'
  });
  if(!response.ok)throw new Error('Weather cache warm failed: '+response.status);
  const data=await response.json();
  if(!Number.isFinite(data.generated)||Date.now()-data.generated>3600000)throw new Error('Weather cache is not fresh');
  console.log('Weather cache ready',new Date(data.generated).toISOString());
}
