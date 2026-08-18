import app from './edge-router.js';
import { fastIdentify } from './fast-identify-v3.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';
import { verifyExactVisualMatch } from './exact-match-guard.js';

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

function guardedResponse(originalResponse, data, guard) {
  const performance = {
    ...(data?.performance || {}),
    final_guard_ms: guard.ms,
    final_guard_confidence: guard.confidence,
    final_guard_same_art: guard.same_art,
    final_guard_reason: guard.reason,
    final_guard_model: guard.model
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
    capa_code: code === 'desconhecida' ? null : code,
    proposed_sku: proposed?.sku || null,
    confidence: data?.confidence ?? null,
    retrieval_score: data?.retrieval_score ?? null,
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
      const guardRequest = request.clone();
      let response = await fastIdentify(request, env);
      const type = response.headers.get('content-type') || '';
      let data = type.includes('application/json')
        ? await response.clone().json().catch(() => null)
        : null;

      if (response.ok && data && (data.product || (Array.isArray(data.products) && data.products.length))) {
        try {
          const guard = await verifyExactVisualMatch(guardRequest, env, data);
          const guarded = guardedResponse(response, data, guard);
          response = guarded.response;
          data = guarded.data;
        } catch (error) {
          const technical = {
            error: `Falha na confirmação visual final: ${error?.message || 'erro desconhecido'}`,
            performance: {
              ...(data?.performance || {}),
              final_guard_same_art: false,
              final_guard_error: error?.message || 'erro desconhecido'
            }
          };
          response = new Response(JSON.stringify(technical), {
            status: 502,
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
