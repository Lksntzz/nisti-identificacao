import React, { useMemo, useState } from 'react';
import './app.css';
import './commerce-admin.css';
import LOGO from './assets/logo.png';
import CommerceManagementView from './commerce-management-view.jsx';
import CommerceSalesDashboard from './commerce-sales-dashboard.jsx';
import CommerceUnifiedImportView from './commerce-unified-import-view.jsx';

const NAV_ITEMS = Object.freeze([
  { id: 'catalog', label: 'Catálogo', icon: 'grid' },
  { id: 'sales', label: 'Vendas', icon: 'chart' },
  { id: 'imports', label: 'Importar', icon: 'upload' },
  { id: 'pending', label: 'Pendências', icon: 'list' }
]);

const VIEW_DESCRIPTIONS = Object.freeze({
  catalog: 'Produto Mestre, imagens e anúncios de todas as plataformas em uma única visão.',
  sales: 'Pedidos, unidades, faturamento e itens sem venda por plataforma, período e SKU.',
  imports: 'Importe arquivos para alimentar o Catálogo Comercial e o Painel de Vendas.',
  pending: 'Somente produtos que precisam de vínculo, revisão ou correção.'
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
              <span className="sidebar-brand-title">NISTI ID</span>
              <span className="sidebar-brand-subtitle">CATÁLOGO COMERCIAL</span>
            </div>
          </div>
        </div>

        <div className="sidebar-highlight-wrap">
          <a href="/admin" className="sidebar-highlight-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Voltar ao NISTI ID</span>
          </a>
        </div>

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
          <a href="/admin-logout" className="sidebar-logout-btn">
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

export default function CommerceAdminAppV2() {
  const [activeView, setActiveView] = useState('catalog');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
            <h1 className="admin-page-title">Catálogo Comercial</h1>
          </div>

          <div className="topbar-right">
            <a href="/admin" className="topbar-logout-btn">
              <span>NISTI ID</span>
            </a>
            <button
              type="button"
              className="topbar-logout-btn commerce-refresh-btn"
              onClick={() => window.location.reload()}
            >
              Atualizar
            </button>
            <a href="/admin-logout" className="topbar-logout-btn">
              <span>Sair</span>
            </a>
          </div>
        </header>

        <main className="admin-page-content commerce-admin-page-content">
          <div className="welcome-banner commerce-welcome-banner">
            <div className="welcome-copy">
              <h2>{activeItem.label}</h2>
              <p>{VIEW_DESCRIPTIONS[activeItem.id]}</p>
            </div>
            <div className="commerce-live-status">
              <span className="commerce-live-dot" />
              <div>
                <strong>Dados conectados</strong>
                <small>Supabase PostgreSQL</small>
              </div>
            </div>
          </div>

          {activeView === 'catalog' && <CommerceManagementView mode="catalog" />}
          {activeView === 'sales' && <CommerceSalesDashboard />}
          {activeView === 'imports' && <CommerceUnifiedImportView />}
          {activeView === 'pending' && <CommerceManagementView mode="pending" />}
        </main>

        <footer className="commerce-footer">
          NISTI PRINT · Catálogo Comercial · Supabase PostgreSQL
        </footer>
      </div>
    </div>
  );
}
