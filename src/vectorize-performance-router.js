import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFinalIdentifyV3 } from './structural-final-v3.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';
import { listPlatforms } from './platform-scope.js';
import { syncPlatformVectors } from './platform-vector-sync.js';

const RECOGNITION_COOKIE = 'nisti_recognition_ticket';
const RECOGNITION_BUILD = 'platform-scoped-recognition-v2';

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

async function previewLastRecognition(env) {
  const row = await env.DB.prepare(`
    SELECT
      id, created_at, kind, http_status, confidence, identified_by, error_message,
      total_ms, embedding_ms, vectorize_ms, local_cv_ms, reference_load_ms, gemini_ms,
      retrieval_top1, retrieval_top1_code, retrieval_top2, retrieval_top2_code,
      retrieval_margin, candidate_count, verification_mode, accepted_by, model,
      retrieval_source, reused_candidates, pipeline_version, reference_candidate_count,
      vector_top_k
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
    pipeline: 'platform namespace + embedding + parallel binary top-2 verifier',
    user_photo_max_side: 768,
    verifier_media_resolution: 'LOW',
    verifier_candidates: 2,
    verifier_timeout_ms: 6500,
    exact_confidence: 0.97,
    timeout_behavior: 'safe suggestions instead of system error'
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
      const response = await structuralFinalIdentifyV3(request, env);
      await recordFallback(ctx, env, response);
      return response;
    }

    return app.fetch(request, env, ctx);
  }
};
