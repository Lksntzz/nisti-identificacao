import app from './storage-metrics-router.js';

const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function vectorId(capaCode) {
  return `cover:${String(capaCode || '').trim().toUpperCase()}`.slice(0, 64);
}

async function syncVectors(env, body = {}) {
  if (!env.COVER_VECTORS?.upsert) {
    return json({
      error: 'Binding COVER_VECTORS não configurado.',
      setup_required: true,
      expected_index: 'nisti-cover-embeddings',
      dimensions: EMBEDDING_DIMENSIONS,
      metric: 'cosine'
    }, 503);
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(body.offset) || 0);
  const { results } = await env.DB.prepare(`
    SELECT ce.capa_code, ce.image_key, ce.embedding_model, ce.dimensions, ce.embedding_json, ce.updated_at,
      (SELECT p.id FROM products p WHERE p.capa_code=ce.capa_code AND p.image_key=ce.image_key ORDER BY p.id DESC LIMIT 1) AS product_id
    FROM cover_embeddings ce
    ORDER BY ce.capa_code ASC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  const vectors = [];
  const invalid = [];
  for (const row of results || []) {
    try {
      const values = JSON.parse(row.embedding_json);
      if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
        invalid.push({ capa_code: row.capa_code, reason: 'dimensão inválida' });
        continue;
      }
      const capaCode = String(row.capa_code || '').trim().toUpperCase();
      vectors.push({
        id: vectorId(capaCode),
        values,
        metadata: {
          capa_code: capaCode,
          image_key: String(row.image_key || ''),
          product_id: Number(row.product_id || 0),
          embedding_model: String(row.embedding_model || ''),
          updated_at: String(row.updated_at || '')
        }
      });
    } catch {
      invalid.push({ capa_code: row.capa_code, reason: 'embedding_json inválido' });
    }
  }

  let mutationId = null;
  if (vectors.length) {
    const result = await env.COVER_VECTORS.upsert(vectors);
    mutationId = result?.mutationId || result?.mutation_id || null;
  }

  const total = await env.DB.prepare('SELECT COUNT(*) AS total FROM cover_embeddings').first();
  const nextOffset = offset + (results || []).length;
  return json({
    ok: true,
    indexed: vectors.length,
    invalid,
    mutation_id: mutationId,
    offset,
    next_offset: nextOffset,
    total_embeddings: Number(total?.total || 0),
    has_more: nextOffset < Number(total?.total || 0),
    note: 'Vectorize aplica upserts de forma assíncrona; novas entradas podem levar alguns segundos para aparecer nas consultas.'
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/vectorize-sync' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        return await syncVectors(env, body);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao sincronizar Vectorize' }, 500);
      }
    }

    if (url.pathname === '/api/admin/vectorize-status' && request.method === 'GET') {
      const embeddings = await env.DB.prepare('SELECT COUNT(*) AS total FROM cover_embeddings').first().catch(() => ({ total: 0 }));
      return json({
        ok: true,
        binding_configured: Boolean(env.COVER_VECTORS?.query),
        expected_index: 'nisti-cover-embeddings',
        dimensions: EMBEDDING_DIMENSIONS,
        metric: 'cosine',
        d1_embeddings: Number(embeddings?.total || 0)
      });
    }

    return app.fetch(request, env, ctx);
  }
};
