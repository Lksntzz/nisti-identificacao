import {
  mirrorSupabaseRpc,
  supabaseMirrorWritesRequested
} from './supabase-write-store.js';

function positiveIds(values) {
  return [...new Set((values || [])
    .map(value => Number(value || 0))
    .filter(value => Number.isInteger(value) && value > 0))];
}

function cleanText(value, limit = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, limit) : '';
}

export async function mirrorVisualReferencesBatchFromD1(env, referenceIds) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const ids = positiveIds(referenceIds);
  if (!ids.length) return { attempted: false, ok: true };

  const placeholders = ids.map(() => '?').join(',');
  const [{ results: references }, { results: embeddings }] = await Promise.all([
    env.DB.prepare(`
      SELECT id,capa_code,image_key,source_product_id,reference_kind,active,created_at,updated_at
      FROM cover_visual_references
      WHERE id IN (${placeholders})
      ORDER BY id ASC
    `).bind(...ids).all(),
    env.DB.prepare(`
      SELECT reference_id,embedding_model,dimensions,embedding_json,updated_at
      FROM cover_reference_embeddings
      WHERE reference_id IN (${placeholders})
      ORDER BY reference_id ASC
    `).bind(...ids).all()
  ]);

  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_visual_references_batch',
    { p_references: references || [], p_embeddings: embeddings || [] },
    `visual reference batch (${ids.length})`
  );
}

export async function mirrorNotificationByCapaFromD1(env, capaCode) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const code = cleanText(capaCode, 80).toUpperCase();
  if (!code) return { attempted: false, ok: true };

  const row = await env.DB.prepare(`
    SELECT id,type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
    FROM notifications
    WHERE UPPER(TRIM(capa_code))=?
    LIMIT 1
  `).bind(code).first();

  if (!row) return { attempted: false, ok: true };
  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_notifications_batch',
    { p_rows: [row] },
    `notification ${code}`
  );
}

export async function mirrorNotificationsForProductOrCoverFromD1(env, productId, capaCode = null) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(productId || 0) || 0;
  const code = cleanText(capaCode, 80).toUpperCase();
  if (!id && !code) return { attempted: false, ok: true };

  let query;
  let binds;
  if (id && code) {
    query = `
      SELECT id,type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
      FROM notifications
      WHERE product_id=? OR UPPER(TRIM(capa_code))=?
      ORDER BY id ASC
    `;
    binds = [id, code];
  } else if (id) {
    query = `
      SELECT id,type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
      FROM notifications
      WHERE product_id=?
      ORDER BY id ASC
    `;
    binds = [id];
  } else {
    query = `
      SELECT id,type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
      FROM notifications
      WHERE UPPER(TRIM(capa_code))=?
      ORDER BY id ASC
    `;
    binds = [code];
  }

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  if (!(results || []).length) return { attempted: false, ok: true };

  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_notifications_batch',
    { p_rows: results || [] },
    `notifications for ${id || code}`
  );
}

export async function mirrorNotificationReadFromD1(env, notificationId, userId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(notificationId || 0);
  const user = cleanText(userId || 'anonymous', 100);
  if (!id || !user) return { attempted: false, ok: true };

  const row = await env.DB.prepare(`
    SELECT id,notification_id,user_id,read_at
    FROM notification_reads
    WHERE notification_id=? AND user_id=?
    LIMIT 1
  `).bind(id, user).first();

  if (!row) return { attempted: false, ok: true };
  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_notification_reads_batch',
    { p_rows: [row] },
    `notification read ${id}/${user}`
  );
}

export async function mirrorNotificationReadsForUserFromD1(env, userId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const user = cleanText(userId || 'anonymous', 100);
  if (!user) return { attempted: false, ok: true };

  const { results } = await env.DB.prepare(`
    SELECT id,notification_id,user_id,read_at
    FROM notification_reads
    WHERE user_id=?
    ORDER BY id ASC
  `).bind(user).all();

  if (!(results || []).length) return { attempted: false, ok: true };
  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_notification_reads_batch',
    { p_rows: results || [] },
    `notification reads for ${user}`
  );
}

export async function mirrorPushSubscriptionByEndpointFromD1(env, endpoint) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const cleanEndpoint = cleanText(endpoint, 4096);
  if (!cleanEndpoint) return { attempted: false, ok: true };

  const row = await env.DB.prepare(`
    SELECT id,user_id,endpoint,p256dh,auth,created_at,updated_at
    FROM push_subscriptions
    WHERE endpoint=?
    LIMIT 1
  `).bind(cleanEndpoint).first();

  if (!row) {
    return mirrorDeletedPushSubscriptionToSupabase(env, cleanEndpoint);
  }

  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_push_subscription',
    { p_row: row },
    'push subscription'
  );
}

export async function mirrorDeletedPushSubscriptionToSupabase(env, endpoint) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const cleanEndpoint = cleanText(endpoint, 4096);
  if (!cleanEndpoint) return { attempted: false, ok: true };

  return mirrorSupabaseRpc(
    env,
    'nisti_delete_push_subscription',
    { p_endpoint: cleanEndpoint },
    'delete push subscription'
  );
}
