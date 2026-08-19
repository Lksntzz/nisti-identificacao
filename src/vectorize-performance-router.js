import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFallbackIdentifyV3 } from './structural-fallback-v3.js';

const RECOGNITION_COOKIE = 'nisti_recognition_ticket';

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
      return structuralFallbackIdentifyV3(request, env);
    }
    return app.fetch(request, env, ctx);
  }
};
