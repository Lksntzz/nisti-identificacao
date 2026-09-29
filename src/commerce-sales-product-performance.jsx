import React, { useEffect, useMemo, useRef, useState } from 'react';
import './commerce-sales-product-performance.css';

const PAGE_SIZE = 50;
const EXPORT_SIZE = 250;
const PLATFORM_DEFS = [
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'ML_NOVO', label: 'ML Novo' },
  { value: 'ML_ANTIGO', label: 'ML Antigo' }
];

const SITUATION_OPTIONS = [
  { value: 'TODOS', label: 'Todas as situações' },
  { value: 'VENDEU', label: 'Vendeu' },
  { value: 'NAO_VENDEU', label: 'Não vendeu' },
  { value: 'VENDE_OUTRA_PLATAFORMA', label: 'Vende em outra plataforma' },
  { value: 'SEM_ANUNCIO', label: 'Sem anúncio' }
];

const STATUS = {
  VENDEU: { label: 'Vendeu', className: 'sold' },
  NAO_VENDEU: { label: 'Sem venda', className: 'no-sales' },
  VENDE_OUTRA_PLATAFORMA: { label: 'Vende em outra plataforma', className: 'elsewhere' },
  SEM_ANUNCIO: { label: 'Sem anúncio', className: 'no-listing' }
};

function brNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function brCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function periodLabel(value, compact = false) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})(.*)$/);
  if (!match) return text || '—';
  const month = compact
    ? ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    : ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return month[Number(match[2])] || match[2];
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

function useAnimatedNumber(value, duration = 560) {
  const target = Number(value || 0);
  const previous = useRef(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = previous.current;
    const delta = target - start;
    const started = performance.now();
    let frame = 0;

    const animate = now => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + delta * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      } else {
        previous.current = target;
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return Math.round(display);
}

function MetricIcon({ type }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  };
  if (type === 'sold') return <svg {...common}><path d="M4 17 9 12l4 3 7-9" /><path d="M15 6h5v5" /></svg>;
  if (type === 'no-sales') return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="m7 17 10-10" /></svg>;
  if (type === 'elsewhere') return <svg {...common}><path d="M5 8h12" /><path d="m14 5 3 3-3 3" /><path d="M19 16H7" /><path d="m10 13-3 3 3 3" /></svg>;
  if (type === 'no-listing') return <svg {...common}><path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5Z" /><path d="m4 4 16 16" /></svg>;
  return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5" /><path d="M12 12v9" /></svg>;
}

function SummaryCard({ type, label, value, helper }) {
  const display = useAnimatedNumber(value);
  return (
    <article className={'spp-kpi ' + type}>
      <span className="spp-kpi-icon"><MetricIcon type={type} /></span>
      <div>
        <span>{label}</span>
        <strong>{brNumber(display)}</strong>
        <small>{helper}</small>
      </div>
    </article>
  );
}

function DecisionCard({ type, title, value, helper, onClick }) {
  const display = useAnimatedNumber(value);
  return (
    <button type="button" className={'spp-decision ' + type} onClick={onClick}>
      <span className="spp-decision-icon">
        {type === 'deactivate' ? '✓' : type === 'review' ? '↗' : '+'}
      </span>
      <div>
        <span>{title}</span>
        <strong>{brNumber(display)}</strong>
        <small>{helper}</small>
      </div>
      <b>›</b>
    </button>
  );
}

function situationMeta(value) {
  return STATUS[value] || { label: value || '—', className: 'no-listing' };
}

