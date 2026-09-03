import app from './system-metrics-clean-router.js';

const R2_FREE_STANDARD_STORAGE_REFERENCE_BYTES = 10 * 1000 * 1000 * 1000;
const MAX_PAGES = 20;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
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
    measurement: complete ? 'complete_bucket_snapshot' : 'partial_bucket_snapshot',
    complete,
    pages_scanned: pages,
    max_objects_scanned: MAX_PAGES * 1000,
    free_standard_storage_reference_bytes: R2_FREE_STANDARD_STORAGE_REFERENCE_BYTES,
    snapshot_percent_of_10gb_reference: usedBytes
      ? (usedBytes / R2_FREE_STANDARD_STORAGE_REFERENCE_BYTES) * 100
      : 0,
    billing_usage: null,
    billing_note: 'R2 cobra armazenamento em GB-mês e operações. Este endpoint mede o tamanho atual do bucket; não representa a fatura mensal nem as operações Class A/B.'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/storage-metrics' && request.method === 'GET') {
      try {
        return json({
          ok: true,
          measured_at: new Date().toISOString(),
          r2: await measureBucket(env.PRODUCT_IMAGES)
        });
      } catch (error) {
        return json({ error: error?.message || 'Falha ao medir R2' }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
