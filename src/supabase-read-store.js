const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15000;

export class SupabaseReadError extends Error {
  constructor(message, { status = 0, code = 'supabase_read_error', fallbackEligible = false } = {}) {
    super(message);
    this.name = 'SupabaseReadError';
    this.status = Number(status || 0);
    this.code = code;
    this.fallbackEligible = Boolean(fallbackEligible);
  }
}

function timeoutMs(env) {
  const raw = Number(env?.SUPABASE_READ_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(raw)));
}

function config(env) {
  const url = String(env?.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url || !/^https:\/\//i.test(url)) {
    throw new SupabaseReadError('SUPABASE_URL ausente ou inválida.', {
      status: 500,
      code: 'supabase_url_missing'
    });
  }

  if (!serviceRoleKey) {
    throw new SupabaseReadError('SUPABASE_SERVICE_ROLE_KEY não configurada.', {
      status: 500,
      code: 'supabase_service_role_missing'
    });
  }

  return { url, serviceRoleKey };
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export async function supabaseRpc(env, functionName, params = {}) {
  const { url, serviceRoleKey } = config(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('supabase-timeout'), timeoutMs(env));

  try {
    const response = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(params || {})
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new SupabaseReadError(
        `Supabase RPC ${functionName} falhou (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`,
        {
          status: response.status,
          code: `supabase_rpc_${response.status}`,
          fallbackEligible: retryableStatus(response.status)
        }
      );
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof SupabaseReadError) throw error;

    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new SupabaseReadError(`Supabase RPC ${functionName} excedeu o timeout.`, {
        status: 408,
        code: 'supabase_read_timeout',
        fallbackEligible: true
      });
    }

    throw new SupabaseReadError(`Falha de transporte ao consultar Supabase RPC ${functionName}.`, {
      status: 0,
      code: 'supabase_transport_error',
      fallbackEligible: true
    });
  } finally {
    clearTimeout(timer);
  }
}