function recommendationFor(item) {
  if (item.situation === 'NAO_VENDEU') {
    return { label: 'Revisar p/ desativar', className: 'deactivate', detail: 'Sem venda em nenhuma plataforma no período.' };
  }
  if (item.situation === 'VENDE_OUTRA_PLATAFORMA') {
    return { label: 'Tem oportunidade', className: 'opportunity', detail: 'Há demanda, mas algum anúncio está zerado.' };
  }
  if (item.situation === 'SEM_ANUNCIO') {
    return { label: 'Criar anúncio', className: 'create', detail: 'Produto sem anúncio identificado.' };
  }
  return { label: 'Manter', className: 'keep', detail: 'Produto com venda nas plataformas anunciadas.' };
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

function SituationDonut({ summary, active, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const total = Number(summary?.analyzed || 0);
  const rows = [
    { key: 'VENDEU', label: 'Com venda', value: Number(summary?.sold || 0), color: '#16a05d' },
    { key: 'NAO_VENDEU', label: 'Sem venda', value: Number(summary?.no_sales || 0), color: '#ef5260' },
    { key: 'VENDE_OUTRA_PLATAFORMA', label: 'Vende em outra plataforma', value: Number(summary?.sells_elsewhere || 0), color: '#f0b226' },
    { key: 'SEM_ANUNCIO', label: 'Sem anúncio', value: Number(summary?.no_listing || 0), color: '#98a5b6' }
  ];

  let cursor = 0;
  const segments = rows.map(row => {
    const share = total > 0 ? row.value / total * 100 : 0;
    const start = cursor;
    cursor += share;
    return { ...row, share, start, end: cursor };
  });
  const visible = segments.find(row => row.key === hovered) || null;

  return (
    <section className="spp-chart-card">
      <div className="spp-card-heading">
        <div><strong>Distribuição por situação</strong><small>Visão geral dos Produtos Mestre.</small></div>
      </div>
      <div className="spp-donut-layout">
        <div className="spp-donut-wrap">
          <svg viewBox="0 0 120 120" aria-label="Distribuição por situação">
            <circle cx="60" cy="60" r="45" className="spp-donut-track" />
            {segments.map((row, index) => (
              <circle
                key={row.key}
                cx="60"
                cy="60"
                r="45"
                pathLength="100"
                className={'spp-donut-segment ' + (hovered && hovered !== row.key ? 'muted' : '')}
                style={{
                  stroke: row.color,
                  strokeDasharray: row.share + ' ' + (100 - row.share),
                  strokeDashoffset: -row.start,
                  '--delay': (index * 90) + 'ms'
                }}
                tabIndex="0"
                role="button"
                onMouseEnter={() => setHovered(row.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(row.key)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelect(row.key)}
              />
            ))}
          </svg>
          <button type="button" className="spp-donut-center" onClick={() => onSelect('TODOS')}>
            <strong>{visible ? brNumber(visible.value) : brNumber(total)}</strong>
            <span>{visible ? visible.label : 'produtos'}</span>
          </button>
        </div>

        <div className="spp-donut-legend">
          {segments.map(row => (
            <button type="button" key={row.key} className={active === row.key ? 'active' : ''} onClick={() => onSelect(row.key)}>
              <span><i style={{ background: row.color }} />{row.label}</span>
              <strong>{brNumber(row.value)}</strong>
              <small>{row.share.toFixed(1).replace('.', ',')}%</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformComparison({ rows, loading }) {
  const max = Math.max(1, ...rows.map(row => Number(row.sold || 0)));
  return (
    <section className="spp-chart-card">
      <div className="spp-card-heading">
        <div><strong>Comparação por plataforma</strong><small>Produtos com venda no período.</small></div>
      </div>
      <div className="spp-platform-chart">
        {loading ? <ChartSkeleton rows={3} /> : rows.map((row, index) => (
          <div className="spp-platform-bar" key={row.value} style={{ '--delay': (index * 80) + 'ms' }}>
            <div><span className={'spp-platform-dot ' + row.value.toLowerCase()} /> <strong>{row.label}</strong><b>{brNumber(row.sold)}</b></div>
            <em><i style={{ width: Math.max(4, Number(row.sold || 0) / max * 100) + '%' }} /></em>
            <small>{brNumber(row.noSales)} sem venda</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrendChart({ rows, loading }) {
  const [hovered, setHovered] = useState(null);
  if (loading) return (
    <section className="spp-chart-card">
      <div className="spp-card-heading"><div><strong>Tendência de sem venda</strong><small>Evolução por período.</small></div></div>
      <div className="spp-trend-loading"><ChartSkeleton rows={4} /></div>
    </section>
  );
  if (!rows.length) return (
    <section className="spp-chart-card">
      <div className="spp-card-heading"><div><strong>Tendência de sem venda</strong><small>Evolução por período.</small></div></div>
      <div className="spp-chart-empty">Sem períodos suficientes para montar a tendência.</div>
    </section>
  );

  const width = 430;
  const height = 210;
  const left = 32;
  const right = 18;
  const top = 20;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const max = Math.max(1, ...rows.map(row => Number(row.noSales || 0)));
  const step = rows.length > 1 ? innerW / (rows.length - 1) : innerW;
  const points = rows.map((row, index) => {
    const x = left + index * step;
    const y = top + innerH - (Number(row.noSales || 0) / max) * innerH;
    return { ...row, x, y };
  });
  const line = points.map(point => point.x + ',' + point.y).join(' ');
  const area = left + ',' + (top + innerH) + ' ' + line + ' ' + (left + innerW) + ',' + (top + innerH);

  return (
    <section className="spp-chart-card">
      <div className="spp-card-heading">
        <div><strong>Tendência de sem venda</strong><small>Produtos zerados em cada período.</small></div>
      </div>
      <div className="spp-trend-wrap">
        {hovered && (
          <div className="spp-trend-tooltip" style={{ left: Math.max(12, Math.min(88, (hovered.x / width) * 100)) + '%' }}>
            <strong>{hovered.label}</strong>
            <span>{brNumber(hovered.noSales)} produtos sem venda</span>
          </div>
        )}
        <svg viewBox={'0 0 ' + width + ' ' + height} className="spp-trend-svg">
          {[0, .5, 1].map(level => {
            const y = top + innerH - innerH * level;
            return <line key={level} x1={left} y1={y} x2={width - right} y2={y} className="spp-trend-grid" />;
          })}
          <polygon points={area} className="spp-trend-area" />
          <polyline points={line} className="spp-trend-line" pathLength="1" />
          {points.map((point, index) => (
            <g key={point.value} onMouseEnter={() => setHovered(point)} onMouseLeave={() => setHovered(null)}>
              <circle cx={point.x} cy={point.y} r="14" className="spp-trend-hit" />
              <circle cx={point.x} cy={point.y} r={hovered?.value === point.value ? 5.5 : 3.8} className="spp-trend-point" style={{ '--delay': (index * 70) + 'ms' }} />
              <text x={point.x} y={height - 10} textAnchor="middle" className="spp-trend-label">{periodLabel(point.value, true)}</text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

function InsightsPanel({ summary, onSelect }) {
  const insights = [
    {
      type: 'danger',
      title: 'Produtos sem sinal de venda',
      value: Number(summary?.no_sales || 0),
      helper: 'Produtos anunciados que ficaram zerados no período.',
      action: () => onSelect('NAO_VENDEU')
    },
    {
      type: 'warning',
      title: 'Vendendo em outra plataforma',
      value: Number(summary?.sells_elsewhere || 0),
      helper: 'Há demanda, mas algum anúncio não converteu.',
      action: () => onSelect('VENDE_OUTRA_PLATAFORMA')
    },
    {
      type: 'purple',
      title: 'Sem anúncio publicado',
      value: Number(summary?.no_listing || 0),
      helper: 'Produtos Mestre sem anúncio identificado.',
      action: () => onSelect('SEM_ANUNCIO')
    },
    {
      type: 'success',
      title: 'Produtos saudáveis',
      value: Number(summary?.sold || 0),
      helper: 'Produtos com venda nas plataformas anunciadas.',
      action: () => onSelect('VENDEU')
    }
  ];

  return (
    <section className="spp-insights-card">
      <div className="spp-card-heading insights">
        <div><strong>✦ Insights automáticos</strong><small>Atalhos para as principais decisões.</small></div>
        <span>{insights.length} insights</span>
      </div>
      <div className="spp-insights-list">
        {insights.map((item, index) => (
          <button type="button" key={item.title} onClick={item.action} style={{ '--delay': (index * 70) + 'ms' }}>
            <i className={item.type}>{item.type === 'danger' ? '▥' : item.type === 'warning' ? '↗' : item.type === 'purple' ? '◉' : '✓'}</i>
            <div><strong>{item.title}</strong><small>{item.helper}</small></div>
            <b>{brNumber(item.value)}</b>
            <span>›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChartSkeleton({ rows = 3 }) {
  return <div className="spp-skeleton-list">{Array.from({ length: rows }).map((_, index) => <i key={index} style={{ width: (82 - index * 11) + '%' }} />)}</div>;
}

function ListingLinks({ item }) {
  const links = [
    ['Shopee', item.shopee],
    ['ML Novo', item.ml_novo],
    ['ML Antigo', item.ml_antigo]
  ].filter(([, data]) => data?.has_listing || data?.url);

  return (
    <div className="spp-listing-links">
      <strong>Anúncios deste produto</strong>
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
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [platformStats, setPlatformStats] = useState([]);
  const [trend, setTrend] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const analyticsKeyRef = useRef('');

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

  const periods = useMemo(() => Array.isArray(data?.options?.periods) ? data.options.periods : [], [data?.options?.periods]);

  useEffect(() => {
    if (!periods.length) return;
    const key = JSON.stringify([stableContext.platform, stableContext.periodStart, stableContext.periodEnd, stableContext.search, periods.map(item => item.value)]);
    if (analyticsKeyRef.current === key) return;
    analyticsKeyRef.current = key;
    let cancelled = false;
    setAnalyticsLoading(true);

    const startIndex = Math.max(0, periods.findIndex(item => item.value === stableContext.periodStart));
    const endFound = periods.findIndex(item => item.value === stableContext.periodEnd);
    const endIndex = endFound >= 0 ? endFound : periods.length - 1;
    let selectedPeriods = periods.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
    if (selectedPeriods.length > 7) selectedPeriods = selectedPeriods.slice(-7);

    Promise.all([
      Promise.all(PLATFORM_DEFS.map(async platform => {
        const payload = await loadPerformance({ ...stableContext, platform: platform.value }, 'TODOS', 0, 1);
        return {
          ...platform,
          sold: Number(payload.summary?.sold || 0),
          noSales: Number(payload.summary?.no_sales || 0)
        };
      })),
      Promise.all(selectedPeriods.map(async period => {
        const payload = await loadPerformance({
          ...stableContext,
          platform: 'TODAS',
          periodStart: period.value,
          periodEnd: period.value
        }, 'TODOS', 0, 1);
        return {
          value: period.value,
          label: periodLabel(period.value),
          noSales: Number(payload.summary?.no_sales || 0)
        };
      }))
    ]).then(([platformRows, trendRows]) => {
      if (cancelled) return;
      setPlatformStats(platformRows);
      setTrend(trendRows);
    }).catch(() => {
      if (cancelled) return;
      setPlatformStats([]);
      setTrend([]);
    }).finally(() => {
      if (!cancelled) setAnalyticsLoading(false);
    });

    return () => { cancelled = true; };
  }, [periods, stableContext]);

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

      const header = ['Produto','SKU Mestre','Shopee','ML Novo','ML Antigo','Total','Situação','Recomendação','Faturamento','Shopee URL','ML Novo URL','ML Antigo URL'];
      const rows = all.map(item => [
        item.product_name,
        item.master_sku,
        item.shopee?.units || 0,
        item.ml_novo?.units || 0,
        item.ml_antigo?.units || 0,
        item.total_units || 0,
        situationMeta(item.situation).label,
        recommendationFor(item).label,
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
      <section className="spp-kpi-grid">
        <SummaryCard type="analyzed" label="Produtos analisados" value={summary.analyzed} helper="Produtos Mestre no filtro atual" />
        <SummaryCard type="sold" label="Produtos com venda" value={summary.sold} helper="Venderam no período selecionado" />
        <SummaryCard type="no-sales" label="Produtos sem venda" value={summary.no_sales} helper="Anunciados, mas zerados no período" />
        <SummaryCard type="elsewhere" label="Vendem em outra plataforma" value={summary.sells_elsewhere} helper="Há demanda, mas algum anúncio zerou" />
        <SummaryCard type="no-listing" label="Sem anúncio" value={summary.no_listing} helper="Sem anúncio identificado" />
      </section>

      <section className="spp-decision-grid">
        <DecisionCard
          type="deactivate"
          title="Revisar para desativar"
          value={summary.no_sales}
          helper="Produtos anunciados sem nenhuma venda no período."
          onClick={() => setSituationAndReset('NAO_VENDEU')}
        />
        <DecisionCard
          type="review"
          title="Tem oportunidade"
          value={summary.sells_elsewhere}
          helper="Vendem em outra plataforma; vale revisar o anúncio zerado."
          onClick={() => setSituationAndReset('VENDE_OUTRA_PLATAFORMA')}
        />
        <DecisionCard
          type="create"
          title="Criar anúncio"
          value={summary.no_listing}
          helper="Produtos Mestre que ainda não possuem anúncio identificado."
          onClick={() => setSituationAndReset('SEM_ANUNCIO')}
        />
      </section>

      {error && <div className="spp-error">{error}</div>}

      <section className="spp-analytics-grid">
        <SituationDonut summary={summary} active={situation} onSelect={setSituationAndReset} />
        <PlatformComparison rows={platformStats} loading={analyticsLoading} />
        <TrendChart rows={trend} loading={analyticsLoading} />
        <InsightsPanel summary={summary} onSelect={setSituationAndReset} />
      </section>

      <section className="spp-table-card">
        <div className="spp-table-head">
          <div>
            <span className="spp-title-icon">◇</span>
            <div>
              <h3>Desempenho por Produto</h3>
              <p>Produto Mestre / SKU do NISTI ID, desempenho por plataforma e recomendação de ação.</p>
            </div>
          </div>
          <div className="spp-table-actions">
            <label>Situação
              <select value={situation} onChange={event => setSituationAndReset(event.target.value)} disabled={loading}>
                {(data?.options?.situations?.length ? data.options.situations : SITUATION_OPTIONS).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={exportRows} disabled={loading || exporting || !pagination.total}>
              {exporting ? 'Exportando…' : '⇩ Exportar'}
            </button>
          </div>
        </div>

        <div className="spp-table-wrap">
          <table className="spp-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU mestre</th>
                <th className="num">Shopee</th>
                <th className="num">ML Novo</th>
                <th className="num">ML Antigo</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>Recomendação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {!loading && items.map((item, index) => {
                const hasAnyListing = item.shopee?.has_listing || item.ml_novo?.has_listing || item.ml_antigo?.has_listing;
                const recommendation = recommendationFor(item);
                return (
                  <React.Fragment key={item.product_id}>
                    <tr className={'spp-row ' + situationMeta(item.situation).className} style={{ '--delay': (index % 12 * 24) + 'ms' }}>
                      <td>
                        <div className="spp-product">
                          <ProductThumb item={item} />
                          <div>
                            <strong>{item.product_name || 'Produto sem nome'}</strong>
                            <small>{item.nisti_product_id ? 'NISTI #' + item.nisti_product_id : 'Produto Mestre'}</small>
                          </div>
                        </div>
                      </td>
                      <td><code className="spp-sku">{item.master_sku || '—'}</code></td>
                      <td className="num"><PlatformCell data={item.shopee} /></td>
                      <td className="num"><PlatformCell data={item.ml_novo} /></td>
                      <td className="num"><PlatformCell data={item.ml_antigo} /></td>
                      <td className="num total"><strong>{brNumber(item.total_units)}</strong></td>
                      <td><StatusChip value={item.situation} /></td>
                      <td><span className={'spp-recommendation ' + recommendation.className} title={recommendation.detail}>{recommendation.label}</span></td>
                      <td>
                        {hasAnyListing ? (
                          <button type="button" className="spp-link-button" onClick={() => setExpanded(current => current === item.product_id ? null : item.product_id)}>
                            {expanded === item.product_id ? 'Fechar' : 'Ver anúncios'}
                          </button>
                        ) : (
                          <button type="button" className="spp-link-button muted" disabled>Sem anúncio</button>
                        )}
                      </td>
                    </tr>
                    {expanded === item.product_id && (
                      <tr className="spp-expanded-row">
                        <td colSpan="9"><ListingLinks item={item} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!loading && !items.length && <tr><td colSpan="9" className="spp-empty">Nenhum produto encontrado neste filtro.</td></tr>}
              {loading && Array.from({ length: 7 }).map((_, index) => (
                <tr key={'loading-' + index} className="spp-loading-row">
                  <td colSpan="9"><span /></td>
                </tr>
              ))}
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
    </div>
  );
}
