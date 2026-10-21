import React, { useState, useEffect } from 'react';

function adminNotificationSourceLabel(source) {
  return ({
    scanner: 'SCANNER',
    catalog: 'CATÁLOGO',
    images: 'IMAGENS',
    mural: 'MURAL',
    commerce: 'COMÉRCIO',
    operators: 'OPERADORES',
    security: 'SEGURANÇA',
    admin: 'ADMIN'
  })[source] || 'SISTEMA';
}

function adminNotificationIcon(source, severity) {
  const icon = severity === 'error' ? 'error'
    : severity === 'warning' ? 'warning'
      : ({
        scanner: 'scanner',
        catalog: 'catalog',
        images: 'images',
        mural: 'mural',
        commerce: 'commerce',
        operators: 'operators',
        security: 'security',
        admin: 'admin'
      })[source] || 'system';

  const attributes = {
    width: 27, height: 27, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, focusable: 'false'
  };
  switch (icon) {
    case 'error':
      return <svg {...attributes}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>;
    case 'warning':
      return <svg {...attributes}><path d="M10.3 3.8 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
    case 'images':
      return <svg {...attributes}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m3 17 5.5-5 4.1 3.6 2.8-2.6 5.6 5" /></svg>;
    case 'scanner':
      return <svg {...attributes}><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3M4 12h16M8 8v2m4-2v2m4-2v2m-8 4v2m4-2v2m4-2v2" /></svg>;
    case 'catalog':
      return <svg {...attributes}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 4v17M11 9h7M11 13h7M11 17h4" /></svg>;
    case 'mural':
      return <svg {...attributes}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h10M7 12h6M7 16h10" /><circle cx="17" cy="12" r="1" /></svg>;
    case 'commerce':
      return <svg {...attributes}><path d="M3 7h18l-1.5 13h-15L3 7ZM8 9V6a4 4 0 0 1 8 0v3" /></svg>;
    case 'operators':
      return <svg {...attributes}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M17 5a3 3 0 0 1 0 6M17.5 14a5 5 0 0 1 3 5v1" /></svg>;
    case 'security':
      return <svg {...attributes}><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case 'admin':
      return <svg {...attributes}><path d="M4 7h16v13H4zM8 7V5a4 4 0 0 1 8 0v2M9 12h6M9 16h4" /></svg>;
    default:
      return <svg {...attributes}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;
  }
}

function formatAdminNotificationDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    ? raw
    : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function AdminNotificationsModal({ isOpen, onClose, unreadCount, setUnreadCount, api }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/admin/system-notifications?limit=100');
      setNotifications(data.notifications || []);
      if (typeof data.unread_count === 'number') setUnreadCount(data.unread_count);
    } catch (error) {
      console.error('Falha ao carregar atividades do sistema', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    load();
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const markOne = async id => {
    try {
      const data = await api(`/api/admin/system-notifications/${id}/read`, { method: 'POST' });
      setNotifications(previous => previous.map(item => item.id === id ? { ...item, is_read: true } : item));
      if (typeof data.unread_count === 'number') setUnreadCount(data.unread_count);
    } catch (error) {
      console.error('Falha ao marcar atividade como lida', error);
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api('/api/admin/system-notifications/mark-all-read', { method: 'POST' });
      setNotifications(previous => previous.map(item => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Falha ao marcar atividades como lidas', error);
    } finally {
      setMarkingAll(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="notifications-modal" role="dialog" aria-modal="true" aria-labelledby="admin-notifications-title">
        <div className="notifications-header">
          <div>
            <h3 id="admin-notifications-title">Atividades do Sistema</h3>
            <small>{unreadCount} não lida{unreadCount === 1 ? '' : 's'} · ações, scanners e alertas</small>
          </div>
          <div className="notifications-actions">
            {unreadCount > 0 && (
              <button type="button" className="mark-all-btn" disabled={markingAll} onClick={markAll}>
                {markingAll ? 'Marcando…' : 'Marcar todas como lidas'}
              </button>
            )}
            <button type="button" className="close-btn" onClick={onClose} aria-label="Fechar notificações">✕</button>
          </div>
        </div>

        <div className="notifications-body">
          {loading && <div className="notifications-loading">Carregando atividades…</div>}
          {!loading && notifications.length === 0 && (
            <div className="notifications-empty">
              <p>Nenhuma atividade registrada ainda.</p>
            </div>
          )}
          {!loading && notifications.map(item => (
            <article
              key={item.id}
              className={`notification-card ${item.is_read ? 'read' : 'unread'}`}
              onClick={() => !item.is_read && markOne(item.id)}
            >
              <div className={`notification-thumb notification-thumb-${item.severity === 'error' ? 'error' : item.severity === 'warning' ? 'warning' : (['scanner', 'catalog', 'images', 'mural', 'commerce', 'operators', 'security', 'admin'].includes(item.source) ? item.source : 'system')}`} aria-hidden="true">
                {adminNotificationIcon(item.source, item.severity)}
              </div>
              <div className="notification-info">
                <div className="notification-top-row">
                  <span className="notif-capa-badge">{adminNotificationSourceLabel(item.source)}</span>
                  {item.http_status && <span className="notif-platform-tag">HTTP {item.http_status}</span>}
                  {!item.is_read && <span className="unread-dot" title="Não lida" />}
                </div>
                <h4>{item.title || 'Atividade no sistema'}</h4>
                <p className="notif-variacao">{item.message}</p>
                {item.actor_name && <p className="notif-variacao"><strong>Responsável:</strong> {item.actor_name}</p>}
                <small className="notif-date">{formatAdminNotificationDate(item.created_at)}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
