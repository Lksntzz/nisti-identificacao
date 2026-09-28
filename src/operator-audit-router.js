import app from './vectorize-performance-router.js';
import { handleGeometricShadowConfirmationRequest } from './geometric-shadow-confirmation-router.js';
import { mirrorSuccessfulMutation } from './supabase-mutation-mirror.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function json(data, status = 200, extraHeaders = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(extraHeaders || {})
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

function isMutatingApiRequest(url, request) {
  return url.pathname.startsWith('/api/') && MUTATING_METHODS.has(String(request.method || '').toUpperCase());
}

export function cutoverWriteFreezeEnabled(env) {
  const raw = String(env?.SUPABASE_CUTOVER_WRITE_FREEZE ?? '0').trim();
  if (raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`SUPABASE_CUTOVER_WRITE_FREEZE inválido: ${raw}`);
}

function cutoverFreezeResponse(configError = null) {
  return json({
    error: configError
      ? 'Configuração de manutenção inválida. Escritas bloqueadas por segurança.'
      : 'Sistema temporariamente em manutenção para sincronização do banco. Tente novamente em instantes.',
    technical_error: configError ? 'cutover_write_freeze_invalid_config' : 'cutover_write_freeze',
    retryable: true
  }, 503, {
    'retry-after': '60',
    'x-nisti-maintenance': 'supabase-cutover-write-freeze'
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isMutatingApiRequest(url, request)) {
      try {
        if (cutoverWriteFreezeEnabled(env)) return cutoverFreezeResponse();
      } catch {
        // Invalid maintenance configuration must fail closed for writes. Reads
        // remain available so health/parity checks can still be performed.
        return cutoverFreezeResponse(true);
      }
    }

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

    // Only confirm-selection needs its JSON body again after the downstream
    // router consumes it. Other mirrored mutations are identified by URL and
    // their response payload, avoiding clones of large image uploads.
    const mirrorRequest = request.method === 'POST' && url.pathname === '/api/operator/confirm-selection'
      ? request.clone()
      : request;

    const response = await app.fetch(request, env, ctx);
    await mirrorSuccessfulMutation(mirrorRequest, response, env);
    return response;
  }
};
