const ADMIN_ID = '__admin_system__';
const SYSTEM_CODE_PREFIX = '__SYS__';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function clean(value, maxLength = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

export async function recordAdminSystemNotification(env, event = {}) {
  if (!env?.DB) return null;

  const eventType = clean(event.event_type, 80) || 'system_activity';
  const title = clean(event.title, 160) || 'Atividade no sistema';
  const message = clean(event.message, 800) || title;
  const severity = ['info', 'success', 'warning', 'error'].includes(event.severity)
    ? event.severity
    : 'info';
  const marker = `${SYSTEM_CODE_PREFIX}${Date.now()}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const envelope = JSON.stringify({
    source: clean(event.source, 80) || 'system',
    severity,
    actor_name: clean(event.actor_name, 100),
    entity_type: clean(event.entity_type, 80),
    request_method: clean(event.request_method, 12),
    http_status: Number.isInteger(Number(event.http_status)) ? Number(event.http_status) : null
  }).slice(0, 1000);

  const result = await env.DB.prepare(`
    INSERT INTO notifications (
      type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
    ) VALUES (?,?,NULL,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(
    eventType,
    marker,
    clean(event.entity_id, 120),
    title,
    message,
    envelope,
    clean(event.request_path, 300)
  ).run();

  return Number(result?.meta?.last_row_id || 0) || null;
}

export async function listAdminSystemNotifications(env, limit = 80) {
  if (!env?.DB) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 80));
  const { results } = await env.DB.prepare(`
    SELECT
      n.id,n.type,n.sku,n.product_name,n.variacao,n.platform,n.image_key,n.created_at,
      r.read_at IS NOT NULL AS is_read,r.read_at
    FROM notifications n
    LEFT JOIN notification_reads r
      ON r.notification_id=n.id AND r.user_id=?
    WHERE n.type<>'new_cover' AND n.capa_code LIKE ?
    ORDER BY n.id DESC
    LIMIT ?
  `).bind(ADMIN_ID, `${SYSTEM_CODE_PREFIX}%`, safeLimit).all();

  return (results || []).map(row => {
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
  if (!env?.DB) return 0;
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM notifications n
    LEFT JOIN notification_reads r
      ON r.notification_id=n.id AND r.user_id=?
    WHERE n.type<>'new_cover' AND n.capa_code LIKE ? AND r.id IS NULL
  `).bind(ADMIN_ID, `${SYSTEM_CODE_PREFIX}%`).first();
  return Number(row?.total || 0);
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
  `).bind(ADMIN_ID, id, `${SYSTEM_CODE_PREFIX}%`).run();
  if (Number(result?.meta?.changes || 0) > 0) return true;
  const existing = await env.DB.prepare(`
    SELECT id FROM notification_reads
    WHERE notification_id=? AND user_id=?
  `).bind(id, ADMIN_ID).first();
  return Boolean(existing);
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
  `).bind(ADMIN_ID, `${SYSTEM_CODE_PREFIX}%`, ADMIN_ID).run();
  return Number(result?.meta?.changes || 0);
}

function operatorNameFromRequest(request) {
  const raw = request?.headers?.get('x-operator-name');
  if (!raw) return null;
  try { return clean(decodeURIComponent(raw), 100); }
  catch { return clean(raw, 100); }
}

function ignoredActivityPath(pathname) {
  return pathname.startsWith('/api/admin/system-notifications')
    || pathname.startsWith('/api/notifications/')
    || pathname === '/api/notifications/mark-all-read'
    || pathname === '/api/push/subscribe'
    || pathname === '/api/push/unsubscribe'
    || pathname === '/api/mural/read'
    || pathname === '/api/mural/mark-all-read';
}

function productIdFromPath(pathname) {
  return pathname.match(/^\/api\/(?:products|admin\/product-image-treatment)\/(\d+)/)?.[1] || null;
}

function responseError(data, status) {
  return clean(data?.error || data?.message, 500) || `A operação respondeu com o status ${status}.`;
}

export function describeAdminSystemActivity({ pathname, method, status, data, actorName }) {
  const ok = status >= 200 && status < 400;
  const productId = productIdFromPath(pathname);
  const base = {
    severity: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'success',
    actor_name: actorName,
    request_path: pathname,
    request_method: method,
    http_status: status,
    entity_type: productId ? 'product' : null,
    entity_id: productId,
    metadata: data && typeof data === 'object' ? {
      product_id: data.product_id || data.id || productId || null,
      sku: data.sku || data.product?.sku || null,
      gtin: data.gtin || null,
      status: data.status || null,
      technical_error: data.technical_error || null
    } : null
  };

  if (pathname === '/admin-login') {
    return {
      ...base,
      event_type: ok ? 'admin_login' : 'admin_login_failed',
      source: 'security',
      title: ok ? 'Acesso ao painel administrativo' : 'Tentativa de acesso recusada',
      message: ok ? 'Uma sessão administrativa foi iniciada.' : 'Uma tentativa de login no painel não foi autorizada.'
    };
  }
  if (pathname === '/admin-logout') {
    return { ...base, event_type: 'admin_logout', source: 'security', title: 'Saída do painel administrativo', message: 'A sessão administrativa foi encerrada.' };
  }

  const gtinLookup = pathname.match(/^\/api\/gtin\/([^/]+)$/);
  if (gtinLookup) {
    const gtin = decodeURIComponent(gtinLookup[1]);
    return {
      ...base,
      event_type: ok ? 'gtin_identified' : status === 404 ? 'gtin_not_found' : 'gtin_error',
      source: 'scanner',
      entity_type: 'gtin',
      entity_id: gtin,
      title: ok ? 'Item identificado no scanner' : status === 404 ? 'Código não cadastrado no scanner' : 'Erro no scanner',
      message: ok
        ? `${actorName || 'Operador'} identificou ${data?.product?.sku || data?.product?.nome || gtin}.`
        : `${actorName || 'Operador'} consultou ${gtin}. ${responseError(data, status)}`
    };
  }

  if (/^\/api\/identify(?:-candidates|-detail)?$/.test(pathname)) {
    return {
      ...base,
      event_type: ok ? 'visual_identification' : 'visual_identification_error',
      source: 'scanner',
      title: ok ? 'Identificação visual realizada' : 'Falha na identificação visual',
      message: ok
        ? `${actorName || 'Operador'} realizou uma identificação de produto.`
        : `${actorName || 'Operador'} tentou identificar um produto. ${responseError(data, status)}`
    };
  }

  if (pathname === '/api/products' && method === 'POST') {
    const created = Boolean(data?.created) || status === 201;
    return {
      ...base,
      event_type: created ? 'product_created' : 'product_updated',
      source: 'catalog',
      entity_type: 'product',
      entity_id: data?.id || null,
      title: created ? 'Novo produto cadastrado' : 'Produto atualizado',
      message: ok
        ? `${data?.sku || 'Produto'} foi ${created ? 'cadastrado' : 'atualizado'} no catálogo.`
        : `Não foi possível salvar o produto. ${responseError(data, status)}`
    };
  }

  if (pathname === '/api/admin/bulk-products') {
    return {
      ...base,
      event_type: ok && !data?.errors?.length ? 'product_import_completed' : 'product_import_warning',
      source: 'catalog',
      title: ok && !data?.errors?.length ? 'Importação de produtos concluída' : 'Importação de produtos com pendências',
      message: ok
        ? `${Number(data?.created || 0)} cadastrado(s), ${Number(data?.updated || 0)} atualizado(s) e ${Number(data?.errors?.length || 0)} erro(s).`
        : responseError(data, status)
    };
  }

  const productMutation = pathname.match(/^\/api\/products\/(\d+)$/);
  if (productMutation) {
    const deleted = method === 'DELETE';
    return {
      ...base,
      event_type: deleted ? 'product_deleted' : 'product_updated',
      source: 'catalog',
      title: deleted ? 'Produto excluído' : 'Produto atualizado',
      message: ok
        ? `O produto #${productMutation[1]} foi ${deleted ? 'excluído do catálogo' : 'atualizado'}.`
        : responseError(data, status)
    };
  }

  const imageUpload = pathname.match(/^\/api\/products\/(\d+)\/image$/);
  if (imageUpload) {
    return {
      ...base,
      event_type: ok ? 'product_image_updated' : 'product_image_error',
      source: 'images',
      title: ok ? 'Imagem original atualizada' : 'Falha ao salvar imagem original',
      message: ok ? `A imagem original do produto #${imageUpload[1]} foi atualizada.` : responseError(data, status)
    };
  }

  const treatment = pathname.match(/^\/api\/admin\/product-image-treatment\/(\d+)(?:\/(approve|redo|failed))?$/);
  if (treatment) {
    const action = treatment[2] || 'processed';
    const labels = {
      processed: ['image_treatment_ready', 'Imagem tratada pronta para revisão', `O tratamento do produto #${treatment[1]} foi recalculado.`],
      approve: ['image_treatment_approved', 'Imagem tratada aprovada', `A imagem tratada do produto #${treatment[1]} foi aprovada e liberada no sistema.`],
      redo: ['image_treatment_redo', 'Novo tratamento solicitado', `O produto #${treatment[1]} voltou para a fila de tratamento preciso.`],
      failed: ['image_treatment_failed', 'Falha no tratamento de imagem', `O tratamento automático do produto #${treatment[1]} falhou.`]
    };
    const [eventType, title, message] = labels[action];
    return {
      ...base,
      severity: !ok || action === 'failed' ? 'warning' : 'success',
      event_type: ok ? eventType : `${eventType}_error`,
      source: 'images',
      title: ok ? title : `Erro: ${title}`,
      message: ok ? message : responseError(data, status)
    };
  }

  const gtinMutation = pathname.match(/^\/api\/products\/(\d+)\/gtins(?:\/([^/]+))?$/);
  if (gtinMutation) {
    const removed = method === 'DELETE';
    const gtin = data?.gtin?.gtin || data?.gtin || (gtinMutation[2] ? decodeURIComponent(gtinMutation[2]) : null);
    return {
      ...base,
      event_type: removed ? 'gtin_removed' : 'gtin_linked',
      source: 'catalog',
      title: removed ? 'EAN removido do produto' : 'EAN vinculado ao produto',
      message: ok
        ? `${gtin || 'EAN'} foi ${removed ? 'removido do' : 'vinculado ao'} produto #${gtinMutation[1]}.`
        : responseError(data, status)
    };
  }

  if (pathname.startsWith('/api/mural')) {
    return {
      ...base,
      event_type: ok ? 'mural_updated' : 'mural_update_error',
      source: 'mural',
      title: ok ? 'Mural NISTI atualizado' : 'Falha ao atualizar o Mural NISTI',
      message: ok ? 'Uma configuração ou conteúdo do Mural NISTI foi alterado.' : responseError(data, status)
    };
  }

  if (pathname.includes('/commerce')) {
    return {
      ...base,
      event_type: ok ? 'commerce_updated' : 'commerce_update_error',
      source: 'commerce',
      title: ok ? 'Catálogo comercial atualizado' : 'Falha no catálogo comercial',
      message: ok ? 'Uma alteração ou sincronização do catálogo comercial foi concluída.' : responseError(data, status)
    };
  }

  if (pathname === '/api/operator/update-name') {
    return {
      ...base,
      event_type: ok ? 'operator_profile_updated' : 'operator_profile_error',
      source: 'operators',
      title: ok ? 'Operador identificado' : 'Falha ao atualizar operador',
      message: ok ? `${actorName || 'Um operador'} atualizou sua identificação no aplicativo.` : responseError(data, status)
    };
  }

  return {
    ...base,
    event_type: ok ? 'system_activity' : 'system_error',
    source: pathname.startsWith('/api/admin/') ? 'admin' : 'system',
    title: ok ? 'Atividade concluída no sistema' : 'Operação com erro no sistema',
    message: ok ? `${method} ${pathname} foi concluído.` : responseError(data, status)
  };
}

export async function recordAdminActivityFromResponse(request, response, env) {
  if (!env?.DB || !request || !response) return null;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = String(request.method || 'GET').toUpperCase();
  const isAdminSessionEvent = pathname === '/admin-login' || pathname === '/admin-logout';
  const isScannerLookup = /^\/api\/gtin\/[^/]+$/.test(pathname);
  const isSignificantMutation = MUTATING_METHODS.has(method) && pathname.startsWith('/api/');

  if ((!isAdminSessionEvent && !isScannerLookup && !isSignificantMutation) || ignoredActivityPath(pathname)) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.clone().json().catch(() => null)
    : null;
  const event = describeAdminSystemActivity({
    pathname,
    method,
    status: Number(response.status || 0),
    data,
    actorName: operatorNameFromRequest(request)
  });
  return recordAdminSystemNotification(env, event);
}
