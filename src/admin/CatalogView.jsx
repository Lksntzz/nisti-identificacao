import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createCatalogXlsx } from './catalog-xlsx.js';
import { CommerceSyncBadge } from './CommerceSyncBadge.jsx';
import { AdminState } from './AdminState.jsx';
import ProductCutoutImage from '../product-cutout-image.jsx';

const PAGE_SIZE = 10;

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

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
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

function platformClass(code) {
  const value = String(code || '').toUpperCase();
  if (value === 'SHOPEE') return 'catalog-platform-shopee';
  if (value === 'ML_NOVO') return 'catalog-platform-ml-novo';
  if (value === 'ML_ANTIGO') return 'catalog-platform-ml-antigo';
  if (value === 'AMAZON') return 'catalog-platform-amazon';
  if (value === 'MAGALU') return 'catalog-platform-magalu';
  if (value === 'LOJA_INTEGRADA') return 'catalog-platform-site';
  if (value === 'SHEIN') return 'catalog-platform-shein';
  if (value === 'TIKTOK') return 'catalog-platform-tiktok';
  if (value === 'KWAI') return 'catalog-platform-kwai';
  if (value === 'ALIEXPRESS') return 'catalog-platform-aliexpress';
  return 'catalog-platform-default';
}

function catalogPlatforms(product) {
  return Array.isArray(product?.commerce_sync?.platforms)
    ? product.commerce_sync.platforms.filter(item => item?.code || item?.label)
    : [];
}

