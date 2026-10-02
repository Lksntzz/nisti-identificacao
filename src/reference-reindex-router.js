import app from './vectorize-admin-router.js';
import {
  normalizePlatform,
  platformNamespace,
  platformVectorId,
  platformsForReference,
  supportedPlatforms
} from './platform-scope.js';
import { supabaseRpc } from './supabase-read-store.js';
import { mirrorSupabaseRpc } from './supabase-write-store.js';

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
  let platforms = await platformsForReference(env, reference);
  if (!platforms.length) platforms = supportedPlatforms();

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
  const rows=await supabaseRpc(env,'nisti_pending_visual_references_v1',{
    p_embedding_model:model,
    p_dimensions:EMBEDDING_DIMENSIONS,
    p_limit:limit
  });
  return Array.isArray(rows) ? rows : [];
}

async function countPending(env, model) {
  return Number(await supabaseRpc(env,'nisti_count_pending_visual_references_v1',{
    p_embedding_model:model,
    p_dimensions:EMBEDDING_DIMENSIONS
  }) || 0);
}

export async function runReferenceReindex(env, { limit = 8 } = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_REINDEX_LIMIT, Number(limit) || 8));
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const references = await pendingReferences(env, model, safeLimit);

  const processed = [];
  const errors = [];
  let vectorized = 0;

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

      const scopedVectors = await vectorsFromReference(
        env,
        reference,
        embeddingModel,
        values
      );
      if (!env.COVER_VECTORS?.upsert) {
        throw new Error('Binding COVER_VECTORS não configurado');
      }
      if (!scopedVectors.length) {
        throw new Error('Nenhum namespace de plataforma disponível para a referência visual');
      }

      // Só marcamos a referência como embeddada no banco depois que o Vectorize
      // confirmou o upsert. Assim uma falha vetorial permanece elegível ao retry.
      await env.COVER_VECTORS.upsert(scopedVectors);
      vectorized += scopedVectors.length;

      const saved=await mirrorSupabaseRpc(env,'nisti_upsert_reference_embedding_v1',{
        p_reference_id:Number(reference.id),
        p_embedding_model:embeddingModel,
        p_dimensions:values.length,
        p_embedding_json:JSON.stringify(values)
      },`reindex reference ${Number(reference.id)}`);
      if(saved?.value !== true) throw new Error('Referência visual não encontrada no Supabase.');

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

  const pending = await countPending(env, model);
  return {
    ok: errors.length === 0,
    processed,
    errors,
    vectorized,
    vectorize_error:null,
    pending_references: pending,
    pending_covers: pending,
    embedding_model: model,
    embedding_dimensions: EMBEDDING_DIMENSIONS,
    vector_namespace: 'platform_key'
  };
}

async function reindexPending(request, env) {
  const body = await request.json().catch(() => ({}));
  const result = await runReferenceReindex(env,{ limit:body.limit });
  return json(result, result.ok ? 200 : 207);
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
