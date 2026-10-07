import React, { useEffect, useState } from 'react';
import './app.css';
import LOGO from './assets/logo.png';
import GtinScannerOverlay from './gtin-scanner-overlay.jsx';
import MuralNisti from './mural-nisti.jsx';
import ProductCutoutImage from './product-cutout-image.jsx';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function getUserId() {
  try {
    let id = localStorage.getItem('nisti_shipping_user_id');
    if (!id) {
      id = 'op_' + crypto.randomUUID();
      localStorage.setItem('nisti_shipping_user_id', id);
    }
    return id;
  } catch {
    return 'op_guest';
  }
}

function getOperatorName() {
  try {
    return localStorage.getItem('nisti_operator_name') || '';
  } catch {
    return '';
  }
}

function setOperatorName(name) {
  try {
    if (name) localStorage.setItem('nisti_operator_name', name.trim());
    else localStorage.removeItem('nisti_operator_name');
  } catch {}
}

async function api(path, options = {}) {
  const operatorName = getOperatorName();
  const headers = {
    'x-user-id': getUserId(),
    ...(operatorName ? { 'x-operator-name': encodeURIComponent(operatorName) } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, {
    credentials:'same-origin',
    cache:'no-store',
    ...options,
    headers
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(data?.error || `Erro ${response.status}`, response.status, data);
  }
  return data;
}


function BellIcon({ unreadCount, onClick }) {
  return (
    <button
      type="button"
      className="bell-circle-btn"
      onClick={onClick}
      aria-label={`Notificações de novos itens (${unreadCount} não lidas)`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="bell-pink-dot" aria-hidden="true" />
      )}
    </button>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function pushSubscriptionData(subscription) {
  if (!subscription?.endpoint) return null;
  const serialized = typeof subscription.toJSON === 'function' ? subscription.toJSON() : null;
  if (serialized?.keys?.p256dh && serialized?.keys?.auth) {
    return {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth
      }
    };
  }

  const rawKey = subscription.getKey?.('p256dh');
  const rawAuth = subscription.getKey?.('auth');
  const encode = value => value
    ? btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    : '';

  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: encode(rawKey), auth: encode(rawAuth) }
  };
}

async function persistPushSubscription(subscription) {
  const payload = pushSubscriptionData(subscription);
  if (!payload?.keys?.p256dh || !payload?.keys?.auth) {
    throw new Error('Assinatura push incompleta.');
  }
  return api('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: payload })
  });
}

async function syncExistingPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return false;
  await persistPushSubscription(subscription);
  return true;
}

