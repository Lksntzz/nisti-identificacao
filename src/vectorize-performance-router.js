import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFinalIdentifyV8 } from './structural-final-v8.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';
import { listPlatforms, normalizePlatform } from './platform-scope.js';
import { syncPlatformVectors } from './platform-vector-sync.js';
import { consolidatePlatforms } from './platform-consolidation.js';
import { syncVisualSignatures } from './visual-signatures.js';
import { handlePublicImageRequest } from './public-image-router.js';

const RECOGNITION_COOKIE = 'nisti_recognition_ticket';
const RECOGNITION_BUILD = 'platform-overlay-aware-v8.6';

async function recordFallback(ctx, env, response) {
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.clone().json().catch(() => null)
    : null;
  if (!data) return;
  const telemetry = recordRecognitionAttempt(env, response.status, data);
  if (ctx?.waitUntil) ctx.waitUntil(telemetry);
  else await telemetry;
}

async function withRecognitionTicketCookie(response) {
  if (!response?.ok) return response;
  const data = await response.clone().json().catch(() => null);
  if (!data?.ticket) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.append(
    'set-cookie',
    `${RECOGNITION_COOKIE}=${data.ticket}; Path=/api; Max-Age=150; HttpOnly; Secure; SameSite=Lax`
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function previewDiagnosticAllowed(url) {
  return url.hostname === 'multi-ref-nisti-identificacao.lksntz1411.workers.dev';
}

function invalidPlatformResponse() {
  return new Response(JSON.stringify({
    error: 'Plataforma inválida. Use MERCADO LIVRE, SHOPEE ou AMAZON.'
  }), {
    status: 400,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function canonicalizeRowPlatform(row) {
  if (!row || typeof row !== 'object') return row;
  const raw = String(row.platform ?? '').trim();
  if (!raw) return row;
  const platform = normalizePlatform(raw);
  if (!platform) return null;
  return { ...row, platform };
}

async function canonicalizeCatalogRequest(request, url) {
  if (request.method !== 'POST') return request;
  const singleProduct = url.pathname === '/api/products';
  const bulkProducts = url.pathname === '/api/admin/bulk-products';
  if (!singleProduct && !bulkProducts) return request;

  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== 'object') return request;

  if (singleProduct) {
    const normalized = canonicalizeRowPlatform(body);
    if (!normalized) return invalidPlatformResponse();
    Object.assign(body, normalized);
  }

  if (bulkProducts && Array.isArray(body.rows)) {
    const rows = [];
    for (const row of body.rows) {
      const normalized = canonicalizeRowPlatform(row);
      if (!normalized) return invalidPlatformResponse();
      rows.push(normalized);
    }
    body.rows = rows;
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body)
  });
}

async function previewLastRecognition(env) {
  const row = await env.DB.prepare(`
    SELECT
      id, created_at, kind, http_status, confidence, identified_by, error_message,
      total_ms, embedding_ms, vectorize_ms, local_cv_ms, reference_load_ms, gemini_ms,
      retrieval_top1, retrieval_top1_code, retrieval_top2, retrieval_top2_code,
      retrieval_margin, candidate_count, verification_mode, accepted_by, model,
      retrieval_source, reused_candidates, pipeline_version, reference_candidate_count,
      vector_top_k, verifier_reason_code, verifier_evidence
    FROM recognition_events
    ORDER BY id DESC
    LIMIT 1
  `).first();

  return new Response(JSON.stringify({ ok: true, event: row || null }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function previewCatalog(env, url) {
  const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 250)));
  let rows;
  if (code) {
    const result = await env.DB.prepare(`
      SELECT id,sku,capa_code,nome,variacao,image_key
      FROM products
      WHERE capa_code=?
      ORDER BY id ASC
      LIMIT ?
    `).bind(code, limit).all();
    rows = result.results || [];
  } else {
    const result = await env.DB.prepare(`
      SELECT id,sku,capa_code,nome,variacao,image_key
      FROM products
      ORDER BY capa_code ASC,id ASC
      LIMIT ?
    `).bind(limit).all();
    rows = result.results || [];
  }
  return new Response(JSON.stringify({ ok: true, products: rows }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function previewBuild() {
  return new Response(JSON.stringify({
    ok: true,
    recognition_build: RECOGNITION_BUILD,
    pipeline: 'platform namespace + embedding + Vectorize retrieval + top1-first inline R2 visual verification + deterministic adjudication',
    user_photo_max_side: 768,
    max_catalog_candidates: 3,
    candidate_transport: 'catalog candidate bytes read directly from R2 and sent inline to verifier',
    media_resolution: 'LOW',
    semantic_features: [
      'fixed_text', 'primary_subjects', 'graphic_elements', 'dominant_colors',
      'layout', 'personalization', 'physical_overlay_ignoring'
    ],
    ignored_physical_overlays: [
      'wire-o', 'spiral', 'elastic', 'tassel', 'plastic_packaging', 'lamination',
      'holographic_effect', 'glare', 'reflection', 'shadow', 'hand', 'table'
    ],
    personalization_policy: 'catalog-aware: personalized products ignore only variable name/initial/date while permanent text remains mandatory',
    minimum_structural_confidence: 0.90,
    verifier_timeout_ms: 6000,
    supported_platforms: ['MERCADO LIVRE', 'SHOPEE', 'AMAZON'],
    mercado_livre_aliases_consolidated: true,
    thumbnail_source: 'retrieved catalog image with product-image fallback',
    diagnostic_evidence: 'reason_code + concise observable evidence persisted per recognition',
    timeout_behavior: 'safe suggestions unless strict isolated retrieval fallback is satisfied'
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function deprecatedLocalConfirmationResponse() {
  return new Response(JSON.stringify({
    error: 'A versão do aplicativo está desatualizada. Atualize a página para usar a verificação estrutural segura.',
    technical_error: 'unsafe_local_confirmation_disabled'
  }), {
    status: 409,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const publicImageResponse = await handlePublicImageRequest(request, env);
    if (publicImageResponse) return publicImageResponse;

    if (request.method === 'GET' && url.pathname === '/api/platforms') {
      const platforms = await listPlatforms(env);
      return new Response(JSON.stringify({ ok: true, platforms }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/preview/build' && previewDiagnosticAllowed(url)) {
      return previewBuild();
    }

    if (request.method === 'POST' && url.pathname === '/api/preview/consolidate-platforms' && previewDiagnosticAllowed(url)) {
      try {
        const data = await consolidatePlatforms(env);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error?.message || 'Falha ao consolidar plataformas'
        }), {
          status: 500,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/preview/sync-visual-signatures' && previewDiagnosticAllowed(url)) {
      try {
        const body = await request.json().catch(() => ({}));
        const data = await syncVisualSignatures(env, body);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error?.message || 'Falha ao sincronizar assinaturas visuais'
        }), {
          status: 500,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/preview/sync-platform-vectors' && previewDiagnosticAllowed(url)) {
      try {
        const body = await request.json().catch(() => ({}));
        const data = await syncPlatformVectors(env, body);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error?.message || 'Falha ao sincronizar vetores por plataforma'
        }), {
          status: 500,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        });
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/preview/catalog' && previewDiagnosticAllowed(url)) {
      return previewCatalog(env, url);
    }

    if (request.method === 'GET' && url.pathname === '/api/preview/last-recognition' && previewDiagnosticAllowed(url)) {
      return previewLastRecognition(env);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      const response = await buildVectorizeCandidates(request, env);
      return withRecognitionTicketCookie(response);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify-confirm') {
      return deprecatedLocalConfirmationResponse();
    }

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      const response = await structuralFinalIdentifyV8(request, env);
      await recordFallback(ctx, env, response);
      return response;
    }

    const canonicalRequest = await canonicalizeCatalogRequest(request, url);
    if (canonicalRequest instanceof Response) return canonicalRequest;
    return app.fetch(canonicalRequest, env, ctx);
  }
};
