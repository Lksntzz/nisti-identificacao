import { broadcastNewCoverPush } from './web-push.js';
import {
  mirrorNotificationByCapaFromD1,
  mirrorNotificationReadFromD1,
  mirrorNotificationReadsForUserFromD1,
  mirrorNotificationsForProductOrCoverFromD1
} from './supabase-secondary-write-store.js';
import {
  preferSupabaseRead,
  supabaseReserveNotifications,
  supabaseReserveUnreadNotifications
} from './supabase-read-store.js';
import { SupabasePrimaryWriteError } from './supabase-write-store.js';

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function logMirrorFailure(label, error) {
  console.error(`[Supabase mirror] ${label} falhou`, error?.message || error);
  if (error instanceof SupabasePrimaryWriteError) throw error;
}

export async function recordNewCoverNotification(env, {
  capaCode,
  productId = null,
  sku = null,
  productName = null,
  variacao = null,
  platform = null,
  imageKey = null
}) {
  const code = clean(capaCode)?.toUpperCase();
  if (!code || !env?.DB) return null;

  const targetProductId = Number(productId) || 0;

  // Verifica se já existia algum outro produto cadastrado com essa mesma capa antes
  const existingCount = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM products
    WHERE UPPER(TRIM(capa_code))=? AND id <> ?
  `).bind(code, targetProductId).first();

  if (Number(existingCount?.total || 0) > 0) {
    // A capa já existia no catálogo antes deste produto, portanto não gera notificação de nova capa
    return null;
  }

  // Se não temos a image_key, tenta buscar se já existe alguma referência visual para essa capa
  let resolvedImageKey = clean(imageKey);
  if (!resolvedImageKey) {
    const ref = await env.DB.prepare(`
      SELECT image_key FROM cover_visual_references
      WHERE UPPER(TRIM(capa_code))=? AND active=1 AND image_key IS NOT NULL
      ORDER BY id ASC LIMIT 1
    `).bind(code).first();
    if (ref?.image_key) resolvedImageKey = ref.image_key;
  }

  const existingNotification = await env.DB.prepare(`
    SELECT id FROM notifications WHERE UPPER(TRIM(capa_code)) = ?
  `).bind(code).first();

  let created = false;
  if (!existingNotification) {
    await env.DB.prepare(`
      INSERT INTO notifications (
        type, capa_code, product_id, sku, product_name, variacao, platform, image_key, created_at
      ) VALUES ('new_cover', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      code,
      targetProductId > 0 ? targetProductId : null,
      clean(sku),
      clean(productName),
      clean(variacao),
      clean(platform)?.toUpperCase(),
      resolvedImageKey
    ).run();
    created = true;

    await mirrorNotificationByCapaFromD1(env, code)
      .catch(error => logMirrorFailure(`notification ${code}`, error));
  }

  if (created) {
    const imageUrl = targetProductId > 0 && resolvedImageKey
      ? `/api/images/${targetProductId}`
      : null;

    await broadcastNewCoverPush(env, {
      capaCode: code,
      productName: clean(productName),
      variacao: clean(variacao),
      platform: clean(platform)?.toUpperCase(),
      imageUrl
    }).catch(err => {
      console.error('[Error] Falha no broadcastNewCoverPush:', err);
    });
  }

  return {
    capa_code: code,
    created
  };
}

export async function updateNotificationImage(env, productId, capaCode, imageKey) {
  if (!env?.DB || !imageKey) return;
  const targetId = Number(productId) || 0;
  const code = clean(capaCode)?.toUpperCase();

  if (targetId > 0 && code) {
    await env.DB.prepare(`
      UPDATE notifications
      SET image_key=?
      WHERE (product_id=? OR UPPER(TRIM(capa_code))=?) AND (image_key IS NULL OR image_key='')
    `).bind(imageKey, targetId, code).run().catch(() => {});
  } else if (targetId > 0) {
    await env.DB.prepare(`
      UPDATE notifications
      SET image_key=?
      WHERE product_id=? AND (image_key IS NULL OR image_key='')
    `).bind(imageKey, targetId).run().catch(() => {});
  } else if (code) {
    await env.DB.prepare(`
      UPDATE notifications
      SET image_key=?
      WHERE UPPER(TRIM(capa_code))=? AND (image_key IS NULL OR image_key='')
    `).bind(imageKey, code).run().catch(() => {});
  }

  await mirrorNotificationsForProductOrCoverFromD1(env, targetId, code)
    .catch(error => logMirrorFailure(`notification image ${targetId || code}`, error));
}

