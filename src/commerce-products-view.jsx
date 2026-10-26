import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import {
  COMMERCE_MARKETPLACES,
  COMMERCE_PAGE_SIZE,
  CommerceEmptyState,
  CommerceLoadingBlock,
  CommerceStatusPill,
  commerceFormatNumber,
  commerceStatusLabel
} from './commerce-admin-shared.jsx';
import ProductCutoutImage from './product-cutout-image.jsx';
import './commerce-planning-layout.css';
import './commerce-listing-state.css';

const MARKETPLACE_LABELS = Object.freeze({
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  SHEIN: 'Shein',
  MAGALU: 'Magalu',
  ALIEXPRESS: 'AliExpress',
  TIKTOK: 'TikTok Shop',
  KAWAI: 'Kwai',
  LOJA_INTEGRADA: 'Loja Integrada'
});

function marketplaceLabel(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (MARKETPLACE_LABELS[normalized]) return MARKETPLACE_LABELS[normalized];
  return normalized
    ? normalized.toLowerCase().split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : 'Plataforma';
}

function coverageInfo(marketplaceCodes = []) {
  const codes = Array.isArray(marketplaceCodes) ? marketplaceCodes.filter(Boolean) : [];
  if (codes.length === 0) return { kind: 'none', label: 'Sem anúncio' };
  if (codes.length === 1) return { kind: 'exclusive', label: 'Exclusivo' };
  return { kind: 'multi', label: 'Multiplataforma' };
}

function formatDate(value) {
  if (!value) return 'Nunca verificado';
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
    return 'Data inválida';
  }
}

function ProductImage({ product, className }) {
  return (
    <ProductCutoutImage
      className={className}
      src={product?.thumbnail_url}
      alt={product?.name || `Produto #${product?.product_id || ''}`}
      fallback={<div className={`${className} commerce-image-placeholder`}>Sem foto</div>}
    />
  );
}

