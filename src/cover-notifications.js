import { broadcastNewCoverPush } from './web-push.js';

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
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

  const result = await env.DB.prepare(`
    INSERT INTO notifications (
      type, capa_code, product_id, sku, product_name, variacao, platform, image_key, created_at
    ) VALUES ('new_cover', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(capa_code) DO NOTHING
  `).bind(
    code,
    targetProductId > 0 ? targetProductId : null,
    clean(sku),
    clean(productName),
    clean(variacao),
    clean(platform)?.toUpperCase(),
    resolvedImageKey
  ).run();
  const created = Number(result?.meta?.changes || 0) > 0;
  if (created) {
    const imageUrl = targetProductId > 0 && resolvedImageKey
      ? `/api/images/${targetProductId}`
      : null;

    broadcastNewCoverPush(env, {
      capaCode: code,
      productName: clean(productName),
      variacao: clean(variacao),
      platform: clean(platform)?.toUpperCase(),
      imageUrl
    }).catch(() => {});
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
}

export async function listUserNotifications(env, userId, limit = 50) {
  if (!env?.DB) return [];
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));

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
    ORDER BY n.id DESC
    LIMIT ?
  `).bind(safeUserId, safeLimit).all();

  return (results || []).map(row => {
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
      is_read: Boolean(row.is_read),
      read_at: row.read_at || null,
      created_at: row.created_at
    };
  });
}

export async function getUnreadNotificationsCount(env, userId) {
  if (!env?.DB) return 0;
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
    WHERE r.id IS NULL
  `).bind(safeUserId).first();

  return Number(row?.total || 0);
}

export async function markNotificationRead(env, notificationId, userId) {
  if (!env?.DB) return false;
  const id = Number(notificationId);
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  if (!id || id <= 0) return false;

  await env.DB.prepare(`
    INSERT INTO notification_reads (notification_id, user_id, read_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(notification_id, user_id) DO NOTHING
  `).bind(id, safeUserId).run();

  return true;
}

export async function markAllNotificationsRead(env, userId) {
  if (!env?.DB) return 0;
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);

  const result = await env.DB.prepare(`
    INSERT INTO notification_reads (notification_id, user_id, read_at)
    SELECT n.id, ?, CURRENT_TIMESTAMP
    FROM notifications n
    WHERE n.id NOT IN (
      SELECT notification_id FROM notification_reads WHERE user_id = ?
    )
  `).bind(safeUserId, safeUserId).run();

  return Number(result?.meta?.changes || 0);
}