export async function listUserNotifications(env, userId, limit = 50) {
  if (!env) return [];
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));

  const rows = await preferSupabaseRead(
    env,
    () => supabaseReserveNotifications(env, safeUserId, safeLimit),
    async () => {
      if (!env.DB) return [];
      const { results } = await env.DB.prepare(`
        SELECT
          n.id,
          n.type,
          n.capa_code,
          n.product_id,
          n.sku,
          n.product_name,
          n.variacao,
          n.platform,
          n.image_key,
          n.created_at,
          r.read_at IS NOT NULL AS is_read,
          r.read_at
        FROM notifications n
        LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE n.type='new_cover'
        ORDER BY n.id DESC
        LIMIT ?
      `).bind(safeUserId, safeLimit).all();
      return results || [];
    },
    'notifications:list'
  );

  return (rows || []).filter(row => (row.type || 'new_cover') === 'new_cover').map(row => {
    const version = row.image_key ? String(row.image_key).split('/').pop() : '';
    const imageUrl = row.product_id && row.image_key
      ? `/api/images/${row.product_id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
      : null;

    return {
      id: Number(row.id),
      type: row.type || 'new_cover',
      capa_code: row.capa_code,
      product_id: row.product_id ? Number(row.product_id) : null,
      sku: row.sku || null,
      product_name: row.product_name || null,
      variacao: row.variacao || null,
      platform: row.platform || null,
      image_url: imageUrl,
      is_read: row.is_read === true || Number(row.is_read) === 1,
      read_at: row.read_at || null,
      created_at: row.created_at
    };
  });
}

export async function getUnreadNotificationsCount(env, userId) {
  if (!env) return 0;
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);

  return preferSupabaseRead(
    env,
    async () => {
      const rows = await supabaseReserveNotifications(env, safeUserId, 100);
      return (rows || []).filter(row =>
        (row.type || 'new_cover') === 'new_cover'
        && !(row.is_read === true || Number(row.is_read) === 1)
      ).length;
    },
    async () => {
      if (!env.DB) return 0;
      const row = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM notifications n
        LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE n.type='new_cover' AND r.id IS NULL
      `).bind(safeUserId).first();
      return Number(row?.total || 0);
    },
    'notifications:unread'
  );
}

export async function markNotificationRead(env, notificationId, userId) {
  if (!env?.DB) return false;
  const id = Number(notificationId);
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  if (!id || id <= 0) return false;

  const result = await env.DB.prepare(`
    INSERT INTO notification_reads (notification_id, user_id, read_at)
    SELECT id, ?, CURRENT_TIMESTAMP
    FROM notifications
    WHERE id=? AND type='new_cover'
    ON CONFLICT(notification_id, user_id) DO NOTHING
  `).bind(safeUserId, id).run();

  if (!Number(result?.meta?.changes || 0)) {
    const existing = await env.DB.prepare(`
      SELECT r.id
      FROM notification_reads r
      INNER JOIN notifications n ON n.id=r.notification_id
      WHERE r.notification_id=? AND r.user_id=? AND n.type='new_cover'
    `).bind(id, safeUserId).first();
    if (!existing) return false;
  }

  await mirrorNotificationReadFromD1(env, id, safeUserId)
    .catch(error => logMirrorFailure(`notification read ${id}`, error));

  return true;
}

export async function markAllNotificationsRead(env, userId) {
  if (!env?.DB) return 0;
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);

  const result = await env.DB.prepare(`
    INSERT INTO notification_reads (notification_id, user_id, read_at)
    SELECT n.id, ?, CURRENT_TIMESTAMP
    FROM notifications n
    WHERE n.type='new_cover' AND n.id NOT IN (
      SELECT notification_id FROM notification_reads WHERE user_id = ?
    )
  `).bind(safeUserId, safeUserId).run();

  await mirrorNotificationReadsForUserFromD1(env, safeUserId)
    .catch(error => logMirrorFailure(`notification reads for ${safeUserId}`, error));

  return Number(result?.meta?.changes || 0);
}

const ADMIN_SYSTEM_USER_ID = '__admin_system__';
const ADMIN_SYSTEM_CODE_PREFIX = '__SYS__';

