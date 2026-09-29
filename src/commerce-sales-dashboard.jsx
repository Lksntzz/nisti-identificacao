import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './commerce-sales-dashboard.css';

const PAGE_SIZE = 100;

function brNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function brCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function monthLabel(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})(.*)$/);
  if (!match) return text || '—';
  const names = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${names[Number(match[2])] || match[2]}${match[3] || ''}`;
}

async function loadSales(filters, offset = 0) {
  const params = new URLSearchParams();
  params.set('platform', filters.platform || 'TODAS');
  if (filters.periodStart) params.set('period_start', filters.periodStart);
  if (filters.periodEnd) params.set('period_end', filters.periodEnd);
  if (filters.sku.trim()) params.set('sku', filters.sku.trim());
  params.set('status', filters.status || 'COM VENDA');
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  const response = await fetch(`/api/admin/commerce/sales/dashboard?${params.toString()}`, {
    credentials: 'same-origin',
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o Painel de Vendas.');
  return data;
}

function Metric({ label, value, helper, currency = false }) {
  return (
    <article className="sales-metric">
      <span>{label}</span>
      <strong>{currency ? brCurrency(value) : brNumber(value)}</strong>
      <small>{helper}</small>
    </article>
  );
}

function HistoryBars({ history }) {
  const maxUnits = Math.max(1, ...history.map(item => Number(item.units || 0)));
  const maxRevenue = Math.max(1, ...history.map(item => Number(item.product_revenue || 0)));
  if (!history.length) return <div className="sales-empty">Sem histórico para o filtro selecionado.</div>;
  return (
    <div className="sales-history-list">
      {history.map(item => (
        <div className="sales-history-row" key={item.period_key}>
          <div className="sales-history-label">
            <strong>{monthLabel(item.period_key)}</strong>
            <small>{brNumber(item.net_orders)} pedidos</small>
          </div>
          <div className="sales-history-bars">
            <div><span style={{ width: `${Math.max(2, Number(item.units || 0) / maxUnits * 100)}%` }} /><small>{brNumber(item.units)} un.</small></div>
            <div className="revenue"><span style={{ width: `${Math.max(2, Number(item.product_revenue || 0) / maxRevenue * 100)}%` }} /><small>{brCurrency(item.product_revenue)}</small></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CommerceSalesDashboard() {
  const [filters, setFilters] = useState({ platform: 'TODAS', periodStart: '', periodEnd: '', sku: '', status: 'COM VENDA' });
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (nextOffset = 0, nextFilters) => {
    const requestId = ++requestIdRef.current;
    const requestedFilters = nextFilters || filters;
    setLoading(true);
    setError('');
    try {
      const payload = await loadSales(requestedFilters, nextOffset);
      if (requestId !== requestIdRef.current) return;
      setData(payload);
      if (!requestedFilters.periodStart || !requestedFilters.periodEnd) {
        setFilters(current => ({
          ...current,
          periodStart: current.periodStart || payload.filters?.period_start || '',
          periodEnd: current.periodEnd || payload.filters?.period_end || ''
        }));
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Falha ao carregar vendas.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { refresh(0, filters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = data?.options || {};
  const metrics = data?.metrics || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const appliedFilters = data?.filters || {};
  const appliedStatus = appliedFilters.status || 'COM VENDA';
  const appliedPlatform = appliedFilters.platform || 'TODAS';
  const history = appliedStatus === 'SEM VENDA' ? [] : (Array.isArray(data?.history) ? data.history : []);
  const pagination = data?.pagination || {};
  const showPlatform = appliedPlatform === 'TODAS';
  const isNoSales = appliedStatus === 'SEM VENDA';
  const totalPages = Math.max(1, Math.ceil(Number(pagination.total || 0) / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const periodOptions = useMemo(() => Array.isArray(options.periods) ? options.periods : [], [options.periods]);

  const apply = () => {
    setOffset(0);
    refresh(0, filters);
  };

  const applySelectFilter = (name, value) => {
    let nextFilters = { ...filters, [name]: value };

    if (name === 'periodStart' && nextFilters.periodEnd) {
      const startIndex = periodOptions.findIndex(item => item.value === value);
      const endIndex = periodOptions.findIndex(item => item.value === nextFilters.periodEnd);
      if (startIndex >= 0 && endIndex >= 0 && startIndex > endIndex) {
        nextFilters = { ...nextFilters, periodEnd: value };
      }
    }

    if (name === 'periodEnd' && nextFilters.periodStart) {
      const startIndex = periodOptions.findIndex(item => item.value === nextFilters.periodStart);
      const endIndex = periodOptions.findIndex(item => item.value === value);
      if (startIndex >= 0 && endIndex >= 0 && endIndex < startIndex) {
        nextFilters = { ...nextFilters, periodStart: value };
      }
    }

    setFilters(nextFilters);
    setOffset(0);
    refresh(0, nextFilters);
  };

  const movePage = nextPage => {
    const nextOffset = (nextPage - 1) * PAGE_SIZE;
    setOffset(nextOffset);
    refresh(nextOffset, filters);
  };

  return (
    <div className="sales-dashboard">
      <section className="sales-filter-panel">
        <div className="sales-filter-title">
          <div><strong>Filtros de vendas</strong><span>Período contínuo, plataforma, SKU e situação de venda.</span></div>
          {data?.snapshot && <small>Base até {new Date(`${data.snapshot.data_through}T12:00:00`).toLocaleDateString('pt-BR')}</small>}
        </div>
        <div className="sales-filter-grid">
          <label>Plataforma
            <select value={filters.platform} onChange={e => applySelectFilter('platform', e.target.value)} disabled={loading}>
              {(options.platforms || [{value:'TODAS',label:'Todas'}]).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>Mês inicial
            <select value={filters.periodStart} onChange={e => applySelectFilter('periodStart', e.target.value)} disabled={loading}>
              {periodOptions.map(item => <option key={item.value} value={item.value}>{monthLabel(item.label)}</option>)}
            </select>
          </label>
          <label>Mês final
            <select value={filters.periodEnd} onChange={e => applySelectFilter('periodEnd', e.target.value)} disabled={loading}>
              {periodOptions.map(item => <option key={item.value} value={item.value}>{monthLabel(item.label)}</option>)}
            </select>
          </label>
          <label>Status de venda
            <select value={filters.status} onChange={e => applySelectFilter('status', e.target.value)} disabled={loading}>
              {(options.statuses || ['TODOS','COM VENDA','SEM VENDA']).map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="sales-sku-filter">SKU (opcional)
            <input value={filters.sku} onChange={e => setFilters(v => ({ ...v, sku: e.target.value }))} placeholder="TODOS" onKeyDown={e => e.key === 'Enter' && apply()} />
          </label>
          <button type="button" className="sales-apply" onClick={apply} disabled={loading}>{loading ? 'Carregando…' : 'Aplicar filtros'}</button>
        </div>
      </section>

      {error && <div className="sales-error">{error}</div>}

      <section className="sales-metrics">
        <Metric label="Pedidos líquidos" value={metrics.net_orders} helper={isNoSales ? 'Sem vendas no intervalo' : 'Pedidos válidos no período'} />
        <Metric label="Unidades vendidas" value={metrics.units} helper={isNoSales ? '0 unidades' : 'Quantidade líquida vendida'} />
        <Metric label="Faturamento produto" value={metrics.product_revenue} helper={isNoSales ? 'R$ 0,00' : 'Receita líquida dos produtos'} currency />
        <Metric
          label={isNoSales ? 'Itens sem venda' : 'Anúncios com venda'}
          value={isNoSales ? metrics.items_without_sales : metrics.listings_with_sales}
          helper={isNoSales ? 'Cadastrados na plataforma sem venda' : 'Anúncios distintos com venda'}
        />
      </section>

      <section className="sales-content-grid">
        <div className="sales-panel sales-items-panel">
          <div className="sales-panel-head"><div><h3>Vendas por item</h3><p>{brNumber(pagination.total)} registros no filtro atual.</p></div></div>
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead><tr>
                {showPlatform && <th>Plataforma</th>}
                <th>SKU</th><th>Produto</th><th>SKU Principal</th><th className="num">Unidades</th><th className="num">Pedidos c/ item</th><th className="num">Faturamento</th><th>Anúncio</th>
              </tr></thead>
              <tbody>
                {!loading && items.map((item, index) => (
                  <tr key={`${item.platform_code}-${item.sku}-${item.sku_primary || index}`} className={item.row_type === 'ZERO' ? 'no-sale' : ''}>
                    {showPlatform && <td><span className={`platform-tag ${String(item.platform_code || '').toLowerCase()}`}>{item.platform_label}</span></td>}
                    <td><code>{item.sku || '—'}</code></td>
                    <td className="product">{item.product_name || '—'}</td>
                    <td><code>{item.sku_primary || '—'}</code></td>
                    <td className="num">{brNumber(item.units)}</td>
                    <td className="num">{brNumber(item.orders_with_item)}</td>
                    <td className="num">{brCurrency(item.product_revenue)}</td>
                    <td>{item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : '—'}</td>
                  </tr>
                ))}
                {!loading && !items.length && <tr><td colSpan={showPlatform ? 8 : 7} className="sales-empty-cell">Nenhum item encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="sales-pagination">
            <span>Página {currentPage} de {totalPages}</span>
            <div><button disabled={loading || currentPage <= 1} onClick={() => movePage(currentPage - 1)}>Anterior</button><button disabled={loading || currentPage >= totalPages} onClick={() => movePage(currentPage + 1)}>Próxima</button></div>
          </div>
        </div>

        <div className="sales-panel sales-history-panel">
          <div className="sales-panel-head"><div><h3>Histórico mensal</h3><p>Unidades e faturamento no intervalo.</p></div></div>
          <HistoryBars history={history} />
        </div>
      </section>
    </div>
  );
}
