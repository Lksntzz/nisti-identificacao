const CONFIRMATION_VERSION = 'v8.19';
const AMBIGUOUS_REVIEW_VERSION = 'v8.24.2';
const MAX_CONTEXT_AGE_MS = 15 * 60 * 1000;
const READY_EVENT = 'nisti:shadow-confirmation-ready';
const STATE_EVENT = 'nisti:shadow-confirmation-state';
const AMBIGUOUS_READY_EVENT = 'nisti:ambiguous-review-ready';
const AMBIGUOUS_STATE_EVENT = 'nisti:ambiguous-review-state';

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizePlatform(value) {
  return String(value || '').trim().toUpperCase();
}

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

async function cloneJson(response) {
  const type = response?.headers?.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  return response.clone().json().catch(() => null);
}

function responseWithJson(response, data) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function operatorHeaders({ json = true } = {}) {
  let operatorId = 'op_guest';
  let operatorName = '';
  try {
    operatorId = localStorage.getItem('nisti_shipping_user_id') || 'op_guest';
    operatorName = localStorage.getItem('nisti_operator_name') || '';
  } catch {}
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-user-id': operatorId,
    ...(operatorName ? { 'x-operator-name': encodeURIComponent(operatorName) } : {})
  };
}

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function install() {
  if (typeof window === 'undefined') return;
  if (location.pathname.startsWith('/admin')) return;
  if (window.__NISTI_SHADOW_CONFIRMATION_CLIENT_INSTALLED__) return;
  window.__NISTI_SHADOW_CONFIRMATION_CLIENT_INSTALLED__ = true;

  const previousFetch = window.fetch.bind(window);
  const contextsByProductionTicket = new Map();
  const latestByPlatform = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [ticket, context] of contextsByProductionTicket.entries()) {
      if (now - context.created_at_ms > MAX_CONTEXT_AGE_MS) contextsByProductionTicket.delete(ticket);
    }
    for (const [platform, context] of latestByPlatform.entries()) {
      if (now - context.created_at_ms > MAX_CONTEXT_AGE_MS) latestByPlatform.delete(platform);
    }
  }

  function contextFor(platform, productionTicket = '') {
    cleanup();
    return contextsByProductionTicket.get(productionTicket)
      || latestByPlatform.get(normalizePlatform(platform))
      || null;
  }

  async function confirmCurrent({ capaCode, platform } = {}) {
    const code = normalizeCode(capaCode);
    const normalizedPlatform = normalizePlatform(platform);
    const context = contextFor(normalizedPlatform);
    if (!context || !context.shadow_ticket) {
      throw new Error('A evidência shadow desta foto não está disponível.');
    }
    if (!code || code !== normalizeCode(context.production_capa_code)) {
      throw new Error('A capa confirmada não corresponde ao resultado atual.');
    }

    dispatch(STATE_EVENT, { status: 'confirming', capa_code: code, platform: normalizedPlatform });

    for (let attempt = 0; attempt < 7; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 350 + attempt * 250));

      const response = await previousFetch('/api/operator/geometric-shadow-evidence/confirm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: operatorHeaders(),
        body: JSON.stringify({
          shadow_ticket: context.shadow_ticket,
          capa_code: code
        })
      });
      const data = await cloneJson(response);

      if (response.ok && data?.confirmed) {
        context.confirmed = true;
        dispatch(STATE_EVENT, {
          status: 'confirmed',
          capa_code: code,
          platform: normalizedPlatform,
          confirmation_version: data.confirmation_version || CONFIRMATION_VERSION
        });
        return data;
      }

      if (response.status === 404 && attempt < 6) continue;

      const message = data?.error || `Falha ao confirmar capa (${response.status}).`;
      dispatch(STATE_EVENT, {
        status: 'error',
        capa_code: code,
        platform: normalizedPlatform,
        error: message
      });
      throw new Error(message);
    }

    throw new Error('A evidência shadow não ficou disponível a tempo para confirmação.');
  }

  async function linkAmbiguousOccurrence(context, occurrenceId) {
    const id = Number(occurrenceId || 0);
    const token = String(context?.shadow_token || '').trim();
    const shadowTicket = String(context?.shadow_ticket || '').trim();
    if (!id || !token || !shadowTicket) return false;

    const path = `/api/operator/geometric-shadow-evidence/${encodeURIComponent(token)}/link-occurrence`;
    for (let attempt = 0; attempt < 7; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 400 + attempt * 300));
      try {
        const response = await previousFetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: operatorHeaders(),
          body: JSON.stringify({
            shadow_ticket: shadowTicket,
            occurrence_id: id
          })
        });
        if (response.ok) return true;
        if (response.status !== 404) return false;
      } catch {}
    }
    return false;
  }

  async function startAmbiguousReview({ context, form, errorMessage }) {
    if (!context?.shadow_ticket || !context?.production_ticket) {
      throw new Error('Tickets da revisão ambígua não estão disponíveis.');
    }
    if (context.ambiguous_review) return context.ambiguous_review;
    if (context.ambiguous_review_starting) return context.ambiguous_review_starting;

    const image = form?.get('image');
    const platform = normalizePlatform(form?.get('platform') || context.platform);
    if (!(image instanceof File) || !platform) {
      throw new Error('Foto ou plataforma ausente para revisão ambígua.');
    }

    dispatch(AMBIGUOUS_STATE_EVENT, {
      status: 'starting',
      platform,
      error: errorMessage || null
    });

    context.ambiguous_review_starting = (async () => {
      const reviewForm = new FormData();
      reviewForm.append('image', image, image.name || 'capa.jpg');
      reviewForm.append('platform', platform);
      reviewForm.append('production_ticket', context.production_ticket);
      reviewForm.append('shadow_ticket', context.shadow_ticket);

      const response = await previousFetch('/api/operator/ambiguous-review/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: operatorHeaders({ json: false }),
        body: reviewForm
      });
      const data = await cloneJson(response);
      if (!response.ok || !data?.ok || !data?.occurrence_id || !data?.review_token) {
        throw new Error(data?.error || `Falha ao iniciar revisão (${response.status}).`);
      }

      context.ambiguous_review = {
        occurrence_id: Number(data.occurrence_id),
        review_token: String(data.review_token),
        platform: normalizePlatform(data.platform || platform),
        candidates: Array.isArray(data.candidates) ? data.candidates : [],
        sent_to_adm: data.sent_to_adm === true
      };

      // O snapshot shadow pode estar sendo persistido em background pela camada
      // geométrica. Vincular com retry garante que uma confirmação muito rápida
      // ainda seja reconciliada como ground truth quando a evidência aparecer.
      void linkAmbiguousOccurrence(context, context.ambiguous_review.occurrence_id);

      dispatch(AMBIGUOUS_READY_EVENT, {
        ...context.ambiguous_review,
        review_version: data.review_version || AMBIGUOUS_REVIEW_VERSION,
        original_error: errorMessage || null
      });
      dispatch(AMBIGUOUS_STATE_EVENT, {
        status: 'ready',
        occurrence_id: context.ambiguous_review.occurrence_id,
        platform: context.ambiguous_review.platform
      });
      return context.ambiguous_review;
    })();

    try {
      return await context.ambiguous_review_starting;
    } finally {
      context.ambiguous_review_starting = null;
    }
  }

  window.__NISTI_CONFIRM_SHADOW_RESULT__ = confirmCurrent;
  window.__NISTI_SHADOW_CONFIRMATION_VERSION__ = CONFIRMATION_VERSION;
  window.__NISTI_AMBIGUOUS_REVIEW_VERSION__ = AMBIGUOUS_REVIEW_VERSION;

  window.fetch = async function confirmationObservedFetch(input, init = {}) {
    const url = requestUrl(input);
    const method = methodOf(input, init);
    const pathname = url?.pathname || '';

    if (method === 'POST' && pathname === '/api/identify-candidates') {
      const form = formBody(init);
      const platform = normalizePlatform(form?.get('platform'));
      const response = await previousFetch(input, init);
      const data = await cloneJson(response);

      if (response.ok && data?.ticket && data?.shadow_evidence?.ticket) {
        const context = {
          production_ticket: String(data.ticket),
          shadow_ticket: String(data.shadow_evidence.ticket),
          shadow_token: String(data.shadow_evidence.token || ''),
          platform,
          created_at_ms: Date.now(),
          production_capa_code: null,
          confirmed: false,
          ambiguous_review: null,
          ambiguous_review_starting: null
        };
        contextsByProductionTicket.set(context.production_ticket, context);
        if (platform) latestByPlatform.set(platform, context);
      }
      return response;
    }

    if (method === 'POST' && pathname === '/api/identify') {
      const form = formBody(init);
      const productionTicket = String(form?.get('ticket') || '');
      const platform = normalizePlatform(form?.get('platform'));
      const response = await previousFetch(input, init);
      const data = await cloneJson(response);
      const context = contextFor(platform, productionTicket);

      const productionCode = normalizeCode(data?.product?.capa_code || data?.capa_code);
      if (response.ok && context && productionCode) {
        context.production_capa_code = productionCode;
        context.platform = platform || context.platform;
        if (context.platform) latestByPlatform.set(context.platform, context);
        dispatch(READY_EVENT, {
          capa_code: productionCode,
          platform: context.platform,
          confirmation_version: CONFIRMATION_VERSION
        });
        return response;
      }

      if (
        response.status === 422 &&
        data?.technical_error === 'ambiguous_top1_margin' &&
        context
      ) {
        try {
          const review = await startAmbiguousReview({
            context,
            form,
            errorMessage: data?.error || null
          });
          return responseWithJson(response, {
            ...data,
            occurrence_id: review.occurrence_id,
            sent_to_adm: review.sent_to_adm,
            review_candidates: review.candidates,
            review_version: AMBIGUOUS_REVIEW_VERSION
          });
        } catch (error) {
          dispatch(AMBIGUOUS_STATE_EVENT, {
            status: 'error',
            platform,
            error: error?.message || 'Falha ao preparar revisão humana.'
          });
        }
      }

      return response;
    }

    return previousFetch(input, init);
  };
}

install();

export {
  CONFIRMATION_VERSION,
  AMBIGUOUS_REVIEW_VERSION,
  READY_EVENT,
  STATE_EVENT,
  AMBIGUOUS_READY_EVENT,
  AMBIGUOUS_STATE_EVENT
};
