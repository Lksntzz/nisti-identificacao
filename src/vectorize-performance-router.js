import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFallbackIdentifyV9 } from './structural-fallback-v9.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';

const RECOGNITION_COOKIE = 'nisti_recognition_ticket';

async function recordFallback(ctx, env, response) {
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.clone().json().catch(() => null) : null;
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/preview/last-recognition' && previewDiagnosticAllowed(url)) {
      return previewLastRecognition(env);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      const response = await buildVectorizeCandidates(request, env);
      return withRecognitionTicketCookie(response);
    }

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      // V9 mantém comparação binária por capa, mas isola timeout por candidata.
      // Falhas temporárias são reexecutadas somente para as capas afetadas e uma
      // comparação não resolvida nunca é tratada como autorização para liberar SKU.
      const response = await structuralFallbackIdentifyV9(request, env);
      await recordFallback(ctx, env, response);
      return response;
    }

    return app.fetch(request, env, ctx);
  }
};