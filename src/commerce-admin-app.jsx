import React, { useEffect, useMemo, useState } from 'react';
import './app.css';
import './commerce-admin.css';
import LOGO from './assets/logo.png';

const PAGE_SIZE = 25;

const NAV_ITEMS = Object.freeze([
  { id: 'overview', label: 'Visão Geral' },
  { id: 'products', label: 'Produtos Mestre' },
  { id: 'listings', label: 'Anúncios' },
  { id: 'imports', label: 'Importações Excel' },
  { id: 'updates', label: 'Atualização Anual' }
]);

const MARKETPLACES = Object.freeze([
  ['', 'Todas as plataformas'],
  ['SHOPEE', 'Shopee'],
  ['MERCADO_LIVRE', 'Mercado Livre'],
  ['AMAZON', 'Amazon']
]);

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (response.status === 401) {
    window.location.href = '/admin-login';
    throw new Error('Sessão administrativa expirada.');
  }
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function statusLabel(value) {
  const labels = {
    ACTIVE: 'Ativo',
    PAUSED: 'Pausado',
    INACTIVE: 'Inativo',
    REMOVED: 'Removido',
    UNKNOWN: 'Não verificado',
    DRAFT: 'Rascunho',
    DISCONTINUED: 'Descontinuado',
    SELLING: 'Vendendo',
    NO_SALES: 'Sem vendas',
    ANNUAL: 'Anual',
    PERMANENT: 'Permanente',
    UNCLASSIFIED: 'Não classificado'
  };
  return labels[value] || value || '—';
}

function StatusPill({ value }) {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  const className = ['ACTIVE', 'SELLING'].includes(normalized)
    ? 'ok'
    : ['PAUSED', 'DRAFT', 'UNKNOWN', 'UNCLASSIFIED'].includes(normalized)
      ? 'warn'
      : ['INACTIVE', 'REMOVED', 'DISCONTINUED', 'NO_SALES'].includes(normalized)
        ? 'muted'
        : '';
  return <span className={`commerce-status-pill ${className}`}>{statusLabel(normalized)}</span>;
}

function MetricCard({ label, value, helper }) {
  return (
    <article className="commerce-metric-card">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
      <small>{helper}</small>
    </article>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="commerce-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="commerce-loading-block">
      <div className="admin-loading-spinner" />
      <span>Carregando dados comerciais…</span>
    </div>
  );
}

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

