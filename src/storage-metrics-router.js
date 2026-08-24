import app from './system-metrics-clean-router.js';

const R2_FREE_INCLUDED_BYTES = 10 * 1000 * 1000 * 1000;
const MAX_PAGES = 20;
const STORAGE_METRICS_CACHE_MS = 5 * 60 * 1000;

let storageMetricsCache = null;
let storageMetricsPromise = null;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function isFresh(entry) {
  return Boolean(entry && entry.expires_at > Date.now());
}

async function measureBucket(bucket) {
  if (!bucket) throw new Error('Binding PRODUCT_IMAGES não configurado');

  let cursor;
  let objects = 0;
  let usedBytes = 0;
  let pages = 0;
  let complete = true;

  do {
    const result = await bucket.list({ limit: 1000, cursor });
    pages += 1;
    for (const object of result.objects || []) {
      objects += 1;
      usedBytes += Number(object.size || 0);
    }

    if (!result.truncated) {
      cursor = undefined;
      break;
    }

    cursor = result.cursor;
    if (pages >= MAX_PAGES) {
      complete = false;
      break;
    }
  } while (cursor);

  return {
    status: 'online',
    object_count: objects,
    used_bytes: usedBytes,
    complete,
    pages_scanned: pages,
    free_included_storage_bytes: R2_FREE_INCLUDED_BYTES,
    percent_of_free_included_storage: usedBytes ? (usedBytes / R2_FREE_INCLUDED_BYTES) * 100 : 0,
    bucket_storage_limit: 'unlimited'
  };
}

async function buildStorageMetrics(env) {
  return {
    ok: true,
    measured_at: new Date().toISOString(),
    cache_ttl_seconds: Math.round(STORAGE_METRICS_CACHE_MS / 1000),
    r2: await measureBucket(env.PRODUCT_IMAGES)
  };
}

async function handleStorageMetrics(env) {
  if (isFresh(storageMetricsCache)) {
    return json(storageMetricsCache.data, 200, { 'x-nisti-cache': 'hit' });
  }

  if (!storageMetricsPromise) {
    storageMetricsPromise = buildStorageMetrics(env)
      .then(data => {
        storageMetricsCache = {
          data,
          expires_at: Date.now() + STORAGE_METRICS_CACHE_MS
        };
        return data;
      })
      .finally(() => {
        storageMetricsPromise = null;
      });
  }

  const data = await storageMetricsPromise;
  return json(data, 200, { 'x-nisti-cache': 'miss' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/storage-metrics' && request.method === 'GET') {
      try {
        return await handleStorageMetrics(env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao medir R2' }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