function cleanAdminValue(value, maxLength = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

export async function recordAdminSystemNotification(env, event = {}) {
  if (!env?.DB) return null;
  const eventType = cleanAdminValue(event.event_type, 80) || 'system_activity';
  const title = cleanAdminValue(event.title, 160) || 'Atividade no sistema';
  const message = cleanAdminValue(event.message, 800) || title;
  const severity = ['info', 'success', 'warning', 'error'].includes(event.severity)
    ? event.severity
    : 'info';
  const marker = `${ADMIN_SYSTEM_CODE_PREFIX}${Date.now()}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const envelope = JSON.stringify({
    source: cleanAdminValue(event.source, 80) || 'system',
    severity,
    actor_name: cleanAdminValue(event.actor_name, 100),
    entity_type: cleanAdminValue(event.entity_type, 80),
    request_method: cleanAdminValue(event.request_method, 12),
    http_status: Number.isInteger(Number(event.http_status)) ? Number(event.http_status) : null
  }).slice(0, 1000);

  const result = await env.DB.prepare(`
    INSERT INTO notifications (
      type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
    ) VALUES (?,?,NULL,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(
    eventType,
    marker,
    cleanAdminValue(event.entity_id, 120),
    title,
    message,
    envelope,
    cleanAdminValue(event.request_path, 300)
  ).run();

  const id = Number(result?.meta?.last_row_id || 0) || null;
  await mirrorNotificationByCapaFromD1(env, marker)
    .catch(error => logMirrorFailure(`admin system notification ${marker}`, error));
  return id;
}

export async function listAdminSystemNotifications(env, limit = 80) {
  if (!env) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 80));
  const rows = await preferSupabaseRead(
    env,
    () => supabaseReserveNotifications(env, ADMIN_SYSTEM_USER_ID, safeLimit),
    async () => {
      if (!env.DB) return [];
      const { results } = await env.DB.prepare(`
        SELECT
          n.id,n.type,n.capa_code,n.sku,n.product_name,n.variacao,n.platform,n.image_key,n.created_at,
          r.read_at IS NOT NULL AS is_read,r.read_at
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id=n.id AND r.user_id=?
        WHERE n.type<>'new_cover' AND n.capa_code LIKE ?
        ORDER BY n.id DESC
        LIMIT ?
      `).bind(ADMIN_SYSTEM_USER_ID, `${ADMIN_SYSTEM_CODE_PREFIX}%`, safeLimit).all();
      return results || [];
    },
    'admin-notifications:list'
  );

  return (rows || []).filter(row =>
    row.type !== 'new_cover'
    && String(row.capa_code || '').startsWith(ADMIN_SYSTEM_CODE_PREFIX)
  ).map(row => {
    let envelope = {};
    try { envelope = row.platform ? JSON.parse(row.platform) : {}; }
    catch { envelope = {}; }
    return {
      id: Number(row.id),
      event_type: row.type || 'system_activity',
      title: row.product_name || 'Atividade no sistema',
      message: row.variacao || row.product_name || 'Atividade no sistema',
      severity: envelope.severity || 'info',
      source: envelope.source || 'system',
      actor_name: envelope.actor_name || null,
      entity_type: envelope.entity_type || null,
      entity_id: row.sku || null,
      request_path: row.image_key || null,
      request_method: envelope.request_method || null,
      http_status: envelope.http_status == null ? null : Number(envelope.http_status),
      metadata: null,
      is_read: row.is_read === true || Number(row.is_read) === 1,
      read_at: row.read_at || null,
      created_at: row.created_at
    };
  });
}

export async function getAdminSystemUnreadCount(env) {
  if (!env) return 0;
  return preferSupabaseRead(
    env,
    async () => {
      const rows = await supabaseReserveNotifications(env, ADMIN_SYSTEM_USER_ID, 100);
      return (rows || []).filter(row =>
        row.type !== 'new_cover'
        && String(row.capa_code || '').startsWith(ADMIN_SYSTEM_CODE_PREFIX)
        && !(row.is_read === true || Number(row.is_read) === 1)
      ).length;
    },
    async () => {
      if (!env.DB) return 0;
      const row = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id=n.id AND r.user_id=?
        WHERE n.type<>'new_cover' AND n.capa_code LIKE ? AND r.id IS NULL
      `).bind(ADMIN_SYSTEM_USER_ID, `${ADMIN_SYSTEM_CODE_PREFIX}%`).first();
      return Number(row?.total || 0);
    },
    'admin-notifications:unread'
  );
}

export async function markAdminSystemNotificationRead(env, notificationId) {
  if (!env?.DB) return false;
  const id = Number(notificationId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const result = await env.DB.prepare(`
    INSERT INTO notification_reads (notification_id,user_id,read_at)
    SELECT id,?,CURRENT_TIMESTAMP
    FROM notifications
    WHERE id=? AND type<>'new_cover' AND capa_code LIKE ?
    ON CONFLICT(notification_id,user_id) DO NOTHING
  `).bind(ADMIN_SYSTEM_USER_ID, id, `${ADMIN_SYSTEM_CODE_PREFIX}%`).run();
  if (Number(result?.meta?.changes || 0) > 0) {
    await mirrorNotificationReadFromD1(env, id, ADMIN_SYSTEM_USER_ID)
      .catch(error => logMirrorFailure(`admin system notification read ${id}`, error));
    return true;
  }
  const existing = await env.DB.prepare(`
    SELECT id FROM notification_reads
    WHERE notification_id=? AND user_id=?
  `).bind(id, ADMIN_SYSTEM_USER_ID).first();
  if (existing) return true;
  return false;
}

export async function markAllAdminSystemNotificationsRead(env) {
  if (!env?.DB) return 0;
  const result = await env.DB.prepare(`
    INSERT INTO notification_reads (notification_id,user_id,read_at)
    SELECT n.id,?,CURRENT_TIMESTAMP
    FROM notifications n
    WHERE n.type<>'new_cover' AND n.capa_code LIKE ?
      AND NOT EXISTS (
        SELECT 1 FROM notification_reads r
        WHERE r.notification_id=n.id AND r.user_id=?
      )
  `).bind(ADMIN_SYSTEM_USER_ID, `${ADMIN_SYSTEM_CODE_PREFIX}%`, ADMIN_SYSTEM_USER_ID).run();
  const changed = Number(result?.meta?.changes || 0);
  if (changed > 0) {
    await mirrorNotificationReadsForUserFromD1(env, ADMIN_SYSTEM_USER_ID)
      .catch(error => logMirrorFailure('admin system notification reads', error));
  }
  return changed;
}
