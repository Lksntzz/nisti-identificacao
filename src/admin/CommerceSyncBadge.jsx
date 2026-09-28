import React from 'react';

export function commerceSyncMeta(sync) {
  const status = String(sync?.sync_status || sync?.status || '').trim().toUpperCase();
  const action = String(sync?.action || '').trim().toUpperCase();

  if (status === 'SYNCED') {
    return {
      state: 'synced',
      label: action === 'CREATED' ? 'Criado no Catálogo' : 'Sincronizado',
      detail: sync?.commerce_product_id ? `Produto Mestre #${sync.commerce_product_id}` : 'Catálogo atualizado'
    };
  }

  if (status === 'CONFLICT') {
    return {
      state: 'conflict',
      label: 'Conflito',
      detail: sync?.last_error || sync?.error || 'Requer revisão no Catálogo'
    };
  }

  if (status === 'ERROR') {
    return {
      state: 'error',
      label: 'Erro de sincronização',
      detail: sync?.last_error || sync?.error || 'O produto foi salvo no NISTI ID, mas o Catálogo não confirmou a atualização'
    };
  }

  if (status === 'NOT_LINKED' || status === 'PENDING') {
    return {
      state: 'pending',
      label: 'Sem sincronização',
      detail: 'Ainda não há vínculo confirmado com o Catálogo'
    };
  }

  return {
    state: 'unknown',
    label: 'Verificando',
    detail: 'Status do Catálogo indisponível no momento'
  };
}

export function CommerceSyncBadge({ sync, compact = false }) {
  const meta = commerceSyncMeta(sync);
  return (
    <span className={`commerce-sync-badge ${meta.state}${compact ? ' compact' : ''}`} title={meta.detail}>
      <span className="commerce-sync-dot" aria-hidden="true" />
      <span>{meta.label}</span>
      {!compact && meta.detail && <small>{meta.detail}</small>}
    </span>
  );
}

export default CommerceSyncBadge;
