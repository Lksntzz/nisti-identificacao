import app from './vectorize-performance-router.js';
import { handleGeometricShadowConfirmationRequest } from './geometric-shadow-confirmation-router.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function operatorNameFromRequest(request) {
  const raw = request.headers.get('x-operator-name');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return String(raw).trim();
  }
}

function isRecognitionRequest(url, request) {
  if (request.method !== 'POST') return false;
  return url.pathname === '/api/identify-candidates'
    || url.pathname === '/api/identify'
    || url.pathname === '/api/identify-detail';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const shadowConfirmationResponse = await handleGeometricShadowConfirmationRequest(request, env);
    if (shadowConfirmationResponse) return shadowConfirmationResponse;

    // Public operator app always sends x-user-id. If it does, require a
    // non-empty operator name before any recognition work starts. This
    // prevents anonymous scans from being stored as "Operador Geral" and
    // closes the race where auto-scan starts while the profile modal is open.
    if (isRecognitionRequest(url, request)) {
      const operatorId = String(request.headers.get('x-user-id') || '').trim();
      if (operatorId && !operatorNameFromRequest(request)) {
        return json({
          error: 'Identifique o operador antes de iniciar o reconhecimento.',
          technical_error: 'operator_required'
        }, 428);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
