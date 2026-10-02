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

export async function preferSupabaseRead(env, supabaseLoader, d1Loader, _label = 'read') {
  if (supabaseReadsRequested(env)) {
    return supabaseLoader();
  }
  return d1Loader();
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

export async function supabaseProductImageContext(env, productId) {
  return await supabaseRpc(env, 'nisti_product_image_context_v1', {
    p_product_id:Number(productId || 0)
  });
}

export async function supabaseCoverReferences(env, capaCode) {
  return rows(await supabaseRpc(env,'nisti_list_cover_references_v1',{
    p_capa_code:String(capaCode || '').trim().toUpperCase()
  }));
}



export async function supabaseProductTreatmentSummary(env, processorVersion = '8') {
  const value = await supabaseRpc(env, 'nisti_product_treatment_summary_v1', {
    p_processor_version:String(processorVersion || '9').trim() || '9'
  });
  return value && typeof value === 'object'
    ? value
    : { with_image:0, approved:0, review:0, pending:0, failed:0 };
}

export async function supabaseProductTreatmentQueue(
  env,
  status = 'work',
  processorVersion = '8',
  limit = 20,
  offset = 0
) {
  const value = await supabaseRpc(env, 'nisti_product_treatment_queue_v1', {
    p_status:String(status || 'work').trim().toLowerCase() || 'work',
    p_processor_version:String(processorVersion || '9').trim() || '9',
    p_limit:Number(limit || 20),
    p_offset:Number(offset || 0)
  });
  return value && typeof value === 'object'
    ? value
    : { status:'work', total:0, limit:Number(limit || 20), offset:Number(offset || 0), items:[] };
}

export async function supabaseReserveProducts(env) {
  return rows(await supabaseRpc(env, 'nisti_reserve_products_v1'));
}


export async function supabaseReserveGtinLookup(env, gtin) {
  const result = rows(await supabaseRpc(env, 'nisti_reserve_gtin_lookup_v1', {
    p_gtin:String(gtin || '').trim()
  }));
  return result[0] || null;
}

export async function supabaseReserveProductGtins(env, productId) {
  return rows(await supabaseRpc(env, 'nisti_reserve_product_gtins_v1', {
    p_product_id:Number(productId || 0)
  }));
}

export async function supabaseReserveOccurrences(env) {
  const value = await supabaseRpc(env, 'nisti_reserve_occurrences_v1');
  return value && typeof value === 'object'
    ? value
    : { stats:{ pending:0, trained:0, dismissed:0 }, occurrences:[] };
}

export async function supabaseReserveNotifications(env, userId, limit = 50) {
  return rows(await supabaseRpc(env, 'nisti_reserve_notifications_v1', {
    p_user_id:String(userId || 'anonymous').trim().slice(0,100),
    p_limit:Math.max(1,Math.min(100,Number(limit) || 50))
  }));
}

export async function supabaseReserveUnreadNotifications(env, userId) {
  const value = await supabaseRpc(env, 'nisti_reserve_unread_notifications_v1', {
    p_user_id:String(userId || 'anonymous').trim().slice(0,100)
  });
  return Number(value || 0);
}


export async function supabaseReserveGtinEvents(env, {
  status = '',
  pending = false,
  today = false,
  query = '',
  limit = 25,
  offset = 0
} = {}) {
  return rows(await supabaseRpc(env, 'nisti_reserve_gtin_events_v1', {
    p_status:String(status || '').trim() || null,
    p_pending:Boolean(pending),
    p_today:Boolean(today),
    p_query:String(query || '').trim() || null,
    p_limit:Math.max(1,Math.min(100,Number(limit) || 25)),
    p_offset:Math.max(0,Number(offset) || 0)
  }));
}

export async function supabaseReserveGtinDashboard(env) {
  const value = await supabaseRpc(env, 'nisti_reserve_gtin_dashboard_v1');
  return value && typeof value === 'object' ? value : {};
}

export async function supabaseReserveMuralFeed(env, {
  userId = 'anonymous',
  kind = null,
  limit = 20,
  cursor = null
} = {}) {
  const value = await supabaseRpc(env, 'nisti_reserve_mural_feed_v1', {
    p_user_id:String(userId || 'anonymous').trim().slice(0,100),
    p_kind:String(kind || '').trim() || null,
    p_limit:Math.max(1,Math.min(50,Number(limit) || 20)),
    p_cursor_featured:cursor ? Number(cursor.featured || 0) === 1 : null,
    p_cursor_priority:cursor ? Number(cursor.priority || 0) : null,
    p_cursor_published_at:cursor?.published_at || null,
    p_cursor_id:cursor ? Number(cursor.id || 0) || null : null
  });
  return value && typeof value === 'object'
    ? value
    : { rows:[], preview_rows:[], unread_count:0 };
}

export async function supabaseReserveMuralCollection(env, slug) {
  return supabaseRpc(env, 'nisti_reserve_mural_collection_v1', {
    p_slug:String(slug || '').trim()
  });
}


export async function supabaseReserveMuralUnread(env, userId) {
  const value = await supabaseRpc(env, 'nisti_reserve_mural_unread_v1', {
    p_user_id:String(userId || 'anonymous').trim().slice(0,100)
  });
  return Number(value || 0);
}

export async function supabaseReserveMuralPostImage(env, postId) {
  const value = await supabaseRpc(env, 'nisti_reserve_mural_post_image_v1', {
    p_id:Number(postId || 0)
  });
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function supabaseReserveMuralCollectionImage(env, slug) {
  const value = await supabaseRpc(env, 'nisti_reserve_mural_collection_image_v1', {
    p_slug:String(slug || '').trim()
  });
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
