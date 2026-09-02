const CONFIRMATION_VERSION = 'v8.19';
const MAX_CONTEXT_AGE_MS = 15 * 60 * 1000;
const READY_EVENT = 'nisti:shadow-confirmation-ready';
const STATE_EVENT = 'nisti:shadow-confirmation-state';

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

  window.__NISTI_CONFIRM_SHADOW_RESULT__ = confirmCurrent;
  window.__NISTI_SHADOW_CONFIRMATION_VERSION__ = CONFIRMATION_VERSION;

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
          confirmed: false
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
      }
      return response;
    }

    return previousFetch(input, init);
  };
}

install();

export { CONFIRMATION_VERSION, READY_EVENT, STATE_EVENT };
