const SHADOW_VERSION = 'v8.18';
const MAX_CONTEXT_AGE_MS = 15 * 60 * 1000;
const FEATURE_OPTIONS = Object.freeze({
  maxFeatures: 260,
  fastThreshold: 18,
  scales: [1, 0.72],
  ratioThreshold: 0.8,
  maxHamming: 96,
  ransacIterations: 650,
  reprojectionThreshold: 6,
  minGoodMatches: 8,
  minInliers: 6,
  minInlierRatio: 0.26,
  minCoverage: 0.02
});

if (!location.pathname.startsWith('/admin')) {
  const nativeFetch = window.fetch.bind(window);
  const contextsByProductionTicket = new Map();
  const latestByPlatform = new Map();
  const referenceCache = new Map();
  let shadowQueue = Promise.resolve();

  function requestUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.origin);
      if (input instanceof URL) return input;
      if (input?.url) return new URL(input.url, location.origin);
    } catch {}
    return null;
  }

  function methodOf(input, init) {
    return String(init?.method || input?.method || 'GET').toUpperCase();
  }

  function formBody(init) {
    return init?.body instanceof FormData ? init.body : null;
  }

  function operatorHeaders() {
    let operatorId = 'op_guest';
    let operatorName = '';
    try {
      operatorId = localStorage.getItem('nisti_shipping_user_id') || 'op_guest';
      operatorName = localStorage.getItem('nisti_operator_name') || '';
    } catch {}
    return {
      'content-type': 'application/json',
      'x-user-id': operatorId,
      ...(operatorName ? { 'x-operator-name': encodeURIComponent(operatorName) } : {})
    };
  }

  async function cloneJson(response) {
    const type = response?.headers?.get('content-type') || '';
    if (!type.includes('application/json')) return null;
    return response.clone().json().catch(() => null);
  }

  function cleanupContexts() {
    const now = Date.now();
    for (const [ticket, context] of contextsByProductionTicket.entries()) {
      if (now - context.created_at_ms > MAX_CONTEXT_AGE_MS) {
        contextsByProductionTicket.delete(ticket);
      }
    }
    for (const [platform, context] of latestByPlatform.entries()) {
      if (now - context.created_at_ms > MAX_CONTEXT_AGE_MS) latestByPlatform.delete(platform);
    }
  }

  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function hex(bytes) {
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(blob) {
    return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  }

  function idle() {
    return new Promise(resolve => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => resolve(), { timeout: 350 });
      } else {
        setTimeout(resolve, 20);
      }
    });
  }

  async function blobFromUrl(url) {
    const response = await nativeFetch(url, { credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) throw new Error(`reference_http_${response.status}`);
    return response.blob();
  }

  async function loadReferenceFeatures(url, core) {
    if (referenceCache.has(url)) return referenceCache.get(url);
    const promise = (async () => {
      const blob = await blobFromUrl(url);
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        const maxDimension = 520;
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(48, Math.round(bitmap.width * scale));
        const height = Math.max(48, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
        ctx.drawImage(bitmap, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const gray = core.rgbaToGray(rgba, width, height);
        const features = core.extractOrbLikeFeatures(gray, width, height, FEATURE_OPTIONS);
        return { width, height, features, feature_count: features.length };
      } finally {
        bitmap.close?.();
      }
    })();
    referenceCache.set(url, promise);
    try {
      return await promise;
    } catch (error) {
      referenceCache.delete(url);
      throw error;
    }
  }

  async function queryFeatures(file, core) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const maxDimension = 520;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(48, Math.round(bitmap.width * scale));
      const height = Math.max(48, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
      ctx.drawImage(bitmap, 0, 0, width, height);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const gray = core.rgbaToGray(rgba, width, height);
      return core.extractOrbLikeFeatures(gray, width, height, FEATURE_OPTIONS);
    } finally {
      bitmap.close?.();
    }
  }

  function retrievalResultForGate(shadowCandidates) {
    const candidates = (shadowCandidates || []).map((item, index) => ({
      capa_code: item.capa_code,
      vector_rank: Number(item.cover_rank || item.vector_rank || index + 1),
      vector_score: Number(item.retrieval_score || 0),
      reference_kind: item.reference_kind
    }));
    return {
      vector_top1: candidates[0]?.capa_code || null,
      vector_top1_score: candidates[0]?.vector_score ?? null,
      candidates
    };
  }

  async function persistEvidence(context, productionData, productionHttpStatus) {
    const started = performance.now();
    const shadow = context.shadow;
    const candidates = Array.isArray(shadow?.candidates) ? shadow.candidates : [];
    if (!context.photo || !shadow?.ticket || !shadow?.token || !candidates.length) return;

    const gateModule = await import('/geometric-hybrid-gate.js?v=8.18');
    const retrievalInput = retrievalResultForGate(candidates);
    const retrievalGate = gateModule.evaluateRetrievalGate(retrievalInput, gateModule.RETRIEVAL_GATE);
    const photoSha256 = await sha256(context.photo);

    let geometric = {
      geometric_evaluated: false,
      geometric_capa_code: null,
      geometric_score: null,
      geometric_runner_up_code: null,
      geometric_runner_up_score: null,
      geometric_good_matches: 0,
      geometric_inliers: 0,
      geometric_inlier_ratio: 0,
      geometric_reference_coverage: 0,
      geometric_vector_rank: null
    };

    // The hybrid architecture never invokes geometry when the retrieval fastpath already passes.
    if (!retrievalGate.eligible) {
      await idle();
      const core = await import('/geometric-core.js?v=8.18');
      const photoFeatures = await queryFeatures(context.photo, core);
      const featureCandidates = [];

      for (const candidate of candidates) {
        await idle();
        try {
          const ref = await loadReferenceFeatures(candidate.image_url, core);
          featureCandidates.push({
            capa_code: candidate.capa_code,
            vector_rank: Number(candidate.cover_rank || candidate.vector_rank || featureCandidates.length + 1),
            vector_score: Number(candidate.retrieval_score || 0),
            reference_id: Number(candidate.reference_id || 0) || null,
            reference_kind: candidate.reference_kind,
            width: ref.width,
            height: ref.height,
            feature_count: ref.feature_count,
            features: ref.features
          });
        } catch {
          featureCandidates.push({
            capa_code: candidate.capa_code,
            vector_rank: Number(candidate.cover_rank || candidate.vector_rank || featureCandidates.length + 1),
            vector_score: Number(candidate.retrieval_score || 0),
            reference_id: Number(candidate.reference_id || 0) || null,
            reference_kind: candidate.reference_kind,
            width: 1,
            height: 1,
            feature_count: 0,
            features: []
          });
        }
      }

      const ranked = core.rankGeometricCandidates(photoFeatures, featureCandidates, FEATURE_OPTIONS);
      const gateInput = {
        candidates: ranked.map(item => ({
          capa_code: item.capa_code,
          vector_rank: item.vector_rank,
          vector_score: item.vector_score,
          reference_kind: item.reference_kind,
          geometric_score: item.score,
          good_matches: item.good_matches,
          inliers: item.inliers,
          inlier_ratio: item.inlier_ratio,
          reference_coverage: item.reference_coverage
        }))
      };
      const decision = gateModule.evaluateGeometricGate(gateInput, gateModule.GEOMETRIC_GATES.strict_core_v816);
      const winner = ranked.find(item => normalizeCode(item.capa_code) === normalizeCode(decision.capa_code)) || ranked[0] || null;
      const runnerUp = decision.runner_up_code
        ? ranked.find(item => normalizeCode(item.capa_code) === normalizeCode(decision.runner_up_code))
        : ranked.find(item => item !== winner) || null;

      geometric = {
        geometric_evaluated: true,
        geometric_capa_code: decision.capa_code || winner?.capa_code || null,
        geometric_score: Number(decision.score ?? winner?.score ?? 0),
        geometric_runner_up_code: decision.runner_up_code || runnerUp?.capa_code || null,
        geometric_runner_up_score: Number(decision.runner_up_score ?? runnerUp?.score ?? 0),
        geometric_good_matches: Number(decision.good_matches ?? winner?.good_matches ?? 0),
        geometric_inliers: Number(decision.inliers ?? winner?.inliers ?? 0),
        geometric_inlier_ratio: Number(decision.inlier_ratio ?? winner?.inlier_ratio ?? 0),
        geometric_reference_coverage: Number(decision.reference_coverage ?? winner?.reference_coverage ?? 0),
        geometric_vector_rank: Number(decision.vector_rank ?? winner?.vector_rank ?? 0) || null
      };
    }

    const body = {
      shadow_ticket: shadow.ticket,
      photo_sha256: photoSha256,
      occurrence_id: Number(productionData?.occurrence_id || 0) || null,
      production_http_status: Number(productionHttpStatus || 0) || null,
      production_capa_code: productionData?.product?.capa_code || productionData?.capa_code || null,
      production_identified_by: productionData?.identified_by || productionData?.accepted_by || null,
      processing_ms: Math.round(performance.now() - started),
      ...geometric
    };

    const response = await nativeFetch('/api/operator/geometric-shadow-evidence', {
      method: 'POST',
      credentials: 'same-origin',
      headers: operatorHeaders(),
      body: JSON.stringify(body)
    });
    if (!response.ok) return;
    context.persisted = true;
    context.photo_sha256 = photoSha256;
  }

  function enqueueEvidence(context, productionData, productionHttpStatus) {
    shadowQueue = shadowQueue
      .then(() => persistEvidence(context, productionData, productionHttpStatus))
      .catch(() => {});
  }

  async function linkOccurrenceWithRetry(context, occurrenceId) {
    const id = Number(occurrenceId || 0);
    if (!context?.shadow?.token || !context?.shadow?.ticket || !id) return;
    const path = `/api/operator/geometric-shadow-evidence/${encodeURIComponent(context.shadow.token)}/link-occurrence`;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500 + attempt * 250));
      try {
        const response = await nativeFetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: operatorHeaders(),
          body: JSON.stringify({ shadow_ticket: context.shadow.ticket, occurrence_id: id })
        });
        if (response.ok) return;
      } catch {}
    }
  }

  window.fetch = async function patchedFetch(input, init = {}) {
    const url = requestUrl(input);
    const method = methodOf(input, init);
    const pathname = url?.pathname || '';
    cleanupContexts();

    if (method === 'POST' && pathname === '/api/identify-candidates') {
      const form = formBody(init);
      const photo = form?.get('image');
      const platform = String(form?.get('platform') || '').trim().toUpperCase();
      const response = await nativeFetch(input, init);
      const data = await cloneJson(response);

      if (response.ok && photo instanceof Blob && data?.ticket && data?.shadow_evidence?.ticket) {
        const context = {
          production_ticket: data.ticket,
          photo,
          platform,
          shadow: data.shadow_evidence,
          created_at_ms: Date.now(),
          persisted: false
        };
        contextsByProductionTicket.set(data.ticket, context);
        latestByPlatform.set(platform, context);
      }
      return response;
    }

    if (method === 'POST' && pathname === '/api/identify') {
      const form = formBody(init);
      const productionTicket = String(form?.get('ticket') || '');
      const platform = String(form?.get('platform') || '').trim().toUpperCase();
      const response = await nativeFetch(input, init);
      const data = await cloneJson(response);
      const context = contextsByProductionTicket.get(productionTicket) || latestByPlatform.get(platform);
      if (context && Date.now() - context.created_at_ms <= MAX_CONTEXT_AGE_MS) {
        if (Number(data?.occurrence_id || 0)) context.occurrence_id = Number(data.occurrence_id);
        enqueueEvidence(context, data, response.status);
      }
      return response;
    }

    if (method === 'POST' && pathname === '/api/report-occurrence') {
      const form = formBody(init);
      const platform = String(form?.get('platform') || '').trim().toUpperCase();
      const context = latestByPlatform.get(platform) || [...latestByPlatform.values()].at(-1) || null;
      const response = await nativeFetch(input, init);
      const data = await cloneJson(response);
      if (response.ok && context && Number(data?.occurrence_id || 0)) {
        void linkOccurrenceWithRetry(context, data.occurrence_id);
      }
      return response;
    }

    return nativeFetch(input, init);
  };

  window.__NISTI_GEOMETRIC_SHADOW_VERSION__ = SHADOW_VERSION;
}
