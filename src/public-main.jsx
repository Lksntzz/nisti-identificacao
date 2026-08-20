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

function enhanceContrast(imageData) {
  const data = imageData.data;
  const len = data.length;
  const totalPixels = len / 4;
  if (totalPixels < 16) return imageData;

  // 1. Auto-White-Balance (Gray World Normalization para lâmpadas quentes/amareladas)
  let sumR = 0, sumG = 0, sumB = 0;
  for (let i = 0; i < len; i += 4) {
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
  }
  const avgR = sumR / totalPixels;
  const avgG = sumG / totalPixels;
  const avgB = sumB / totalPixels;
  const avgGray = (avgR + avgG + avgB) / 3;

  if (avgR > 10 && avgG > 10 && avgB > 10) {
    // Fator suave de ganho para não estourar cores intencionais (ex: fundos pastel)
    const gainR = 1 + (avgGray / avgR - 1) * 0.45;
    const gainG = 1 + (avgGray / avgG - 1) * 0.45;
    const gainB = 1 + (avgGray / avgB - 1) * 0.45;

    for (let i = 0; i < len; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] * gainR));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * gainG));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * gainB));
    }
  }

  // 2. Histograma e Expansão de Contraste com corte de reflexo especular
  const histogram = new Uint32Array(256);
  for (let i = 0; i < len; i += 4) {
    const lum = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    histogram[lum]++;
  }

  const clipLow = Math.floor(totalPixels * 0.02);
  const clipHigh = Math.floor(totalPixels * 0.98);

  let count = 0;
  let minLum = 0;
  for (let i = 0; i < 256; i++) {
    count += histogram[i];
    if (count >= clipLow) {
      minLum = i;
      break;
    }
  }

  count = 0;
  let maxLum = 255;
  for (let i = 255; i >= 0; i--) {
    count += histogram[i];
    if (count >= totalPixels - clipHigh) {
      maxLum = i;
      break;
    }
  }

  const range = maxLum - minLum;
  if (range > 30 && range < 235) {
    const scale = 255 / range;
    for (let i = 0; i < len; i += 4) {
      data[i] = Math.min(255, Math.max(0, (data[i] - minLum) * scale));
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - minLum) * scale));
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - minLum) * scale));
    }
  }

  return imageData;
}

async function compressPhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  // Foco Central Inteligente: recorte sutil de 1.5% das bordas externas para preservar títulos e molduras
  const origW = bitmap.width;
  const origH = bitmap.height;
  const cropRatio = 0.015;
  const srcX = Math.round(origW * cropRatio);
  const srcY = Math.round(origH * cropRatio);
  const srcW = Math.max(1, Math.round(origW * (1 - cropRatio * 2)));
  const srcH = Math.max(1, Math.round(origH * (1 - cropRatio * 2)));

  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, width, height);
  bitmap.close?.();

  try {
    const imgData = context.getImageData(0, 0, width, height);
    enhanceContrast(imgData);
    context.putImageData(imgData, 0, 0);
  } catch {}

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.80));
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
  const [installed, setInstalled] = useState(() => {
    try {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      const wasInstalled = localStorage.getItem('nisti_pwa_installed') === '1';
      if (isStandalone) {
        localStorage.setItem('nisti_pwa_installed', '1');
        return true;
      }
      return wasInstalled;
    } catch {
      return false;
    }
  });

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const before = event => { event.preventDefault(); setPrompt(event); };
    const onInstalled = () => {
      try { localStorage.setItem('nisti_pwa_installed', '1'); } catch {}
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', onInstalled);
    
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e) => {
      if (e.matches) {
        try { localStorage.setItem('nisti_pwa_installed', '1'); } catch {}
        setInstalled(true);
      }
    };
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
      window.removeEventListener('appinstalled', onInstalled);
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  if (installed) return null;
  // No Android/PC, só mostra se o navegador disparar o evento de instalação
  if (!ios && !prompt) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') {
        try { localStorage.setItem('nisti_pwa_installed', '1'); } catch {}
        setInstalled(true);
      }
      setPrompt(null);
      return;
    }
    if (ios) setHelp(true);
  };

  const acknowledgeIosInstall = () => {
    try { localStorage.setItem('nisti_pwa_installed', '1'); } catch {}
    setInstalled(true);
    setHelp(false);
  };

  return <>
    <button className="install-button" type="button" onClick={install}>↓ Instalar NISTI ID</button>
    {help && <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && setHelp(false)}>
      <div className="modal">
        <h3>Instalar NISTI ID no iPhone</h3>
        <p>No Safari:</p>
        <ol><li>Toque em Compartilhar (ícone do meio).</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li><li>Confirme em <strong>Adicionar</strong>.</li></ol>
        <button type="button" onClick={acknowledgeIosInstall}>Entendi, já adicionei</button>
      </div>
    </div>}
  </>;
}