function OverviewView({ dashboard, onNavigate }) {
  const byMarketplace = dashboard?.by_marketplace || {};
  return (
    <>
      <section className="commerce-metrics-grid">
        <MetricCard label="Produtos Mestre" value={dashboard?.products} helper="Produtos comerciais cadastrados" />
        <MetricCard label="Anúncios" value={dashboard?.listings} helper="Em todos os marketplaces" />
        <MetricCard label="Multiplataforma" value={dashboard?.multi_platform_products} helper="Presentes em 2 ou mais plataformas" />
        <MetricCard label="Sem anúncio" value={dashboard?.products_without_listing} helper="Produtos sem publicação vinculada" />
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Distribuição por plataforma</h2>
            <p>Quantidade de produtos e anúncios registrados no catálogo comercial.</p>
          </div>
          <button type="button" className="commerce-secondary-button" onClick={() => onNavigate('listings')}>Abrir anúncios</button>
        </div>
        <div className="commerce-marketplace-grid">
          {MARKETPLACES.filter(([code]) => code).map(([code, name]) => {
            const stats = byMarketplace[code] || {};
            return (
              <article key={code}>
                <span>{name}</span>
                <strong>{formatNumber(stats.products || 0)} produtos</strong>
                <small>{formatNumber(stats.listings || 0)} anúncios</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Pendências operacionais</h2>
            <p>Itens que precisam de tratamento antes do catálogo se tornar a fonte operacional diária.</p>
          </div>
        </div>
        <div className="commerce-task-grid">
          <button type="button" onClick={() => onNavigate('imports')}>
            <span>Importações em revisão</span>
            <strong>{formatNumber(dashboard?.imports_pending || 0)}</strong>
          </button>
          <button type="button" onClick={() => onNavigate('updates')}>
            <span>Atualizações anuais pendentes</span>
            <strong>{formatNumber(dashboard?.update_items_pending || 0)}</strong>
          </button>
          <button type="button" onClick={() => onNavigate('products')}>
            <span>Produtos em uma única plataforma</span>
            <strong>{formatNumber(dashboard?.single_platform_products || 0)}</strong>
          </button>
        </div>
      </section>
    </>
  );
}

function ProductsView() {
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0, limit: PAGE_SIZE, offset: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (nextOffset = offset) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
    if (search.trim()) params.set('search', search.trim());
    if (marketplace) params.set('marketplace', marketplace);
    if (status) params.set('status', status);
    try {
      const result = await api(`/api/admin/commerce/products?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0); }, [marketplace, status]);

  const total = Number(data?.pagination?.total || 0);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Produtos Mestre</h2>
          <p>Identidade comercial canônica. SKU histórico e presença em marketplaces são relacionados sem duplicar o produto.</p>
        </div>
        <div className="commerce-filter-row">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome ou SKU" />
            <button type="submit">Buscar</button>
          </form>
          <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
            {MARKETPLACES.map(([code, label]) => <option key={code || 'all'} value={code}>{label}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            <option value="ACTIVE">Ativos</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="DISCONTINUED">Descontinuados</option>
          </select>
        </div>
      </div>

      {error && <div className="commerce-error">{error}</div>}
      {loading ? <LoadingBlock /> : data.items?.length ? (
        <div className="commerce-table-wrap">
          <table className="commerce-table">
            <thead><tr><th>Produto</th><th>SKU atual</th><th>Categoria</th><th>Tipo</th><th>Plataformas</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.map(product => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>#{product.id}</small></td>
                  <td><code>{product.current_sku || '—'}</code></td>
                  <td>{product.category_name || '—'}{product.subcategory_name ? <small>{product.subcategory_name}</small> : null}</td>
                  <td>{statusLabel(product.temporal_type)}{product.edition_year ? <small>Edição {product.edition_year}</small> : null}</td>
                  <td>{formatNumber(product.marketplace_count || 0)}<small>{product.marketplaces || 'Sem anúncio'}</small></td>
                  <td><StatusPill value={product.internal_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Nenhum produto comercial cadastrado" detail="Os primeiros produtos entrarão após a reconciliação das planilhas Shopee e Mercado Livre." />}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {formatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => load(offset + PAGE_SIZE)}>Próxima</button>
        </div>
      </div>
    </section>
  );
}

function ListingsView() {
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (nextOffset = offset) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
    if (search.trim()) params.set('search', search.trim());
    if (marketplace) params.set('marketplace', marketplace);
    if (status) params.set('status', status);
    try {
      const result = await api(`/api/admin/commerce/listings?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar anúncios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0); }, [marketplace, status]);

  const total = Number(data?.pagination?.total || 0);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Anúncios por plataforma</h2>
          <p>Um anúncio pode conter múltiplos produtos/variações; o vínculo é N:N e não usa a URL como identidade do produto.</p>
        </div>
        <div className="commerce-filter-row">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar título, SKU ou ID" />
            <button type="submit">Buscar</button>
          </form>
          <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
            {MARKETPLACES.map(([code, label]) => <option key={code || 'all'} value={code}>{label}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            <option value="ACTIVE">Ativos</option>
            <option value="PAUSED">Pausados</option>
            <option value="INACTIVE">Inativos</option>
            <option value="UNKNOWN">Não verificados</option>
          </select>
        </div>
      </div>

      {error && <div className="commerce-error">{error}</div>}
      {loading ? <LoadingBlock /> : data.items?.length ? (
        <div className="commerce-table-wrap">
          <table className="commerce-table">
            <thead><tr><th>Plataforma</th><th>Anúncio</th><th>Produtos</th><th>Ano</th><th>Venda</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.map(listing => (
                <tr key={listing.id}>
                  <td><strong>{listing.marketplace_name || listing.marketplace_code}</strong><small>{listing.external_listing_id || 'Sem ID externo'}</small></td>
                  <td>
                    <strong>{listing.title || 'Título não capturado'}</strong>
                    {listing.canonical_url ? <a href={listing.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : null}
                  </td>
                  <td>{formatNumber(listing.product_count || 0)}<small>{listing.platform_skus || 'Sem SKU vinculado'}</small></td>
                  <td>{listing.observed_year || '—'}</td>
                  <td><StatusPill value={listing.sales_status} /></td>
                  <td><StatusPill value={listing.listing_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Nenhum anúncio cadastrado" detail="Os anúncios aparecerão aqui após a primeira importação e reconciliação." />}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {formatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => load(offset + PAGE_SIZE)}>Próxima</button>
        </div>
      </div>
    </section>
  );
}

function ImportsView() {
  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header">
        <div>
          <h2>Importações Excel</h2>
          <p>Entrada controlada das planilhas antigas. O Excel nunca grava diretamente no catálogo definitivo.</p>
        </div>
      </div>
      <div className="commerce-import-flow">
        <div><span>1</span><strong>Excel</strong><small>Shopee ou Mercado Livre</small></div>
        <div><span>2</span><strong>Normalização</strong><small>Preserva linha original e corrige estrutura</small></div>
        <div><span>3</span><strong>Reconciliação</strong><small>SKU, aliases, nome e revisão humana</small></div>
        <div><span>4</span><strong>Commit</strong><small>Somente dados aprovados entram no catálogo</small></div>
      </div>
      <div className="commerce-notice">
        <strong>Backend de staging já preparado.</strong>
        <p>A leitura binária do XLSX será acoplada no navegador sem enviar a service-role ao cliente. Até essa etapa ser concluída, nenhum arquivo será importado parcialmente.</p>
      </div>
    </section>
  );
}

function UpdatesView({ dashboard }) {
  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header">
        <div>
          <h2>Atualização Anual</h2>
          <p>Controle granular para a virada 2026 → 2027 por anúncio e produto.</p>
        </div>
      </div>
      <div className="commerce-update-example">
        <div><span>SKU</span><strong>Não verificado</strong></div>
        <div><span>Título</span><strong>Não verificado</strong></div>
        <div><span>Descrição</span><strong>Não verificado</strong></div>
        <div><span>Imagens</span><strong>Não verificado</strong></div>
        <div><span>Vídeo</span><strong>Não verificado</strong></div>
      </div>
      <div className="commerce-notice">
        <strong>{formatNumber(dashboard?.update_items_pending || 0)} itens pendentes atualmente.</strong>
        <p>Produtos permanentes ficam fora da campanha anual por padrão. O status final só será concluído quando todas as verificações obrigatórias estiverem em OK ou Não aplicável.</p>
      </div>
    </section>
  );
}

export default function CommerceAdminApp() {
  const [activeView, setActiveView] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const title = useMemo(() => NAV_ITEMS.find(item => item.id === activeView)?.label || 'Catálogo Comercial', [activeView]);

  const refreshDashboard = async () => {
    setError('');
    try {
      setDashboard(await api('/api/admin/commerce/dashboard'));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o Catálogo Comercial.');
    } finally {
      setLoading(false);
    }
  };

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
          {loading ? <LoadingBlock /> : (
            <>
              {activeView === 'overview' && <OverviewView dashboard={dashboard || {}} onNavigate={setActiveView} />}
              {activeView === 'products' && <ProductsView />}
              {activeView === 'listings' && <ListingsView />}
              {activeView === 'imports' && <ImportsView />}
              {activeView === 'updates' && <UpdatesView dashboard={dashboard || {}} />}
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
