import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './app.css';
import './commerce-admin.css';
import LOGO from './assets/logo.png';
import CommerceCommercialPanel from './commerce-commercial-panel.jsx';
import CommerceProductsView from './commerce-products-view.jsx';
import CommerceDashboard from './commerce-dashboard.jsx';
import CommerceImportHistory from './commerce-import-history.jsx';
import { fetchCommercialManager } from './commerce-manager-fetch.js';
import { usePrivacy, setPrivate } from './commerce-privacy.js';
import './nisti-motion.css';
import './nisti-motion.js';

const IS_GA = typeof window !== 'undefined' && window.location.hostname === 'ga.sistemanistiid.online';
const LOGOUT_ACTION = IS_GA ? '/ga-logout' : '/admin-logout';
if (IS_GA && typeof document !== 'undefined') document.title = 'GA - Gestor de Anúncio';

const NAV_ITEMS = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', icon: 'chart' },
  { id: 'catalog', label: 'Painel Comercial', icon: 'grid' },
  { id: 'planning', label: 'Planejamento de Produtos', icon: 'package' },
  { id: 'imports', label: 'Histórico de importações', icon: 'list' }
]);

const VIEW_TITLES = Object.freeze({
  dashboard: 'Dashboard',
  catalog: 'Painel Comercial',
  planning: 'Planejamento de Produtos NISTI',
  sales: 'Painel Comercial',
  imports: 'Histórico de importações'
});

function SidebarIcon({ name }) {
  const props = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  };

  if (name === 'package') {
    return (
      <svg {...props}>
        <path d="m16.5 9.4-9-5.19" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" x2="12" y1="22" y2="12" />
      </svg>
    );
  }

  if (name === 'chart') {
    return (
      <svg {...props}>
        <path d="M3 3v18h18" />
        <path d="m7 16 4-5 3 3 5-7" />
      </svg>
    );
  }

  if (name === 'upload') {
    return (
      <svg {...props}>
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 21h14" />
        <path d="M5 17v4" />
        <path d="M19 17v4" />
      </svg>
    );
  }

  if (name === 'list') {
    return (
      <svg {...props}>
        <line x1="8" x2="21" y1="6" y2="6" />
        <line x1="8" x2="21" y1="12" y2="12" />
        <line x1="8" x2="21" y1="18" y2="18" />
        <line x1="3" x2="3.01" y1="6" y2="6" />
        <line x1="3" x2="3.01" y1="12" y2="12" />
        <line x1="3" x2="3.01" y1="18" y2="18" />
      </svg>
    );
  }

  return (
    <svg {...props}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function CommerceSidebar({ activeView, onViewChange, sidebarOpen, onCloseSidebar }) {
  return (
    <>
      {sidebarOpen && <div className="sidebar-mobile-backdrop" onClick={onCloseSidebar} />}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src={LOGO} alt="NISTI ID" className="sidebar-brand-logo" />
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-title">{IS_GA ? 'GA' : 'NISTI ID'}</span>
              <span className="sidebar-brand-subtitle">{IS_GA ? 'GESTOR DE ANÚNCIO' : 'CATÁLOGO COMERCIAL'}</span>
            </div>
          </div>
        </div>

        {!IS_GA && <div className="sidebar-highlight-wrap">
          <a href="/admin" className="sidebar-highlight-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Voltar ao NISTI ID</span>
          </a>
        </div>}

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <span className="sidebar-section-title">COMERCIAL</span>
            <ul className="sidebar-section-list">
              {NAV_ITEMS.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
                    onClick={() => {
                      onViewChange(item.id);
                      onCloseSidebar();
                    }}
                  >
                    <SidebarIcon name={item.icon} />
                    <span className="sidebar-item-label">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="sidebar-footer">
          <form method="POST" action="/admin-logout" onSubmit={event => { if (IS_GA) event.currentTarget.action = LOGOUT_ACTION; }} className="nim-logout-form"><button type="submit" className="sidebar-logout-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Encerrar Sessão</span>
          </button></form>
        </div>
      </aside>
    </>
  );
}

// Estado real da conexão com o banco: consulta o endpoint /health (que faz uma leitura no Supabase).
// Verde = respondeu; vermelho = falhou; cinza = verificando. Reverifica a cada 60 s (só com a aba visível) e ao atualizar.
function useDatabaseStatus(revision) {
  const [status, setStatus] = useState({ state: 'checking', at: null, detail: '' });
  const check = useCallback(async signal => {
    setStatus(current => ({ ...current, state: 'checking' }));
    let detail = '';
    // Duas tentativas antes de ficar vermelho: uma falha momentânea (rede, Worker frio) não deve assustar.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await fetchCommercialManager('/api/admin/commerce/health', { signal });
        if (signal?.aborted) return;
        if (result?.ok === true) { setStatus({ state: 'ok', at: new Date(), detail: '' }); return; }
        detail = result?.error || 'o banco não respondeu';
      } catch (error) {
        if (signal?.aborted) return;
        detail = error?.message || 'falha na consulta';
      }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 2500));
      if (signal?.aborted) return;
    }
    setStatus({ state: 'error', at: new Date(), detail });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') check(controller.signal);
    }, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [check, revision]);
  return status;
}