function NotificationsModal({ isOpen, onClose, unreadCount, setUnreadCount }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [pushStatus, setPushStatus] = useState('unknown');
  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/notifications');
      setNotifications(data.notifications || []);
      if (typeof data.unread_count === 'number') {
        setUnreadCount(data.unread_count);
      }
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (isOpen) {
      load();
      if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          navigator.serviceWorker.ready.then(reg => {
            reg.pushManager.getSubscription().then(sub => {
              setPushStatus(sub ? 'granted' : 'supported');
            }).catch(() => setPushStatus('supported'));
          }).catch(() => setPushStatus('supported'));
        } else if (Notification.permission === 'denied') {
          setPushStatus('denied');
        } else {
          setPushStatus('supported');
        }
      } else {
        setPushStatus('unsupported');
      }
    }
  }, [isOpen]);

  const togglePush = async () => {
    if (pushStatus === 'subscribing') return;
    setPushStatus('subscribing');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus('denied');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        const keyData = await api('/api/push/public-key');
        const appServerKey = urlBase64ToUint8Array(keyData.publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey
        });
      }

      await persistPushSubscription(sub);

      setPushStatus('granted');
    } catch (err) {
      console.error('Push subscription error:', err);
      setPushStatus('supported');
    }
  };

  const markOne = async (id) => {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api('/api/notifications/mark-all-read', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
    finally { setMarkingAll(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="notifications-modal">
        <div className="notifications-header">
          <div>
            <h3>Novos Itens Cadastrados</h3>
            <small>{unreadCount} não lida{unreadCount === 1 ? '' : 's'}</small>
          </div>
          <div className="notifications-actions">
            {unreadCount > 0 && (
              <button
                type="button"
                className="mark-all-btn"
                disabled={markingAll}
                onClick={markAll}
              >
                {markingAll ? 'Marcando…' : 'Marcar todas como lidas'}
              </button>
            )}
            <button type="button" className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="push-banner">
          <div className="push-banner-copy">
            <strong>Notificações no celular</strong>
            <span>
              {pushStatus === 'granted'
                ? 'Notificações ativas neste aparelho.'
                : pushStatus === 'denied'
                ? 'Permissão bloqueada no navegador.'
                : pushStatus === 'unsupported'
                ? 'Push indisponível neste navegador.'
                : 'Receba avisos instantâneos quando novos itens forem cadastrados.'}
            </span>
          </div>
          {pushStatus === 'supported' && (
            <button type="button" className="push-enable-btn" onClick={togglePush}>
              Ativar
            </button>
          )}
          {pushStatus === 'subscribing' && (
            <button type="button" className="push-enable-btn" disabled>
              Ativando…
            </button>
          )}
          {pushStatus === 'granted' && (
            <span className="push-status-badge">Ativo</span>
          )}
        </div>

        <div className="notifications-body">
          {loading && <div className="notifications-loading">Carregando novidades…</div>}
          {!loading && notifications.length === 0 && (
            <div className="notifications-empty">
              <p>Nenhum item novo cadastrado recentemente.</p>
            </div>
          )}
          {!loading && notifications.map(item => (
            <article
              key={item.id}
              className={`notification-card ${item.is_read ? 'read' : 'unread'}`}
              onClick={() => !item.is_read && markOne(item.id)}
            >
              <div className="notification-thumb">
                <ProductCutoutImage
                  src={item.image_url}
                  alt={item.capa_code}
                  fallback={<div className="thumb-placeholder">Sem foto</div>}
                />
              </div>
              <div className="notification-info">
                <div className="notification-top-row">
                  <span className="notif-capa-badge">{item.capa_code}</span>
                  {item.platform && <span className="notif-platform-tag">{item.platform}</span>}
                  {!item.is_read && <span className="unread-dot" title="Não lida" />}
                </div>
                <h4>{item.product_name || item.sku || 'Nova capa cadastrada'}</h4>
                {item.variacao && <p className="notif-variacao"><strong>Variação:</strong> {item.variacao}</p>}
                <small className="notif-date">
                  {new Date(item.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function OperatorProfileModal({ isOpen, onClose, currentName, onSave }) {
  const [name, setName] = useState(currentName || '');

  useEffect(() => {
    setName(currentName || '');
  }, [currentName, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      onClose();
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal" style={{ maxWidth: '420px' }}>
        <div className="admin-modal-head">
          <div>
            <h3>Perfil do Operador</h3>
            <small>Identifique quem está realizando os reconhecimentos</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="admin-modal-form">
          <div className="form-group">
            <label>Seu Nome ou Setor</label>
            <input
              type="text"
              placeholder="Ex: Carlos (Expedição), Lucas, etc."
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              required
            />
            <small style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
              Este nome será gravado em cada identificação e exibido no histórico do painel administrativo.
            </small>
          </div>

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-submit-rainbow">Salvar Perfil</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InstallApp({ compact = false }) {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handlePrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (!prompt || installed) return null;

  const handleInstall = async () => {
    if (!prompt) return;
    prompt.prompt();
    try {
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setInstalled(true);
      }
    } catch {}
    setPrompt(null);
  };

  return (
    <button
      type="button"
      className={`install-button ${compact ? 'compact' : ''}`}
      onClick={handleInstall}
      title="Instalar aplicativo"
      aria-label="Instalar aplicativo"
    >
      {compact ? '⬇' : 'Instalar App'}
    </button>
  );
}

function BrandHeader({ unreadCount = 0, onOpenNotifications, operatorName, onOpenOperatorModal, showInstall = false, muralUnread = 0, activeView = 'scanner', onOpenScanner, onOpenMural }) {
  const initials = operatorName
    ? operatorName.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
    : 'OP';
  const inMural = activeView === 'mural';

  const identity = (
    <>
      <img
        className="brand-icon-mark"
        src={LOGO}
        alt="NISTI"
        onError={e => { e.currentTarget.style.opacity = '0.4'; }}
      />
      <div className="brand-titles">
        <strong className="brand-main-title">NISTI PRINT</strong>
        <span className="brand-subtext">{inMural ? 'Mural NISTI' : 'Scanner de EAN'}</span>
      </div>
    </>
  );

  return (
    <header className="brand-topbar">
      {inMural && onOpenScanner ? (
        <button type="button" className="brand-identity brand-identity-button" onClick={onOpenScanner} aria-label="Voltar ao Scanner">
          {identity}
        </button>
      ) : (
        <div className="brand-identity">{identity}</div>
      )}
      <div className="header-actions">
        <button
          type="button"
          className="operator-profile-pill"
          onClick={onOpenOperatorModal}
          title="Editar perfil do operador"
        >
          <span className="operator-avatar-mini">{initials}</span>
          <span className="operator-name-label">{operatorName || 'Operador'}</span>
        </button>
        {showInstall && <InstallApp compact />}
        {!inMural && onOpenMural && onOpenScanner && (
          <button
            type="button"
            className="mural-nav-btn"
            onClick={onOpenMural}
            aria-label={`Abrir Mural NISTI (${muralUnread} não lidos)`}
          >
            <span>Mural</span>
            {muralUnread > 0 && <span className="mural-nav-count">{muralUnread > 9 ? '9+' : muralUnread}</span>}
          </button>
        )}
        <BellIcon unreadCount={unreadCount} onClick={onOpenNotifications} />
      </div>
    </header>
  );
}


function PublicIdentificationApp() {
  const [operatorName, setOperatorNameState] = useState(() => getOperatorName());
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [muralUnread, setMuralUnread] = useState(0);
  const [muralAccess, setMuralAccess] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [publicView, setPublicView] = useState('scanner');

  useEffect(() => {
    syncExistingPushSubscription().catch(error => {
      console.warn('[Push] Não foi possível renovar a assinatura existente', error);
    });
  }, []);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#scanner' || hash.startsWith('#/scanner')) {
        setPublicView('scanner');
      } else if (hash === '#mural' || hash.startsWith('#/mural')) {
        setPublicView('mural');
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    let active = true;
    const fetchUnread = () => {
      api('/api/notifications/unread-count').then(notifications => {
        if (!active) return;
        if (typeof notifications?.unread_count === 'number') setUnreadCount(notifications.unread_count);
      }).catch(() => {});
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const qaRequested = new URLSearchParams(window.location.search).get('mural') === 'qa';
    api('/api/mural/access', {
      headers: qaRequested ? { 'x-mural-qa': '1' } : {}
    })
      .then(data => {
        if (!active) return;
        const allowed = Boolean(data?.released || (qaRequested && data?.qa));
        setMuralAccess(allowed);
        if (allowed && qaRequested) setPublicView('mural');
      })
      .catch(() => active && setMuralAccess(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!muralAccess) {
      setMuralUnread(0);
      return undefined;
    }
    let active = true;
    const fetchMuralUnread = () => {
      api('/api/mural/unread-count').then(data => {
        if (active && typeof data?.unread_count === 'number') setMuralUnread(data.unread_count);
      }).catch(() => {});
    };
    fetchMuralUnread();
    const interval = setInterval(fetchMuralUnread, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [muralAccess]);

  return (
    <main className={`app general ${publicView === 'scanner' ? 'ean-viewport' : 'mural-viewport'}`}>
      <BrandHeader
        unreadCount={unreadCount}
        onOpenNotifications={() => setNotificationsOpen(true)}
        operatorName={operatorName}
        onOpenOperatorModal={() => setOperatorModalOpen(true)}
        showInstall
        muralUnread={muralUnread}
        activeView={publicView}
        onOpenScanner={() => setPublicView('scanner')}
        onOpenMural={() => setPublicView('mural')}
      />

      {publicView === 'scanner' ? (
        <div className="main-card ean-primary-card">
          <div className="card-top-gradient" />
          <div className="card-inner-body ean-primary-body">
            <GtinScannerOverlay embedded />
          </div>
        </div>
      ) : muralAccess ? (
        <MuralNisti onUnreadChange={setMuralUnread} />
      ) : (
        <section className="mural-coming-soon" role="status" aria-live="polite">
          <div className="mural-coming-soon-card">
            <span className="mural-coming-soon-kicker">MURAL NISTI</span>
            <h2>Em breve</h2>
            <p>Estamos preparando este espaço para você.</p>
            <button type="button" onClick={() => setPublicView('scanner')}>Voltar ao Scanner</button>
          </div>
        </section>
      )}

      <NotificationsModal
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        unreadCount={unreadCount}
        setUnreadCount={setUnreadCount}
      />

      <OperatorProfileModal
        isOpen={operatorModalOpen}
        onClose={() => setOperatorModalOpen(false)}
        currentName={operatorName}
        onSave={newName => {
          setOperatorName(newName);
          setOperatorNameState(newName);
        }}
      />
    </main>
  );
}

export default PublicIdentificationApp;
