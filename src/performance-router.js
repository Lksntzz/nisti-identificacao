import app from './edge-router.js';
import { fastIdentify } from './fast-identify-v4.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';

// Orçamento total do Worker. A margem restante fica para upload/browser sem voltar aos 50+ segundos.
const ROUTER_BUDGET_MS = 4600;

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

function timeoutResult(started) {
  const data = {
    error: 'Não consegui confirmar a capa dentro do limite de 5 segundos. Tente novamente.',
    technical_error: 'recognition_deadline_exceeded',
    performance: {
      total_ms: Date.now() - started,
      recognition_deadline_ms: ROUTER_BUDGET_MS,
      deadline_exceeded: true
    }
  };
  return {
    response: new Response(JSON.stringify(data), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    }),
    data
  };
}

async function identifyWithinBudget(request, env) {
  const started = Date.now();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(timeoutResult(started)), ROUTER_BUDGET_MS);
  });

  const work = (async () => {
    const response = await fastIdentify(request, env, { deadlineAt: started + ROUTER_BUDGET_MS - 100 });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json')
      ? await response.clone().json().catch(() => null)
      : null;
    return { response, data };
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      let { response, data } = await identifyWithinBudget(request, env);

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