function DatabaseStatus({ status }) {
  const label = status.state === 'ok' ? 'Conectado ao banco de dados'
    : status.state === 'error' ? 'Sem conexão com o banco de dados' : 'Verificando conexão…';
  const when = status.at ? ' · verificado às ' + status.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <span className={'commerce-db-status is-' + status.state} role="status" title={label + when + (status.state === 'error' && status.detail ? ' · ' + status.detail : '')} aria-label={label}>
      <span className="commerce-live-dot" aria-hidden="true" />
      <span className="commerce-db-status-text">{status.state === 'ok' ? 'Conectado' : status.state === 'error' ? 'Sem conexão' : 'Verificando'}</span>
    </span>
  );
}

export default function CommerceAdminAppV2() {
  const privacy = usePrivacy();
  const [activeView, setActiveView] = useState('dashboard');
  const [perfOpen, setPerfOpen] = useState(null);
  const openPerformance = (tab, filter = null) => { setPerfOpen({ tab, filter, nonce: Date.now() }); setActiveView('catalog'); };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [salesRevision, setSalesRevision] = useState(0);

  const dbStatus = useDatabaseStatus(salesRevision);
  const activeItem = useMemo(
    () => NAV_ITEMS.find(item => item.id === activeView) || NAV_ITEMS[0],
    [activeView]
  );

  return (
    <div className="admin-layout-root commerce-admin-root">
      <CommerceSidebar
        activeView={activeView}
        onViewChange={setActiveView}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

      <div className="admin-main-wrapper">
        <header className="admin-topbar-header">
          <div className="topbar-left">
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setSidebarOpen(value => !value)}
              aria-label="Alternar menu lateral"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h1 className="admin-page-title">{IS_GA ? (VIEW_TITLES[activeItem.id] || activeItem.label) : 'Catálogo Comercial'}</h1>
          </div>

          <div className="topbar-right">
            {!IS_GA && <a href="/admin" className="topbar-logout-btn">
              <span>NISTI ID</span>
            </a>}
            <button
              type="button"
              className={'commerce-privacy-btn' + (privacy ? ' is-on' : '')}
              onClick={() => setPrivate(!privacy)}
              aria-pressed={privacy}
              aria-label={privacy ? 'Mostrar valores' : 'Ocultar valores'}
              title={privacy ? 'Valores ocultos. Clique para mostrar' : 'Ocultar valores em reais'}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {privacy
                  ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>
                  : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
              </svg>
              <span>{privacy ? 'Valores ocultos' : 'Ocultar valores'}</span>
            </button>
            <DatabaseStatus status={dbStatus} />
            <button
              type="button"
              className={'commerce-refresh-icon' + (dbStatus.state === 'checking' ? ' is-spinning' : '')}
              onClick={() => setSalesRevision(value => value + 1)}
              aria-label="Atualizar dados"
              title="Atualizar dados"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            {!IS_GA && <form method="POST" action="/admin-logout" className="nim-logout-form"><button type="submit" className="topbar-logout-btn">
              <span>Sair</span>
            </button></form>}
          </div>
        </header>

        <main className="admin-page-content commerce-admin-page-content">
          <div key={activeView + ':' + salesRevision} className="commerce-admin-view-transition">
            {(activeView === 'catalog' || activeView === 'sales') && <CommerceCommercialPanel perfOpen={perfOpen} />}
            {activeView === 'planning' && <CommerceProductsView />}
            {activeView === 'dashboard' && <CommerceDashboard onOpenTab={openPerformance} />}
            {activeView === 'imports' && <CommerceImportHistory />}
          </div>
        </main>

        <footer className="commerce-footer">
          NISTI PRINT · Catálogo Comercial · Supabase PostgreSQL
        </footer>
      </div>
    </div>
  );
}
