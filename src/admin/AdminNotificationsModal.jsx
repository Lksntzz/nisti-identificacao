import React, { useState, useEffect } from 'react';
import './admin-notification-details.css';

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


// Explicação em linguagem simples de cada tipo de atividade: o que é, o que significa e o que fazer.
const EXPLANATIONS = {
  admin_login: ['Alguém entrou no painel administrativo com a senha correta.', 'Se foi você, está tudo certo. Se o aparelho ou o local não forem conhecidos, troque a senha do painel.'],
  admin_login_failed: ['Alguém tentou entrar no painel e errou a senha ou não foi autorizado.', 'Uma ou duas tentativas costumam ser engano. Várias seguidas, de um lugar desconhecido, merecem atenção: troque a senha.'],
  admin_logout: ['A sessão do painel foi encerrada.', 'Normal. Nenhuma ação necessária.'],
  gtin_identified: ['Um operador bipou um código de barras e o sistema reconheceu o produto.', 'Mostra qual produto foi identificado. Nenhuma ação necessária.'],
  gtin_not_found: ['Um operador bipou um código de barras que não está cadastrado.', 'Cadastre esse código em "EAN não Cadastrados" para ele ser reconhecido da próxima vez.'],
  gtin_error: ['O scanner não conseguiu consultar o código de barras.', 'Verifique a internet do aparelho. Se persistir, veja o painel Saúde & Logs.'],
  gtin_linked: ['Um código de barras (EAN) foi ligado a um produto.', 'A partir de agora, bipar esse código identifica esse produto.'],
  gtin_removed: ['Um código de barras foi desligado de um produto.', 'Esse código deixa de identificar o produto. Se foi engano, ligue de novo na ficha do produto.'],
  visual_identification: ['Um operador usou a identificação por imagem para achar um produto.', 'Nenhuma ação necessária.'],
  visual_identification_error: ['A identificação por imagem falhou.', 'O operador pode bipar o código de barras no lugar.'],
  product_created: ['Um produto novo entrou no catálogo.', 'Confira se o EAN e a imagem foram cadastrados.'],
  product_updated: ['Os dados de um produto foram alterados.', 'Nenhuma ação necessária. Se não foi você, veja quem fez em "Responsável".'],
  product_deleted: ['Um produto foi excluído do catálogo.', 'Se foi engano, cadastre o produto de novo. Vendas antigas dele podem ficar sem vínculo.'],
  product_image_updated: ['A foto original de um produto foi trocada.', 'A foto tratada pode precisar ser refeita em "Produtos NISTI".'],
  image_treatment_ready: ['O sistema terminou de tratar uma imagem (recorte e fundo).', 'Revise e aprove a imagem para ela aparecer no sistema.'],
  image_treatment_approved: ['Uma imagem tratada foi aprovada.', 'Ela já está sendo usada no sistema e no Mural.'],
  image_treatment_redo: ['Foi pedido um novo tratamento de imagem.', 'O produto voltou para a fila. Aguarde o aviso de "pronta para revisão".'],
  image_treatment_failed: ['O tratamento automático da imagem falhou.', 'Tente refazer. Se continuar, troque a foto original por uma com fundo mais limpo.'],
  mural_updated: ['Algo mudou no Mural dos operadores (publicação, coleção ou imagem).', 'Abra o Mural no celular para conferir como ficou.'],
  mural_update_error: ['Não foi possível salvar uma alteração do Mural.', 'Tente de novo. Se persistir, anote a hora e veja o Saúde & Logs.'],
  commerce_updated: ['O Painel Comercial recebeu uma alteração ou importação (anúncios, vendas ou vínculos).', 'Confira os números no Painel Comercial se foi uma importação.'],
  commerce_update_error: ['Uma importação ou alteração do Painel Comercial falhou.', 'Confira o arquivo importado e tente de novo.'],
  operator_profile_updated: ['Um operador informou ou trocou o nome no aplicativo.', 'Serve para saber quem fez cada ação.'],
  system_activity: ['O sistema concluiu uma operação interna.', 'Nenhuma ação necessária.'],
  system_error: ['Uma operação do sistema deu erro.', 'Se o erro se repetir várias vezes, veja o painel Saúde & Logs.']
};

