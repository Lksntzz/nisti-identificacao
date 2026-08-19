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

function referenceVectorId(referenceId) {
  return `ref:${Number(referenceId)}`;
}

function vectorFromRow(row) {
  const values = JSON.parse(row.embedding_json);
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Embedding com dimensão inválida');
  }

  const referenceId = Number(row.reference_id || 0);
  const capaCode = String(row.capa_code || '').trim().toUpperCase();
  if (!referenceId || !capaCode) throw new Error('Referência vetorial inválida');

  return {
    id: referenceVectorId(referenceId),
    values,
    metadata: {
      reference_id: referenceId,
      capa_code: capaCode,
      image_key: String(row.image_key || ''),
      source_product_id: Number(row.source_product_id || 0),
      reference_kind: String(row.reference_kind || 'product'),
      embedding_model: String(row.embedding_model || ''),
      updated_at: String(row.updated_at || '')
    }
  };
}

async function readJson(response) {
  const type = response?.headers?.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  return response.clone().json().catch(() => null);
}

async function referenceRow(env, referenceId) {
  return env.DB.prepare(`
    SELECT
      r.id AS reference_id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,
      e.embedding_model,e.dimensions,e.embedding_json,e.updated_at
    FROM cover_visual_references r
    JOIN cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.id=? AND r.active=1
    LIMIT 1
  `).bind(referenceId).first();
}

async function upsertReferenceVector(env, referenceId) {
  if (!env.COVER_VECTORS?.upsert) return false;
  const row = await referenceRow(env, referenceId);
  if (!row) return false;
  await env.COVER_VECTORS.upsert([vectorFromRow(row)]);
  return true;
}

async function upsertReferenceVectors(env, referenceIds) {
  if (!env.COVER_VECTORS?.upsert) return { indexed: 0, invalid: [] };
  const ids = [...new Set((referenceIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return { indexed: 0, invalid: [] };

  const vectors = [];
  const invalid = [];
  for (const id of ids) {
    try {
      const row = await referenceRow(env, id);
      if (!row) {
        invalid.push({ reference_id: id, reason: 'embedding ausente' });
        continue;
      }
      vectors.push(vectorFromRow(row));
    } catch (error) {
      invalid.push({ reference_id: id, reason: error?.message || 'embedding inválido' });
    }
  }

  if (vectors.length) await env.COVER_VECTORS.upsert(vectors);
  return { indexed: vectors.length, invalid };
}

async function deleteReferenceVectors(env, referenceIds) {
  if (!env.COVER_VECTORS?.deleteByIds) return 0;
  const ids = [...new Set((referenceIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))]
    .map(referenceVectorId);
  if (!ids.length) return 0;
  await env.COVER_VECTORS.deleteByIds(ids);
  return ids.length;
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
    SELECT
      r.id AS reference_id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,
      e.embedding_model,e.dimensions,e.embedding_json,e.updated_at
    FROM cover_visual_references r
    JOIN cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
    ORDER BY r.id ASC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  const vectors = [];
  const invalid = [];
  for (const row of results || []) {
    try {
      vectors.push(vectorFromRow(row));
    } catch (error) {
      invalid.push({
        reference_id: Number(row.reference_id || 0),
        capa_code: row.capa_code,
        reason: error?.message || 'embedding_json inválido'
      });
    }
  }

  let mutationId = null;
  if (vectors.length) {
    const result = await env.COVER_VECTORS.upsert(vectors);
    mutationId = result?.mutationId || result?.mutation_id || null;
  }

  const total = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM cover_visual_references r
    JOIN cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
  `).first();
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
    vector_id_format: 'ref:<REFERENCE_ID>',
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
      const [references, embeddings, covers] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS total FROM cover_visual_references WHERE active=1`)
          .first().catch(() => ({ total: 0 })),
        env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM cover_visual_references r
          JOIN cover_reference_embeddings e ON e.reference_id=r.id
          WHERE r.active=1
        `).first().catch(() => ({ total: 0 })),
        env.DB.prepare(`
          SELECT COUNT(DISTINCT r.capa_code) AS total
          FROM cover_visual_references r
          JOIN cover_reference_embeddings e ON e.reference_id=r.id
          WHERE r.active=1
        `).first().catch(() => ({ total: 0 }))
      ]);

      return json({
        ok: true,
        binding_configured: Boolean(env.COVER_VECTORS?.query),
        expected_index: 'nisti-cover-embeddings',
        dimensions: EMBEDDING_DIMENSIONS,
        metric: 'cosine',
        d1_references: Number(references?.total || 0),
        d1_embeddings: Number(embeddings?.total || 0),
        indexed_covers: Number(covers?.total || 0),
        pending_references: Math.max(0, Number(references?.total || 0) - Number(embeddings?.total || 0)),
        vector_id_format: 'ref:<REFERENCE_ID>'
      });
    }

    const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
    if (imageUpload && request.method === 'POST') {
      const response = await app.fetch(request, env, ctx);
      const data = await readJson(response);
      if (response.ok && data) {
        try {
          if (data.reference_id) await upsertReferenceVector(env, Number(data.reference_id));
          if (Array.isArray(data.removed_reference_ids)) {
            await deleteReferenceVectors(env, data.removed_reference_ids);
          }
        } catch {
          // D1/R2 continuam como fonte de verdade; vectorize-sync repara divergências.
        }
      }
      return response;
    }

    const coverReferences = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/references$/);
    if (coverReferences && request.method === 'POST') {
      const response = await app.fetch(request, env, ctx);
      const data = await readJson(response);
      if (response.ok && data?.reference?.id && data?.reference?.indexed) {
        try {
          await upsertReferenceVector(env, Number(data.reference.id));
        } catch {
          // O endpoint de sync pode reparar posteriormente.
        }
      }
      return response;
    }

    const deleteReference = url.pathname.match(/^\/api\/admin\/cover-references\/(\d+)$/);
    if (deleteReference && request.method === 'DELETE') {
      const response = await app.fetch(request, env, ctx);
      const data = await readJson(response);
      if (response.ok && data?.deleted?.id) {
        try {
          await deleteReferenceVectors(env, [Number(data.deleted.id)]);
        } catch {
          // Exclusão no Vectorize é assíncrona; uma limpeza administrativa pode repetir a operação.
        }
      }
      return response;
    }

    if (url.pathname === '/api/admin/reindex-cover-embeddings' && request.method === 'POST') {
      const response = await app.fetch(request, env, ctx);
      const data = await readJson(response);
      if (response.ok && data) {
        try {
          const processedIds = (data.processed || []).map(item => Number(item.reference_id));
          await upsertReferenceVectors(env, processedIds);
          await deleteReferenceVectors(env, data.removed_reference_ids || []);
        } catch {
          // vectorize-sync continua sendo o reparo idempotente.
        }
      }
      return response;
    }

    return app.fetch(request, env, ctx);
  }
};
