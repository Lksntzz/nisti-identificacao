import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import LOGO from './assets/logo.png';

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
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(data?.error || `Erro ${response.status}`, response.status, data);
  }
  return data;
}

async function compressPhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  return blob ? new File([blob], 'capa.jpg', { type: 'image/jpeg' }) : file;
}

function BellIcon({ unreadCount, onClick }) {
  return (
    <button
      type="button"
      className="bell-circle-btn"
      onClick={onClick}
      aria-label={`Notificações de novas capas (${unreadCount} não lidas)`}
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

      const rawKey = sub.getKey ? sub.getKey('p256dh') : null;
      const rawAuth = sub.getKey ? sub.getKey('auth') : null;

      const subData = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') : '',
          auth: rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') : ''
        }
      };

      await api('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: subData })
      });

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
            <h3>Novas Capas e Variações</h3>
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
            <strong>📲 Notificações no celular</strong>
            <span>
              {pushStatus === 'granted'
                ? 'Notificações ativas neste aparelho.'
                : pushStatus === 'denied'
                ? 'Permissão bloqueada no navegador.'
                : pushStatus === 'unsupported'
                ? 'Push indisponível neste navegador.'
                : 'Receba avisos instantâneos ao cadastrar novas capas.'}
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
            <span className="push-status-badge">✓ Ativo</span>
          )}
        </div>

        <div className="notifications-body">
          {loading && <div className="notifications-loading">Carregando novidades…</div>}
          {!loading && notifications.length === 0 && (
            <div className="notifications-empty">
              <p>Nenhuma nova capa cadastrada recentemente.</p>
            </div>
          )}
          {!loading && notifications.map(item => (
            <article
              key={item.id}
              className={`notification-card ${item.is_read ? 'read' : 'unread'}`}
              onClick={() => !item.is_read && markOne(item.id)}
            >
              <div className="notification-thumb">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.capa_code} loading="lazy" />
                ) : (
                  <div className="thumb-placeholder">Sem foto</div>
                )}
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

function BrandHeader({ unreadCount = 0, onOpenNotifications, operatorName, onOpenOperatorModal }) {
  const initials = operatorName
    ? operatorName.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
    : 'OP';

  return (
    <header className="brand-topbar">
      <div className="brand-identity">
        <img
          className="brand-icon-mark"
          src={LOGO}
          alt="NISTI"
          onError={e => { e.currentTarget.style.opacity = '0.4'; }}
        />
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="operator-profile-pill"
          onClick={onOpenOperatorModal}
          title="Editar perfil do operador"
        >
          <span className="operator-avatar-mini">{initials}</span>
          <span className="operator-name-label">{operatorName || 'Identificar-se'}</span>
        </button>
        <BellIcon unreadCount={unreadCount} onClick={onOpenNotifications} />
      </div>
    </header>
  );
}

function Badge({ label, value }) {
  return <div className="badge"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

function ProductImage({ product, className = '', alt }) {
  const sources = [...new Set([
    product?.image_url,
    product?.product_image_url
  ].filter(Boolean))];
  const sourceKey = sources.join('|');
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [sourceKey]);

  const src = sources[index];
  if (!src) {
    return <div className={className || undefined} aria-label="Imagem indisponível">Imagem indisponível</div>;
  }

  return <img
    className={className || undefined}
    src={src}
    alt={alt || product?.sku || 'Produto'}
    loading="lazy"
    decoding="async"
    onError={() => setIndex(current => current + 1)}
  />;
}

function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [help, setHelp] = useState(false);
  const [standalone, setStandalone] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  );
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const before = event => { event.preventDefault(); setPrompt(event); };
    const installed = () => { setStandalone(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installed);
    
    // Check if window matchMedia changes (e.g., user opens in PWA mode)
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e) => { if (e.matches) setStandalone(true); };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', handleMediaChange);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
        reg.update();
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installed);
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  if (standalone) return null;
  // No Android/PC, só mostra se o navegador disparar o evento de instalação (não está instalado)
  if (!ios && !prompt) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      setPrompt(null);
      return;
    }
    if (ios) setHelp(true);
  };

  return <>
    <button className="install-button" type="button" onClick={install}>↓ Instalar NISTI ID</button>
    {help && <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && setHelp(false)}>
      <div className="modal">
        <h3>Instalar NISTI ID no iPhone</h3>
        <p>No Safari:</p>
        <ol><li>Toque em Compartilhar.</li><li>Escolha Adicionar à Tela de Início.</li><li>Confirme em Adicionar.</li></ol>
        <button type="button" onClick={() => setHelp(false)}>Entendi</button>
      </div>
    </div>}
  </>;
}

