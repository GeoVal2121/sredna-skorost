// Same-origin access to NIMH's Bulgarian MeteoAlarm feed. No user location is sent.
export default async function handler(request) {
  const url = new URL(request.url), id = url.searchParams.get('id');
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if ([...url.searchParams.keys()].some(k => k !== 'id') ||
      (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return new Response('Invalid warning identifier', { status: 400 });
  }
  const upstream = id ? 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-bulgaria/' + id
    : 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-bulgaria';
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok || !/xml/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid upstream');
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) { await reader.cancel(); throw new Error('Oversized upstream'); }
      chunks.push(value);
    }
    return new Response(new Blob(chunks), { headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    } });
  } catch {
    return new Response('Warning source unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