export function CatalogPlatformTags({ product }) {
  const syncStatus = String(product?.commerce_sync?.sync_status || product?.commerce_sync?.status || '').toUpperCase();
  // Do not use product.platform / product_platforms: those belong to Scanner
  // identification and may survive a full Commerce import reset.
  const confirmedCatalogLink = syncStatus === 'SYNCED' && Number(product?.commerce_sync?.commerce_product_id) > 0;
  const platforms = confirmedCatalogLink ? catalogPlatforms(product) : [];
  const visible = platforms.slice(0, 2);
  const hidden = platforms.slice(2);

  if (!platforms.length) {
    return <span className="catalog-platform-empty">Sem anúncio no catálogo</span>;
  }

  return (
    <div className="catalog-platform-stack">
      {visible.map(platform => (
        <span
          key={platform.code || platform.label}
          className={`catalog-platform-pill ${platformClass(platform.code)}`}
        >
          {platform.label || platform.code}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="catalog-platform-more-wrap">
          <button type="button" className="catalog-platform-more" aria-label={`Ver mais ${hidden.length} plataformas`}>
            +{hidden.length}
          </button>
          <span className="catalog-platform-popover">
            <strong>Plataformas cadastradas</strong>
            {platforms.map(platform => (
              <span key={`all-${platform.code || platform.label}`} className="catalog-platform-popover-row">
                <i className={platformClass(platform.code)} />
                {platform.label || platform.code}
              </span>
            ))}
          </span>
        </span>
      )}
    </div>
  );
}

function SalesTrendChart({ history, mode = 'bars' }) {
  const values = Array.isArray(history) ? history : [];
  if (!values.length) return <p className="nisti-sales-empty-chart">Nenhum mês importado neste intervalo.</p>;
  const max = Math.max(1, ...values.map(row => Number(row.units) || 0));
  const width=680, height=210, left=40, top=20, right=18, bottom=38;
  const innerWidth=width-left-right, innerHeight=height-top-bottom;
  const points=values.map((row,index)=>({
    x:left+(index+.5)*innerWidth/values.length,
    y:top+innerHeight-(Number(row.units)||0)/max*innerHeight,
    count:Number(row.units)||0,
    label:String(row.month||'').slice(5)+'/'+String(row.month||'').slice(2,4)
  }));
  return <svg className="nisti-sales-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img"
    aria-label={`Vendas mensais: ${points.map(item=>item.label+': '+item.count+' unidades').join(', ')}`}>
    {[0,.5,1].map(fraction=><g key={fraction}>
      <line x1={left} x2={width-right} y1={top+innerHeight*(1-fraction)} y2={top+innerHeight*(1-fraction)} stroke="#e2e8f0" />
      <text x={left-9} y={top+innerHeight*(1-fraction)+4} textAnchor="end" fill="#64748b" fontSize="11">{Math.round(max*fraction)}</text>
    </g>)}
    {mode==='line' && <polyline fill="none" stroke="#2563eb" strokeWidth="3" strokeLinejoin="round"
      points={points.map(p=>`${p.x},${p.y}`).join(' ')} />}
    {points.map((point,index)=><g key={index}>
      {mode==='bars' ? <rect x={point.x-Math.min(24,innerWidth/values.length*.33)} y={point.y}
        width={Math.min(48,innerWidth/values.length*.66)} height={Math.max(0,top+innerHeight-point.y)}
        rx="5" fill="#2563eb" /> : <circle cx={point.x} cy={point.y} r="5" fill="#2563eb" stroke="white" strokeWidth="2" />}
      <text x={point.x} y={Math.max(12,point.y-9)} textAnchor="middle" fill="#1e40af" fontSize="12" fontWeight="600">{point.count}</text>
      <text x={point.x} y={height-13} textAnchor="middle" fill="#64748b" fontSize="11">{point.label}</text>
    </g>)}
  </svg>;
}

export function CatalogView({
  products,
  highlightedProductIds = [],
  onRefresh,
  onOpenCreate,
  onOpenImport,
  onViewProduct,
  onEditProduct,
  onDeleteProduct
}) {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [presenceFilter, setPresenceFilter] = useState('ALL');
  const [historyMonths, setHistoryMonths] = useState(3);
  const [planning, setPlanning] = useState({});
  const [planningLoading, setPlanningLoading] = useState(false);
  const [planningError, setPlanningError] = useState('');
  const [salesProduct, setSalesProduct] = useState(null);
  const [salesPlatform, setSalesPlatform] = useState('TODAS');
  const [salesMonths, setSalesMonths] = useState(6);
  const [salesChartType, setSalesChartType] = useState('bars');
  const [onlyWithoutEan, setOnlyWithoutEan] = useState(false);
  const [page, setPage] = useState(1);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const previousPageRef = useRef(1);

  const platforms = useMemo(() => {
    const map = new Map();
    products.forEach(product => {
      catalogPlatforms(product).forEach(platform => {
        if (platform?.code) map.set(platform.code, platform.label || platform.code);
      });
    });
    return [...map.entries()]
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const catalogPlatformList = catalogPlatforms(p);
      const matchPlatform = !platformFilter || catalogPlatformList.some(platform => platform.code === platformFilter);
      const matchEanFilter = !onlyWithoutEan || !p.has_active_gtin;
      const matchPresence = presenceFilter === 'ALL' || (presenceFilter === 'EXCLUSIVE' ? catalogPlatformList.length === 1 : catalogPlatformList.length > 1);
      const platformSearch = catalogPlatformList.map(platform => platform.label || platform.code).join(' ');
      const matchQuery = !q || [p.sku, p.nome, p.variacao, p.capa_code, platformSearch, p.gtin].some(
        val => String(val || '').toLowerCase().includes(q)
      );
      return matchPlatform && matchPresence && matchEanFilter && matchQuery;
    });
  }, [products, search, platformFilter, presenceFilter, onlyWithoutEan]);

  useEffect(() => setPage(1), [search, platformFilter, presenceFilter, onlyWithoutEan]);

  const exportExcel = () => {
    const blob = new Blob([createCatalogXlsx(filtered)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `catalogo_nisti_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    if (!salesProduct?.id) return;
    const id=Number(salesProduct.id);
    let cancelled=false;
    setPlanningLoading(true);
    setPlanningError('');
    const params=new URLSearchParams({ids:String(id),platform:salesPlatform,months:String(salesMonths)});
    fetch('/api/admin/commerce/products/nisti-sales-planning?'+params,{credentials:'same-origin'})
      .then(async response=>{
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data?.error || `Erro ${response.status} ao consultar vendas`);
        return data;
      })
      .then(data=>{if(!cancelled)setPlanning({[id]:(data.items||[]).find(item=>Number(item.nisti_product_id)===id)});})
      .catch(error=>{if(!cancelled){setPlanningError(error.message);setPlanning({});}})
      .finally(()=>{if(!cancelled)setPlanningLoading(false);});
    return ()=>{cancelled=true;};
  },[salesProduct?.id,salesPlatform,salesMonths]);
  const selectedPlatformLabel = platforms.find(item => item.code === platformFilter)?.label || platformFilter;
  const pageDirection = page >= previousPageRef.current ? 'forward' : 'backward';
  const tableMotionKey = `${search.trim()}|${platformFilter}|${onlyWithoutEan ? '1' : '0'}|${page}`;

  useEffect(() => {
    previousPageRef.current = page;
  }, [page]);

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
              className={`btn-toolbar-filter ${platformFilter || onlyWithoutEan ? 'active' : ''}`}
              onClick={() => setFilterMenuOpen(prev => !prev)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>{onlyWithoutEan ? 'Sem EAN' : (platforms.find(item => item.code === platformFilter)?.label || 'Filtros')}</span>
            </button>

            {filterMenuOpen && (
              <div className="filter-dropdown-menu">
                <button
                  type="button"
                  className={!platformFilter && !onlyWithoutEan ? 'selected' : ''}
                  onClick={() => { setPlatformFilter(''); setOnlyWithoutEan(false); setFilterMenuOpen(false); }}
                >
                  Todos os produtos
                </button>
                <button
                  type="button"
                  className={onlyWithoutEan ? 'selected' : ''}
                  onClick={() => { setOnlyWithoutEan(prev => !prev); setFilterMenuOpen(false); }}
                  style={{ color: '#d97706', fontWeight: 600 }}
                >
                  Apenas sem EAN
                </button>
                <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />
                {platforms.map(platform => (
                  <button
                    key={platform.code}
                    className={platformFilter === platform.code ? 'selected' : ''}
                    onClick={() => { setPlatformFilter(platform.code); setOnlyWithoutEan(false); setFilterMenuOpen(false); }}
                  >
                    {platform.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <select aria-label="Exclusividade dos anúncios" value={presenceFilter} onChange={event=>setPresenceFilter(event.target.value)}>
            <option value="ALL">Todos os anúncios</option>
            <option value="EXCLUSIVE">Exclusivos da plataforma</option>
            <option value="SHARED">Multiplataforma</option>
          </select>
          <select aria-label="Histórico das vendas" value={historyMonths} onChange={event=>setHistoryMonths(Number(event.target.value))}>
            <option value={3}>Últimos 3 meses</option>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
          </select>
          <button type="button" className="btn-toolbar-filter" title="Baixar planilha Excel com tabela e filtro por plataforma" onClick={exportExcel}>
            <span>Baixar a planilha</span>
          </button>

          <button
            type="button"
            className="btn-create-product-gradient"
            onClick={onOpenCreate}
          >
            <span>+ Cadastrar Produto</span>
          </button>
        </div>
      </div>

      {(search.trim() || platformFilter || onlyWithoutEan) && (
        <div className="nisti-filter-chips" aria-label="Filtros ativos">
          <span className="nisti-filter-summary">{filtered.length.toLocaleString('pt-BR')} resultado{filtered.length === 1 ? '' : 's'}</span>
          {search.trim() && (
            <button type="button" className="nisti-filter-chip" onClick={() => setSearch('')}>
              Busca: “{search.trim()}” <span aria-hidden="true">×</span>
            </button>
          )}
          {platformFilter && (
            <button type="button" className="nisti-filter-chip" onClick={() => setPlatformFilter('')}>
              {selectedPlatformLabel} <span aria-hidden="true">×</span>
            </button>
          )}
          {onlyWithoutEan && (
            <button type="button" className="nisti-filter-chip warning" onClick={() => setOnlyWithoutEan(false)}>
              Sem EAN <span aria-hidden="true">×</span>
            </button>
          )}
          <button
            type="button"
            className="nisti-filter-clear"
            onClick={() => { setSearch(''); setPlatformFilter(''); setOnlyWithoutEan(false); }}
          >
            Limpar filtros
          </button>
        </div>
      )}

      <div className="table-responsive-container">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th style={{ width: '130px' }}>CAPA CODE</th>
              <th>PRODUTO</th>
              <th style={{ width: '160px' }}>PLATAFORMA</th>
              <th style={{ width: '150px' }}>CADASTRADO EM</th>
              <th style={{ width: '180px' }}>STATUS</th>
              <th style={{ width: '120px', textAlign: 'right' }}>AÇÕES</th>
            </tr>
          </thead>
          <tbody key={tableMotionKey} className={`nisti-table-swap ${pageDirection}`}>
            {slice.length === 0 ? (
              <tr>
                <td colSpan="6" className="table-empty-row nisti-state-cell">
                  <AdminState
                    tone="empty"
                    compact
                    title={products.length === 0 ? 'Catálogo vazio' : 'Nenhum produto encontrado'}
                    description={products.length === 0
                      ? 'Cadastre o primeiro produto para iniciar o catálogo NISTI.'
                      : 'Os filtros atuais não retornaram produtos. Ajuste a busca ou limpe os filtros.'}
                    actionLabel={products.length === 0 ? 'Cadastrar produto' : 'Limpar filtros'}
                    onAction={products.length === 0
                      ? onOpenCreate
                      : () => { setSearch(''); setPlatformFilter(''); setOnlyWithoutEan(false); }}
                  />
                </td>
              </tr>
            ) : (
              slice.map(product => {
                const dateInfo = formatProductDate(product.created_at);
                const isRecent = highlightedProductIds.includes(Number(product.id));
                return (
                  <tr key={product.id} className={`nisti-table-row ${isRecent ? 'is-recent' : ''}`}>
                    <td>
                      <div className="capa-cell-wrap">
                        {product.image_url ? (
                          <ProductCutoutImage
                            src={productImage(product)}
                            alt={product.sku}
                            className="table-thumb-img"
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
                      <CatalogPlatformTags product={product} />
                    </td>

                    <td>
                      <div className="datetime-cell">
                        <span>{dateInfo.date}</span>
                        <small>{dateInfo.time}</small>
                      </div>
                    </td>

                    <td>
                      <div className="product-sync-status-stack">
                        <span className="status-pill active">• Ativo</span>
                        <CommerceSyncBadge sync={product.commerce_sync} compact />
                        {isRecent && <span className="nisti-recent-badge">Alterado agora</span>}
                      </div>
                    </td>

                    <td>
                      <div className="table-action-btns">
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Visualizar detalhes"
                          onClick={() => onViewProduct(product)}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Ver vendas e projeção"
                          aria-label={`Ver vendas e projeção de ${product.nome || product.sku}`}
                          onClick={() => { setSalesPlatform('TODAS'); setSalesMonths(6); setSalesChartType('bars'); setSalesProduct(product); }}
                        >
                          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 3v18h18" />
                            <path d="m7 16 4-5 3 3 5-7" />
                            <path d="M17 7h2v2" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Editar produto"
                          onClick={() => onEditProduct(product)}
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
                          onClick={() => onDeleteProduct(product.id, product.sku)}
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

      {salesProduct && (
        <div className="nisti-sales-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) setSalesProduct(null);
        }}>
          <section className="nisti-sales-modal" role="dialog" aria-modal="true" aria-label={`Vendas de ${salesProduct.nome || salesProduct.sku}`}>
            <header className="nisti-sales-modal-header">
              <div>
                <span>Planejamento de vendas · NISTI</span>
                <h3>{salesProduct.nome || 'Produto NISTI'}</h3>
                <code>{salesProduct.sku || 'SKU não informado'}</code>
              </div>
              <button type="button" onClick={() => setSalesProduct(null)} aria-label="Fechar detalhes de vendas">Fechar</button>
            </header>
            <div className="nisti-sales-modal-filters">
              <label>Plataforma
                <select value={salesPlatform} onChange={event=>setSalesPlatform(event.target.value)}>
                  <option value="TODAS">Todas as plataformas</option>
                  <option value="SHOPEE">Shopee</option>
                  <option value="MERCADO_LIVRE">Mercado Livre (ambas as contas)</option>
                  <option value="ML_NOVO">Mercado Livre · novo</option>
                  <option value="ML_ANTIGO">Mercado Livre · antigo</option>
                </select>
              </label>
              <label>Período histórico
                <select value={salesMonths} onChange={event=>setSalesMonths(Number(event.target.value))}>
                  <option value={1}>Último mês</option>
                  <option value={3}>Últimos 3 meses</option>
                  <option value={6}>Últimos 6 meses</option>
                  <option value={12}>Últimos 12 meses</option>
                </select>
              </label>
              <label>Visualização
                <select value={salesChartType} onChange={event=>setSalesChartType(event.target.value)}>
                  <option value="bars">Gráfico de colunas</option>
                  <option value="line">Gráfico de linha</option>
                </select>
              </label>
            </div>
            {planningLoading ? <p>Consultando vendas importadas…</p> : planningError ? (
              <p role="alert">Não foi possível consultar as vendas: {planningError}</p>
            ) : !planning[salesProduct.id] ? <p>Este produto não possui vínculo comercial para consultar as vendas.</p> : (() => {
              const report=planning[salesProduct.id];
              const display = value => value == null ? '—' : Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
              const history=Array.isArray(report.history) ? report.history : [];
              const max=Math.max(1,...history.map(x=>Number(x.units)||0));
              return <>
                <div className="nisti-sales-modal-metrics">
                  <div><span>Vendas do mês</span><strong>{report.month_units == null ? 'Sem importação' : display(report.month_units)+' un.'}</strong></div>
                  <div><span>Saída por dia</span><strong>{report.daily_average == null ? '—' : display(report.daily_average)+' un.'}</strong></div>
                  <div><span>Projeção do mês</span><strong>{report.month_projection == null ? '—' : display(report.month_projection)+' un.'}</strong></div>
                  <div><span>Média mensal histórica</span><strong>{report.historic_monthly_average == null ? '—' : display(report.historic_monthly_average)+' un.'}</strong></div>
                </div>
                <div className="nisti-sales-chart-heading">
                  <div><h4>Evolução das vendas</h4><small>Unidades por mês com dados importados</small></div>
                  {history.length>1 && <span>{history[history.length-1].month} · {display(history[history.length-1].units)} un.</span>}
                </div>
                <SalesTrendChart history={history} mode={salesChartType} />
                <div className="nisti-sales-monthly-table">
                  {history.map(row=><div key={row.month}>
                    <span>{row.month.slice(5)}/{row.month.slice(0,4)}</span>
                    <strong>{display(row.units)} un.</strong>
                  </div>)}
                </div>
                <p className="nisti-sales-modal-note">{report.month_units == null
                  ? 'O mês atual ainda não possui dados importados. Nenhuma projeção foi calculada.'
                  : `Vendas registradas até ${String(report.recorded_until || '').split('-').reverse().join('/')}. A projeção é uma estimativa, não uma venda realizada.`}</p>
              </>;
            })()}
          </section>
        </div>
      )}

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
    </div>
  );
}

export default CatalogView;
