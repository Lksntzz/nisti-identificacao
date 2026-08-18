import app from './performance-router.js';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { structuralFallbackIdentify } from './structural-fallback.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/identify-candidates') {
      return buildVectorizeCandidates(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/identify') {
      return structuralFallbackIdentify(request, env);
    }
    return app.fetch(request, env, ctx);
  }
};