function ConfidenceBadge({ confidence, score }) {
  let value = 95;
  if (typeof confidence === 'number' && confidence > 0) {
    value = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  } else if (typeof score === 'number' && score > 0) {
    value = Math.min(99, Math.round(score * 100));
  }

  const isHigh = value >= 90;
  return (
    <div className={`confidence-tag ${isHigh ? 'high' : 'medium'}`} title="Índice de certeza da Inteligência Artificial">
      <span className="conf-dot" />
      <span>{isHigh ? `Alta Precisão (${value}%)` : `Correspondência (${value}%)`}</span>
    </div>
  );
}

function ScanningOverlay({ elapsedMs, stageText }) {
  const seconds = (elapsedMs / 1000).toFixed(1);
  return (
    <div className="scanning-hud-overlay">
      <div className="scanning-grid-bg" />
      <div className="scanning-laser-beam" />
      <div className="scanning-hud-box">
        <span className="scanning-timer-val">{seconds}s</span>
        <div className="scanning-status-text">
          <span className="scanning-radar-dot" />
          <span>{stageText || 'Identificando capa…'}</span>
        </div>
      </div>
    </div>
  );
}

function ProductResult({ product, performance, onReset }) {
  return (
    <div className="result-compact-card">
      <div className="result-compact-header">
        <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          ✓ Capa Identificada
        </span>
        <ConfidenceBadge confidence={product.confidence} score={performance?.retrieval_top1} />
      </div>

      <div className="result-compact-row">
        <ProductImage product={product} className="result-compact-img" alt={`Mockup ${product.sku}`} />
        <div className="result-compact-info">
          <h4 className="result-compact-sku" title={product.sku}>{product.sku}</h4>
          <div className="result-compact-badges">
            <span className="result-compact-badge">Capa: <strong>{product.capa_code}</strong></span>
            {product.wireo && <span className="result-compact-badge">Wire-o: <strong>{product.wireo}</strong></span>}
            {product.elastico && <span className="result-compact-badge">Elástico: <strong>{product.elastico}</strong></span>}
            {product.tassel && <span className="result-compact-badge">Tassel: <strong>{product.tassel}</strong></span>}
          </div>
        </div>
      </div>

      {performance?.total_ms && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
          <span>{product.platform ? `Plataforma: ${product.platform}` : ''}</span>
          <span style={{ fontWeight: 600 }}>Reconhecido em {(performance.total_ms / 1000).toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
}

function ProductChoices({ capaCode, products, platform, onSelect, performance, onReset }) {
  const [analyzingDetail, setAnalyzingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  const handleDetailPhoto = async (file) => {
    if (!file || analyzingDetail) return;
    setAnalyzingDetail(true);
    setDetailError('');

    try {
      const optimized = await compressPhoto(file);
      const form = new FormData();
      form.append('image', optimized);
      form.append('capa_code', capaCode);
      form.append('platform', platform);

      const data = await api('/api/identify-detail', {
        method: 'POST',
        body: form
      });

      if (data?.product) {
        onSelect(data.product);
      } else {
        setDetailError('Não foi possível desempatar pelo detalhe. Toque no SKU correto abaixo.');
      }
    } catch (err) {
      setDetailError(err?.message || 'Erro ao analisar detalhe.');
    } finally {
      setAnalyzingDetail(false);
    }
  };

  return (
    <div className="result-compact-card" style={{ background: '#f8faff', borderColor: '#c7d2fe' }}>
      <div className="result-compact-header">
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#4f46e5', textTransform: 'uppercase' }}>
          Capa {capaCode} · Toque no SKU correto ({products.length})
        </span>
        <ConfidenceBadge score={performance?.retrieval_top1} />
      </div>

      <label className="btn-detail-tiebreaker" style={{ margin: '3px 0 5px', padding: '6px 10px', fontSize: '11px' }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>{analyzingDetail ? 'Analisando detalhe com IA…' : '🔍 Desempatar por foto de detalhe / texto'}</span>
        <input type="file" accept="image/*" capture="environment" disabled={analyzingDetail} onChange={e => handleDetailPhoto(e.target.files?.[0])} />
      </label>

      {detailError && <p className="status error" style={{ fontSize: '11px', margin: '2px 0 4px', padding: '4px 8px' }}>{detailError}</p>}

      <div className="choices">
        {products.map(product => (
          <article className="choice-card" key={product.id} onClick={() => onSelect(product)}>
            <ProductImage product={product} alt={product.sku}/>
            <div className="choice-card-info">
              <h4 className="choice-card-sku">{product.sku}</h4>
              <div className="choice-card-tags">
                <span className="choice-card-tag">Capa: {product.capa_code}</span>
                {product.wireo && <span className="choice-card-tag">Wire-o: {product.wireo}</span>}
                {product.elastico && <span className="choice-card-tag">Elástico: {product.elastico}</span>}
                {product.tassel && <span className="choice-card-tag">Tassel: {product.tassel}</span>}
              </div>
            </div>
            <button type="button" className="choice-card-select-btn" onClick={(e) => { e.stopPropagation(); onSelect(product); }}>
              Selecionar
            </button>
          </article>
        ))}
      </div>

      {performance?.total_ms && (
        <small style={{ fontSize: '10px', color: '#64748b', textAlign: 'right' }}>
          Identificado em {(performance.total_ms / 1000).toFixed(1)}s
        </small>
      )}
    </div>
  );
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
  const [recentScans, setRecentScans] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nisti_recent_scans') || '[]'); } catch { return []; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [scanStage, setScanStage] = useState('Processando foto…');
  const runId = useRef(0);

  useEffect(() => {
    if (!busy) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      const diff = Date.now() - start;
      setElapsedMs(diff);
      if (diff < 400) {
        setScanStage('1. Extraindo vetor visual…');
      } else if (diff < 1200) {
        setScanStage('2. Comparando com IA…');
      } else {
        setScanStage('3. Confirmando produto…');
      }
    }, 40);
    return () => clearInterval(interval);
  }, [busy]);

  const addRecentScan = (product) => {
    if (!product) return;
    setRecentScans(prev => {
      const entry = {
        id: product.id,
        sku: product.sku,
        capaCode: product.capa_code,
        nome: product.nome || '',
        wireo: product.wireo || '',
        tassel: product.tassel || '',
        elastico: product.elastico || '',
        platform: product.platform || '',
        image_url: product.image_url || product.product_image_url || (product.id ? `/api/images/${product.id}` : ''),
        time: new Date().toISOString()
      };
      const next = [entry, ...prev.filter(s => s.sku !== product.sku)].slice(0, 10);
      try { localStorage.setItem('nisti_recent_scans', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const restoreScan = (scan) => {
    setResult({
      id: scan.id,
      sku: scan.sku,
      capa_code: scan.capaCode,
      nome: scan.nome,
      wireo: scan.wireo,
      tassel: scan.tassel,
      elastico: scan.elastico,
      platform: scan.platform,
      image_url: scan.image_url,
      confidence: 1
    });
    setChoices(null);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

  const resetAll = () => {
    setPhoto(null);
    setPreview(current => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setPlatform('');
    clearDecision();
  };

  const applyData = (data, file, currentPreview) => {
    setPerformance(data.performance || null);
    setSuggestions([]);
    setSuggestedPlatform(null);
    if (data.needs_selection) {
      setChoices({ capaCode: data.capa_code, products: data.products || [] });
      setResult(null);
    } else if (data.product) {
      setChoices(null);
      setResult(data.product);
      addRecentScan(data.product);
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
      const snap = preview;

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
      applyData(data, file, snap);
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
    const objectUrl = URL.createObjectURL(file);
    setPhoto(file);
    clearDecision();
    setPreview(current => {
      if (current) URL.revokeObjectURL(current);
      return objectUrl;
    });
    // ⚡ Auto-scan: se a plataforma já está selecionada, dispara na hora
    if (platform) {
      identifyFileWithPlatform(file, platform);
    }
  };

  const changePlatform = event => {
    const newPlatform = event.target.value;
    setPlatform(newPlatform);
    clearDecision();
    // ⚡ Auto-scan: se já tem foto, identifica ao trocar plataforma
    if (photo && newPlatform) {
      identifyFileWithPlatform(photo, newPlatform);
    }
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
        <div className="platform-field-group">
          <div className="select-container">
            <svg className="select-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <svg className="select-chevron-right" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>

        {platformError && (
          <div className="status error" style={{ padding: '6px 10px', margin: 0 }}>
            <p style={{ margin: 0, fontSize: '11px' }}>{platformError}</p>
          </div>
        )}

        {preview && (result || choices) ? (
          <div className="compact-photo-strip">
            <img src={preview} alt="Foto da capa" className="compact-strip-thumb" />
            <span className="compact-strip-text">Foto da capa enviada</span>
            <label className="compact-strip-change">
              <span>Trocar foto</span>
              <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])} />
            </label>
          </div>
        ) : (
          <div className="cover-card-container">
            <div className="dashed-upload-zone">
              {preview ? (
                <div className="photo-preview-wrap">
                  <img className="photo-preview-img" src={preview} alt="Foto da capa" />
                  {busy && <ScanningOverlay elapsedMs={elapsedMs} stageText={scanStage} />}
                  {!busy && (
                    <label className="change-photo-btn">
                      <span>Trocar foto</span>
                      <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])} />
                    </label>
                  )}
                </div>
              ) : (
                <div className="dropzone-empty-state">
                  <div className="camera-circle-badge">
                    <svg className="camera-gradient-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="url(#camera-rainbow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    <svg className="sparkle-badge-icon" viewBox="0 0 24 24" width="10" height="10" fill="#06b6d4">
                      <path d="m12 2 2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                    </svg>
                  </div>
                  <h3 className="dropzone-title">Fotografar ou enviar capa</h3>
                  <p className="dropzone-hint">Enquadre de frente com boa luz.</p>
                  <label className="gallery-pill-btn">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Galeria / Câmera</span>
                    <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])} />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="action-buttons-group">
          <button
            type="button"
            className="btn-identify-rainbow"
            disabled={!photo || !platform || busy}
            onClick={() => identifyFile(photo)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>{busy ? 'Identificando…' : (result || choices || error) ? 'Tentar novamente' : 'Identificar produto'}</span>
          </button>

          {(photo || platform || result || choices || error) && (
            <button
              type="button"
              className="btn-nova-consulta"
              onClick={resetAll}
              disabled={busy}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>Nova consulta</span>
            </button>
          )}
        </div>

        {error && (
          <div className="status error" style={{ padding: '10px 12px', margin: '4px 0', borderRadius: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '14px' }}>⚠️</span>
              <h3 style={{ fontSize: '13px', margin: 0, fontWeight: 800 }}>{error.includes('conexão') || error.includes('fetch') ? 'Oscilação de Conexão' : 'Não foi possível identificar'}</h3>
            </div>
            <p style={{ fontSize: '11.5px', margin: '4px 0 6px', color: '#b91c1c' }}>{error}</p>
            
            <div style={{ background: 'rgba(255,255,255,0.7)', borderRadius: '8px', padding: '6px 8px', fontSize: '11px', color: '#334155', marginTop: '4px', lineHeight: 1.4 }}>
              <strong>💡 Dicas de ajuste na bancada:</strong>
              <ul style={{ margin: '3px 0 0 16px', padding: 0 }}>
                <li>Se houver reflexo de lâmpada ou glitter, <strong>incline o caderno 5°</strong>.</li>
                <li>Mantenha o flash desligado e enquadre de frente.</li>
              </ul>
            </div>

            {suggestedPlatform && (
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn-identify-rainbow"
                  style={{ height: '38px', fontSize: '12.5px', background: '#4f46e5' }}
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
          platform={platform}
          performance={performance}
          onReset={resetAll}
          onSelect={product => {
            setResult(product);
            setChoices(null);
            addRecentScan(product);
          }}
        />}

        {result && <ProductResult product={result} performance={performance} onReset={resetAll}/>}
      </div>
    </div>

    {/* Gaveta de histórico rápido da sessão */}
    {recentScans.length > 0 && (
      <div className={`recent-scans-drawer${drawerOpen ? ' open' : ''}`}>
        <div className="recent-scans-header" onClick={() => setDrawerOpen(o => !o)}>
          <span className="recent-scans-title">
            🗂️ Histórico desta sessão
            <span className="recent-scans-badge">{recentScans.length}</span>
          </span>
          <svg className="recent-scans-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        {drawerOpen && (
          <div className="recent-scans-list">
            {recentScans.map((scan, i) => (
              <div
                className="recent-scan-item"
                key={`${scan.sku}-${i}`}
                onClick={() => restoreScan(scan)}
                title="Toque para abrir este produto"
              >
                <div className="recent-scan-info">
                  {scan.image_url ? (
                    <img
                      className="recent-scan-img"
                      src={scan.image_url}
                      alt={scan.sku}
                      onError={e => {
                        e.currentTarget.style.opacity = '0.3';
                      }}
                    />
                  ) : (
                    <div className="recent-scan-img" />
                  )}
                  <div className="recent-scan-details">
                    <h4>{scan.sku}</h4>
                    <div className="recent-scan-meta">
                      <span className="recent-scan-tag">Capa: <strong>{scan.capaCode}</strong></span>
                      {scan.wireo && <span className="recent-scan-tag">Wire-o: {scan.wireo}</span>}
                      {scan.elastico && <span className="recent-scan-tag">Elástico: {scan.elastico}</span>}
                      {scan.tassel && <span className="recent-scan-tag">Tassel: {scan.tassel}</span>}
                      {scan.platform && <span className="recent-scan-tag platform">{scan.platform}</span>}
                    </div>
                  </div>
                </div>
                <span className="recent-scan-time">
                  {new Date(scan.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            <button
              type="button"
              className="btn-clear-history"
              onClick={() => {
                setRecentScans([]);
                try { localStorage.removeItem('nisti_recent_scans'); } catch {}
              }}
            >Limpar histórico</button>
          </div>
        )}
      </div>
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
        // Sincroniza o nome retroativamente em todos os eventos deste operador
        api('/api/operator/update-name', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operator_name: newName })
        }).catch(() => {});
      }}
    />

    <InstallApp />
  </main>;
}

export default PublicIdentificationApp;
