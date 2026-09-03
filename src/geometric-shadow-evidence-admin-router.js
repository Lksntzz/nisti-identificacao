import app from './reference-reindex-router.js';
import { handleGeometricShadowEvidenceRequest } from './geometric-shadow-evidence-router.js';
import { handleGeometricShadowObservabilityRequest } from './geometric-shadow-observability-router.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/geometric-shadow-evidence/observability') {
      const response = await handleGeometricShadowObservabilityRequest(request, env);
      if (response) return response;
    }

    if (url.pathname === '/api/admin/geometric-shadow-evidence/summary') {
      const response = await handleGeometricShadowEvidenceRequest(request, env);
      if (response) return response;
    }

    return app.fetch(request, env, ctx);
  }
};
