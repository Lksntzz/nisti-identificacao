import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

const LOGO = '/nisti-logo-transparent.webp';
const LOGO_FALLBACK = '/nisti-app-icon.svg';

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

async function api(path, options = {}) {
  const headers = {
    'x-user-id': getUserId(),
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
      className="notification-bell-btn"
      onClick={onClick}
      aria-label={`Notificações de novas capas (${unreadCount} não lidas)`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="notification-badge" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

function NotificationsModal({ isOpen, onClose, unreadCount, setUnreadCount }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

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
    if (isOpen) load();
  }, [isOpen]);

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

function BrandHeader({ unreadCount = 0, onOpenNotifications }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return <header className="topbar">
    <div className="brand-block">
      <img
        className="brand-logo"
        src={logoFailed ? LOGO_FALLBACK : LOGO}
        alt="NISTI PRINT"
        onError={() => setLogoFailed(true)}
      />
      <div className="top-title"><small>NISTI PRINT</small><h1>Identificação Visual</h1></div>
    </div>
    <div className="header-actions">
      <BellIcon unreadCount={unreadCount} onClick={onOpenNotifications} />
    </div>
  </header>;
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
    const installed = () => setStandalone(true);
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    return () => {
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (standalone) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      setPrompt(null);
      return;
    }
    if (ios) setHelp(true);
    else alert('Abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.');
  };

  return <>
    <button className="install-button" type="button" onClick={install}>↓ Instalar app</button>
    {help && <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && setHelp(false)}>
      <div className="modal">
        <h3>Instalar no iPhone</h3>
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

function PossibleMatches({ suggestions, onSelect }) {
  if (!suggestions?.length) return null;
  return <section className="possible-matches">
    <p className="eyebrow">POSSÍVEIS CORRESPONDÊNCIAS</p>
    <h3>Confira antes de confirmar</h3>
    <p className="possible-note">O sistema não encontrou identidade visual suficiente para confirmar automaticamente. As opções abaixo pertencem à plataforma selecionada e nunca são tratadas como identificação automática.</p>
    <div className="choices">
      {suggestions.flatMap(group => (group.products || []).map(product => (
        <article className="choice-card possible-card" key={`${group.capa_code}-${product.id}`}>
          <ProductImage product={product} alt={product.sku}/>
          <div>
            <h4>{product.sku}</h4>
            <p>Capa: {group.capa_code}</p>
            <p>{product.nome || product.variacao || product.platform}</p>
            <small>
              {group.verification_source === 'catalog-visual-comparison' || group.verification_source === 'gemini-verified'
                ? 'Verificação visual'
                : 'Similaridade do índice'}: {Math.round(Number(group.confidence || 0) * 100)}%
            </small>
          </div>
          <button type="button" onClick={() => onSelect(product)}>É este produto</button>
        </article>
      )))}
    </div>
  </section>;
}

function PublicIdentificationApp() {
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
    />
    <section className="panel">
      <p className="eyebrow">PAINEL GERAL</p>
      <h2>Identificação de produto</h2>
      <p className="lead">Selecione a plataforma e fotografe a capa de frente. A busca visual será feita somente dentro do catálogo dessa plataforma.</p>

      <div className="platform-selector">
        <label htmlFor="recognition-platform">PLATAFORMA</label>
        <select id="recognition-platform" value={platform} onChange={changePlatform} disabled={busy}>
          <option value="">Selecione a plataforma</option>
          {platforms.map(item => <option key={item.platform_key} value={item.platform}>
            {item.platform} ({item.product_count})
          </option>)}
        </select>
        {platform && <small>Busca restrita a {platform}.</small>}
      </div>

      {platformError && <div className="status error"><h3>Plataformas indisponíveis</h3><p>{platformError}</p></div>}

      <label className="camera">
        <span className="camera-label">CAPA DO PRODUTO</span>
        {preview
          ? <><img className="photo-preview" src={preview} alt="Foto da capa"/><span className="photo-ready">Foto pronta</span></>
          : <div className="camera-empty"><span className="camera-icon">◎</span><strong>Fotografar ou enviar capa</strong><span>Use uma imagem frontal, nítida e com boa iluminação.</span></div>}
        <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])}/>
      </label>

      <button className="primary" disabled={!photo || !platform || busy} onClick={() => identifyFile(photo)}>
        {busy ? 'Comparando capa…' : 'Identificar produto'}
      </button>

      {error && <div className="status error">
        <h3>Produto não identificado</h3>
        <p>{error}</p>
        {suggestedPlatform && (
          <div style={{ marginTop: '14px' }}>
            <button
              type="button"
              className="primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                minHeight: '44px',
                padding: '0 16px',
                fontSize: '14px',
                background: '#4f46e5',
                color: '#fff',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '600'
              }}
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
      </div>}
      <PossibleMatches suggestions={suggestions} onSelect={product => {
        setResult(product);
        setChoices(null);
        setSuggestions([]);
        setError('');
      }}/>
      {choices && <ProductChoices
        capaCode={choices.capaCode}
        products={choices.products}
        performance={performance}
        onSelect={product => { setResult(product); setChoices(null); }}
      />}
      {result && <ProductResult product={result} performance={performance}/>} 
    </section>

    <NotificationsModal
      isOpen={notificationsOpen}
      onClose={() => setNotificationsOpen(false)}
      unreadCount={unreadCount}
      setUnreadCount={setUnreadCount}
    />

    <InstallApp />
  </main>;
}

createRoot(document.getElementById('root')).render(<PublicIdentificationApp/>);
