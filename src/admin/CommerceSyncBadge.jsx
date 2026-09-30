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

  if (status === 'PENDING') {
    return {
      state: 'pending',
      label: 'Sincronização pendente',
      detail: 'Aguardando confirmação do Catálogo'
    };
  }

  if (status === 'NOT_LINKED') {
    return {
      state: 'not-linked',
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

function SyncIcon({ state }) {
  const props = {
    viewBox: '0 0 24 24',
    width: 13,
    height: 13,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (state === 'synced') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
  if (state === 'conflict') return <svg {...props}><path d="M10.3 3.7 2.4 17.4A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  if (state === 'error') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
  if (state === 'pending') return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (state === 'not-linked') return <svg {...props}><path d="M8.5 8.5 6.8 6.8a4 4 0 0 0-5.6 5.6l2.4 2.4a4 4 0 0 0 5.6 0l1.3-1.3" /><path d="m15.5 15.5 1.7 1.7a4 4 0 0 0 5.6-5.6l-2.4-2.4a4 4 0 0 0-5.6 0l-1.3 1.3" /><path d="m9 15 6-6" /></svg>;
  return <svg {...props}><path d="M20 7h-5V2M4 17h5v5" /><path d="M5.1 9A8 8 0 0 1 18 5l2 2M18.9 15A8 8 0 0 1 6 19l-2-2" /></svg>;
}

export function CommerceSyncBadge({ sync, compact = false }) {
  const meta = commerceSyncMeta(sync);
  return (
    <span
      className={`commerce-sync-badge ${meta.state}${compact ? ' compact' : ''}`}
      title={meta.detail}
      aria-live="polite"
      aria-busy={meta.state === 'unknown' || meta.state === 'pending' ? 'true' : undefined}
    >
      <span className="commerce-sync-icon"><SyncIcon state={meta.state} /></span>
      <span>{meta.label}</span>
      {!compact && meta.detail && <small>{meta.detail}</small>}
    </span>
  );
}

export default CommerceSyncBadge;
