// Cache curto (60 s) das leituras pesadas do GA (dashboard e comparações), por servidor de borda.
// O cache é zerado a cada alteração bem-sucedida (importação, vínculo, estado), e o botão "Atualizar dados"
// força uma leitura nova (?fresh=1). Somente leitura de dados do próprio GA, já autenticada antes de chegar aqui.
export const READ_CACHE_TTL_SECONDS = 60;
const ORIGIN = 'https://ga-read-cache.invalid';
const GEN_KEY = ORIGIN + '/__generation';

export function isCacheableReadPath(method, pathname, basePath) {
  if (String(method || '').toUpperCase() !== 'GET') return false;
  return pathname === basePath + '/sales-dashboard'
    || pathname.startsWith(basePath + '/sales-dashboard/')
    || pathname.startsWith(basePath + '/sales-compare/');
}

function defaultCache() {
  try { return typeof caches !== 'undefined' ? caches.default : null; } catch { return null; }
}

async function readGeneration(cache) {
  const hit = await cache.match(new Request(GEN_KEY));
  return hit ? String(await hit.text()) : '0';
}

export async function bumpReadCacheGeneration(cache = defaultCache()) {
  if (!cache) return;
  try {
    await cache.put(new Request(GEN_KEY), new Response(String(Date.now()), {
      headers: { 'cache-control': 'public, max-age=86400' }
    }));
  } catch { /* cache indisponível: as leituras seguem sem cache */ }
}

export async function cachedRead(request, produce, { cache = defaultCache(), ttl = READ_CACHE_TTL_SECONDS } = {}) {
  if (!cache) return produce();
  const url = new URL(request.url);
  const fresh = url.searchParams.get('fresh') === '1';
  url.searchParams.delete('fresh');
  try {
    const generation = await readGeneration(cache);
    const key = new Request(ORIGIN + url.pathname + url.search + (url.search ? '&' : '?') + 'g=' + generation);
    if (!fresh) {
      const hit = await cache.match(key);
      if (hit) {
        const body = await hit.text();
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-ga-cache': 'HIT' }
        });
      }
    }
    const response = await produce();
    if (response && response.status === 200) {
      const body = await response.clone().text();
      await cache.put(key, new Response(body, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl }
      }));
    }
    return response;
  } catch {
    return produce();
  }
}
