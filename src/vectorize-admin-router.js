import app from './storage-metrics-router.js';
import {
  normalizePlatform,
  platformNamespace,
  platformVectorId,
  platformsForReference,
  supportedPlatforms
} from './platform-scope.js';

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

function legacyReferenceVectorId(referenceId) {
  return `ref:${Number(referenceId)}`;
}

function vectorForPlatform(row, platform) {
  const values = JSON.parse(row.embedding_json);
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Embedding com dimensão inválida');
  }

  const referenceId = Number(row.reference_id || row.id || 0);
  const capaCode = String(row.capa_code || '').trim().toUpperCase();
  const normalizedPlatform = normalizePlatform(platform);
  const namespace = platformNamespace(normalizedPlatform);
  const id = platformVectorId(referenceId, normalizedPlatform);

  if (!referenceId || !capaCode || !normalizedPlatform || !namespace || !id) {
    throw new Error('Referência vetorial por plataforma inválida');
  }

  return {
    id,
    namespace,
    values,
    metadata: {
      reference_id: referenceId,
      capa_code: capaCode,
      platform: normalizedPlatform,
      platform_key: namespace,
      image_key: String(row.image_key || ''),
      source_product_id: Number(row.source_product_id || 0),
      reference_kind: String(row.reference_kind || 'product'),
      embedding_model: String(row.embedding_model || ''),
      updated_at: String(row.updated_at || '')
    }
  };
}

async function vectorsFromRow(env, row) {
  let platforms = await platformsForReference(env, row);
  if (!platforms.length) {
    platforms = supportedPlatforms();
  }
  return platforms.map(platform => vectorForPlatform(row, platform));
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

async function vectorIdsForReference(env, referenceId) {
  const row = await referenceRow(env, referenceId);
  if (!row) return [legacyReferenceVectorId(referenceId)];
  const platforms = await platformsForReference(env, row);
  return [
    legacyReferenceVectorId(referenceId),
    ...platforms.map(platform => platformVectorId(referenceId, platform)).filter(Boolean)
  ];
}

async function deleteVectorIds(env, ids) {
  if (!env.COVER_VECTORS?.deleteByIds) return 0;
  const unique = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!unique.length) return 0;
  await env.COVER_VECTORS.deleteByIds(unique);
  return unique.length;
}

async function upsertReferenceVector(env, referenceId) {
  if (!env.COVER_VECTORS?.upsert) return 0;
  const row = await referenceRow(env, referenceId);
  if (!row) return 0;
  const vectors = await vectorsFromRow(env, row);
  if (!vectors.length) return 0;
  await env.COVER_VECTORS.upsert(vectors);
  await deleteVectorIds(env, [legacyReferenceVectorId(referenceId)]).catch(() => {});
  return vectors.length;
}

async function upsertReferenceVectors(env, referenceIds) {
  if (!env.COVER_VECTORS?.upsert) return { indexed: 0, invalid: [] };
  const ids = [...new Set(
    (referenceIds || [])
      .map(Number)
      .filter(id => Number.isInteger(id) && id > 0)
  )];
  if (!ids.length) return { indexed: 0, invalid: [] };

  const vectors = [];
  const invalid = [];
  const legacyIds = [];

  for (const id of ids) {
    try {
      const row = await referenceRow(env, id);
      if (!row) {
        invalid.push({ reference_id: id, reason: 'embedding ausente' });
        continue;
      }
      const scoped = await vectorsFromRow(env, row);
      if (!scoped.length) {
        invalid.push({ reference_id: id, reason: 'referência sem plataforma cadastrada' });
        continue;
      }
      vectors.push(...scoped);
      legacyIds.push(legacyReferenceVectorId(id));
    } catch (error) {
      invalid.push({
        reference_id: id,
        reason: error?.message || 'embedding inválido'
      });
    }
  }

  if (vectors.length) await env.COVER_VECTORS.upsert(vectors);
  if (legacyIds.length) await deleteVectorIds(env, legacyIds).catch(() => {});
  return { indexed: vectors.length, invalid };
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
  const legacyIds = [];

  for (const row of results || []) {
    try {
      const scoped = await vectorsFromRow(env, row);
      if (!scoped.length) {
        invalid.push({
          reference_id: Number(row.reference_id || 0),
          capa_code: row.capa_code,
          reason: 'referência sem plataforma cadastrada'
        });
        continue;
      }
      vectors.push(...scoped);
      legacyIds.push(legacyReferenceVectorId(row.reference_id));
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
  if (legacyIds.length) await deleteVectorIds(env, legacyIds).catch(() => {});

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
    references_processed: (results || []).length,
    invalid,
    mutation_id: mutationId,
    offset,
    next_offset: nextOffset,
    total_embeddings: Number(total?.total || 0),
    has_more: nextOffset < Number(total?.total || 0),
    vector_id_format: 'ref:<REFERENCE_ID>:p:<PLATFORM_KEY>',
    namespace: 'platform_key',
    note: 'Cada referência é indexada uma vez por plataforma; Vectorize aplica os upserts de forma assíncrona.'
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
      const [references, embeddings, covers, platforms] = await Promise.all([
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
        `).first().catch(() => ({ total: 0 })),
        env.DB.prepare(`
          SELECT COUNT(DISTINCT UPPER(TRIM(platform))) AS total
          FROM product_platforms
          WHERE TRIM(COALESCE(platform,''))<>''
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
        platform_count: Number(platforms?.total || 0),
        pending_references: Math.max(
          0,
          Number(references?.total || 0) - Number(embeddings?.total || 0)
        ),
        vector_id_format: 'ref:<REFERENCE_ID>:p:<PLATFORM_KEY>',
        vector_namespace: 'platform_key'
      });
    }

    const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
    if (imageUpload && request.method === 'POST') {
      const productId = Number(imageUpload[1]);
      const before = await env.DB.prepare(`
        SELECT id FROM cover_visual_references
        WHERE source_product_id=? AND active=1
      `).bind(productId).all().catch(() => ({ results: [] }));
      const oldVectorIds = new Map();
      for (const row of before.results || []) {
        oldVectorIds.set(Number(row.id), await vectorIdsForReference(env, Number(row.id)));
      }

      const response = await app.fetch(request, env, ctx);
      const data = await readJson(response);
      if (response.ok && data) {
        try {
          if (data.reference_id) {
            await upsertReferenceVector(env, Number(data.reference_id));
          }
          const deletedIds = (data.removed_reference_ids || [])
            .flatMap(id => oldVectorIds.get(Number(id)) || [legacyReferenceVectorId(id)]);
          await deleteVectorIds(env, deletedIds);
        } catch {
          // vectorize-sync é idempotente e repara divergências posteriormente.
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
      const referenceId = Number(deleteReference[1]);
      const vectorIds = await vectorIdsForReference(env, referenceId);
      const response = await app.fetch(request, env, ctx);
      const data = await readJson(response);
      if (response.ok && data?.deleted?.id) {
        try {
          await deleteVectorIds(env, vectorIds);
        } catch {
          // Exclusão no Vectorize é assíncrona; sync posterior é seguro.
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
        } catch {
          // vectorize-sync continua sendo o reparo idempotente.
        }
      }
      return response;
    }

    return app.fetch(request, env, ctx);
  }
};
