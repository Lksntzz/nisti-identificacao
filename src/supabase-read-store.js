const DEFAULT_TIMEOUT_MS = 2500;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 5000;
const MAX_CUSTOM_TIMEOUT_MS = 30000;

export class SupabaseReadError extends Error {
  constructor(message, { status = 0, code = 'supabase_read_error', fallbackEligible = false } = {}) {
    super(message);
    this.name = 'SupabaseReadError';
    this.status = Number(status || 0);
    this.code = code;
    this.fallbackEligible = Boolean(fallbackEligible);
  }
}

export function supabaseReadsRequested(env) {
  return String(env?.SUPABASE_READS_ENABLED || '').trim() === '1';
}

export function supabaseEmergencyFallbackRequested(env) {
  return String(env?.SUPABASE_EMERGENCY_FALLBACK_ENABLED || '').trim() === '1';
}

export function isD1DailyReadLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const code = Number(error?.code || error?.cause?.code || 0);
  return code === 7500
    || message.includes('daily row read limit')
    || message.includes("exceeded d1's free tier")
    || (message.includes('d1') && message.includes('row read') && message.includes('limit'));
}

function timeoutMs(env, overrideMs = null) {
  const hasOverride = overrideMs !== null
    && overrideMs !== undefined
    && Number.isFinite(Number(overrideMs));
  const raw = hasOverride
    ? Number(overrideMs)
    : Number(env?.SUPABASE_READ_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  const max = hasOverride ? MAX_CUSTOM_TIMEOUT_MS : MAX_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(max, Math.round(raw)));
}

function config(env) {
  const url = String(env?.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !/^https:\/\//i.test(url)) {
    throw new SupabaseReadError('SUPABASE_URL ausente ou inválida.', {
      status: 500,
      code: 'supabase_url_missing',
      fallbackEligible: false
    });
  }
  if (!serviceRoleKey) {
    throw new SupabaseReadError('SUPABASE_SERVICE_ROLE_KEY não configurada.', {
      status: 500,
      code: 'supabase_service_role_missing',
      fallbackEligible: false
    });
  }
  return { url, serviceRoleKey };
}

function fallbackStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export async function supabaseRpc(env, functionName, params = {}, options = {}) {
  const { url, serviceRoleKey } = config(env);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort('supabase-read-timeout'),
    timeoutMs(env, options?.timeoutMs)
  );

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
          fallbackEligible: fallbackStatus(response.status)
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

export async function preferSupabaseRead(env, supabaseLoader, d1Loader, label = 'read') {
  if (supabaseReadsRequested(env)) {
    try {
      return await supabaseLoader();
    } catch (error) {
      if (error instanceof SupabaseReadError && error.fallbackEligible) {
        console.warn(`[Supabase] ${label} indisponível; usando fallback D1 temporário: ${error.code}`);
        return d1Loader();
      }
      throw error;
    }
  }

  try {
    return await d1Loader();
  } catch (error) {
    if (supabaseEmergencyFallbackRequested(env) && isD1DailyReadLimitError(error)) {
      console.warn(`[Supabase reserve] D1 sem cota de leitura em ${label}; usando banco reserva.`);
      return supabaseLoader();
    }
    throw error;
  }
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

export async function supabaseListPlatforms(env) {
  return rows(await supabaseRpc(env, 'nisti_list_platforms'));
}

export async function supabasePlatformExists(env, platform) {
  return (await supabaseRpc(env, 'nisti_platform_exists', { p_platform: platform })) === true;
}

export async function supabasePlatformsForReference(env, sourceProductId, capaCode) {
  return rows(await supabaseRpc(env, 'nisti_platforms_for_reference', {
    p_source_product_id: Number(sourceProductId || 0) || null,
    p_capa_code: String(capaCode || '').trim().toUpperCase() || null
  }));
}

export async function supabaseActiveReferences(env, ids) {
  const cleanIds = [...new Set((ids || [])
    .map(value => Number(value || 0))
    .filter(value => Number.isInteger(value) && value > 0))];
  if (!cleanIds.length) return [];
  return rows(await supabaseRpc(env, 'nisti_active_references', { p_ids: cleanIds }));
}

export async function supabaseReferenceById(env, referenceId) {
  const result = rows(await supabaseRpc(env, 'nisti_reference_by_id', {
    p_reference_id: Number(referenceId || 0)
  }));
  return result[0] || null;
}

export async function supabaseReferenceByCover(env, capaCode) {
  const result = rows(await supabaseRpc(env, 'nisti_reference_by_cover', {
    p_capa_code: String(capaCode || '').trim().toUpperCase()
  }));
  return result[0] || null;
}

export async function supabaseProductsForCover(env, capaCode, platform) {
  return rows(await supabaseRpc(env, 'nisti_products_for_cover', {
    p_capa_code: String(capaCode || '').trim().toUpperCase(),
    p_platform: String(platform || '').trim().toUpperCase()
  }));
}

export async function supabaseImageKey(env, entity, id) {
  const value = await supabaseRpc(env, 'nisti_image_key', {
    p_entity: String(entity || '').trim().toLowerCase(),
    p_id: Number(id || 0)
  });
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}


export async function supabaseReserveProducts(env) {
  return rows(await supabaseRpc(env, 'nisti_reserve_products_v1'));
}
