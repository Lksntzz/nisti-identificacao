import React, { useEffect, useMemo, useRef, useState } from 'react';
import './commerce-sales-product-performance.css';

const PAGE_SIZE = 50;
const EXPORT_SIZE = 250;

function brNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function brCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function csvCell(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

async function loadPerformance(context, situation = 'TODOS', offset = 0, limit = PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set('platform', context.platform || 'TODAS');
  if (context.periodStart) params.set('period_start', context.periodStart);
  if (context.periodEnd) params.set('period_end', context.periodEnd);
  if (context.search) params.set('search', context.search);
  params.set('situation', situation || 'TODOS');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const response = await fetch('/api/admin/commerce/sales/product-performance?' + params.toString(), {
    credentials: 'same-origin',
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o desempenho por produto.');
  return payload;
}

const SITUATION_OPTIONS = [
  { value: 'TODOS', label: 'Todas as situações' },
  { value: 'VENDEU', label: 'Vendeu' },
  { value: 'NAO_VENDEU', label: 'Não vendeu' },
  { value: 'VENDE_OUTRA_PLATAFORMA', label: 'Vende em outra plataforma' },
  { value: 'SEM_ANUNCIO', label: 'Sem anúncio' }
];

const STATUS = {
  VENDEU: { label: 'Vendeu', className: 'sold' },
  NAO_VENDEU: { label: 'Não vendeu', className: 'no-sales' },
  VENDE_OUTRA_PLATAFORMA: { label: 'Vende em outra plataforma', className: 'elsewhere' },
  SEM_ANUNCIO: { label: 'Sem anúncio', className: 'no-listing' }
};

function situationMeta(value) {
  return STATUS[value] || { label: value || '—', className: 'no-listing' };
}

function ProductThumb({ item }) {
  const [failed, setFailed] = useState(false);
  const letter = String(item.product_name || item.master_sku || '?').trim().charAt(0).toUpperCase();
  if (!item.image_url || failed) return <span className="spp-thumb fallback">{letter}</span>;
  return <img className="spp-thumb" src={item.image_url} alt="" onError={() => setFailed(true)} />;
}

function PlatformCell({ data }) {
  const units = Number(data?.units || 0);
  if (!data?.has_listing && units <= 0) return <span className="spp-platform-value absent">—</span>;
  if (units <= 0) return <span className="spp-platform-value zero">0</span>;
  return <strong className="spp-platform-value sold">{brNumber(units)} un.</strong>;
}

function StatusChip({ value }) {
  const meta = situationMeta(value);
  return <span className={'spp-status ' + meta.className}><i />{meta.label}</span>;
}

function SummaryCard({ icon, label, value, helper, tone }) {
  return (
    <article className={'spp-summary-card ' + tone}>
      <span className="spp-summary-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{brNumber(value)}</strong>
        <small>{helper}</small>
      </div>
    </article>
  );
}

function SituationSummary({ summary, active, onSelect }) {
  const total = Number(summary?.analyzed || 0);
  const rows = [
    { key: 'VENDEU', label: 'Vendeu', value: Number(summary?.sold || 0), color: '#159a55' },
    { key: 'NAO_VENDEU', label: 'Não vendeu', value: Number(summary?.no_sales || 0), color: '#ef4d5a' },
    { key: 'VENDE_OUTRA_PLATAFORMA', label: 'Vende em outra plataforma', value: Number(summary?.sells_elsewhere || 0), color: '#f0ad22' },
    { key: 'SEM_ANUNCIO', label: 'Sem anúncio', value: Number(summary?.no_listing || 0), color: '#9aa6b6' }
  ];

  let cursor = 0;
  const gradient = rows.map(row => {
    const pct = total > 0 ? row.value / total * 100 : 0;
    const start = cursor;
    cursor += pct;
    return row.color + ' ' + start + '% ' + cursor + '%';
  }).join(',');

  return (
    <section className="spp-side-card">
      <div className="spp-side-head">
        <div><span className="spp-side-head-icon">◔</span><div><strong>Resumo por situação</strong><small>Distribuição dos produtos no período.</small></div></div>
      </div>

      <div className="spp-situation-summary">
        <button
          type="button"
          className="spp-donut"
          style={{ background: 'conic-gradient(' + (gradient || '#e5e7eb 0 100%') + ')' }}
          onClick={() => onSelect('TODOS')}
          title="Mostrar todas as situações"
        >
          <span><strong>{brNumber(total)}</strong><small>produtos<br/>analisados</small></span>
        </button>

        <div className="spp-situation-list">
          {rows.map(row => {
            const pct = total > 0 ? row.value / total * 100 : 0;
            return (
              <button
                type="button"
                key={row.key}
                className={active === row.key ? 'active' : ''}
                onClick={() => onSelect(row.key)}
              >
                <span className="spp-situation-name"><i style={{ background: row.color }} />{row.label}</span>
                <strong>{brNumber(row.value)}</strong>
                <small>{pct.toFixed(1).replace('.', ',')}%</small>
                <em><i style={{ width: Math.max(0, Math.min(100, pct)) + '%', background: row.color }} /></em>
              </button>
            );
          })}
        </div>
      </div>

      <div className="spp-explain">
        <strong>Entenda as situações</strong>
        <p><i className="sold" /><b>Vendeu:</b> vendeu em todas as plataformas onde possui anúncio no filtro atual.</p>
        <p><i className="no-sales" /><b>Não vendeu:</b> possui anúncio, mas não teve venda em nenhuma plataforma no período.</p>
        <p><i className="elsewhere" /><b>Vende em outra plataforma:</b> vende em uma plataforma, mas existe outra com anúncio zerado.</p>
        <p><i className="no-listing" /><b>Sem anúncio:</b> não há anúncio identificado nas plataformas analisadas.</p>
      </div>
    </section>
  );
}

function ListingLinks({ item }) {
  const links = [
    ['Shopee', item.shopee],
    ['ML Novo', item.ml_novo],
    ['ML Antigo', item.ml_antigo]
  ].filter(([, data]) => data?.has_listing || data?.url);

  return (
    <div className="spp-listing-links">
      <strong>Anúncios do produto</strong>
      <div>
        {links.map(([label, data]) => data?.url
          ? <a key={label} href={data.url} target="_blank" rel="noreferrer">{label} ↗</a>
          : <span key={label}>{label} · cadastrado</span>
        )}
        {!links.length && <span>Nenhum anúncio identificado.</span>}
      </div>
    </div>
  );
}

export default function CommerceSalesProductPerformance({ context }) {
  const [data, setData] = useState(null);
  const [situation, setSituation] = useState('TODOS');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const stableContext = useMemo(() => ({
    platform: context?.platform || 'TODAS',
    periodStart: context?.periodStart || '',
    periodEnd: context?.periodEnd || '',
    search: context?.search || ''
  }), [context?.platform, context?.periodStart, context?.periodEnd, context?.search]);

  useEffect(() => {
    setOffset(0);
    setSituation('TODOS');
    setExpanded(null);
  }, [stableContext.platform, stableContext.periodStart, stableContext.periodEnd, stableContext.search]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    loadPerformance(stableContext, situation, offset)
      .then(payload => {
        if (requestId !== requestRef.current) return;
        setData(payload);
      })
      .catch(err => {
        if (requestId !== requestRef.current) return;
        setError(err.message || 'Falha ao carregar produtos.');
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
  }, [stableContext, situation, offset]);

  const summary = data?.summary || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const pagination = data?.pagination || {};
  const totalPages = Math.max(1, Math.ceil(Number(pagination.total || 0) / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function setSituationAndReset(value) {
    setSituation(value);
    setOffset(0);
    setExpanded(null);
  }

  async function exportRows() {
    setExporting(true);
    setError('');
    try {
      const total = Number(pagination.total || 0);
      const all = [];
      let nextOffset = 0;
      while (nextOffset < total) {
        const page = await loadPerformance(stableContext, situation, nextOffset, EXPORT_SIZE);
        const rows = Array.isArray(page.items) ? page.items : [];
        all.push(...rows);
        const step = Number(page.pagination?.limit || rows.length || 0);
        if (!rows.length || step <= 0) break;
        nextOffset += step;
      }

      const header = ['Produto','SKU Mestre','Shopee','ML Novo','ML Antigo','Total','Situação','Faturamento','Shopee URL','ML Novo URL','ML Antigo URL'];
      const rows = all.map(item => [
        item.product_name,
        item.master_sku,
        item.shopee?.units || 0,
        item.ml_novo?.units || 0,
        item.ml_antigo?.units || 0,
        item.total_units || 0,
        situationMeta(item.situation).label,
        Number(item.total_revenue || 0).toFixed(2).replace('.', ','),
        item.shopee?.url || '',
        item.ml_novo?.url || '',
        item.ml_antigo?.url || ''
      ]);
      const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'desempenho_produtos_nisti.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Não foi possível exportar os produtos.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="spp-root">
      <section className="spp-summary-grid">
        <SummaryCard icon="◇" tone="blue" label="Produtos analisados" value={summary.analyzed} helper="Total de Produtos Mestre no filtro" />
        <SummaryCard icon="↗" tone="green" label="Produtos com venda" value={summary.sold} helper="Vendem nas plataformas onde estão anunciados" />
        <SummaryCard icon="⊘" tone="red" label="Produtos sem venda" value={summary.no_sales} helper="Anunciados, mas zerados no período" />
        <SummaryCard icon="▱" tone="amber" label="Vendem em outra plataforma" value={summary.sells_elsewhere} helper="Há demanda, mas existe anúncio zerado" />
      </section>

      {error && <div className="spp-error">{error}</div>}

      <div className="spp-main-grid">
        <section className="spp-table-card">
          <div className="spp-table-head">
            <div>
              <span className="spp-title-icon">◇</span>
              <div>
                <h3>Desempenho por Produto</h3>
                <p>Cruza o Produto Mestre / SKU do NISTI ID entre as plataformas.</p>
              </div>
            </div>
            <div className="spp-table-actions">
              <label>Situação
                <select value={situation} onChange={event => setSituationAndReset(event.target.value)} disabled={loading}>
                  {(data?.options?.situations?.length ? data.options.situations : SITUATION_OPTIONS).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button type="button" onClick={exportRows} disabled={loading || exporting || !pagination.total}>{exporting ? 'Exportando…' : 'Exportar'}</button>
            </div>
          </div>

          <div className="spp-table-wrap">
            <table className="spp-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Shopee</th>
                  <th className="num">ML Novo</th>
                  <th className="num">ML Antigo</th>
                  <th className="num">Total</th>
                  <th>Situação</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {!loading && items.map(item => {
                  const hasAnyListing = item.shopee?.has_listing || item.ml_novo?.has_listing || item.ml_antigo?.has_listing;
                  return (
                    <React.Fragment key={item.product_id}>
                      <tr className={'spp-row ' + situationMeta(item.situation).className}>
                        <td>
                          <div className="spp-product">
                            <ProductThumb item={item} />
                            <div>
                              <strong>{item.product_name || 'Produto sem nome'}</strong>
                              <small>SKU: {item.master_sku || '—'}{item.nisti_product_id ? ' · NISTI #' + item.nisti_product_id : ''}</small>
                            </div>
                          </div>
                        </td>
                        <td className="num"><PlatformCell data={item.shopee} /></td>
                        <td className="num"><PlatformCell data={item.ml_novo} /></td>
                        <td className="num"><PlatformCell data={item.ml_antigo} /></td>
                        <td className="num total"><strong>{brNumber(item.total_units)}</strong></td>
                        <td><StatusChip value={item.situation} /></td>
                        <td>
                          {hasAnyListing ? (
                            <button type="button" className="spp-link-button" onClick={() => setExpanded(current => current === item.product_id ? null : item.product_id)}>
                              {expanded === item.product_id ? 'Fechar' : 'Ver anúncios'}
                            </button>
                          ) : (
                            <span className="spp-no-action">Sem anúncio</span>
                          )}
                        </td>
                      </tr>
                      {expanded === item.product_id && (
                        <tr className="spp-expanded-row">
                          <td colSpan="7"><ListingLinks item={item} /></td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!loading && !items.length && <tr><td colSpan="7" className="spp-empty">Nenhum produto encontrado neste filtro.</td></tr>}
                {loading && <tr><td colSpan="7" className="spp-empty">Carregando desempenho por produto…</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="spp-pagination">
            <span>{brNumber(pagination.total || 0)} produtos · Página {currentPage} de {totalPages}</span>
            <div>
              <button type="button" disabled={loading || currentPage <= 1} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
              <button type="button" disabled={loading || currentPage >= totalPages} onClick={() => setOffset(offset + PAGE_SIZE)}>Próxima</button>
            </div>
          </div>
        </section>

        <aside className="spp-sidebar">
          <SituationSummary summary={summary} active={situation} onSelect={setSituationAndReset} />
        </aside>
      </div>
    </div>
  );
}
