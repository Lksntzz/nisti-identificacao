async function notificationStore() {
  return import('./cover-notifications.js');
}

export async function recordAdminSystemNotification(env, event) {
  return (await notificationStore()).recordAdminSystemNotification(env, event);
}

export async function listAdminSystemNotifications(env, limit) {
  return (await notificationStore()).listAdminSystemNotifications(env, limit);
}

export async function getAdminSystemUnreadCount(env) {
  return (await notificationStore()).getAdminSystemUnreadCount(env);
}

export async function markAdminSystemNotificationRead(env, notificationId) {
  return (await notificationStore()).markAdminSystemNotificationRead(env, notificationId);
}

export async function markAllAdminSystemNotificationsRead(env) {
  return (await notificationStore()).markAllAdminSystemNotificationsRead(env);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function clean(value, maxLength = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
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