function ProductResult({ product, performance }) {
  return <div className="result">
    <p className="eyebrow">PRODUTO IDENTIFICADO PELA CAPA</p>
    <h3>{product.sku}</h3>
    <ProductImage product={product} className="result-image" alt={`Mockup ${product.sku}`} />
    <div className="badges">
      <Badge label="Capa" value={product.capa_code}/>
      <Badge label="Wire-O" value={product.wireo}/>
      <Badge label="Tassel" value={product.tassel}/>
      <Badge label="Elástico" value={product.elastico}/>
    </div>
    {product.platform && <p className="platform"><strong>Plataforma:</strong> {product.platform}</p>}
    {performance?.total_ms && <small className="perf">Identificado em {(performance.total_ms / 1000).toFixed(1)} s</small>}
  </div>;
}

function ProductChoices({ capaCode, products, onSelect, performance }) {
  return <div className="result">
    <p className="eyebrow">CAPA IDENTIFICADA</p>
    <h3 className="choice-title">{capaCode} · escolha o SKU</h3>
    <div className="choices">
      {products.map(product => <article className="choice-card" key={product.id}>
        <ProductImage product={product} alt={product.sku}/>
        <div>
          <h4>{product.sku}</h4>
          <p>{product.nome || product.variacao || product.capa_code}</p>
          <p>Miolo: {product.miolo_code} · Acabamento: {product.acabamento_code}</p>
        </div>
        <button type="button" onClick={() => onSelect(product)}>Selecionar este SKU</button>
      </article>)}
    </div>
    {performance?.total_ms && <small className="perf">Capa reconhecida em {(performance.total_ms / 1000).toFixed(1)} s</small>}
  </div>;
}

