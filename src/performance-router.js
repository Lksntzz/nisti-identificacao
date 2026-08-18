import app from './edge-router.js';
import { fastIdentify } from './fast-identify-v3.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';
import { verifyExactVisualMatch } from './exact-match-guard.js';

const MAX_GEMINI_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [300, 900];
const RETRYABLE_GEMINI_STATUS = new Set([429, 500, 502, 503, 504]);

function responseWithHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function resultImageUrl(product) {
  if (!product?.id || !product?.image_key) return null;
  const version = String(product.image_key).split('/').pop() || 'current';
  return `/api/images/${product.id}?v=${encodeURIComponent(version)}`;
}

function prepareProductImage(product) {
  if (!product?.image_key) return product;
  product.image_url = resultImageUrl(product);
  return product;
}

function proposedResult(data) {
  if (data?.product) return data.product;
  if (Array.isArray(data?.products) && data.products.length) return data.products[0];
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryableGeminiMessage(value) {
  const text = String(value || '');
  const match = text.match(/Gemini[^()]*\((\d{3})\)/i);
  return Boolean(match && RETRYABLE_GEMINI_STATUS.has(Number(match[1])));
}

function retryableGeminiResponse(response, data) {
  if (RETRYABLE_GEMINI_STATUS.has(Number(response?.status || 0))) return true;
  return retryableGeminiMessage(data?.error) || retryableGeminiMessage(data?.technical_error);
}

async function fastIdentifyWithRetry(requestSeed, env) {
  let response = null;
  let data = null;

  for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt += 1) {
    response = await fastIdentify(requestSeed.clone(), env);
    const type = response.headers.get('content-type') || '';
    data = type.includes('application/json')
      ? await response.clone().json().catch(() => null)
      : null;

    const retryable = retryableGeminiResponse(response, data);
    if (!retryable || attempt === MAX_GEMINI_ATTEMPTS) {
      if (data?.performance) data.performance.gemini_retry_count = attempt - 1;
      return { response, data, attempts: attempt, exhausted: retryable && attempt === MAX_GEMINI_ATTEMPTS };
    }

    await sleep(RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
  }

  return { response, data, attempts: MAX_GEMINI_ATTEMPTS, exhausted: true };
}

async function finalGuardWithRetry(requestSeed, env, data) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt += 1) {
    try {
      const guard = await verifyExactVisualMatch(requestSeed.clone(), env, data);
      guard.retry_count = attempt - 1;
      return guard;
    } catch (error) {
      lastError = error;
      const retryable = retryableGeminiMessage(error?.message);
      if (!retryable || attempt === MAX_GEMINI_ATTEMPTS) throw error;
      await sleep(RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  }

  throw lastError || new Error('Falha desconhecida na confirmação visual final');
}

function temporaryGeminiFailure(originalResponse, data, attempts) {
  const originalError = String(data?.error || `Gemini indisponível (${originalResponse?.status || 503})`);
  const unavailable = {
    ...(data || {}),
    error: `Serviço de reconhecimento temporariamente indisponível após ${attempts} tentativas. Tente novamente em alguns segundos.`,
    technical_error: originalError,
    performance: {
      ...(data?.performance || {}),
      gemini_retry_count: Math.max(0, attempts - 1),
      gemini_retry_exhausted: true
    }
  };

  return {
    response: new Response(JSON.stringify(unavailable), {
      status: 503,
      headers: responseWithHeaders(originalResponse)
    }),
    data: unavailable
  };
}

function guardedResponse(originalResponse, data, guard) {
  const performance = {
    ...(data?.performance || {}),
    final_guard_ms: guard.ms,
    final_guard_confidence: guard.confidence,
    final_guard_same_art: guard.same_art,
    final_guard_reason: guard.reason,
    final_guard_model: guard.model,
    final_guard_retry_count: Number(guard.retry_count || 0)
  };

  if (guard.same_art) {
    return {
      response: originalResponse,
      data: {
        ...data,
        identified_by: data?.identified_by ? `${data.identified_by}+pairwise-guard` : data?.identified_by,
        performance
      }
    };
  }

  const proposed = proposedResult(data);
  const code = proposed?.capa_code || data?.capa_code || 'desconhecida';
  const reason = guard.reason ? ` Motivo: ${guard.reason}` : '';
  const rejected = {
    error: `A confirmação visual final rejeitou a capa ${code} porque a arte não corresponde com segurança à foto.${reason}`,
    product: proposed || null,
    capa_code: code === 'desconhecida' ? null : code,
    proposed_sku: proposed?.sku || null,
    confidence: data?.confidence ?? null,
    retrieval_score: data?.retrieval_score ?? null,
    identified_by: data?.identified_by || null,
    performance
  };
  return {
    response: new Response(JSON.stringify(rejected), {
      status: 422,
      headers: responseWithHeaders(originalResponse)
    }),
    data: rejected
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      const requestSeed = request.clone();
      let { response, data, attempts, exhausted } = await fastIdentifyWithRetry(requestSeed, env);

      if (exhausted) {
        const temporary = temporaryGeminiFailure(response, data, attempts);
        response = temporary.response;
        data = temporary.data;
      }

      if (response.ok && data && (data.product || (Array.isArray(data.products) && data.products.length))) {
        try {
          const guard = await finalGuardWithRetry(requestSeed, env, data);
          const guarded = guardedResponse(response, data, guard);
          response = guarded.response;
          data = guarded.data;
        } catch (error) {
          const retryable = retryableGeminiMessage(error?.message);
          const technical = {
            error: retryable
              ? 'Serviço de confirmação visual temporariamente indisponível após 3 tentativas. Tente novamente em alguns segundos.'
              : `Falha na confirmação visual final: ${error?.message || 'erro desconhecido'}`,
            technical_error: error?.message || 'erro desconhecido',
            performance: {
              ...(data?.performance || {}),
              final_guard_same_art: false,
              final_guard_error: error?.message || 'erro desconhecido',
              final_guard_retry_count: retryable ? MAX_GEMINI_ATTEMPTS - 1 : 0,
              final_guard_retry_exhausted: retryable
            }
          };
          response = new Response(JSON.stringify(technical), {
            status: retryable ? 503 : 502,
            headers: responseWithHeaders(response)
          });
          data = technical;
        }
      }

      if (data) {
        const telemetry = recordRecognitionAttempt(env, response.status, data);
        if (ctx?.waitUntil) ctx.waitUntil(telemetry);
        else await telemetry;
      }

      if (!response.ok || !data) return response;

      if (data.product) prepareProductImage(data.product);
      if (Array.isArray(data.products)) data.products = data.products.map(prepareProductImage);

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: responseWithHeaders(response)
      });
    }

    return app.fetch(request, env, ctx);
  }
};
