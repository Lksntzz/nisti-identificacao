import app from './vectorize-admin-router.js';
import {
  normalizePlatform,
  platformNamespace,
  platformVectorId,
  platformsForReference
} from './platform-scope.js';

const EMBEDDING_DIMENSIONS = 768;
const MAX_REINDEX_LIMIT = 20;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function embedImage(env, bytes, mimeType) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        content: {
          parts: [{
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: base64(bytes)
            }
          }]
        },
        output_dimensionality: EMBEDDING_DIMENSIONS
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini Embedding falhou (${response.status})`);
  }

  const payload = await response.json();
  const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Gemini Embedding não retornou vetor válido');
  }

  return { model, values };
}

async function vectorsFromReference(env, reference, model, values) {
  const referenceId = Number(reference.id);
  const capaCode = String(reference.capa_code || '').trim().toUpperCase();
  const platforms = await platformsForReference(env, reference);

  return platforms.map(platform => {
    const normalizedPlatform = normalizePlatform(platform);
    const namespace = platformNamespace(normalizedPlatform);
    return {
      id: platformVectorId(referenceId, normalizedPlatform),
      namespace,
      values,
      metadata: {
        reference_id: referenceId,
        capa_code: capaCode,
        platform: normalizedPlatform,
        platform_key: namespace,
        image_key: String(reference.image_key || ''),
        source_product_id: Number(reference.source_product_id || 0),
        reference_kind: String(reference.reference_kind || 'product'),
        embedding_model: model,
        updated_at: new Date().toISOString()
      }
    };
  }).filter(vector => vector.id && vector.namespace);
}

async function pendingReferences(env, model, limit) {
  const { results } = await env.DB.prepare(`
    SELECT
      r.id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind
    FROM cover_visual_references r
    LEFT JOIN cover_reference_embeddings e
      ON e.reference_id=r.id AND e.dimensions=? AND e.embedding_model=?
    WHERE r.active=1 AND e.reference_id IS NULL
    ORDER BY r.id ASC
    LIMIT ?
  `).bind(EMBEDDING_DIMENSIONS, model, limit).all();
  return results || [];
}

async function countPending(env, model) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM cover_visual_references r
    LEFT JOIN cover_reference_embeddings e
      ON e.reference_id=r.id AND e.dimensions=? AND e.embedding_model=?
    WHERE r.active=1 AND e.reference_id IS NULL
  `).bind(EMBEDDING_DIMENSIONS, model).first();
  return Number(row?.total || 0);
}

async function reindexPending(request, env) {
  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(MAX_REINDEX_LIMIT, Number(body.limit) || 8));
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const references = await pendingReferences(env, model, limit);

  const processed = [];
  const errors = [];
  const vectors = [];

  for (const reference of references) {
    try {
      const object = await env.PRODUCT_IMAGES.get(reference.image_key);
      if (!object) throw new Error('Imagem não encontrada no R2');

      const bytes = new Uint8Array(await object.arrayBuffer());
      const { model: embeddingModel, values } = await embedImage(
        env,
        bytes,
        object.httpMetadata?.contentType || 'image/jpeg'
      );

      await env.DB.prepare(`
        INSERT INTO cover_reference_embeddings (
          reference_id,embedding_model,dimensions,embedding_json,updated_at
        ) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(reference_id) DO UPDATE SET
          embedding_model=excluded.embedding_model,
          dimensions=excluded.dimensions,
          embedding_json=excluded.embedding_json,
          updated_at=CURRENT_TIMESTAMP
      `).bind(
        Number(reference.id),
        embeddingModel,
        values.length,
        JSON.stringify(values)
      ).run();

      const scopedVectors = await vectorsFromReference(
        env,
        reference,
        embeddingModel,
        values
      );
      vectors.push(...scopedVectors);
      processed.push({
        reference_id: Number(reference.id),
        capa_code: String(reference.capa_code || '').trim().toUpperCase(),
        platform_vectors: scopedVectors.length
      });
    } catch (error) {
      errors.push({
        reference_id: Number(reference.id),
        capa_code: String(reference.capa_code || '').trim().toUpperCase(),
        error: error?.message || 'Falha ao indexar referência'
      });
    }
  }

  let vectorized = 0;
  let vectorizeError = null;
  if (vectors.length) {
    if (!env.COVER_VECTORS?.upsert) {
      vectorizeError = 'Binding COVER_VECTORS não configurado';
    } else {
      try {
        await env.COVER_VECTORS.upsert(vectors);
        vectorized = vectors.length;
      } catch (error) {
        vectorizeError = error?.message || 'Falha ao sincronizar Vectorize';
      }
    }
  }

  const pending = await countPending(env, model);
  return json({
    ok: errors.length === 0 && !vectorizeError,
    processed,
    errors,
    vectorized,
    vectorize_error: vectorizeError,
    pending_references: pending,
    pending_covers: pending,
    embedding_model: model,
    embedding_dimensions: EMBEDDING_DIMENSIONS,
    vector_namespace: 'platform_key'
  }, errors.length || vectorizeError ? 207 : 200);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/reindex-cover-embeddings' && request.method === 'POST') {
      try {
        return await reindexPending(request, env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao reindexar referências visuais' }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