function ProductCoverage({ marketplaceCodes = [], compact = false }) {
  const coverage = coverageInfo(marketplaceCodes);
  return (
    <div className={`commerce-product-coverage ${compact ? 'compact' : ''}`}>
      <span className={`commerce-coverage-tag ${coverage.kind}`}>{coverage.label}</span>
      {marketplaceCodes.length ? (
        <div className="commerce-platform-tags">
          {marketplaceCodes.map(code => (
            <span className="commerce-platform-tag" key={code}>{marketplaceLabel(code)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SalesPlanningCard({ report, loading, error }) {
  if (loading) return <div className="nisti-product-planning is-loading">Consultando vendas importadas…</div>;
  if (error) return <div className="nisti-product-planning unavailable" title={error}>Indicadores temporariamente indisponíveis.</div>;
  if (!report) return <div className="nisti-product-planning unavailable">Sem dados de planejamento.</div>;
  const hasCurrent = report.month_units !== null && report.month_units !== undefined;
  const importedHistory = Number(report.historic_months_imported || 0);
  const format = number => commerceFormatNumber(Number(number || 0));
  const history = Array.isArray(report.history) ? report.history : [];
  return (
    <div className="nisti-product-planning">
      <div className="nisti-product-planning-metrics">
        <div><span>Vendas do mês</span><strong>{hasCurrent ? format(report.month_units) + ' un.' : 'Sem importação'}</strong></div>
        <div><span>Saída diária</span><strong>{hasCurrent && report.daily_average != null ? Number(report.daily_average).toLocaleString('pt-BR',{maximumFractionDigits:2}) + ' un.' : '—'}</strong></div>
        <div><span>Projeção do mês</span><strong>{report.month_projection != null ? format(report.month_projection) + ' un.' : '—'}</strong></div>
        <div><span>Média histórica</span><strong>{importedHistory && report.historic_monthly_average != null ? Number(report.historic_monthly_average).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' un.' : '—'}</strong></div>
      </div>
      {history.length ? (
        <div className="nisti-product-planning-history" aria-label="Histórico mensal de unidades vendidas">
          {history.map(item => (
            <div key={item.month}><span>{String(item.month).slice(5)}/{String(item.month).slice(2,4)}</span><strong>{format(item.units)}</strong></div>
          ))}
        </div>
      ) : <small>Sem histórico de vendas importado.</small>}
      <small>{hasCurrent
        ? `Dados importados até ${String(report.recorded_until || '').split('-').reverse().join('/')}. Projeção estimada, não representa vendas realizadas.`
        : 'Mês atual sem dados importados; não é possível projetar a saída.'}</small>
    </div>
  );
}

function ProductStateEditor({ product, busy, onClose, onSave }) {
  const [internalStatus, setInternalStatus] = useState(product.internal_status || 'DRAFT');
  const marketplaceCodes = Array.isArray(product.marketplace_codes) ? product.marketplace_codes : [];

  return (
    <div className="commerce-listing-state-backdrop" onClick={onClose}>
      <aside className="commerce-listing-state-panel" onClick={event => event.stopPropagation()}>
        <div className="commerce-listing-state-head">
          <div>
            <span>Produto Mestre #{product.product_id}</span>
            <h3>{product.name}</h3>
            <small>{product.current_sku || 'SKU não informado'}</small>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>Fechar</button>
        </div>

        <div className="commerce-listing-state-context">
          <div><span>Categoria</span><strong>{product.category_name || '—'}</strong></div>
          <div><span>Cobertura</span><strong>{coverageInfo(marketplaceCodes).label}</strong></div>
          <div><span>Anúncios</span><strong>{commerceFormatNumber(product.listing_count || 0)}</strong></div>
        </div>

        <div className="commerce-listing-state-form">
          <label>
            <span>Status do Produto Mestre</span>
            <select value={internalStatus} onChange={event => setInternalStatus(event.target.value)} disabled={busy}>
              <option value="DRAFT">Rascunho</option>
              <option value="ACTIVE">Ativo</option>
              <option value="DISCONTINUED">Descontinuado</option>
            </select>
            <small>
              Ative apenas produtos comercialmente válidos. Use Descontinuado quando o produto não deve mais operar, sem apagar seu histórico.
            </small>
          </label>
        </div>

        <div className="commerce-listing-state-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button
            type="button"
            onClick={() => onSave({ internalStatus })}
            disabled={busy || internalStatus === product.internal_status}
          >
            {busy ? 'Salvando…' : 'Salvar revisão'}
          </button>
        </div>
      </aside>
    </div>
  );
}

function ListingPlatformCard({ listing }) {
  return (
    <article className="commerce-platform-listing-card">
      <div className="commerce-platform-listing-media">
        <ProductCutoutImage
          src={listing.image_url}
          alt={listing.title || `Anúncio #${listing.listing_id}`}
          fallback={<div className="commerce-image-placeholder">Sem foto</div>}
        />
        {listing.image_source === 'OTHER_MARKETPLACE' ? (
          <small>Mesma foto do produto · {listing.image_source_marketplace_name || marketplaceLabel(listing.image_source_marketplace_code)}</small>
        ) : null}
        {listing.image_source === 'NISTI_ID' ? <small>Imagem NISTI ID</small> : null}
      </div>

      <div className="commerce-platform-listing-copy">
        <div className="commerce-platform-listing-title">
          <div>
            <span>Anúncio #{listing.listing_id}</span>
            <h4>{listing.title || 'Título não capturado'}</h4>
          </div>
          {listing.canonical_url ? (
            <a href={listing.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio</a>
          ) : null}
        </div>

        <div className="commerce-platform-listing-meta">
          <div><span>ID da plataforma</span><strong>{listing.external_listing_id || '—'}</strong></div>
          <div><span>SKU na plataforma</span><strong>{listing.platform_sku || '—'}</strong></div>
          <div><span>Variação</span><strong>{listing.variation_name || '—'}</strong></div>
          <div><span>Última verificação</span><strong>{formatDate(listing.last_checked_at)}</strong></div>
        </div>

        {listing.marketplace_category ? (
          <div className="commerce-platform-category">
            <span>Categoria da plataforma</span>
            <strong>{listing.marketplace_category}</strong>
          </div>
        ) : null}

        <div className="commerce-platform-statuses">
          <div><span>Anúncio</span><CommerceStatusPill value={listing.listing_status} /></div>
          <div><span>Venda</span><CommerceStatusPill value={listing.sales_status} /></div>
          <div><span>Vídeo</span><CommerceStatusPill value={listing.video_status} /></div>
        </div>
      </div>
    </article>
  );
}

function ProductPlatformDrawer({
  product,
  detail,
  loading,
  error,
  activePlatform,
  onPlatformChange,
  onClose,
  onReviewStatus
}) {
  const marketplaces = Array.isArray(detail?.marketplaces) ? detail.marketplaces : [];
  const active = marketplaces.find(item => item.code === activePlatform) || marketplaces[0] || null;
  const codes = marketplaces.map(item => item.code);

  return (
    <div className="commerce-listing-state-backdrop" onClick={onClose}>
      <aside className="commerce-product-detail-panel" onClick={event => event.stopPropagation()}>
        <div className="commerce-product-detail-head">
          <ProductImage product={product} className="commerce-product-detail-image" />
          <div className="commerce-product-detail-heading">
            <span>Produto Mestre #{product.product_id}</span>
            <h3>{product.name}</h3>
            <code>{product.current_sku || 'SKU não informado'}</code>
            <ProductCoverage marketplaceCodes={codes.length ? codes : (product.marketplace_codes || [])} compact />
          </div>
          <button type="button" className="commerce-detail-close" onClick={onClose}>Fechar</button>
        </div>

        <div className="commerce-product-detail-summary">
          <div><span>Categoria</span><strong>{detail?.category_name || product.category_name || '—'}</strong></div>
          <div><span>Tipo</span><strong>{commerceStatusLabel(detail?.temporal_type || product.temporal_type)}</strong></div>
          <div><span>Anúncios</span><strong>{commerceFormatNumber(detail?.listing_count ?? product.listing_count ?? 0)}</strong></div>
          <div><span>Status</span><CommerceStatusPill value={detail?.internal_status || product.internal_status} /></div>
        </div>

        {loading ? (
          <CommerceLoadingBlock label="Carregando informações das plataformas…" />
        ) : error ? (
          <div className="commerce-error commerce-product-detail-error">{error}</div>
        ) : marketplaces.length ? (
          <>
            <div className="commerce-platform-tabs" role="tablist" aria-label="Plataformas do produto">
              {marketplaces.map(item => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active?.code === item.code}
                  className={active?.code === item.code ? 'active' : ''}
                  key={item.code}
                  onClick={() => onPlatformChange(item.code)}
                >
                  <span>{item.name || marketplaceLabel(item.code)}</span>
                  <small>{commerceFormatNumber(item.listing_count || 0)}</small>
                </button>
              ))}
            </div>

            <section className="commerce-platform-detail-section">
              <div className="commerce-platform-detail-title">
                <div>
                  <span>Informações da plataforma</span>
                  <h4>{active?.name || marketplaceLabel(active?.code)}</h4>
                </div>
                <strong>{commerceFormatNumber(active?.listing_count || 0)} anúncio(s)</strong>
              </div>

              <div className="commerce-platform-listings">
                {(active?.listings || []).map(listing => (
                  <ListingPlatformCard key={listing.listing_id} listing={listing} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <CommerceEmptyState
            title="Produto sem anúncio vinculado"
            detail="O Produto Mestre existe no catálogo, mas ainda não possui uma plataforma comercial vinculada."
          />
        )}

        <div className="commerce-product-detail-actions">
          <button type="button" className="secondary" onClick={onClose}>Fechar</button>
          <button type="button" onClick={() => onReviewStatus(product)}>Revisar status do produto</button>
        </div>
      </aside>
    </div>
  );
}

const PLANNING_COLUMNS = Object.freeze([
  { key: 'name', label: 'Produto', get: (p) => String(p.name || '').toLowerCase() },
  { key: 'status', label: 'Estado', get: (p) => String(p.internal_status || '') },
  { key: 'platforms', label: 'Plataformas', get: (p) => (p.marketplace_codes || []).length },
  { key: 'month_units', label: 'Vendas do mês', num: true, get: (p, r) => r?.month_units },
  { key: 'daily_average', label: 'Saída diária', num: true, get: (p, r) => r?.daily_average },
  { key: 'month_projection', label: 'Projeção do mês', num: true, get: (p, r) => r?.month_projection },
  { key: 'historic_monthly_average', label: 'Média histórica', num: true, get: (p, r) => r?.historic_monthly_average }
]);

function PlanningTable({ items, reports, busy, error, onOpen, onReview }) {
  const [sort, setSort] = useState({ key: '', dir: 'desc' });
  const fmt = (value, digits = 0) => value === null || value === undefined ? '—'
    : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits });
  const rows = React.useMemo(() => {
    const column = PLANNING_COLUMNS.find(item => item.key === sort.key);
    if (!column) return items;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...items].sort((left, right) => {
      const a = column.get(left, reports[Number(left.product_id)]);
      const b = column.get(right, reports[Number(right.product_id)]);
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return (a > b ? 1 : a < b ? -1 : 0) * factor;
    });
  }, [items, reports, sort]);
  const recordedUntil = Object.values(reports).map(item => item?.recorded_until).filter(Boolean)[0];
  const toggle = key => setSort(current => current.key === key
    ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' });
  return (
    <div className="nisti-planning-table-wrap">
      {error ? <p className="nisti-planning-note is-error">Indicadores temporariamente indisponíveis.</p>
        : busy ? <p className="nisti-planning-note">Consultando vendas importadas…</p>
        : <p className="nisti-planning-note">
            {recordedUntil ? `Vendas importadas até ${String(recordedUntil).split('-').reverse().join('/')}. ` : ''}
            Projeção é estimativa, não representa vendas realizadas. Clique no título de uma coluna para ordenar esta página.
          </p>}
      <div className="nisti-planning-scroll">
        <table className="nisti-planning-table" aria-label="Planejamento de produtos">
          <thead>
            <tr>
              {PLANNING_COLUMNS.map(column => (
                <th key={column.key} className={column.num ? 'num' : ''}
                  aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => toggle(column.key)}>
                    {column.label}{sort.key === column.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
              <th className="actions"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(product => {
              const id = Number(product.product_id || 0);
              const report = reports[id];
              const hasCurrent = report && report.month_units !== null && report.month_units !== undefined;
              const history = Array.isArray(report?.history) ? report.history : [];
              const historyText = history.length
                ? 'Histórico: ' + history.map(item => `${String(item.month).slice(5)}/${String(item.month).slice(2, 4)}: ${fmt(item.units)}`).join(' · ')
                : 'Sem histórico de vendas importado';
              const codes = Array.isArray(product.marketplace_codes) ? product.marketplace_codes : [];
              const coverage = coverageInfo(codes);
              return (
                <tr key={id} onClick={() => onOpen(product)} title="Abrir plataformas deste produto">
                  <td className="product">
                    <div className="nisti-planning-product">
                      <ProductImage product={product} className="nisti-planning-thumb" />
                      <div><strong>{product.name}</strong><code>{product.current_sku || 'SKU não informado'}</code></div>
                    </div>
                  </td>
                  <td><CommerceStatusPill value={product.internal_status} /></td>
                  <td>
                    <span className={`commerce-coverage-tag ${coverage.kind}`}>{coverage.label}</span>
                    {codes.length ? <small className="nisti-planning-platforms">{codes.map(marketplaceLabel).join(', ')}</small> : null}
                  </td>
                  <td className="num">{hasCurrent ? fmt(report.month_units) : '—'}</td>
                  <td className="num">{hasCurrent ? fmt(report.daily_average, 2) : '—'}</td>
                  <td className="num">{fmt(report?.month_projection)}</td>
                  <td className="num" title={historyText}>{Number(report?.historic_months_imported || 0) ? fmt(report.historic_monthly_average, 1) : '—'}</td>
                  <td className="actions" onClick={event => event.stopPropagation()}>
                    <button type="button" className="commerce-card-review-button" onClick={() => onReview(product)}>Revisar status</button>
                    <button type="button" className="commerce-card-detail-button" onClick={() => onOpen(product)}>Ver plataformas</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CommerceProductsView() {
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [presence, setPresence] = useState('ALL');
  const [historyMonths, setHistoryMonths] = useState(3);
  const [salesPlanning, setSalesPlanning] = useState({});
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stateProduct, setStateProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [activePlatform, setActivePlatform] = useState('');
  const [saving, setSaving] = useState(false);

  async function load(nextOffset = offset) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(COMMERCE_PAGE_SIZE), offset: String(nextOffset) });
    if (search.trim()) params.set('search', search.trim());
    if (marketplace) params.set('marketplace', marketplace);
    if (status) params.set('status', status);
    if (presence !== 'ALL') params.set('presence', presence);
    try {
      const result = await commerceApi(`/api/admin/commerce/products?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, [marketplace, status, presence]);

  useEffect(() => {
    const ids = (data.items || []).map(item => Number(item.product_id)).filter(Number.isSafeInteger);
    if (!ids.length) { setSalesPlanning({}); setPlanningError(''); return; }
    let cancelled = false;
    setPlanningBusy(true);
    setPlanningError('');
    const params = new URLSearchParams({ids:ids.join(','),platform:marketplace || 'TODAS',months:String(historyMonths)});
    commerceApi('/api/admin/commerce/products/sales-planning?' + params)
      .then(result => {
        if (cancelled) return;
        const reports = Object.fromEntries((result.items || []).map(item => [item.product_id,item]));
        setSalesPlanning(reports);
      })
      .catch(error => { if (!cancelled) { setPlanningError(error.message || 'Falha ao consultar vendas.'); setSalesPlanning({}); } })
      .finally(() => { if (!cancelled) setPlanningBusy(false); });
    return () => { cancelled = true; };
  }, [data.items, marketplace, historyMonths]);

  async function openProductDetail(product) {
    const productId = Number(product?.product_id || 0);
    if (!productId) return;
    setDetailProduct(product);
    setDetail(null);
    setDetailError('');
    setActivePlatform('');
    setDetailLoading(true);
    try {
      const result = await commerceApi(`/api/admin/commerce/products/${productId}/details`);
      setDetail(result || {});
      const marketplaces = Array.isArray(result?.marketplaces) ? result.marketplaces : [];
      setActivePlatform(marketplaces[0]?.code || '');
    } catch (err) {
      setDetailError(err.message || 'Não foi possível carregar as plataformas deste produto.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveProductState(values) {
    const productId = Number(stateProduct?.product_id || 0);
    if (!productId) return;

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await commerceApi(`/api/admin/commerce/products/${productId}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ internal_status: values.internalStatus })
      });

      setMessage(`Produto Mestre #${productId} atualizado para ${commerceStatusLabel(updated.internal_status)}.`);
      setStateProduct(null);
      setDetailProduct(null);
      setDetail(null);
      await load(0);
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar o Produto Mestre.');
    } finally {
      setSaving(false);
    }
  }

  const total = Number(data?.pagination?.total || 0);
  const page = Math.floor(offset / COMMERCE_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / COMMERCE_PAGE_SIZE));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Produtos Mestre</h2>
          <p>Visão central por produto. A tag mostra se ele é exclusivo de uma plataforma ou está publicado em múltiplas plataformas.</p>
        </div>
        <div className="commerce-filter-row nisti-planning-filters">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome ou SKU" />
            <button type="submit">Buscar</button>
          </form>
          <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
            {COMMERCE_MARKETPLACES.map(([code, label]) => <option key={code || 'all'} value={code}>{label}</option>)}
          </select>
          <select value={presence} onChange={event => setPresence(event.target.value)} aria-label="Exclusividade dos anúncios">
            <option value="ALL">Todos os anúncios</option>
            <option value="EXCLUSIVE">Exclusivos de uma plataforma</option>
            <option value="SHARED">Anunciados em várias plataformas</option>
          </select>
          <select value={historyMonths} onChange={event => setHistoryMonths(Number(event.target.value))} aria-label="Período de planejamento">
            <option value={3}>Histórico de 3 meses</option>
            <option value={6}>Histórico de 6 meses</option>
            <option value={12}>Histórico de 12 meses</option>
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
      {message && <div className="commerce-listing-state-message">{message}</div>}

      {loading ? <CommerceLoadingBlock label="Carregando produtos…" /> : data.items?.length ? (
        <PlanningTable
          items={data.items}
          reports={salesPlanning}
          busy={planningBusy}
          error={planningError}
          onOpen={openProductDetail}
          onReview={setStateProduct}
        />
      ) : (
        <CommerceEmptyState title="Nenhum produto comercial cadastrado" detail="Os produtos aparecerão aqui após a reconciliação das fontes comerciais." />
      )}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - COMMERCE_PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + COMMERCE_PAGE_SIZE >= total || loading} onClick={() => load(offset + COMMERCE_PAGE_SIZE)}>Próxima</button>
        </div>
      </div>

      {detailProduct && (
        <ProductPlatformDrawer
          product={detailProduct}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          activePlatform={activePlatform}
          onPlatformChange={setActivePlatform}
          onClose={() => {
            setDetailProduct(null);
            setDetail(null);
            setDetailError('');
            setActivePlatform('');
          }}
          onReviewStatus={product => {
            setDetailProduct(null);
            setStateProduct(product);
          }}
        />
      )}

      {stateProduct && (
        <ProductStateEditor
          product={stateProduct}
          busy={saving}
          onClose={() => !saving && setStateProduct(null)}
          onSave={saveProductState}
        />
      )}
    </section>
  );
}