function PublicIdentificationApp() {
  const [operatorName, setOperatorNameState] = useState(() => getOperatorName());
  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [platforms, setPlatforms] = useState([]);
  const [platform, setPlatform] = useState('');
  const [platformError, setPlatformError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [choices, setChoices] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestedPlatform, setSuggestedPlatform] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    let active = true;
    api('/api/platforms')
      .then(data => {
        if (!active) return;
        setPlatforms(data.platforms || []);
        setPlatformError('');
      })
      .catch(err => {
        if (!active) return;
        setPlatformError(err.message || 'Não foi possível carregar as plataformas.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const fetchUnread = () => {
      api('/api/notifications/unread-count')
        .then(data => {
          if (!active) return;
          if (typeof data?.unread_count === 'number') {
            setUnreadCount(data.unread_count);
          }
        })
        .catch(() => {});
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const clearDecision = () => {
    setError('');
    setSuggestedPlatform(null);
    setResult(null);
    setChoices(null);
    setSuggestions([]);
    setPerformance(null);
  };

  const applyData = data => {
    setPerformance(data.performance || null);
    setSuggestions([]);
    setSuggestedPlatform(null);
    if (data.needs_selection) {
      setChoices({ capaCode: data.capa_code, products: data.products || [] });
      setResult(null);
    } else {
      setChoices(null);
      setResult(data.product || null);
    }
  };

  const identifyFileWithPlatform = async (file, targetPlatform) => {
    const activePlatform = targetPlatform || platform;
    if (!file || !activePlatform || busy) return;
    const id = ++runId.current;
    setBusy(true);
    clearDecision();

    try {
      const optimized = await compressPhoto(file);

      const candidateForm = new FormData();
      candidateForm.append('image', optimized);
      candidateForm.append('platform', activePlatform);
      const candidateData = await api('/api/identify-candidates', {
        method: 'POST',
        body: candidateForm
      });
      if (id !== runId.current) return;

      const verificationForm = new FormData();
      verificationForm.append('image', optimized);
      verificationForm.append('platform', activePlatform);
      if (candidateData?.ticket) {
        verificationForm.append('ticket', candidateData.ticket);
      }

      const data = await api('/api/identify', {
        method: 'POST',
        body: verificationForm
      });
      if (id !== runId.current) return;
      applyData(data);
    } catch (err) {
      if (id !== runId.current) return;
      const data = err?.data || null;
      setPerformance(data?.performance || null);
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setSuggestedPlatform(data?.suggested_platform || null);
      setError(err.message || 'Não foi possível identificar o produto.');
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const identifyFile = file => identifyFileWithPlatform(file, platform);

  const choose = file => {
    if (!file) return;
    if (!getOperatorName()) {
      setOperatorModalOpen(true);
    }
    setPhoto(file);
    clearDecision();
    setPreview(current => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  };

  const changePlatform = event => {
    setPlatform(event.target.value);
    clearDecision();
  };

  return <main className="app general">
    <BrandHeader
      unreadCount={unreadCount}
      onOpenNotifications={() => setNotificationsOpen(true)}
      operatorName={operatorName}
      onOpenOperatorModal={() => setOperatorModalOpen(true)}
    />
    
    <div className="main-card">
      <div className="card-top-gradient" />
      <div className="card-inner-body">
        <div className="painel-badge">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <span>PAINEL GERAL</span>
        </div>

        <h2 className="card-headline">Identificação de produto</h2>
        <p className="card-subhead">
          Selecione a plataforma e fotografe a capa de frente. A busca visual será feita somente dentro do catálogo dessa plataforma.
        </p>

        <div className="platform-field-group">
          <label className="field-title" htmlFor="recognition-platform">PLATAFORMA</label>
          <div className="select-container">
            <svg className="select-icon-left" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 2 10 5-10 5-10-5Z"/>
              <path d="m2 12 10 5 10-5"/>
              <path d="m2 17 10 5 10-5"/>
            </svg>
            <select
              id="recognition-platform"
              className="platform-native-select"
              value={platform}
              onChange={changePlatform}
              disabled={busy}
            >
              <option value="">Selecione a plataforma</option>
              {platforms.map(item => (
                <option key={item.platform_key} value={item.platform}>
                  {item.platform} ({item.product_count})
                </option>
              ))}
            </select>
            <svg className="select-chevron-right" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>

        {platformError && (
          <div className="status error">
            <h3>Plataformas indisponíveis</h3>
            <p>{platformError}</p>
          </div>
        )}

        <div className="cover-card-container">
          <div className="cover-card-header">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span>CAPA DO PRODUTO</span>
          </div>

          <div className="dashed-upload-zone">
            {preview ? (
              <div className="photo-preview-wrap">
                <img className="photo-preview-img" src={preview} alt="Foto da capa" />
                <label className="change-photo-btn">
                  <span>Trocar foto</span>
                  <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])} />
                </label>
              </div>
            ) : (
              <div className="dropzone-empty-state">
                <div className="camera-circle-badge">
                  <svg className="camera-gradient-icon" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="url(#camera-rainbow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <defs>
                      <linearGradient id="camera-rainbow" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="50%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#d946ef" />
                      </linearGradient>
                    </defs>
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                  <svg className="sparkle-badge-icon" viewBox="0 0 24 24" width="14" height="14" fill="#06b6d4">
                    <path d="m12 2 2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                  </svg>
                </div>
                <h3 className="dropzone-title">Fotografar ou enviar capa</h3>
                <p className="dropzone-hint">Use uma imagem frontal, nítida e com boa iluminação.</p>
                <label className="gallery-pill-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Selecionar da galeria</span>
                  <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])} />
                </label>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn-identify-rainbow"
          disabled={!photo || !platform || busy}
          onClick={() => identifyFile(photo)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>{busy ? 'Identificando capa…' : 'Identificar produto'}</span>
        </button>

        <div className="security-notice-footer">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>Suas imagens são processadas com segurança e não são armazenadas após a identificação.</span>
        </div>

        {error && (
          <div className="status error" style={{ marginTop: '20px' }}>
            <h3>Produto não identificado</h3>
            <p>{error}</p>
            {suggestedPlatform && (
              <div style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="btn-identify-rainbow"
                  style={{ minHeight: '44px', fontSize: '14px', background: '#4f46e5' }}
                  onClick={() => {
                    const target = suggestedPlatform;
                    setPlatform(target);
                    setSuggestedPlatform(null);
                    identifyFileWithPlatform(photo, target);
                  }}
                >
                  Alternar para {suggestedPlatform} e identificar
                </button>
              </div>
            )}
          </div>
        )}

        {choices && <ProductChoices
          capaCode={choices.capaCode}
          products={choices.products}
          performance={performance}
          onSelect={product => { setResult(product); setChoices(null); }}
        />}

        {result && <ProductResult product={result} performance={performance}/>}
      </div>
    </div>

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

    <InstallApp />
  </main>;
}

createRoot(document.getElementById('root')).render(<PublicIdentificationApp/>);
