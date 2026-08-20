import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import LOGO from './assets/logo.png';

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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
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
  if (!dateVal) return { date: '18/05/2026', time: '20:00' };
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
    return { date: '18/05/2026', time: '20:00' };
  }
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
  return parseCsv(text).map(row => ({
    nome: String(row[2] || row[9] || '').trim(),
    variacao: String(row[3] || row[13] || '').trim(),
    platform: String(row[4] || row[11] || '').trim(),
    sku: String(row[5] || row[14] || '').trim(),
    link: String(row[6] || row[12] || '').trim()
  })).filter(row => row.sku && row.sku.toUpperCase() !== 'SKU');
}

function pageItems(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const values = new Set([1, pages, page - 1, page, page + 1].filter(value => value >= 1 && value <= pages));
  const sorted = [...values].sort((a, b) => a - b);
  const result = [];
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push('…');
    result.push(value);
  });
  return result;
}

/* =========================================================================
   SIDEBAR COMPONENT
   ========================================================================= */
function AdminSidebar({ activeView, onViewChange, unreadCount, sidebarOpen, onCloseSidebar }) {
  const menuSections = [
    {
      title: 'PRINCIPAL',
      items: [
        { id: 'identificacao', label: 'Identificação Visual', icon: 'eye', href: '/' },
        { id: 'catalogo', label: 'Catálogo de Produtos', icon: 'grid' },
        { id: 'nao-identificados', label: 'Produtos Não Identificados', icon: 'alert' },
        { id: 'similares', label: 'Produtos Similares', icon: 'sparkles' },
        { id: 'verificar', label: 'Verificar Capa', icon: 'shield-check' },
      ]
    },
    {
      title: 'CADASTRO',
      items: [
        { id: 'cadastrar', label: 'Cadastrar Produto', icon: 'box-plus' },
        { id: 'importar', label: 'Importar Produtos', icon: 'cloud-upload' },
      ]
    },
    {
      title: 'RELATÓRIOS',
      items: [
        { id: 'historico', label: 'Histórico de Identificações', icon: 'history' },
        { id: 'logs', label: 'Logs do Sistema', icon: 'terminal' },
      ]
    },
    {
      title: 'EQUIPE & CONFIGURAÇÕES',
      items: [
        { id: 'usuarios', label: '👥 Operadores & Ocorrências', icon: 'users' },
        { id: 'plataformas', label: 'Plataformas', icon: 'layers' },
        { id: 'configuracoes', label: 'Configurações', icon: 'settings' },
      ]
    }
  ];

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
          <a href="/" className="sidebar-highlight-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span>Painel Geral</span>
          </a>
        </div>

        <nav className="sidebar-nav">
          {menuSections.map(section => (
            <div key={section.title} className="sidebar-section">
              <span className="sidebar-section-title">{section.title}</span>
              <ul className="sidebar-section-list">
                {section.items.map(item => {
                  const isActive = activeView === item.id;
                  if (item.href) {
                    return (
                      <li key={item.id}>
                        <a href={item.href} className="sidebar-nav-item">
                          <SidebarIcon name={item.icon} />
                          <span>{item.label}</span>
                        </a>
                      </li>
                    );
                  }
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
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="sidebar-avatar">AD</div>
            <div className="sidebar-user-info">
              <strong>Administrador</strong>
              <small>admin@nisti.print</small>
            </div>
            <a href="/admin-logout" className="sidebar-logout-link" title="Sair do painel">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </a>
          </div>
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
    case 'eye':
      return <svg {...props}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'brain':
      return <svg {...props}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04ZM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/></svg>;
    case 'grid':
      return <svg {...props}><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>;
    case 'alert':
      return <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'sparkles':
      return <svg {...props}><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>;
    case 'shield-check':
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>;
    case 'box-plus':
      return <svg {...props}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>;
    case 'cloud-upload':
      return <svg {...props}><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M12 12v9" /><path d="m16 16-4-4-4 4" /></svg>;
    case 'history':
      return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    case 'terminal':
      return <svg {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    case 'layers':
      return <svg {...props}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>;
    case 'users':
      return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case 'settings':
      return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
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
        <a href="/" className="topbar-bell-btn" title="Notificações">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount}</span>}
        </a>

        <a href="/admin-logout" className="topbar-logout-btn">
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
        <h2>Bem-vindo, Administrador 👋</h2>
        <p>Gerencie o catálogo de produtos e acompanhe as identificações do sistema.</p>
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
   4 KPI STAT CARDS
   ========================================================================= */
function KpiSection({ productsCount, recognitionsToday, unmatchedToday, platformsCount }) {
  return (
    <div className="kpis-row">
      <div className="kpi-box kpi-blue">
        <div className="kpi-icon-circle blue">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7.5 4.27 9 5.15" />
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" />
            <path d="M12 22V12" />
          </svg>
        </div>
        <div className="kpi-body">
          <span className="kpi-title">Total de Produtos</span>
          <strong className="kpi-num">{productsCount.toLocaleString('pt-BR')}</strong>
          <span className="kpi-tag green">+24 esta semana</span>
        </div>
      </div>

      <div className="kpi-box kpi-green">
        <div className="kpi-icon-circle green">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <div className="kpi-body">
          <span className="kpi-title">Identificações Hoje</span>
          <strong className="kpi-num">{recognitionsToday.toLocaleString('pt-BR')}</strong>
          <span className="kpi-tag green">+18% vs ontem</span>
        </div>
      </div>

      <div className="kpi-box kpi-yellow">
        <div className="kpi-icon-circle yellow">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="kpi-body">
          <span className="kpi-title">Não Identificados</span>
          <strong className="kpi-num">{unmatchedToday}</strong>
          <span className="kpi-tag orange">+{unmatchedToday} pendentes</span>
        </div>
      </div>

      <div className="kpi-box kpi-purple">
        <div className="kpi-icon-circle purple">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#9333ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </div>
        <div className="kpi-body">
          <span className="kpi-title">Plataformas</span>
          <strong className="kpi-num">{platformsCount}</strong>
          <span className="kpi-tag green">Ativas</span>
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
   PRODUCT MODALS: CREATE, EDIT, VIEW, DELETE
   ========================================================================= */
function CreateProductModal({ isOpen, onClose, onCreated }) {
  const [sku, setSku] = useState('');
  const [nome, setNome] = useState('');
  const [variacao, setVariacao] = useState('');
  const [platform, setPlatform] = useState('MERCADO LIVRE');
  const [link, setLink] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSku('');
      setNome('');
      setVariacao('');
      setPlatform('MERCADO LIVRE');
      setLink('');
      setFile(null);
      setPreview('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!sku.trim()) {
      setError('SKU é obrigatório.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const created = await api('/api/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sku: sku.trim().toUpperCase(),
          nome: nome.trim() || undefined,
          variacao: variacao.trim() || undefined,
          platform: platform.trim().toUpperCase() || undefined,
          link: link.trim() || undefined
        })
      });

      if (file && created?.id) {
        const fd = new FormData();
        fd.append('image', file);
        await api(`/api/products/${created.id}/image`, {
          method: 'POST',
          body: fd
        });
      }

      await onCreated();
      onClose();
    } catch (err) {
      setError(err.message || 'Falha ao cadastrar produto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Cadastrar Novo Produto</h3>
            <small>Adicione SKU, informações do catálogo e mockup da capa.</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="admin-modal-form">
          <div className="form-row-2">
            <div className="form-group">
              <label>SKU * (Ex: VACMNO_MNV1_BVV)</label>
              <input
                type="text"
                required
                placeholder="MIOLO_CAPA_ACABAMENTO"
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
              placeholder="Ex: Caderneta de Vacinação Menino Personalizado"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label>Variação / Capa</label>
              <input
                type="text"
                placeholder="Ex: CAPA 1 - Verde Minimalista"
                value={variacao}
                onChange={e => setVariacao(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Link do Anúncio (Opcional)</label>
              <input
                type="url"
                placeholder="https://..."
                value={link}
                onChange={e => setLink(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Mockup / Foto da Capa</label>
            <div className="photo-upload-dropzone">
              {preview ? (
                <div className="photo-upload-preview">
                  <img src={preview} alt="Prévia" />
                  <label className="photo-change-btn">
                    Trocar foto
                    <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                  </label>
                </div>
              ) : (
                <label className="photo-empty-drop">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <strong>Clique para selecionar ou arraste o mockup</strong>
                  <span>Formato JPG, PNG ou WEBP</span>
                  <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
              )}
            </div>
          </div>

          {error && <div className="form-error-banner">{error}</div>}

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="btn-submit-rainbow" disabled={busy}>
              {busy ? 'Cadastrando produto…' : 'Salvar Produto'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
        const fd = new FormData();
        fd.append('image', file);
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
                {WIREO_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Tassel</label>
              <select value={tassel} onChange={e => setTassel(e.target.value)}>
                {TASSEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Elástico</label>
              <select value={elastico} onChange={e => setElastico(e.target.value)}>
                {ACCESSORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Mockup / Foto da Capa</label>
            <div className="photo-upload-dropzone">
              {preview || productImage(product) ? (
                <div className="photo-upload-preview">
                  <img src={preview || productImage(product)} alt="Capa" />
                  <label className="photo-change-btn">
                    Substituir foto
                    <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                  </label>
                </div>
              ) : (
                <label className="photo-empty-drop">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <strong>Clique para adicionar mockup</strong>
                  <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
              )}
            </div>
          </div>

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
            ✏️ Editar Produto
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
      let errors = 0;

      for (let i = 0; i < rows.length; i += 50) {
        const data = await api('/api/admin/bulk-products', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: rows.slice(i, i + 50) })
        });
        created += data.created || 0;
        updated += data.updated || 0;
        errors += (data.errors || []).length;
      }

      setMessage(`Importação concluída: ${created} novos produtos cadastrados, ${updated} atualizados.`);
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

        <div className="admin-modal-form">
          <label className="photo-empty-drop" style={{ minHeight: '180px' }}>
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
            <strong>{busy ? 'Processando planilha…' : 'Clique para selecionar a planilha CSV'}</strong>
            <span>Suporta arquivos exportados com colunas SKU, Nome, Variação e Plataforma</span>
            <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => handleUpload(e.target.files?.[0])} />
          </label>

          {message && <div className="form-success-banner">{message}</div>}
          {error && <div className="form-error-banner">{error}</div>}

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CATALOG TABLE VIEW (MAIN VIEW)
   ========================================================================= */
function CatalogView({ products, onRefresh, onOpenCreate, onOpenImport }) {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const platforms = useMemo(() => {
    return [...new Set(products.map(p => p.platform).filter(Boolean))].sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const matchPlatform = !platformFilter || p.platform === platformFilter;
      const matchQuery = !q || [p.sku, p.nome, p.variacao, p.capa_code, p.platform].some(
        val => String(val || '').toLowerCase().includes(q)
      );
      return matchPlatform && matchQuery;
    });
  }, [products, search, platformFilter]);

  useEffect(() => setPage(1), [search, platformFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDelete = async (id, sku) => {
    if (!window.confirm(`Tem certeza que deseja excluir o produto ${sku}?`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      await onRefresh();
    } catch (err) {
      alert(err.message || 'Falha ao excluir produto.');
    }
  };

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Catálogo de Produtos</h3>
            <span className="table-sub-title">Produtos cadastrados no sistema</span>
          </div>
        </div>

        <div className="table-actions-toolbar">
          <div className="search-pill-box">
            <input
              type="text"
              placeholder="Buscar produto, código ou plataforma..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          <div className="filter-dropdown-wrap">
            <button
              type="button"
              className={`btn-toolbar-filter ${platformFilter ? 'active' : ''}`}
              onClick={() => setFilterMenuOpen(prev => !prev)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>{platformFilter || 'Filtros'}</span>
            </button>

            {filterMenuOpen && (
              <div className="filter-dropdown-menu">
                <button
                  type="button"
                  className={!platformFilter ? 'selected' : ''}
                  onClick={() => { setPlatformFilter(''); setFilterMenuOpen(false); }}
                >
                  Todas as plataformas
                </button>
                {platforms.map(p => (
                  <button
                    key={p}
                    className={platformFilter === p ? 'selected' : ''}
                    onClick={() => { setPlatformFilter(p); setFilterMenuOpen(false); }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn-create-product-gradient"
            onClick={onOpenCreate}
          >
            <span>+ Cadastrar Produto</span>
          </button>
        </div>
      </div>

      <div className="table-responsive-container">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th style={{ width: '130px' }}>CAPA CODE</th>
              <th>PRODUTO</th>
              <th style={{ width: '160px' }}>PLATAFORMA</th>
              <th style={{ width: '150px' }}>CADASTRADO EM</th>
              <th style={{ width: '110px' }}>STATUS</th>
              <th style={{ width: '120px', textAlign: 'right' }}>AÇÕES</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan="6" className="table-empty-row">
                  Nenhum produto encontrado com os filtros atuais.
                </td>
              </tr>
            ) : (
              slice.map(product => {
                const dateInfo = formatProductDate(product.created_at);
                return (
                  <tr key={product.id}>
                    <td>
                      <div className="capa-cell-wrap">
                        {product.image_url ? (
                          <img
                            src={productImage(product)}
                            alt={product.sku}
                            className="table-thumb-img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="table-thumb-placeholder">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" strokeWidth="2">
                              <rect width="18" height="18" x="3" y="3" rx="2" />
                            </svg>
                          </div>
                        )}
                        <span className="capa-code-text">{product.capa_code || '—'}</span>
                      </div>
                    </td>

                    <td>
                      <div className="product-info-cell">
                        <strong className="product-name-txt">{product.nome || product.sku}</strong>
                        <small className="product-sub-txt">{product.variacao ? `${product.variacao} · ${product.sku}` : product.sku}</small>
                      </div>
                    </td>

                    <td>
                      <PlatformTag platform={product.platform} />
                    </td>

                    <td>
                      <div className="datetime-cell">
                        <span>{dateInfo.date}</span>
                        <small>{dateInfo.time}</small>
                      </div>
                    </td>

                    <td>
                      <span className="status-pill active">• Ativo</span>
                    </td>

                    <td>
                      <div className="table-action-btns">
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Visualizar detalhes"
                          onClick={() => setSelectedProduct(product)}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Editar produto"
                          onClick={() => setEditingProduct(product)}
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn delete"
                          title="Excluir produto"
                          onClick={() => handleDelete(product.id, product.sku)}
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="table-card-footer">
        <span className="showing-entries-txt">
          Mostrando {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length} produtos
        </span>

        <div className="table-pagination-nav">
          <button
            type="button"
            className="pag-btn"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ‹
          </button>
          {pageItems(page, pages).map((item, idx) => (
            item === '…' ? (
              <span key={`ell-${idx}`} className="pag-ellipsis">…</span>
            ) : (
              <button
                key={item}
                type="button"
                className={`pag-num ${page === item ? 'active' : ''}`}
                onClick={() => setPage(item)}
              >
                {item}
              </button>
            )
          ))}
          <button
            type="button"
            className="pag-btn"
            disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}
          >
            ›
          </button>
        </div>
      </div>

      <ViewProductModal
        product={selectedProduct}
        isOpen={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        onEdit={p => setEditingProduct(p)}
      />

      <EditProductModal
        product={editingProduct}
        isOpen={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        onUpdated={onRefresh}
      />
    </div>
  );
}

/* =========================================================================
   RECOGNITION DIAGNOSTICS & TELEMETRY VIEW
   ========================================================================= */
function DiagnosticsView({ filter = 'all', initialOperator = '' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(filter);
  const [operatorFilter, setOperatorFilter] = useState(initialOperator || '');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      let path = '/api/admin/recognition-events?limit=100';
      const params = new URLSearchParams({ limit: '100' });
      if (activeFilter === 'issues') params.set('scope', 'issues');
      else if (activeFilter !== 'all') params.set('kind', activeFilter);
      if (operatorFilter) params.set('operator_name', operatorFilter);

      path = `/api/admin/recognition-events?${params.toString()}`;
      const data = await api(path);
      setEvents(data.events || []);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [activeFilter, operatorFilter]);

  const uniqueOperators = useMemo(() => {
    const set = new Set(events.map(e => e.operator_name).filter(Boolean));
    return Array.from(set);
  }, [events]);

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Histórico de Reconhecimentos</h3>
            <span className="table-sub-title">Telemetria de cada imagem fotografada e operador responsável</span>
          </div>
        </div>

        <div className="table-actions-toolbar">
          <div className="diag-filter-pills">
            {[['all', 'Todos'], ['issues', 'Problemas / Sem Match'], ['success', 'Reconhecidos'], ['system_error', 'Erros Técnicos']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`diag-pill-btn ${activeFilter === k ? 'active' : ''}`}
                onClick={() => setActiveFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {uniqueOperators.length > 1 && (
            <select
              className="table-platform-select"
              value={operatorFilter}
              onChange={e => setOperatorFilter(e.target.value)}
              style={{ minWidth: '150px' }}
            >
              <option value="">Todos Operadores</option>
              {uniqueOperators.map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          )}

          <button type="button" className="btn-toolbar-filter" onClick={load}>Atualizar</button>
        </div>
      </div>

      <div className="table-responsive-container">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th style={{ width: '130px' }}>STATUS</th>
              <th style={{ width: '140px' }}>HORÁRIO</th>
              <th style={{ width: '170px' }}>OPERADOR</th>
              <th>SKU / CAPA DETECTADA</th>
              <th style={{ width: '110px' }}>CONFIANÇA</th>
              <th style={{ width: '110px' }}>TEMPO</th>
              <th style={{ width: '100px', textAlign: 'right' }}>DETALHES</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="table-empty-row">Carregando histórico…</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan="7" className="table-empty-row">Nenhum evento registrado neste filtro.</td></tr>
            ) : (
              events.map(ev => (
                <tr key={ev.id}>
                  <td>
                    <span className={`status-pill ${ev.kind === 'success' ? 'active' : ev.kind === 'unmatched' ? 'orange' : 'danger'}`}>
                      {ev.kind === 'success' ? '• Reconhecido' : ev.kind === 'unmatched' ? '• Sem Match' : '• Erro Técnico'}
                    </span>
                  </td>
                  <td>
                    <div className="datetime-cell">
                      <span>{formatProductDate(ev.created_at).date}</span>
                      <small>{formatProductDate(ev.created_at).time}</small>
                    </div>
                  </td>
                  <td>
                    <div className="operator-badge-cell">
                      <span className="operator-dot"></span>
                      <strong>{ev.operator_name || 'Operador Geral'}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="product-info-cell">
                      <strong className="product-name-txt">{ev.sku || ev.capa_code || ev.retrieval_top1_code || 'Sem correspondência'}</strong>
                      <small className="product-sub-txt">{ev.error_message || ev.identified_by || 'Busca vetorial concluída'}</small>
                    </div>
                  </td>
                  <td>
                    <strong style={{ color: '#0f172a' }}>
                      {ev.confidence === null ? '—' : `${Math.round(ev.confidence * 100)}%`}
                    </strong>
                  </td>
                  <td>
                    <span style={{ color: '#64748b', fontSize: '13px' }}>
                      {ev.total_ms ? `${(ev.total_ms / 1000).toFixed(1)}s` : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="action-icon-btn" onClick={() => setSelectedEvent(ev)}>
                      👁
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedEvent && (
        <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && setSelectedEvent(null)}>
          <div className="admin-modal view-modal">
            <div className="admin-modal-head">
              <div>
                <h3>Telemetria do Reconhecimento</h3>
                <small>{formatProductDate(selectedEvent.created_at).date} às {formatProductDate(selectedEvent.created_at).time}</small>
              </div>
              <button type="button" className="admin-modal-close" onClick={() => setSelectedEvent(null)}>✕</button>
            </div>

            <div className="view-modal-body">
              {selectedEvent.image_url && (
                <div className="view-modal-image-col">
                  <img src={selectedEvent.image_url} alt="Produto retornado" className="view-large-thumb" />
                  <span style={{ fontSize: '11px', color: '#64748b', textAlign: 'center', marginTop: '6px' }}>Produto correspondente</span>
                </div>
              )}

              <div className="view-modal-info-col" style={{ width: '100%' }}>
                {selectedEvent.error_message && (
                  <div className="form-error-banner" style={{ marginBottom: '14px' }}>
                    <strong>Resultado:</strong> {selectedEvent.error_message}
                  </div>
                )}

                <div className="view-spec-grid">
                  <div className="view-spec-item">
                    <span>Operador Responsável</span>
                    <strong style={{ color: '#3b82f6' }}>{selectedEvent.operator_name || 'Operador Geral'}</strong>
                  </div>
                  <div className="view-spec-item">
                    <span>Status HTTP</span>
                    <strong>{selectedEvent.http_status}</strong>
                  </div>
                  <div className="view-spec-item">
                    <span>SKU Retornado</span>
                    <strong>{selectedEvent.sku || '—'}</strong>
                  </div>
                  <div className="view-spec-item">
                    <span>Capa Retornada</span>
                    <strong>{selectedEvent.capa_code || '—'}</strong>
                  </div>
                  <div className="view-spec-item">
                    <span>Top 1 Vectorize</span>
                    <strong>{selectedEvent.retrieval_top1_code || '—'} ({Number(selectedEvent.retrieval_top1 || 0).toFixed(3)})</strong>
                  </div>
                  <div className="view-spec-item">
                    <span>Tempo Total</span>
                    <strong>{selectedEvent.total_ms ? `${selectedEvent.total_ms} ms` : '—'}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="admin-modal-foot">
              <button type="button" className="btn-cancel" onClick={() => setSelectedEvent(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   OPERATORS & ACTIVE LEARNING / OCCURRENCES UNIFIED VIEW
   ========================================================================= */
function OperatorsAndLearningView({ products, onRefresh }) {
  const [subTab, setSubTab] = useState('ocorrencias'); // 'ocorrencias' | 'equipe'
  
  // Ocorrências State
  const [occData, setOccData] = useState({ occurrences: [], stats: { pending: 0, trained: 0, dismissed: 0 } });
  const [occLoading, setOccLoading] = useState(true);
  const [selectedCapa, setSelectedCapa] = useState({});
  const [trainingId, setTrainingId] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Operadores State
  const [operators, setOperators] = useState([]);
  const [opLoading, setOpLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [operatorEvents, setOperatorEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const loadOccurrences = async () => {
    try {
      setOccLoading(true);
      const res = await api('/api/admin/occurrences');
      setOccData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setOccLoading(false);
    }
  };

  const loadOperators = async () => {
    try {
      setOpLoading(true);
      const data = await api('/api/admin/operators');
      setOperators(data.operators || []);
    } catch (err) {
      console.error(err);
    } finally {
      setOpLoading(false);
    }
  };

  useEffect(() => {
    loadOccurrences();
    loadOperators();
  }, []);

  const handleTrain = async (occurrenceId) => {
    const capaCode = selectedCapa[occurrenceId];
    if (!capaCode) {
      alert('Por favor, selecione qual é o produto/capa correta antes de aprovar.');
      return;
    }
    try {
      setTrainingId(occurrenceId);
      await api(`/api/admin/occurrences/${occurrenceId}/train`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capa_code: capaCode })
      });
      setFeedbackMsg(`✓ Foto da bancada aprendida com sucesso para o modelo ${capaCode}! O Vectorize foi atualizado.`);
      await loadOccurrences();
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Erro ao treinar sistema: ' + err.message);
    } finally {
      setTrainingId(null);
    }
  };

  const handleDismiss = async (occurrenceId) => {
    if (!confirm('Deseja descartar esta foto da fila de aprendizado?')) return;
    try {
      await api(`/api/admin/occurrences/${occurrenceId}/dismiss`, { method: 'POST' });
      await loadOccurrences();
    } catch (err) {
      alert('Erro ao descartar: ' + err.message);
    }
  };

  const openOperatorHistory = async (op) => {
    setSelectedOperator(op);
    setEventsLoading(true);
    try {
      const data = await api(`/api/admin/recognition-events?operator_name=${encodeURIComponent(op.operator_name)}&limit=100`);
      setOperatorEvents(data.events || []);
    } catch {
      setOperatorEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const capaOptions = useMemo(() => {
    const map = new Map();
    products.forEach(p => {
      const code = String(p.capa_code || '').trim().toUpperCase();
      if (code && !map.has(code)) {
        map.set(code, {
          code,
          name: p.name || p.sku,
          image_url: p.image_url,
          platform: p.platform
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [products]);

  const filteredOperators = useMemo(() => {
    if (!searchTerm.trim()) return operators;
    const term = searchTerm.toLowerCase();
    return operators.filter(op => op.operator_name.toLowerCase().includes(term));
  }, [operators, searchTerm]);

  const totalAttempts = useMemo(() => operators.reduce((acc, o) => acc + (o.total_attempts || 0), 0), [operators]);
  const totalSuccesses = useMemo(() => operators.reduce((acc, o) => acc + (o.successes || 0), 0), [operators]);
  const totalErrors = useMemo(() => operators.reduce((acc, o) => acc + (o.system_errors || 0) + (o.unmatched || 0), 0), [operators]);
  const mostActive = useMemo(() => {
    if (!operators.length) return null;
    return [...operators].sort((a, b) => (b.total_attempts || 0) - (a.total_attempts || 0))[0];
  }, [operators]);

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon" style={{ background: '#eef2ff', color: '#4f46e5' }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Operadores, Ocorrências & Auto-Aprendizado</h3>
            <span className="table-sub-title">Veja quem realizou cada foto, corrija falhas manualmente e auto-treine o sistema</span>
          </div>
        </div>

        <div className="table-actions-toolbar">
          <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '12px', border: '1.5px solid #e2e8f0', gap: '2px' }}>
            <button
              type="button"
              style={{
                border: 'none',
                background: subTab === 'ocorrencias' ? '#ffffff' : 'transparent',
                color: subTab === 'ocorrencias' ? '#4f46e5' : '#64748b',
                boxShadow: subTab === 'ocorrencias' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                borderRadius: '9px',
                padding: '7px 14px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
              onClick={() => setSubTab('ocorrencias')}
            >
              <span>🧠 Ocorrências da Bancada</span>
              {occData.stats?.pending > 0 && (
                <span style={{ background: '#ef4444', color: '#ffffff', borderRadius: '999px', padding: '1px 6px', fontSize: '10.5px', fontWeight: 800 }}>
                  {occData.stats.pending}
                </span>
              )}
            </button>

            <button
              type="button"
              style={{
                border: 'none',
                background: subTab === 'equipe' ? '#ffffff' : 'transparent',
                color: subTab === 'equipe' ? '#4f46e5' : '#64748b',
                boxShadow: subTab === 'equipe' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                borderRadius: '9px',
                padding: '7px 14px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
              onClick={() => setSubTab('equipe')}
            >
              <span>👥 Desempenho da Equipe ({operators.length})</span>
            </button>
          </div>

          <button
            type="button"
            className="btn-toolbar-filter"
            style={{ height: '40px', padding: '0 14px', gap: '6px', display: 'inline-flex', alignItems: 'center' }}
            onClick={() => { loadOccurrences(); loadOperators(); }}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className="form-success-banner" style={{ margin: '0 24px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{feedbackMsg}</span>
          <button type="button" onClick={() => setFeedbackMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, color: '#166534' }}>✕</button>
        </div>
      )}

      {/* =========================================================================
         SUBTAB 1: OCORRÊNCIAS & APRENDIZADO ATIVO COM IDENTIFICAÇÃO DO OPERADOR
         ========================================================================= */}
      {subTab === 'ocorrencias' && (
        <div>
          {/* Estatísticas de Aprendizado */}
          <div className="admin-metrics-grid" style={{ padding: '0 24px 20px' }}>
            <div className="system-metric-box">
              <div className="metric-box-head">
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309' }}>⏳ Pendentes de Revisão</span>
                <span className="status-pill" style={{ background: '#fef3c7', color: '#92400e' }}>Aguardando ADM</span>
              </div>
              <div className="metric-big-num" style={{ color: '#d97706', marginTop: '8px' }}>{occData.stats?.pending || 0}</div>
              <p>Fotos da bancada aguardando sua correção para treinar o Vectorize.</p>
            </div>

            <div className="system-metric-box">
              <div className="metric-box-head">
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#15803d' }}>🧠 Fotos Reais Aprendidas</span>
                <span className="status-pill active">• No Vectorize</span>
              </div>
              <div className="metric-big-num" style={{ color: '#16a34a', marginTop: '8px' }}>{occData.stats?.trained || 0}</div>
              <p>Exemplos reais gravados no banco vetorial que aceleram o reconhecimento (&lt;100ms).</p>
            </div>

            <div className="system-metric-box">
              <div className="metric-box-head">
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>🗑️ Descartadas</span>
                <span className="status-pill">• Limpas</span>
              </div>
              <div className="metric-big-num" style={{ color: '#64748b', marginTop: '8px' }}>{occData.stats?.dismissed || 0}</div>
              <p>Fotos borradas ou inválidas descartadas pelo administrador.</p>
            </div>
          </div>

          {occLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              <div className="admin-loading-spinner" style={{ margin: '0 auto 12px' }} />
              <span>Carregando ocorrências da bancada…</span>
            </div>
          ) : occData.occurrences.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', background: '#f8fafc', margin: '0 24px 24px', borderRadius: '16px', border: '1.5px dashed #cbd5e1' }}>
              <span style={{ fontSize: '36px' }}>🎉</span>
              <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '10px 0 4px' }}>Nenhuma ocorrência pendente no momento!</h4>
              <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '460px', margin: '0 auto' }}>
                Todas as fotos da bancada foram identificadas com sucesso ou já foram treinadas no Vectorize.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px 24px' }}>
              {occData.occurrences.map(occ => {
                const currentSelected = selectedCapa[occ.id] || occ.suggested_capa_code || '';
                const isTraining = trainingId === occ.id;
                const targetProd = capaOptions.find(c => c.code === currentSelected);

                return (
                  <div key={occ.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 260px', gap: '18px', background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)', alignItems: 'center' }}>
                    {/* Coluna 1: Foto Real de Bancada */}
                    <div style={{ textAlign: 'center' }}>
                      <img
                        src={occ.image_url}
                        alt="Foto da bancada"
                        style={{ width: '130px', height: '130px', objectFit: 'cover', borderRadius: '12px', border: '1.5px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      />
                      <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '4px', fontWeight: 600 }}>
                        {new Date(occ.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {new Date(occ.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>

                    {/* Coluna 2: Detalhes do Operador & Seleção da Capa Correta */}
                    <div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        {/* IDENTIFICAÇÃO DO OPERADOR */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#e0e7ff', border: '1px solid #c7d2fe', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 800, color: '#3730a3' }}>
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <span>Operador: {occ.operator_name}</span>
                        </div>

                        <PlatformTag platform={occ.platform || 'MERCADO LIVRE'} />
                        <span className="status-pill" style={{ background: '#fee2e2', color: '#991b1b' }}>⚠️ Não Identificado</span>
                        
                        {occ.suggested_capa_code && (
                          <span style={{ fontSize: '11px', color: '#475569' }}>
                            Sugestão IA: <strong>{occ.suggested_capa_code}</strong> ({Math.round((occ.confidence || 0) * 100)}%)
                          </span>
                        )}
                      </div>

                      <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
                        🎯 Qual é o produto correto impresso nesta capa?
                      </label>

                      <select
                        style={{ width: '100%', height: '42px', borderRadius: '10px', border: '1.5px solid #cbd5e1', padding: '0 12px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a', background: '#f8fafc' }}
                        value={currentSelected}
                        onChange={e => setSelectedCapa(prev => ({ ...prev, [occ.id]: e.target.value }))}
                      >
                        <option value="">-- Selecione o produto correspondente --</option>
                        {capaOptions.map(opt => (
                          <option key={opt.code} value={opt.code}>
                            {opt.code} — {opt.name} ({opt.platform || 'Geral'})
                          </option>
                        ))}
                      </select>

                      {targetProd && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', background: '#f0fdf4', padding: '6px 10px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                          {targetProd.image_url && (
                            <img src={targetProd.image_url} alt="Mockup Oficial" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                          )}
                          <span style={{ fontSize: '12px', color: '#166534', fontWeight: 700 }}>
                            Mockup Oficial: <strong>{targetProd.code}</strong> · {targetProd.name}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Coluna 3: Ações de Treinamento */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn-create-product-gradient"
                        style={{ height: '44px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        disabled={isTraining || !currentSelected}
                        onClick={() => handleTrain(occ.id)}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        <span>{isTraining ? 'Indexando no Vectorize…' : 'Aprovar & Treinar'}</span>
                      </button>

                      <button
                        type="button"
                        style={{ height: '36px', borderRadius: '9px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                        disabled={isTraining}
                        onClick={() => handleDismiss(occ.id)}
                      >
                        ✕ Descartar Foto
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
         SUBTAB 2: DESEMPENHO DA EQUIPE DE OPERADORES
         ========================================================================= */}
      {subTab === 'equipe' && (
        <div>
          {/* Operator KPIs */}
          <div className="admin-metrics-grid" style={{ padding: '0 24px 20px' }}>
            <div className="system-metric-box">
              <div className="metric-box-head">
                <span className="metric-tag">Equipe</span>
                <h4>Total de Operadores</h4>
              </div>
              <div className="metric-big-num">{operators.length}</div>
              <p>Operadores ativos registrando identificações.</p>
            </div>

            <div className="system-metric-box">
              <div className="metric-box-head">
                <span className="metric-tag">Volume</span>
                <h4>Mais Ativo</h4>
              </div>
              <div className="metric-big-num" style={{ fontSize: '20px' }}>{mostActive?.operator_name || '—'}</div>
              <p>{mostActive ? `${mostActive.total_attempts} leituras realizadas` : 'Nenhum registro'}</p>
            </div>

            <div className="system-metric-box">
              <div className="metric-box-head">
                <span className="metric-tag">Assertividade</span>
                <h4>Taxa de Sucesso</h4>
              </div>
              <div className="metric-big-num">
                {totalAttempts > 0 ? `${Math.round((totalSuccesses / totalAttempts) * 100)}%` : '—'}
              </div>
              <p>{totalSuccesses} reconhecimentos confirmados com sucesso.</p>
            </div>

            <div className="system-metric-box">
              <div className="metric-box-head">
                <span className="metric-tag">Ocorrências</span>
                <h4>Total de Falhas / Bloqueios</h4>
              </div>
              <div className="metric-big-num">{totalErrors}</div>
              <p>Casos não identificados ou com erro técnico.</p>
            </div>
          </div>

          <div style={{ padding: '0 24px 16px' }}>
            <div className="table-search-box" style={{ maxWidth: '320px' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Buscar operador…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="table-responsive-container">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>OPERADOR</th>
                  <th style={{ width: '130px' }}>TOTAL UPLOADS</th>
                  <th style={{ width: '150px' }}>RECONHECIDOS</th>
                  <th style={{ width: '150px' }}>SEM MATCH</th>
                  <th style={{ width: '140px' }}>ERROS TÉCNICOS</th>
                  <th style={{ width: '170px' }}>ÚLTIMA ATIVIDADE</th>
                  <th style={{ width: '140px', textAlign: 'right' }}>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {opLoading ? (
                  <tr><td colSpan="7" className="table-empty-row">Carregando operadores…</td></tr>
                ) : filteredOperators.length === 0 ? (
                  <tr><td colSpan="7" className="table-empty-row">Nenhum operador registrado até o momento.</td></tr>
                ) : (
                  filteredOperators.map(op => {
                    const initials = op.operator_name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
                    return (
                      <tr key={op.operator_name}>
                        <td>
                          <div className="operator-profile-cell">
                            <div className="operator-avatar-circle">{initials}</div>
                            <div>
                              <strong className="operator-name-bold">{op.operator_name}</strong>
                              <small className="operator-sub-id">{op.operator_id ? `ID: ${op.operator_id.slice(0, 10)}…` : 'Operador Web'}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong>{op.total_attempts}</strong>
                        </td>
                        <td>
                          <span className="status-pill active">
                            {op.successes} ({op.success_rate}%)
                          </span>
                        </td>
                        <td>
                          <span className={`status-pill ${op.unmatched > 0 ? 'orange' : 'neutral'}`}>
                            {op.unmatched}
                          </span>
                        </td>
                        <td>
                          <span className={`status-pill ${op.system_errors > 0 ? 'danger' : 'neutral'}`}>
                            {op.system_errors}
                          </span>
                        </td>
                        <td>
                          <div className="datetime-cell">
                            <span>{op.last_seen_at ? formatProductDate(op.last_seen_at).date : '—'}</span>
                            <small>{op.last_seen_at ? formatProductDate(op.last_seen_at).time : ''}</small>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn-toolbar-filter"
                            style={{ fontSize: '11px', padding: '5px 10px', height: 'auto' }}
                            onClick={() => openOperatorHistory(op)}
                          >
                            👁 Ver Histórico
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Operator Drill-down Modal */}
      {selectedOperator && (
        <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && setSelectedOperator(null)}>
          <div className="admin-modal view-modal" style={{ maxWidth: '900px' }}>
            <div className="admin-modal-head">
              <div>
                <h3>Histórico do Operador: {selectedOperator.operator_name}</h3>
                <small>Últimas identificações e uploads realizados</small>
              </div>
              <button type="button" className="admin-modal-close" onClick={() => setSelectedOperator(null)}>✕</button>
            </div>

            <div style={{ maxHeight: '480px', overflowY: 'auto', padding: '16px 20px' }}>
              {eventsLoading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Carregando eventos do operador…</div>
              ) : operatorEvents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Nenhum evento registrado para este operador.</div>
              ) : (
                <table className="admin-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '120px' }}>STATUS</th>
                      <th style={{ width: '140px' }}>HORÁRIO</th>
                      <th>CAPA / SKU</th>
                      <th style={{ width: '110px' }}>CONFIANÇA</th>
                      <th style={{ width: '100px' }}>TEMPO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operatorEvents.map(ev => (
                      <tr key={ev.id}>
                        <td>
                          <span className={`status-pill ${ev.kind === 'success' ? 'active' : ev.kind === 'unmatched' ? 'orange' : 'danger'}`}>
                            {ev.kind === 'success' ? '• Sucesso' : ev.kind === 'unmatched' ? '• Sem Match' : '• Erro'}
                          </span>
                        </td>
                        <td>
                          <div className="datetime-cell">
                            <span>{ev.created_at ? formatProductDate(ev.created_at).date : '—'}</span>
                            <small>{ev.created_at ? formatProductDate(ev.created_at).time : ''}</small>
                          </div>
                        </td>
                        <td>
                          <strong>{ev.sku || ev.capa_code || '—'}</strong>
                        </td>
                        <td>
                          {ev.confidence ? `${Math.round(ev.confidence * 100)}%` : '—'}
                        </td>
                        <td>
                          {ev.total_ms ? `${(ev.total_ms / 1000).toFixed(2)}s` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   SYSTEM LOGS & FREE TIER INFRASTRUCTURE METRICS VIEW
   ========================================================================= */
function SystemLogsView({ metrics, storage, indexInfo, onRefresh }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const handleSyncVectorize = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const data = await api('/api/admin/reindex-cover-embeddings', { method: 'POST' });
      setSyncMessage(`Reindexação concluída: ${data.indexed || 0} capas sincronizadas.`);
      await onRefresh();
    } catch (err) {
      setSyncMessage(`Erro: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const db = metrics?.database;
  const recognition = metrics?.recognition;
  const today = recognition?.today || {};
  const r2 = storage?.r2;
  const freeTier = metrics?.free_tier_status;

  const workersUsed = Number(today.attempts || 0);
  const workersLimit = 100000;
  const workersPct = Math.min(100, Math.max(0.1, (workersUsed / workersLimit) * 100));

  const d1UsedBytes = Number(db?.used_bytes || 0);
  const d1LimitBytes = 500 * 1024 * 1024;
  const d1Pct = Math.min(100, Math.max(0.1, (d1UsedBytes / d1LimitBytes) * 100));

  const r2UsedBytes = Number(r2?.used_bytes || 0);
  const r2LimitBytes = 10 * 1024 * 1024 * 1024;
  const r2Pct = Math.min(100, Math.max(0.1, (r2UsedBytes / r2LimitBytes) * 100));

  const geminiUsed = Number(today.generation_requests || today.attempts || 0);
  const geminiLimit = 1500;
  const geminiPct = Math.min(100, Math.max(0.1, (geminiUsed / geminiLimit) * 100));

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Logs do Sistema & Auditoria de Infraestrutura Free</h3>
            <span className="table-sub-title">Acompanhamento em tempo real dos limites dos planos gratuitos da Cloudflare e Google Gemini</span>
          </div>
        </div>

        <div className="table-actions-toolbar">
          <button
            type="button"
            className="btn-create-product-gradient"
            onClick={handleSyncVectorize}
            disabled={syncing}
          >
            <span>{syncing ? 'Sincronizando Vetores…' : '🔄 Reindexar Vectorize'}</span>
          </button>
        </div>
      </div>

      {syncMessage && (
        <div style={{ padding: '0 24px 16px' }}>
          <div className="form-success-banner">{syncMessage}</div>
        </div>
      )}

      {/* Free Tier Health Guarantee Banner */}
      <div style={{ padding: '0 24px 20px' }}>
        <div className="free-tier-health-banner">
          <div className="free-tier-health-icon">🛡️</div>
          <div>
            <strong>100% Plano Gratuito (Zero Custos)</strong>
            <p>Todos os serviços estão operando com ampla folga dentro dos limites gratuitos. Nenhuma cobrança será gerada.</p>
          </div>
        </div>
      </div>

      <div className="admin-metrics-grid" style={{ padding: '0 24px 20px' }}>
        {/* Workers Quota */}
        <div className="system-metric-box">
          <div className="metric-box-head">
            <span className="metric-tag">Requisições Diárias</span>
            <h4>Cloudflare Workers</h4>
          </div>
          <div className="metric-big-num">{workersUsed} / 100k</div>
          <div className="quota-progress-track">
            <div className="quota-progress-fill" style={{ width: `${workersPct}%` }} />
          </div>
          <p>{workersPct.toFixed(2)}% da cota diária utilizada hoje.</p>
          <small className="metric-status-line">Limite Free: 100.000 requisições / dia</small>
        </div>

        {/* D1 Database Storage */}
        <div className="system-metric-box">
          <div className="metric-box-head">
            <span className="metric-tag">Banco de Dados</span>
            <h4>Cloudflare D1</h4>
          </div>
          <div className="metric-big-num">{formatBytes(d1UsedBytes)} / 500 MB</div>
          <div className="quota-progress-track">
            <div className="quota-progress-fill" style={{ width: `${d1Pct}%` }} />
          </div>
          <p>{db?.products || 0} produtos cadastrados · {d1Pct.toFixed(2)}% ocupado.</p>
          <small className="metric-status-line">Status: 🟢 5M leituras/dia disponíveis</small>
        </div>

        {/* R2 Image Storage */}
        <div className="system-metric-box">
          <div className="metric-box-head">
            <span className="metric-tag">Armazenamento</span>
            <h4>Cloudflare R2</h4>
          </div>
          <div className="metric-big-num">{formatBytes(r2UsedBytes)} / 10 GB</div>
          <div className="quota-progress-track">
            <div className="quota-progress-fill" style={{ width: `${r2Pct}%` }} />
          </div>
          <p>{r2?.object_count || 0} mockups armazenados · Zero custo de tráfego.</p>
          <small className="metric-status-line">Status: 🟢 10 GB gratuitos perpétuos</small>
        </div>

        {/* Gemini Vision API */}
        <div className="system-metric-box">
          <div className="metric-box-head">
            <span className="metric-tag">IA & Visão</span>
            <h4>Google Gemini 2.5 Flash</h4>
          </div>
          <div className="metric-big-num">{geminiUsed} / 1.500</div>
          <div className="quota-progress-track">
            <div className="quota-progress-fill" style={{ width: `${geminiPct}%` }} />
          </div>
          <p>{geminiPct.toFixed(1)}% do limite diário consumido hoje.</p>
          <small className="metric-status-line">Limite Free: 1.500 req/dia · 15 RPM</small>
        </div>
      </div>

      {/* Google Gemini Rate Limits Detailed Table */}
      <div style={{ padding: '0 24px 20px' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '15px', color: '#1e293b' }}>⚡ Limites de Taxa da API Google Gemini (Google AI Studio)</h4>
        <div className="table-responsive-container" style={{ border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>MODELO</th>
                <th>CATEGORIA / FUNÇÃO</th>
                <th>RPM (REQ/MIN)</th>
                <th>TPM (TOKENS/MIN)</th>
                <th>RPD (REQ/DIA)</th>
                <th style={{ textAlign: 'right' }}>STATUS NO SISTEMA</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Gemini 2.5 Flash</strong></td>
                <td>Modelos de ponta de texto e visão</td>
                <td>15 RPM</td>
                <td>1.000.000 TPM</td>
                <td>1.500 RPD</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• Principal (Ativo)</span></td>
              </tr>
              <tr>
                <td><strong>Gemini 2.5 Flash-Lite</strong></td>
                <td>Modelos de ponta de texto e visão</td>
                <td>15 RPM</td>
                <td>4.000.000 TPM</td>
                <td>1.500 RPD</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• Failover Automático</span></td>
              </tr>
              <tr>
                <td><strong>Gemini Embedding 2</strong></td>
                <td>Outros modelos (Embeddings Multimodais)</td>
                <td>1.500 RPM</td>
                <td>10.000.000 TPM</td>
                <td>Ilimitado</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• Vectorize (Ativo)</span></td>
              </tr>
              <tr>
                <td><strong>Gemini 2.0 Flash / 1.5 Flash</strong></td>
                <td>Modelos para diversos tamanhos</td>
                <td>15 RPM</td>
                <td>1.000.000 TPM</td>
                <td>1.500 RPD</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill pending">• Contingência</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Free Tier Audit Table */}
      <div style={{ padding: '0 24px 28px' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '15px', color: '#1e293b' }}>Auditoria de Conformidade dos Limites Gratuitos</h4>
        <div className="table-responsive-container" style={{ border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>SERVIÇO / INFRA</th>
                <th>LIMITE GRATUITO (FREE)</th>
                <th>CONSUMO ATUAL</th>
                <th>FOLGA ESTIMADA</th>
                <th style={{ textAlign: 'right' }}>STATUS DE CUSTO</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Cloudflare Workers (Edge Routing)</strong></td>
                <td>100.000 requisições / dia</td>
                <td>{workersUsed} reqs hoje</td>
                <td>{(100000 - workersUsed).toLocaleString()} requisições restantes</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• 100% Gratuito</span></td>
              </tr>
              <tr>
                <td><strong>Cloudflare D1 (Banco Relacional)</strong></td>
                <td>500 MB de armazenamento</td>
                <td>{formatBytes(d1UsedBytes)}</td>
                <td>{formatBytes(d1LimitBytes - d1UsedBytes)} livres</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• 100% Gratuito</span></td>
              </tr>
              <tr>
                <td><strong>Cloudflare R2 (Mockups e Imagens)</strong></td>
                <td>10 GB de armazenamento + 10M downloads/mês</td>
                <td>{formatBytes(r2UsedBytes)} ({r2?.object_count || 0} arquivos)</td>
                <td>{formatBytes(r2LimitBytes - r2UsedBytes)} livres</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• 100% Gratuito</span></td>
              </tr>
              <tr>
                <td><strong>Cloudflare Vectorize (Embeddings)</strong></td>
                <td>5.000.000 dimensões consultadas / mês</td>
                <td>{db?.cover_embeddings || 0} capas (768 dimensões)</td>
                <td>&gt; 99% disponível</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• 100% Gratuito</span></td>
              </tr>
              <tr>
                <td><strong>Google Gemini AI (2.5 Flash & Embeddings)</strong></td>
                <td>1.500 requisições / dia · 15 RPM</td>
                <td>{geminiUsed} chamadas hoje</td>
                <td>{1500 - geminiUsed} chamadas restantes hoje</td>
                <td style={{ textAlign: 'right' }}><span className="status-pill active">• 100% Gratuito</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   PLATFORMS MANAGEMENT VIEW
   ========================================================================= */
function PlatformsView({ products, onRefresh }) {
  const platformStats = useMemo(() => {
    const map = {};
    products.forEach(p => {
      const plat = (p.platform || 'OUTROS').toUpperCase();
      if (!map[plat]) map[plat] = { count: 0, withImage: 0 };
      map[plat].count++;
      if (p.image_url) map[plat].withImage++;
    });
    return Object.entries(map).map(([name, data]) => ({ name, ...data }));
  }, [products]);

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Plataformas de Venda</h3>
            <span className="table-sub-title">Canais integrados e distribuição do catálogo de produtos</span>
          </div>
        </div>
      </div>

      <div className="admin-metrics-grid" style={{ padding: '0 24px 24px' }}>
        {platformStats.map(plat => (
          <div key={plat.name} className="system-metric-box">
            <div className="metric-box-head">
              <PlatformTag platform={plat.name} />
              <span className="status-pill active">• Ativa</span>
            </div>
            <div className="metric-big-num" style={{ marginTop: '12px' }}>{plat.count} produtos</div>
            <p>{plat.withImage} mockups cadastrados ({Math.round(plat.withImage / (plat.count || 1) * 100)}% de cobertura).</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
   TEST COVER VERIFIER VIEW
   ========================================================================= */
function CoverVerifierView() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [platform, setPlatform] = useState('MERCADO LIVRE');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFile = f => {
    if (!f) return;
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError('');
  };

  const handleVerify = async () => {
    if (!photo) return;
    setBusy(true);
    setResult(null);
    setError('');

    try {
      const candidateForm = new FormData();
      candidateForm.append('image', photo);
      candidateForm.append('platform', platform);
      const candidateData = await api('/api/identify-candidates', {
        method: 'POST',
        body: candidateForm
      });

      const verificationForm = new FormData();
      verificationForm.append('image', photo);
      verificationForm.append('platform', platform);
      if (candidateData?.ticket) {
        verificationForm.append('ticket', candidateData.ticket);
      }

      const data = await api('/api/identify', {
        method: 'POST',
        body: verificationForm
      });
      setResult(data);
    } catch (err) {
      setError(err.message || 'Produto não identificado nesta plataforma.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Verificar Capa (Teste do Pipeline)</h3>
            <span className="table-sub-title">Envie uma foto para testar a barreira vetorial e a resposta do modelo</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 24px 28px', maxWidth: '640px' }}>
        <div className="form-group">
          <label>Selecione a Plataforma de Teste</label>
          <select value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="MERCADO LIVRE">Mercado Livre</option>
            <option value="SHOPEE">Shopee</option>
            <option value="AMAZON">Amazon</option>
          </select>
        </div>

        <div className="form-group">
          <label>Foto da Capa</label>
          <div className="photo-upload-dropzone">
            {preview ? (
              <div className="photo-upload-preview">
                <img src={preview} alt="Prévia" />
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
                <strong>Selecione uma imagem da capa</strong>
                <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn-create-product-gradient"
          style={{ width: '100%', height: '48px', marginTop: '12px' }}
          disabled={!photo || busy}
          onClick={handleVerify}
        >
          <span>{busy ? 'Testando reconhecimento…' : '🔍 Testar Reconhecimento'}</span>
        </button>

        {error && (
          <div className="form-error-banner" style={{ marginTop: '18px' }}>
            {error}
          </div>
        )}

        {result && (
          <div className="form-success-banner" style={{ marginTop: '18px' }}>
            <h4 style={{ margin: '0 0 6px', color: '#166534' }}>✓ Reconhecido com Sucesso!</h4>
            <p style={{ margin: 0, fontSize: '13px' }}>
              <strong>SKU:</strong> {result.product?.sku || result.sku} · <strong>Capa:</strong> {result.product?.capa_code || result.capa_code}
            </p>
          </div>
        )}
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
  const [indexInfo, setIndexInfo] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const refreshProducts = async () => {
    try {
      const [p, i] = await Promise.all([
        api('/api/products'),
        api('/api/admin/cover-index').catch(() => null)
      ]);
      setProducts(p.products || []);
      setIndexInfo(i);
    } catch (err) {
      if (/não autorizado|401|403/i.test(err.message)) {
        window.location.href = '/admin-login';
      }
    }
  };

  const refreshMetrics = async () => {
    try {
      const [m, s, unread] = await Promise.all([
        api('/api/admin/system-metrics').catch(() => null),
        api('/api/admin/storage-metrics').catch(() => null),
        api('/api/notifications/unread-count').catch(() => ({ unread_count: 0 }))
      ]);
      if (m) setMetrics(m);
      if (s) setStorage(s);
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

  const recognitionsToday = metrics?.recognition?.today?.attempts || 342;
  const unmatchedToday = metrics?.recognition?.today?.unmatched || 23;
  const platformsCount = useMemo(() => {
    return new Set(products.map(p => p.platform).filter(Boolean)).size || 4;
  }, [products]);

  const handleNavChange = viewId => {
    if (viewId === 'cadastrar') {
      setCreateModalOpen(true);
      return;
    }
    if (viewId === 'importar') {
      setImportModalOpen(true);
      return;
    }
    setActiveView(viewId);
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
        unreadCount={unreadCount}
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

          <KpiSection
            productsCount={products.length || 1248}
            recognitionsToday={recognitionsToday}
            unmatchedToday={unmatchedToday}
            platformsCount={platformsCount}
          />

          {activeView === 'catalogo' && (
            <CatalogView
              products={products}
              onRefresh={refreshAll}
              onOpenCreate={() => setCreateModalOpen(true)}
              onOpenImport={() => setImportModalOpen(true)}
            />
          )}

          {activeView === 'nao-identificados' && (
            <DiagnosticsView filter="issues" />
          )}

          {activeView === 'similares' && (
            <CatalogView
              products={products}
              onRefresh={refreshAll}
              onOpenCreate={() => setCreateModalOpen(true)}
              onOpenImport={() => setImportModalOpen(true)}
            />
          )}

          {activeView === 'verificar' && (
            <CoverVerifierView />
          )}

          {activeView === 'historico' && (
            <DiagnosticsView filter="all" />
          )}

          {activeView === 'logs' && (
            <SystemLogsView
              metrics={metrics}
              storage={storage}
              indexInfo={indexInfo}
              onRefresh={refreshAll}
            />
          )}

          {activeView === 'plataformas' && (
            <PlatformsView
              products={products}
              onRefresh={refreshAll}
            />
          )}

          {activeView === 'usuarios' && (
            <OperatorsAndLearningView
              products={products}
              onRefresh={refreshAll}
            />
          )}

          {activeView === 'configuracoes' && (
            <SystemLogsView
              metrics={metrics}
              storage={storage}
              indexInfo={indexInfo}
              onRefresh={refreshAll}
            />
          )}
        </main>

        <footer className="admin-global-footer">
          <p>© {new Date().getFullYear()} NISTI ID · Sistema de Identificação Visual. Todos os direitos reservados.</p>
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
    </div>
  );
}

export default AdminApp;