function explanationFor(item) {
  const known = EXPLANATIONS[item.event_type];
  if (known) return { what: known[0], todo: known[1] };
  if (item.severity === 'error') return { what: 'Uma operação do sistema deu erro.', todo: 'Se se repetir, veja o painel Saúde & Logs.' };
  if (item.severity === 'warning') return { what: 'Uma operação terminou com aviso.', todo: 'Confira se o resultado é o esperado.' };
  return { what: 'Atividade registrada pelo sistema.', todo: 'Nenhuma ação necessária.' };
}

function describeStatus(status) {
  const code = Number(status);
  if (!code) return null;
  if (code >= 200 && code < 300) return `Deu certo (${code})`;
  if (code === 401 || code === 403) return `Sem permissão (${code})`;
  if (code === 404) return `Não encontrado (${code})`;
  if (code === 429) return `Muitos pedidos em pouco tempo (${code})`;
  if (code >= 400 && code < 500) return `Pedido recusado (${code})`;
  if (code >= 500) return `Erro no servidor (${code})`;
  return String(code);
}

function detailRows(item) {
  const d = item.details || {};
  const rows = [
    ['Quando', formatAdminNotificationDate(item.created_at)],
    ['Quem', item.actor_name || (item.source === 'security' ? 'Administrador do painel' : null)],
    ['Produto', d.product_name],
    ['SKU', d.sku || item.entity_id],
    ['Código de barras', d.gtin],
    ['Variação', d.variation],
    ['Wire-o', d.wireo],
    ['Aparelho', d.device],
    ['Local aproximado', d.place],
    ['Endereço de rede (IP)', d.ip],
    ['Resultado', describeStatus(item.http_status)]
  ];
  return rows.filter(([, value]) => value);
}

function detailsAsText(item, explanation) {
  return [item.title, item.message, ...detailRows(item).map(([k, v]) => `${k}: ${v}`), `O que significa: ${explanation.what}`].join('\n');
}


function NotificationDetail({ item, copied, onCopy }) {
  const explanation = explanationFor(item);
  const rows = detailRows(item);
  const productId = item.details?.product_id;
  const showPhoto = productId && ['product_created', 'product_updated', 'product_image_updated', 'gtin_identified', 'gtin_linked', 'gtin_removed', 'image_treatment_ready', 'image_treatment_approved'].includes(item.event_type);
  return (
    <div className="notif-detail" onClick={event => event.stopPropagation()}>
      <div className="notif-detail-explain">
        <b>O que significa</b>
        <p>{explanation.what}</p>
        <b>O que fazer</b>
        <p>{explanation.todo}</p>
      </div>
      {(rows.length > 0 || showPhoto) && (
        <div className="notif-detail-body">
          {showPhoto && <img className="notif-detail-photo" src={`/api/images/${encodeURIComponent(productId)}`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}
          <dl className="notif-detail-grid">
            {rows.map(([label, value]) => (<React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>))}
          </dl>
        </div>
      )}
      <button type="button" className="notif-detail-copy" onClick={() => onCopy(detailsAsText(item, explanation))}>
        {copied ? 'Copiado ✓' : 'Copiar detalhes'}
      </button>
    </div>
  );
}

export default function AdminNotificationsModal({ isOpen, onClose, unreadCount, setUnreadCount, api }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

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

  const toggleOpen = item => {
    setOpenId(current => current === item.id ? null : item.id);
    if (!item.is_read) markOne(item.id);
  };

  const copyDetails = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(current => current === id ? null : current), 1800);
    } catch { /* sem permissão de área de transferência: não é crítico */ }
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
              className={`notification-card ${item.is_read ? 'read' : 'unread'}${openId === item.id ? ' is-open' : ''}`}
              onClick={() => toggleOpen(item)}
              role="button"
              tabIndex={0}
              aria-expanded={openId === item.id}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleOpen(item); } }}
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
                {openId === item.id && <NotificationDetail item={item} copied={copiedId === item.id} onCopy={text => copyDetails(item.id, text)} />}
                <span className="notif-expand-hint" aria-hidden="true">{openId === item.id ? 'Ocultar detalhes ▲' : 'Ver detalhes ▼'}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
