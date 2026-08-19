import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFallbackIdentifyV4 } from './structural-fallback-v4.js';
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      const response = await buildVectorizeCandidates(request, env);
      return withRecognitionTicketCookie(response);
    }
    if (request.method === 'POST' && url.pathname === '/api/identify') {
      // V4 preserva as referências visuais recuperadas pelo Vectorize em vez de
      // voltar a escolher um único mockup arbitrário por capa no fallback Gemini.
      const response = await structuralFallbackIdentifyV4(request, env);
      await recordFallback(ctx, env, response);
      return response;
    }
    return app.fetch(request, env, ctx);
  }
};
