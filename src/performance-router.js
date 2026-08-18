import app from './edge-router.js';
import { fastIdentify } from './fast-identify-v3.js';
import { recordRecognitionAttempt } from './recognition-metrics.js';

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/identify') {
      const response = await fastIdentify(request, env);
      const type = response.headers.get('content-type') || '';
      const data = type.includes('application/json')
        ? await response.clone().json().catch(() => null)
        : null;

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