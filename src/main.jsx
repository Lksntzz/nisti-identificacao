import React, { useState, useEffect, useMemo } from 'react';
import './app.css';
import LOGO from './assets/logo.png';
import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';
import SystemHealthView from './system-health-view.jsx';
import ExpeditionDashboard from './admin/ExpeditionDashboard.jsx';
import CatalogView from './admin/CatalogView.jsx';
import GtinRegistryView from './admin/GtinRegistryView.jsx';
import BarcodeGeneratorView from './admin/BarcodeGeneratorView.jsx';
import GtinEventsView from './admin/GtinEventsView.jsx';
import ProductsWithoutGtinView from './admin/ProductsWithoutGtinView.jsx';
import {
  createEan13Svg,
  downloadBarcodePng,
  downloadBarcodeZip
} from './ean-barcode.js';
import { buildEanCollections, collectionZipFilename } from './ean-collections.js';

const PAGE_SIZE = 10;

const WIREO_OPTIONS = [
  ['P', 'Preto'],
  ['B', 'Branco'],
  ['R', 'Rose Gold']
];

const ACCESSORY_OPTIONS = [
  ['P', 'Preto'],
  ['B', 'Branco'],
  ['A', 'Azul'],
  ['R', 'Rosa'],
  ['V', 'Verde'],
  ['L', 'Laranja']
];

const TASSEL_OPTIONS = [
  ['X', 'Sem tassel'],
  ...ACCESSORY_OPTIONS
];

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
}

function formatCurrentDateTime() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now);

  const dayWeek = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long'
  }).format(now);

  const timeStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit'
  }).format(now);

  const capitalizedDay = dayWeek.charAt(0).toUpperCase() + dayWeek.slice(1);
  return { date: dateStr, weekdayTime: `${capitalizedDay}, ${timeStr}` };
}

function formatProductDate(dateVal) {
  if (!dateVal) return { date: '—', time: '' };
  try {
    const d = new Date(dateVal);
    const date = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(d);
    const time = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
    return { date, time };
  } catch {
    return { date: '—', time: '' };
  }
}

