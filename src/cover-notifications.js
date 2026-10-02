import { broadcastNewCoverPush } from './web-push.js';
import { supabaseReserveNotifications } from './supabase-read-store.js';
import { mirrorSupabaseRpc } from './supabase-write-store.js';

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
  if (!code) return null;

  const result = await mirrorSupabaseRpc(env, 'nisti_record_new_cover_notification_v1', {
    p_row: {
      capa_code:code,
      product_id:Number(productId) || null,
      sku:clean(sku),
      product_name:clean(productName),
      variacao:clean(variacao),
      platform:clean(platform)?.toUpperCase(),
      image_key:clean(imageKey)
    }
  }, 'notificação de nova capa');

  const saved = result.value || {};
  if (saved.created) {
    await broadcastNewCoverPush(env, {
      capaCode:code,
      productName:clean(productName),
      variacao:clean(variacao),
      platform:clean(platform)?.toUpperCase(),
      imageUrl:Number(productId) > 0 && imageKey ? `/api/images/${Number(productId)}` : null
    }).catch(err => console.error('[Error] Falha no broadcastNewCoverPush:', err));
  }

  return {
    capa_code:code,
    created:saved.created === true
  };
}

export async function updateNotificationImage(env, productId, capaCode, imageKey) {
  if (!imageKey) return;
  const targetId = Number(productId) || 0;
  const code = clean(capaCode)?.toUpperCase();

  await mirrorSupabaseRpc(env, 'nisti_update_notification_image_v1', {
    p_product_id:targetId,
    p_capa_code:code,
    p_image_key:imageKey
  }, 'imagem de notificação');
}

export async function listUserNotifications(env, userId, limit = 50) {
  if (!env) return [];
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = await supabaseReserveNotifications(env, safeUserId, safeLimit);

  return (rows || [])
    .filter(row => (row.type || 'new_cover') === 'new_cover')
    .map(row => {
      const version = row.image_key ? String(row.image_key).split('/').pop() : '';
      const imageUrl = row.product_id && row.image_key
        ? `/api/images/${row.product_id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
        : null;

      return {
        id:Number(row.id),
        type:row.type || 'new_cover',
        capa_code:row.capa_code,
        product_id:row.product_id ? Number(row.product_id) : null,
        sku:row.sku || null,
        product_name:row.product_name || null,
        variacao:row.variacao || null,
        platform:row.platform || null,
        image_url:imageUrl,
        is_read:row.is_read === true || Number(row.is_read) === 1,
        read_at:row.read_at || null,
        created_at:row.created_at
      };
    });
}

export async function getUnreadNotificationsCount(env, userId) {
  if (!env) return 0;
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  const rows = await supabaseReserveNotifications(env, safeUserId, 100);
  return (rows || []).filter(row =>
    (row.type || 'new_cover') === 'new_cover'
    && !(row.is_read === true || Number(row.is_read) === 1)
  ).length;
}

export async function markNotificationRead(env, notificationId, userId) {
  const id = Number(notificationId);
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  if (!id || id <= 0) return false;

  const result = await mirrorSupabaseRpc(env, 'nisti_mark_notification_read_v1', {
    p_notification_id:id,
    p_user_id:safeUserId,
    p_admin_only:false
  }, 'leitura de notificação');
  return result.value === true;
}

export async function markAllNotificationsRead(env, userId) {
  const safeUserId = String(userId || 'anonymous').trim().slice(0, 100);
  const result = await mirrorSupabaseRpc(env, 'nisti_mark_all_notifications_read_v1', {
    p_user_id:safeUserId,
    p_admin_only:false
  }, 'leitura de todas as notificações');
  return Number(result.value || 0);
}

const ADMIN_SYSTEM_USER_ID = '__admin_system__';
const ADMIN_SYSTEM_CODE_PREFIX = '__SYS__';

function cleanAdminValue(value, maxLength = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

export async function recordAdminSystemNotification(env, event = {}) {
  const eventType = cleanAdminValue(event.event_type, 80) || 'system_activity';
  const title = cleanAdminValue(event.title, 160) || 'Atividade no sistema';
  const message = cleanAdminValue(event.message, 800) || title;
  const severity = ['info', 'success', 'warning', 'error'].includes(event.severity)
    ? event.severity
    : 'info';
  const envelope = JSON.stringify({
    source:cleanAdminValue(event.source, 80) || 'system',
    severity,
    actor_name:cleanAdminValue(event.actor_name, 100),
    entity_type:cleanAdminValue(event.entity_type, 80),
    request_method:cleanAdminValue(event.request_method, 12),
    http_status:Number.isInteger(Number(event.http_status)) ? Number(event.http_status) : null
  }).slice(0, 1000);

  const result = await mirrorSupabaseRpc(env, 'nisti_record_admin_system_notification_v1', {
    p_row: {
      event_type:eventType,
      title,
      message,
      entity_id:cleanAdminValue(event.entity_id, 120),
      envelope,
      request_path:cleanAdminValue(event.request_path, 300)
    }
  }, 'notificação administrativa');

  return Number(result.value || 0) || null;
}

export async function listAdminSystemNotifications(env, limit = 80) {
  if (!env) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 80));
  const rows = await supabaseReserveNotifications(env, ADMIN_SYSTEM_USER_ID, safeLimit);

  return (rows || [])
    .filter(row =>
      row.type !== 'new_cover'
      && String(row.capa_code || '').startsWith(ADMIN_SYSTEM_CODE_PREFIX)
    )
    .map(row => {
      let envelope = {};
      try {
        envelope = row.platform ? JSON.parse(row.platform) : {};
      } catch {
        envelope = {};
      }
      return {
        id:Number(row.id),
        event_type:row.type || 'system_activity',
        title:row.product_name || 'Atividade no sistema',
        message:row.variacao || row.product_name || 'Atividade no sistema',
        severity:envelope.severity || 'info',
        source:envelope.source || 'system',
        actor_name:envelope.actor_name || null,
        entity_type:envelope.entity_type || null,
        entity_id:row.sku || null,
        request_path:row.image_key || null,
        request_method:envelope.request_method || null,
        http_status:envelope.http_status == null ? null : Number(envelope.http_status),
        metadata:null,
        is_read:row.is_read === true || Number(row.is_read) === 1,
        read_at:row.read_at || null,
        created_at:row.created_at
      };
    });
}

export async function getAdminSystemUnreadCount(env) {
  if (!env) return 0;
  const rows = await supabaseReserveNotifications(env, ADMIN_SYSTEM_USER_ID, 100);
  return (rows || []).filter(row =>
    row.type !== 'new_cover'
    && String(row.capa_code || '').startsWith(ADMIN_SYSTEM_CODE_PREFIX)
    && !(row.is_read === true || Number(row.is_read) === 1)
  ).length;
}

export async function markAdminSystemNotificationRead(env, notificationId) {
  const id = Number(notificationId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const result = await mirrorSupabaseRpc(env, 'nisti_mark_notification_read_v1', {
    p_notification_id:id,
    p_user_id:ADMIN_SYSTEM_USER_ID,
    p_admin_only:true
  }, 'leitura de notificação administrativa');
  return result.value === true;
}

export async function markAllAdminSystemNotificationsRead(env) {
  const result = await mirrorSupabaseRpc(env, 'nisti_mark_all_notifications_read_v1', {
    p_user_id:ADMIN_SYSTEM_USER_ID,
    p_admin_only:true
  }, 'leitura de todas as notificações administrativas');
  return Number(result.value || 0);
}
