import React, { useEffect, useMemo, useState } from 'react';
import './app.css';
import './commerce-admin.css';
import LOGO from './assets/logo.png';
import { commerceApi } from './commerce-admin-api.js';
import { CommerceLoadingBlock } from './commerce-admin-shared.jsx';
import CommerceOverviewView from './commerce-overview-view.jsx';
import CommerceManagementView from './commerce-management-view.jsx';
import CommerceProductsView from './commerce-products-view.jsx';
import CommerceListingsView from './commerce-listings-view.jsx';
import CommerceImportView from './commerce-import-view.jsx';
import CommerceUpdateView from './commerce-update-view.jsx';
import CommerceReconciliationView from './commerce-reconciliation-view.jsx';
import CommerceShopeeSnapshotView from './commerce-shopee-snapshot-view.jsx';

const NAV_ITEMS = Object.freeze([
  { id: 'management', label: 'Gestão' },
  { id: 'overview', label: 'Visão Geral' },
  { id: 'products', label: 'Produtos Mestre' },
  { id: 'listings', label: 'Anúncios' },
  { id: 'shopee', label: 'Shopee · Capas' },
  { id: 'imports', label: 'Importações Excel' },
  { id: 'reconciliation', label: 'Revisão de vínculos' },
  { id: 'updates', label: 'Atualização Anual' }
]);

function CommerceSidebar({ activeView, onViewChange }) {
  return (
    <aside className="commerce-sidebar">
      <div className="commerce-brand">
        <img src={LOGO} alt="NISTI" />
        <div>
          <strong>NISTI PRINT</strong>
          <span>CATÁLOGO COMERCIAL</span>
        </div>
      </div>

      <a className="commerce-back-link" href="/admin">← Voltar ao NISTI ID</a>

      <nav>
        <span className="commerce-nav-title">COMERCIAL</span>
        {NAV_ITEMS.map(item => (
          <button
            type="button"
            key={item.id}
            className={activeView === item.id ? 'active' : ''}
            onClick={() => onViewChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="commerce-sidebar-footer">
        <span>Supabase PostgreSQL</span>
        <strong>Fonte de verdade comercial</strong>
        <a href="/admin-logout">Sair</a>
      </div>
    </aside>
  );
}

export default function CommerceAdminAppV2() {
  const [activeView, setActiveView] = useState('management');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const title = useMemo(
    () => NAV_ITEMS.find(item => item.id === activeView)?.label || 'Catálogo Comercial',
    [activeView]
  );

  async function refreshDashboard() {
    setError('');
    try {
      setDashboard(await commerceApi('/api/admin/commerce/dashboard'));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o Catálogo Comercial.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshDashboard(); }, []);

  return (
    <div className="commerce-layout">
      <CommerceSidebar activeView={activeView} onViewChange={setActiveView} />
      <div className="commerce-main">
        <header className="commerce-topbar">
          <div>
            <span>ADMINISTRAÇÃO · COMERCIAL</span>
            <h1>{title}</h1>
          </div>
          <button type="button" onClick={refreshDashboard}>Atualizar dados</button>
        </header>

        <main className="commerce-content">
          {error && <div className="commerce-error">{error}</div>}
          {loading ? <CommerceLoadingBlock /> : (
            <>
              {activeView === 'management' && <CommerceManagementView />}
              {activeView === 'overview' && <CommerceOverviewView dashboard={dashboard || {}} onNavigate={setActiveView} />}
              {activeView === 'products' && <CommerceProductsView />}
              {activeView === 'listings' && <CommerceListingsView />}
              {activeView === 'shopee' && <CommerceShopeeSnapshotView />}
              {activeView === 'imports' && <CommerceImportView onCatalogChanged={refreshDashboard} />}
              {activeView === 'reconciliation' && <CommerceReconciliationView onCatalogChanged={refreshDashboard} />}
              {activeView === 'updates' && <CommerceUpdateView onCatalogChanged={refreshDashboard} />}
            </>
          )}
        </main>

        <footer className="commerce-footer">
          NISTI PRINT · Catálogo Comercial · Supabase PostgreSQL
        </footer>
      </div>
    </div>
  );
}