async function compressAdminImage(file) {
  if (!file) return null;
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise(resolve => {
    img.onload = resolve;
    img.src = url;
  });
  URL.revokeObjectURL(url);

  let width = img.width;
  let height = img.height;
  const maxSide = 768;
  
  if (width > height && width > maxSide) {
    height = Math.round(height * maxSide / width);
    width = maxSide;
  } else if (height > width && height > maxSide) {
    width = Math.round(width * maxSide / height);
    height = maxSide;
  } else if (width <= maxSide && height <= maxSide) {
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

function catalogRowsFromCsv(text) {
  const parsed = parseCsv(text);
  if (!parsed.length) return [];
  const headers = parsed[0].map(value => String(value || '').trim().toLowerCase());
  const indexOf = (...names) => headers.findIndex(header => names.includes(header));
  const skuIndex = indexOf('sku');
  const gtinIndex = indexOf('ean', 'ean-13', 'gtin', 'gtin-13');
  const hasHeader = skuIndex >= 0;
  const valueAt = (row, index, fallback = '') => String(index >= 0 ? row[index] : fallback || '').trim();

  return (hasHeader ? parsed.slice(1) : parsed).map(row => ({
    nome: hasHeader ? valueAt(row, indexOf('nome', 'produto', 'nome do produto')) : String(row[2] || row[9] || '').trim(),
    variacao: hasHeader ? valueAt(row, indexOf('variacao', 'variação', 'capa')) : String(row[3] || row[13] || '').trim(),
    platform: hasHeader ? valueAt(row, indexOf('plataforma', 'platform')) : String(row[4] || row[11] || '').trim(),
    sku: hasHeader ? valueAt(row, skuIndex) : String(row[5] || row[14] || '').trim(),
    gtin: hasHeader ? valueAt(row, gtinIndex) : String(row[7] || '').replace(/\D/g, '').trim(),
    link: hasHeader ? valueAt(row, indexOf('link', 'url')) : String(row[6] || row[12] || '').trim()
  })).filter(row => row.sku && row.sku.toUpperCase() !== 'SKU');
}

/* =========================================================================
   SIDEBAR COMPONENT
   ========================================================================= */
function AdminSidebar({ activeView, onViewChange, sidebarOpen, onCloseSidebar }) {
  return (
    <>
      {sidebarOpen && <div className="sidebar-mobile-backdrop" onClick={onCloseSidebar} />}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src={LOGO} alt="NISTI ID" className="sidebar-brand-logo" />
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-title">NISTI ID</span>
              <span className="sidebar-brand-subtitle">PAINEL ADM</span>
            </div>
          </div>
        </div>

        <div className="sidebar-highlight-wrap">
          <a
            href="/"
            className="sidebar-highlight-btn"
            target="_blank"
            rel="noreferrer"
            title="Abrir o painel operacional em uma nova aba"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3h7v7" />
              <path d="M10 14 21 3" />
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
            <span>Abrir NISTI ID</span>
          </a>
        </div>

        <nav className="sidebar-nav">
          {ADMIN_MENU_SECTIONS.map(section => (
            <div key={section.title} className="sidebar-section">
              <span className="sidebar-section-title">{section.title}</span>
              <ul className="sidebar-section-list">
                {section.items.map(item => {
                  const isActive = activeView === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          onViewChange(item.id);
                          onCloseSidebar();
                        }}
                      >
                        <SidebarIcon name={item.icon} />
                        <span className="sidebar-item-label">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <a
            href="/admin-logout"
            className="sidebar-logout-btn"
            onClick={e => {
              if (window.location.hash) {
                e.preventDefault();
                document.cookie = 'nisti_admin_session=; Path=/; Max-Age=0; SameSite=Strict';
                window.location.hash = '';
                window.location.pathname = '/';
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Encerrar Sessão</span>
          </a>
        </div>
      </aside>
    </>
  );
}

function SidebarIcon({ name }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  switch (name) {
    case 'grid':
      return <svg {...props}><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>;
    case 'alert':
      return <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'history':
      return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    case 'terminal':
      return <svg {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    case 'barcode':
      return <svg {...props}><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" /><path d="M8 5v14M15 5v14M19 5v14" strokeWidth="1" /></svg>;
    default:
      return null;
  }
}

/* =========================================================================
   TOPBAR COMPONENT
   ========================================================================= */
function AdminTopbar({ onToggleSidebar, unreadCount }) {
  return (
    <header className="admin-topbar-header">
      <div className="topbar-left">
        <button
          type="button"
          className="hamburger-btn"
          onClick={onToggleSidebar}
          aria-label="Alternar menu lateral"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="admin-page-title">Painel Administrativo</h1>
      </div>

      <div className="topbar-right">
        <a
          href="#scanner"
          onClick={e => {
            e.preventDefault();
            window.location.hash = '';
            window.location.pathname = '/';
          }}
          className="topbar-logout-btn"
          style={{ background: '#f1f5f9', color: '#1e293b', border: '1px solid #cbd5e1' }}
          title="Voltar ao Scanner de Expedição"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          <span>Scanner</span>
        </a>

        <a href="/" className="topbar-bell-btn" title="Notificações">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount}</span>}
        </a>

        <a
          href="/admin-logout"
          className="topbar-logout-btn"
          onClick={e => {
            if (window.location.hash) {
              e.preventDefault();
              document.cookie = 'nisti_admin_session=; Path=/; Max-Age=0; SameSite=Strict';
              window.location.hash = '';
              window.location.pathname = '/';
            }
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Sair</span>
        </a>
      </div>
    </header>
  );
}

/* =========================================================================
   WELCOME & LIVE DATE BANNER
   ========================================================================= */
function WelcomeDateBanner() {
  const [nowData, setNowData] = useState(formatCurrentDateTime());

  useEffect(() => {
    const timer = setInterval(() => setNowData(formatCurrentDateTime()), 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="welcome-banner">
      <div className="welcome-copy">
        <h2>Bem-vindo, Administrador</h2>
        <p>Gerencie o catálogo de produtos e acompanhe as identificações da expedição.</p>
      </div>

      <div className="live-date-card">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <div className="live-date-info">
          <strong>{nowData.date}</strong>
          <small>{nowData.weekdayTime}</small>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   PLATFORM BADGE
   ========================================================================= */
function PlatformTag({ platform }) {
  const p = String(platform || '').toUpperCase();
  let className = 'platform-pill-default';
  let label = platform || 'Geral';

  if (p.includes('MERCADO') || p.includes('ML')) {
    className = 'platform-pill-ml';
    label = 'Mercado Livre';
  } else if (p.includes('SHOPEE')) {
    className = 'platform-pill-shopee';
    label = 'Shopee';
  } else if (p.includes('AMAZON')) {
    className = 'platform-pill-amazon';
    label = 'Amazon';
  } else if (p.includes('MAGALU')) {
    className = 'platform-pill-magalu';
    label = 'Magalu';
  }

  return <span className={`platform-pill ${className}`}>{label}</span>;
}

/* =========================================================================
   REGISTRATION & MODAL HELPERS
   ========================================================================= */
function RegistrationBarcodeResult({ items, errors = [], onReset, onClose, title = 'Produtos cadastrados' }) {
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const barcodeItems = items.filter(item => /^\d{13}$/.test(String(item.gtin || '')));

  const downloadAll = async () => {
    setDownloadBusy(true);
    setDownloadError('');
    try {
      await downloadBarcodeZip(barcodeItems, '', 'etiquetas-produtos-cadastrados.zip');
    } catch (error) {
      setDownloadError(error?.message || 'Não foi possível gerar o pacote de etiquetas.');
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="registration-result">
      <div className="registration-result-hero">
        <span className="registration-result-check">✓</span>
        <div><h4>{title}</h4><p>{barcodeItems.length} etiqueta{barcodeItems.length === 1 ? '' : 's'} pronta{barcodeItems.length === 1 ? '' : 's'} para baixar.</p></div>
      </div>

      {barcodeItems.length > 0 && <div className="registration-barcode-list">
        {barcodeItems.map(item => (
          <article className="registration-barcode-card" key={`${item.id || item.sku}-${item.gtin}`}>
            <div className="registration-barcode-preview" dangerouslySetInnerHTML={{ __html: createEan13Svg(item) }} />
            <div className="registration-barcode-info">
              <strong>{item.nome || item.sku}</strong>
              <span>{item.variacao || item.sku}</span>
              <code>{item.gtin}</code>
            </div>
            <button type="button" onClick={() => downloadBarcodePng(item).catch(error => setDownloadError(error.message))}>Baixar PNG</button>
          </article>
        ))}
      </div>}

      {errors.length > 0 && <div className="registration-result-errors">
        <strong>{errors.length} item{errors.length === 1 ? '' : 's'} precisa{errors.length === 1 ? '' : 'm'} de atenção</strong>
        {errors.map((item, index) => <p key={`${item.sku || 'item'}-${index}`}><b>{item.sku || `Linha ${item.row || index + 1}`}:</b> {item.error}</p>)}
      </div>}
      {downloadError && <div className="form-error-banner">{downloadError}</div>}

      <div className="registration-result-actions">
        <button type="button" className="btn-cancel" onClick={onReset}>Cadastrar outros produtos</button>
        {barcodeItems.length > 1 && <button type="button" className="btn-download-labels" disabled={downloadBusy} onClick={downloadAll}>{downloadBusy ? 'Gerando ZIP…' : 'Baixar todas em ZIP'}</button>}
        <button type="button" className="btn-submit-rainbow" onClick={onClose}>Concluir</button>
      </div>
    </div>
  );
}

function CreateProductModal({ isOpen, onClose, onCreated }) {
  const [nome, setNome] = useState('');
  const [platform, setPlatform] = useState('MERCADO LIVRE');
  const [link, setLink] = useState('');
  const [variants, setVariants] = useState([
    { id: 1, sku: '', gtin: '', variacao: '', file: null, preview: '' }
  ]);
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const resetForm = () => {
    setNome('');
    setPlatform('MERCADO LIVRE');
    setLink('');
    setVariants([{ id: Date.now(), sku: '', gtin: '', variacao: '', file: null, preview: '' }]);
    setProgressMsg('');
    setError('');
    setResult(null);
  };

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  if (!isOpen) return null;

  const addVariant = () => {
    setVariants(prev => [
      ...prev,
      { id: Date.now(), sku: '', gtin: '', variacao: '', file: null, preview: '' }
    ]);
  };

  const removeVariant = (id) => {
    if (variants.length <= 1) return;
    setVariants(prev => prev.filter(v => v.id !== id));
  };

  const updateVariant = (id, field, value) => {
    setVariants(prev => prev.map(v => {
      if (v.id !== id) return v;
      if (field === 'file') {
        const file = value;
        const preview = file ? URL.createObjectURL(file) : '';
        return { ...v, file, preview };
      }
      return { ...v, [field]: value };
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setProgressMsg('');

    try {
      const failures = [];
      const registered = [];

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const cleanSku = v.sku.trim().toUpperCase();
        if (!cleanSku) continue;
        const cleanGtin = v.gtin.replace(/\D/g, '');
        if (cleanGtin.length !== 13) {
          failures.push({ sku: cleanSku, error: 'Código EAN-13 inválido (deve ter 13 dígitos).' });
          continue;
        }

        setProgressMsg(`Salvando variação ${i + 1} de ${variants.length} (${cleanSku})…`);

        try {
          const res = await api('/api/products', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sku: cleanSku,
              gtin: cleanGtin,
              nome: nome.trim(),
              variacao: v.variacao.trim() || cleanSku,
              platform: platform.trim().toUpperCase(),
              link: link.trim()
            })
          });

          const productId = Number(res.id);
          if (!Number.isSafeInteger(productId) || productId <= 0) {
            throw new Error('O cadastro não retornou o ID do produto. Atualize a lista antes de tentar novamente.');
          }

          registered.push({
            id: productId,
            sku: cleanSku,
            gtin: cleanGtin,
            nome: nome.trim(),
            variacao: v.variacao.trim() || cleanSku,
            platform: platform.trim().toUpperCase()
          });

          if (v.file) {
            try {
              const compressed = await compressAdminImage(v.file);
              const fd = new FormData();
              fd.append('image', compressed || v.file);
              await api(`/api/products/${productId}/image`, {
                method: 'POST',
                body: fd
              });
            } catch (imageError) {
              failures.push({ sku: cleanSku, error: `Produto cadastrado, mas a imagem não foi salva: ${imageError.message || 'falha no envio'}. Abra o produto para reenviar a imagem.` });
            }
          }
        } catch (err) {
          failures.push({ sku: cleanSku, error: err.message || 'Falha ao salvar produto.' });
        }
      }

      await onCreated();

      if (registered.length > 0) {
        setResult({ items: registered, errors: failures });
      } else if (failures.length > 0) {
        setError(`Falha ao cadastrar: ${failures.map(f => `${f.sku}: ${f.error}`).join('; ')}`);
      }
    } catch (err) {
      setError(err.message || 'Falha ao criar produto.');
    } finally {
      setBusy(false);
      setProgressMsg('');
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal create-modal" style={{ maxWidth: '820px' }}>
        <div className="admin-modal-head">
          <div>
            <h3>Cadastrar Novo Produto com Variações</h3>
            <small>Defina o produto pai e adicione todas as capas/variantes de uma vez.</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        {result ? (
          <RegistrationBarcodeResult
            items={result.items}
            errors={result.errors}
            onReset={resetForm}
            onClose={onClose}
          />
        ) : (
          <form onSubmit={handleSubmit} className="admin-modal-form">
            <div className="form-row-2">
              <div className="form-group">
                <label>Nome do Produto Pai *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Agenda 2026 Personalizada"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Plataforma Padrão</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="MERCADO LIVRE">Mercado Livre</option>
                  <option value="SHOPEE">Shopee</option>
                  <option value="AMAZON">Amazon</option>
                  <option value="MAGALU">Magalu</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Link do Anúncio (Opcional)</label>
              <input
                type="url"
                placeholder="https://produto.mercadolivre.com.br/..."
                value={link}
                onChange={e => setLink(e.target.value)}
              />
            </div>

            <div className="variants-section-header">
              <div className="variants-header-title">
                <h4>Capas / Variações</h4>
                <span className="variants-count-badge">{variants.length}</span>
              </div>
              <button type="button" className="btn-add-variant" onClick={addVariant}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Adicionar Outra Capa</span>
              </button>
            </div>

            <div className="variants-card-list">
              {variants.map((v, index) => (
                <div key={v.id} className="variant-entry-box">
                  <div className="variant-entry-head">
                    <span className="variant-badge">Capa #{index + 1}</span>
                    {variants.length > 1 && (
                      <button type="button" className="btn-remove-variant" onClick={() => removeVariant(v.id)}>
                        Remover
                      </button>
                    )}
                  </div>

                  <div className="form-row-3">
                    <div className="form-group">
                      <label>SKU * (Ex: VACMNO_PQV{index + 1}_BBB)</label>
                      <input
                        type="text"
                        required
                        placeholder="SKU da variação"
                        value={v.sku}
                        onChange={e => updateVariant(v.id, 'sku', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>EAN-13 *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength="13"
                        placeholder="7890000000000"
                        value={v.gtin}
                        onChange={e => updateVariant(v.id, 'gtin', e.target.value.replace(/\D/g, '').slice(0, 13))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Nome da Variação / Capa (Ex: CAPA {index + 1})</label>
                      <input
                        type="text"
                        placeholder={`Ex: CAPA ${index + 1}`}
                        value={v.variacao}
                        onChange={e => updateVariant(v.id, 'variacao', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Mockup da Variante</label>
                    <div className="photo-upload-dropzone" style={{ height: '110px', padding: '10px' }}>
                      {v.preview ? (
                        <div className="photo-upload-preview" style={{ height: '90px' }}>
                          <img src={v.preview} alt="Prévia" style={{ height: '80px', width: '80px' }} />
                          <label className="photo-change-btn" style={{ fontSize: '11px', padding: '4px 8px' }}>
                            Trocar foto
                            <input type="file" accept="image/*" onChange={e => updateVariant(v.id, 'file', e.target.files?.[0])} />
                          </label>
                        </div>
                      ) : (
                        <label className="photo-empty-drop" style={{ padding: '10px' }}>
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                            <circle cx="9" cy="9" r="2" />
                            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                          </svg>
                          <strong style={{ fontSize: '11px' }}>Selecionar mockup</strong>
                          <input type="file" accept="image/*" onChange={e => updateVariant(v.id, 'file', e.target.files?.[0])} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="form-error-banner" style={{ marginTop: '16px' }}>{error}</div>}

            <div className="admin-modal-foot" style={{ marginTop: '20px' }}>
              <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>Cancelar</button>
              <button type="submit" className="btn-submit-rainbow" disabled={busy} style={{ minWidth: '180px' }}>
                {busy ? (progressMsg || 'Cadastrando variações…') : `Salvar ${variants.length} produto(s)`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ProductGtinManager({ productId }) {
  const [gtins, setGtins] = useState([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await api(`/api/products/${productId}/gtins`);
      setGtins((data.gtins || []).filter(item => item.active));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os códigos EAN.');
    }
  };

  useEffect(() => { load(); }, [productId]);

  const add = async () => {
    const gtin = value.replace(/\D/g, '');
    if (gtin.length !== 13) {
      setError('Informe um EAN-13 válido com 13 dígitos.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/products/${productId}/gtins`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gtin, source: 'NISTI' })
      });
      setValue('');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível vincular o EAN.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async gtin => {
    if (!confirm(`Desvincular o EAN ${gtin} deste produto?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/products/${productId}/gtins/${encodeURIComponent(gtin)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível desvincular o EAN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="product-gtin-manager">
      <div className="product-gtin-heading">
        <div>
          <strong>Códigos EAN vinculados</strong>
          <small>O scanner usa estes códigos para localizar o produto diretamente.</small>
        </div>
        <span>{gtins.length} ativo{gtins.length === 1 ? '' : 's'}</span>
      </div>
      <div className="product-gtin-add">
        <input
          type="text"
          inputMode="numeric"
          maxLength="13"
          placeholder="Digite os 13 números do EAN"
          value={value}
          onChange={event => setValue(event.target.value.replace(/\D/g, '').slice(0, 13))}
        />
        <button type="button" onClick={add} disabled={busy || value.length !== 13}>Vincular</button>
      </div>
      {gtins.length > 0 ? (
        <div className="product-gtin-list">
          {gtins.map(item => (
            <div key={item.id} className="product-gtin-row">
              <span>▥</span>
              <strong>{item.gtin}</strong>
              <small>{item.source || 'NISTI'}</small>
              <button type="button" onClick={() => remove(item.gtin)} disabled={busy}>Remover</button>
            </div>
          ))}
        </div>
      ) : <p className="product-gtin-empty">Nenhum EAN cadastrado para este produto.</p>}
      {error && <div className="form-error-banner">{error}</div>}
    </section>
  );
}

function EditProductModal({ product, isOpen, onClose, onUpdated }) {
  const [sku, setSku] = useState('');
  const [nome, setNome] = useState('');
  const [variacao, setVariacao] = useState('');
  const [platform, setPlatform] = useState('MERCADO LIVRE');
  const [link, setLink] = useState('');
  const [wireo, setWireo] = useState('B');
  const [tassel, setTassel] = useState('X');
  const [elastico, setElastico] = useState('B');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (product) {
      setSku(product.sku || '');
      setNome(product.nome || '');
      setVariacao(product.variacao || '');
      setPlatform(product.platform || 'MERCADO LIVRE');
      setLink(product.link || '');
      setWireo(product.wireo_code || 'B');
      setTassel(product.tassel_code || 'X');
      setElastico(product.elastico_code || 'B');
      setFile(null);
      setPreview('');
      setError('');
    }
  }, [product, isOpen]);

  if (!isOpen || !product) return null;

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await api(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sku: sku.trim().toUpperCase(),
          nome: nome.trim(),
          variacao: variacao.trim(),
          platform: platform.trim().toUpperCase(),
          link: link.trim(),
          wireo_code: wireo,
          tassel_code: tassel,
          elastico_code: elastico
        })
      });

      if (file) {
        const compressed = await compressAdminImage(file);
        const fd = new FormData();
        fd.append('image', compressed || file);
        await api(`/api/products/${product.id}/image`, {
          method: 'POST',
          body: fd
        });
      }

      await onUpdated();
      onClose();
    } catch (err) {
      setError(err.message || 'Falha ao salvar produto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Editar Produto</h3>
            <small>ID: #{product.id} · Capa: {product.capa_code || '—'}</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="admin-modal-form">
          <div className="form-row-2">
            <div className="form-group">
              <label>SKU *</label>
              <input
                type="text"
                required
                value={sku}
                onChange={e => setSku(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Plataforma</label>
              <select value={platform} onChange={e => setPlatform(e.target.value)}>
                <option value="MERCADO LIVRE">Mercado Livre</option>
                <option value="SHOPEE">Shopee</option>
                <option value="AMAZON">Amazon</option>
                <option value="MAGALU">Magalu</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Nome do Produto</label>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label>Variação</label>
              <input
                type="text"
                value={variacao}
                onChange={e => setVariacao(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Link do Anúncio</label>
              <input
                type="url"
                value={link}
                onChange={e => setLink(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row-3">
            <div className="form-group">
              <label>Wire-O</label>
              <select value={wireo} onChange={e => setWireo(e.target.value)}>
                {WIREO_OPTIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Tassel</label>
              <select value={tassel} onChange={e => setTassel(e.target.value)}>
                {TASSEL_OPTIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Elástico</label>
              <select value={elastico} onChange={e => setElastico(e.target.value)}>
                {ACCESSORY_OPTIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Mockup / Capa</label>
            <div className="photo-upload-dropzone">
              {preview || product.image_url ? (
                <div className="photo-upload-preview">
                  <img src={preview || productImage(product)} alt="Prévia" />
                  <label className="photo-change-btn">
                    Trocar foto
                    <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                  </label>
                </div>
              ) : (
                <label className="photo-empty-drop">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#6366f1" strokeWidth="2">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                  </svg>
                  <strong>Selecione uma imagem</strong>
                  <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
              )}
            </div>
          </div>

          <ProductGtinManager productId={product.id} />

          {error && <div className="form-error-banner">{error}</div>}

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="btn-submit-rainbow" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewProductModal({ product, isOpen, onClose, onEdit }) {
  if (!isOpen || !product) return null;

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal view-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Detalhes do Produto</h3>
            <small>{product.sku}</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="view-modal-body">
          <div className="view-modal-image-col">
            {product.image_url ? (
              <img src={productImage(product)} alt={product.sku} className="view-large-thumb" />
            ) : (
              <div className="view-placeholder-box">Sem mockup cadastrado</div>
            )}
          </div>

          <div className="view-modal-info-col">
            <div className="view-badge-row">
              <span className="capa-code-pill-lg">{product.capa_code}</span>
              <PlatformTag platform={product.platform} />
              <span className="status-pill active">• Ativo</span>
            </div>

            <h4 className="view-prod-title">{product.nome || 'Produto sem título'}</h4>
            {product.variacao && <p className="view-prod-variation"><strong>Variação:</strong> {product.variacao}</p>}

            <div className="view-spec-grid">
              <div className="view-spec-item">
                <span>Miolo</span>
                <strong>{product.miolo_code || '—'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Acabamento</span>
                <strong>{product.acabamento_code || '—'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Wire-O</span>
                <strong>{WIREO_OPTIONS.find(([v]) => v === product.wireo_code)?.[1] || product.wireo_code || 'Branco'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Tassel</span>
                <strong>{TASSEL_OPTIONS.find(([v]) => v === product.tassel_code)?.[1] || product.tassel_code || 'Sem'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Elástico</span>
                <strong>{ACCESSORY_OPTIONS.find(([v]) => v === product.elastico_code)?.[1] || product.elastico_code || 'Branco'}</strong>
              </div>
            </div>

            {product.link && (
              <a href={product.link} target="_blank" rel="noopener noreferrer" className="view-link-btn">
                Abrir Anúncio na Plataforma ↗
              </a>
            )}
          </div>
        </div>

        <div className="admin-modal-foot">
          <button type="button" className="btn-cancel" onClick={onClose}>Fechar</button>
          <button type="button" className="btn-edit-action" onClick={() => { onClose(); onEdit(product); }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: '6px' }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span>Editar Produto</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportCsvModal({ isOpen, onClose, onImported }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setMessage('');
      setError('');
      setResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    setMessage('');
    setError('');

    try {
      const rows = catalogRowsFromCsv(await file.text());
      if (!rows.length) throw new Error('Nenhum SKU válido encontrado na planilha.');

      let created = 0;
      let updated = 0;
      const importedItems = [];
      const importErrors = [];
      const rowsBySku = new Map(rows.map(row => [String(row.sku || '').trim().toUpperCase(), row]));

      for (let i = 0; i < rows.length; i += 50) {
        const data = await api('/api/admin/bulk-products', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: rows.slice(i, i + 50) })
        });
        created += data.created || 0;
        updated += data.updated || 0;
        for (const item of data.imported || []) {
          const source = rowsBySku.get(String(item.sku || '').trim().toUpperCase()) || {};
          importedItems.push({ ...source, ...item, gtin: item.gtin || source.gtin, nome: source.nome, variacao: source.variacao });
        }
        importErrors.push(...(data.errors || []));
      }

      setMessage(`Importação concluída: ${created} novos produtos cadastrados, ${updated} atualizados.`);
      for (const item of importedItems) {
        if (!/^\d{13}$/.test(String(item.gtin || ''))) {
          importErrors.push({ sku: item.sku, error: 'Produto salvo sem EAN válido; nenhuma etiqueta foi gerada.' });
        }
      }
      setResult({ items: importedItems, errors: importErrors, created, updated });
      await onImported();
    } catch (err) {
      setError(err.message || 'Falha ao importar arquivo CSV.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Importar Produtos em Lote (CSV)</h3>
            <small>Envie uma planilha com seus produtos para atualização rápida.</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        {result ? <RegistrationBarcodeResult
          items={result.items}
          errors={result.errors}
          title={`Importação concluída: ${result.created} novos e ${result.updated} atualizados`}
          onReset={() => { setResult(null); setMessage(''); setError(''); }}
          onClose={onClose}
        /> : <div className="admin-modal-form">
          <label className="photo-empty-drop" style={{ minHeight: '180px' }}>
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
            <strong>{busy ? 'Processando planilha…' : 'Clique para selecionar a planilha CSV'}</strong>
            <span>Use as colunas SKU, EAN, Nome, Variação, Plataforma e Link</span>
            <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => handleUpload(e.target.files?.[0])} />
          </label>

          {message && <div className="form-success-banner">{message}</div>}
          {error && <div className="form-error-banner">{error}</div>}

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose}>Fechar</button>
          </div>
        </div>}
      </div>
    </div>
  );
}

/* =========================================================================
   MAIN ADMIN APP ROOT
   ========================================================================= */
function AdminApp() {
  const [activeView, setActiveView] = useState('catalogo');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [storage, setStorage] = useState(null);
  const [gtinDashboard, setGtinDashboard] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [viewProduct, setViewProduct] = useState(null);
  const [editProduct, setEditProduct] = useState(null);

  const refreshProducts = async () => {
    try {
      const p = await api('/api/products');
      setProducts(p.products || []);
    } catch (err) {
      if (/não autorizado|401|403/i.test(err.message)) {
        window.location.href = '/admin-login';
      }
    }
  };

  const refreshMetrics = async () => {
    try {
      const [m, s, unread, gtin] = await Promise.all([
        api('/api/admin/system-metrics').catch(() => null),
        api('/api/admin/storage-metrics').catch(() => null),
        api('/api/notifications/unread-count').catch(() => ({ unread_count: 0 })),
        api('/api/admin/gtin-dashboard').catch(() => null)
      ]);
      if (m) setMetrics(m);
      if (s) setStorage(s);
      if (gtin) setGtinDashboard(gtin);
      if (unread?.unread_count !== undefined) setUnreadCount(unread.unread_count);
    } catch {}
  };

  const refreshAll = async () => {
    await Promise.all([refreshProducts(), refreshMetrics()]);
  };

  useEffect(() => {
    refreshAll().finally(() => setLoading(false));
    const interval = setInterval(refreshMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteProduct = async (id, sku) => {
    if (!window.confirm(`Tem certeza que deseja excluir o produto ${sku}?`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      await refreshAll();
    } catch (err) {
      alert(err.message || 'Falha ao excluir produto.');
    }
  };

  const handleNavChange = viewId => {
    if (viewId === 'commerce') {
      window.location.href = '/admin-commerce';
      return;
    }
    setActiveView(viewId);
  };
  const productsWithoutGtin = gtinDashboard?.products_without_gtin || [];

  const showProductsWithoutGtin = () => {
    if (productsWithoutGtin.length === 1) {
      setViewProduct(productsWithoutGtin[0]);
      return;
    }
    if (productsWithoutGtin.length > 1) setActiveView('produtos-sem-ean');
  };

  if (loading) {
    return (
      <div className="admin-loading-screen">
        <div className="admin-loading-spinner" />
        <span>Carregando NISTI ID…</span>
      </div>
    );
  }

  return (
    <div className="admin-layout-root">
      <AdminSidebar
        activeView={activeView}
        onViewChange={handleNavChange}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

      <div className="admin-main-wrapper">
        <AdminTopbar
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          unreadCount={unreadCount}
        />

        <main className="admin-page-content">
          <WelcomeDateBanner />

          {/* Dashboard de Produtividade da Expedição & KPIs */}
          <ExpeditionDashboard
            gtinDashboard={gtinDashboard}
            productsCount={products.length}
            onNavigate={handleNavChange}
            onShowProductsWithoutGtin={showProductsWithoutGtin}
          />

          {activeView === 'catalogo' && (
            <CatalogView
              products={products}
              onRefresh={refreshAll}
              onOpenCreate={() => setCreateModalOpen(true)}
              onOpenImport={() => setImportModalOpen(true)}
              onViewProduct={p => setViewProduct(p)}
              onEditProduct={p => setEditProduct(p)}
              onDeleteProduct={handleDeleteProduct}
            />
          )}

          {activeView === 'gtins' && <GtinRegistryView />}

          {activeView === 'gerador-barras' && <BarcodeGeneratorView api={api} />}

          {activeView === 'historico-ean' && (
            <GtinEventsView
              api={api}
              products={products}
              onLinkSuccess={refreshAll}
            />
          )}

          {activeView === 'ean-nao-cadastrados' && (
            <GtinEventsView
              initialStatus="not_found"
              api={api}
              products={products}
              onLinkSuccess={refreshAll}
            />
          )}

          {activeView === 'produtos-sem-ean' && (
            <ProductsWithoutGtinView
              products={productsWithoutGtin}
              onSelect={product => setViewProduct(product)}
              onBack={() => setActiveView('catalogo')}
            />
          )}

          {activeView === 'logs' && (
            <SystemHealthView
              metrics={metrics}
              storage={storage}
              onRefresh={refreshAll}
            />
          )}
        </main>

        <footer className="admin-global-footer">
          <p>© {new Date().getFullYear()} NISTI ID · Sistema de Identificação por EAN. Todos os direitos reservados.</p>
        </footer>
      </div>

      <CreateProductModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={refreshAll}
      />

      <ImportCsvModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={refreshAll}
      />

      <ViewProductModal
        product={viewProduct}
        isOpen={Boolean(viewProduct)}
        onClose={() => setViewProduct(null)}
        onEdit={p => setEditProduct(p)}
      />

      <EditProductModal
        product={editProduct}
        isOpen={Boolean(editProduct)}
        onClose={() => setEditProduct(null)}
        onUpdated={refreshAll}
      />
    </div>
  );
}

export {
  CatalogView,
  GtinRegistryView,
  BarcodeGeneratorView,
  GtinEventsView,
  ProductGtinManager,
  RegistrationBarcodeResult
};

export default AdminApp;
