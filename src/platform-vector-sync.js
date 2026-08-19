import {
  normalizePlatform,
  platformNamespace,
  platformVectorId,
  platformsForReference
} from './platform-scope.js';

const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

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

export async function syncPlatformVectors(env, options = {}) {
  if (!env.COVER_VECTORS?.upsert) {
    throw new Error('Binding COVER_VECTORS não configurado');
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(options.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(options.offset) || 0);
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
      const platforms = await platformsForReference(env, row);
      if (!platforms.length) {
        invalid.push({
          reference_id: Number(row.reference_id || 0),
          capa_code: row.capa_code,
          reason: 'referência sem plataforma cadastrada'
        });
        continue;
      }
      for (const platform of platforms) {
        vectors.push(vectorForPlatform(row, platform));
      }
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

  if (legacyIds.length && env.COVER_VECTORS?.deleteByIds) {
    await env.COVER_VECTORS.deleteByIds([...new Set(legacyIds)]).catch(() => {});
  }

  const total = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM cover_visual_references r
    JOIN cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
  `).first();
  const nextOffset = offset + (results || []).length;

  return {
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
    vector_namespace: 'platform_key'
  };
}
