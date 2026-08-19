import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFallbackIdentifyV7 } from './structural-fallback-v7.js';
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

async function enforceCrossSignalAgreement(response) {
  if (!response?.ok) return response;

  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;

  const data = await response.clone().json().catch(() => null);
  if (!data || (!data.product && !data.needs_selection)) return response;

  const performance = data.performance && typeof data.performance === 'object'
    ? data.performance
    : {};
  const selectedCode = String(
    data.capa_code || data.product?.capa_code || performance.gemini_proposed_code || ''
  ).trim().toUpperCase();
  const retrievalTopCode = String(performance.retrieval_top1_code || '').trim().toUpperCase();
  const localGeometryCodes = Array.isArray(performance.local_geometry_codes)
    ? performance.local_geometry_codes.map(code => String(code || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const localTopCode = localGeometryCodes[0] || '';
  const localGeometryUseful = performance.shortlist_strategy === 'local-geometry+retrieval-top1';

  // O Gemini não pode transformar "mais parecido" em identificação. Uma resposta
  // positiva só é aceita quando existe concordância com um sinal independente.
  // Evidência geométrica só entra no gate quando o V7 marcou que ela continha
  // sinal útil; caso contrário usamos o top-1 do retrieval como corroborador.
  const corroboratingCode = localGeometryUseful
    ? (localTopCode || retrievalTopCode)
    : retrievalTopCode;
  const corroborated = Boolean(selectedCode && corroboratingCode && selectedCode === corroboratingCode);

  if (corroborated) {
    performance.cross_signal_guard = 'passed';
    performance.cross_signal_code = corroboratingCode;
    performance.cross_signal_source = localGeometryUseful ? 'local-geometry' : 'retrieval-top1';
    data.performance = performance;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  performance.accepted_by = 'rejected-by-cross-signal-guard';
  performance.cross_signal_guard = 'rejected';
  performance.cross_signal_selected_code = selectedCode || null;
  performance.cross_signal_retrieval_top1_code = retrievalTopCode || null;
  performance.cross_signal_local_top_code = localTopCode || null;
  performance.cross_signal_source = localGeometryUseful ? 'local-geometry' : 'retrieval-top1';

  return new Response(JSON.stringify({
    error: 'A análise visual encontrou sinais conflitantes. Produto não identificado com segurança.',
    confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
    identified_by: 'rejected-by-cross-signal-guard',
    performance
  }), {
    status: 422,
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
      // V7 mantém uma única chamada Gemini final. Antes de liberar qualquer SKU,
      // aplicamos um gate de concordância entre sinais independentes para impedir
      // que um candidato apenas "parecido" seja promovido a identificação.
      const rawResponse = await structuralFallbackIdentifyV7(request, env);
      const response = await enforceCrossSignalAgreement(rawResponse);
      await recordFallback(ctx, env, response);
      return response;
    }
    return app.fetch(request, env, ctx);
  }
};