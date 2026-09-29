import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CommerceSalesProductPerformance from './commerce-sales-product-performance.jsx';
import './commerce-sales-dashboard.css';

const PAGE_SIZE = 100;
const EXPORT_PAGE_SIZE = 500;

function brNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function brCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function brPercent(value) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(Number(value || 0));
}

function monthLabel(value, compact = false) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})(.*)$/);
  if (!match) return text || '—';
  const names = compact
    ? ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    : ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${names[Number(match[2])] || match[2]}${match[3] || ''}`;
}

async function loadSales(filters, offset = 0, limit = PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set('platform', filters.platform || 'TODAS');
  if (filters.periodStart) params.set('period_start', filters.periodStart);
  if (filters.periodEnd) params.set('period_end', filters.periodEnd);
  if (String(filters.sku || '').trim()) params.set('sku', String(filters.sku || '').trim());
  params.set('status', filters.status || 'COM VENDA');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const response = await fetch(`/api/admin/commerce/sales/dashboard?${params.toString()}`, {
    credentials: 'same-origin',
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o Painel de Vendas.');
  return data;
}

function MetricIcon({ type }) {
  const props = {
    viewBox: '0 0 24 24',
    width: 24,
    height: 24,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  };

  if (type === 'orders') {
    return <svg {...props}><path d="M4 5h2l2 10h9l2-7H7" /><circle cx="10" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></svg>;
  }
  if (type === 'units') {
    return <svg {...props}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3" /><path d="M12 12v9" /></svg>;
  }
  if (type === 'ticket') {
    return <svg {...props}><path d="M20 13 11 4H5v6l9 9 6-6Z" /><circle cx="8" cy="7" r="1" /></svg>;
  }
  return <svg {...props}><path d="M5 20V10" /><path d="M10 20V4" /><path d="M15 20v-7" /><path d="M20 20V7" /></svg>;
}

function metricDelta(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) return null;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function AnimatedMetricValue({ value, currency = false }) {
  const target = Number(value || 0);
  const [display, setDisplay] = useState(0);
  const previousRef = useRef(0);

  useEffect(() => {
    const from = previousRef.current;
    const difference = target - from;
    const duration = 520;
    let frame = 0;
    const startedAt = performance.now();

    const step = now => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + difference * eased;
      setDisplay(next);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        previousRef.current = target;
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <>{currency ? brCurrency(display) : brNumber(Math.round(display))}</>;
}

function MetricCard({ type, label, value, currency = false, delta, helper }) {
  const tone = type || 'revenue';
  return (
    <article className={`sales-kpi-card ${tone}`}>
      <div className="sales-kpi-icon"><MetricIcon type={type} /></div>
      <div className="sales-kpi-copy">
        <span>{label}</span>
        <strong><AnimatedMetricValue value={value} currency={currency} /></strong>
        <div className="sales-kpi-helper">
          {delta == null ? (
            <small>{helper}</small>
          ) : (
            <>
              <em className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '↑' : '↓'} {brPercent(Math.abs(delta))}%</em>
              <small>vs. período anterior</small>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function resolvePreviousFilters(appliedFilters, periods) {
  const values = (periods || []).map(item => item.value);
  const startIndex = values.indexOf(appliedFilters?.period_start);
  const endIndex = values.indexOf(appliedFilters?.period_end);
  if (startIndex < 0 || endIndex < startIndex) return null;

  const windowSize = endIndex - startIndex + 1;
  const previousEnd = startIndex - 1;
  const previousStart = previousEnd - windowSize + 1;
  if (previousStart < 0 || previousEnd < 0) return null;

  return {
    platform: appliedFilters?.platform || 'TODAS',
    periodStart: values[previousStart],
    periodEnd: values[previousEnd],
    sku: appliedFilters?.sku || '',
    status: appliedFilters?.status || 'COM VENDA'
  };
}

function SalesChart({ history }) {
  const rows = Array.isArray(history) ? history : [];
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showOrders, setShowOrders] = useState(true);

  useEffect(() => {
    setHoveredIndex(null);
    setSelectedIndex(null);
  }, [history]);

  if (!rows.length) {
    return <div className="sales-chart-empty">Sem evolução de vendas para o filtro selecionado.</div>;
  }

  const width = 760;
  const height = 270;
  const left = 58;
  const right = 42;
  const top = 22;
  const bottom = 42;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const maxRevenue = Math.max(1, ...rows.map(item => Number(item.product_revenue || 0)));
  const maxOrders = Math.max(1, ...rows.map(item => Number(item.net_orders || 0)));
  const slot = innerWidth / rows.length;
  const barWidth = Math.max(16, Math.min(44, slot * 0.5));

  const points = rows.map((item, index) => {
    const x = left + (index * slot) + slot / 2;
    const y = top + innerHeight - (Number(item.net_orders || 0) / maxOrders) * innerHeight;
    return [x, y];
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const activeIndex = hoveredIndex ?? selectedIndex;
  const activeItem = activeIndex == null ? null : rows[activeIndex];

  const selectPoint = index => {
    setSelectedIndex(current => current === index ? null : index);
  };

  return (
    <div className="sales-chart-interactive">
      <div className="sales-chart-controls" aria-label="Séries do gráfico">
        <button type="button" className={showRevenue ? 'active revenue' : 'revenue'} onClick={() => setShowRevenue(value => !value)}>
          <i /> Faturamento
        </button>
        <button type="button" className={showOrders ? 'active orders' : 'orders'} onClick={() => setShowOrders(value => !value)}>
          <i /> Pedidos
        </button>
        <span>Clique em um mês para fixar o detalhe</span>
      </div>

      <div className="sales-chart-wrap">
        {activeItem && (
          <div
            className="sales-chart-tooltip"
            style={{ left: `${Math.max(9, Math.min(91, ((activeIndex + .5) / rows.length) * 100))}%` }}
          >
            <strong>{monthLabel(activeItem.period_key)}</strong>
            <span>Faturamento <b>{brCurrency(activeItem.product_revenue)}</b></span>
            <span>Pedidos <b>{brNumber(activeItem.net_orders)}</b></span>
            <span>Unidades <b>{brNumber(activeItem.units)}</b></span>
          </div>
        )}

        <svg className="sales-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução mensal de faturamento e pedidos">
          {[0, .25, .5, .75, 1].map(level => {
            const y = top + innerHeight - (innerHeight * level);
            return (
              <g key={level}>
                <line x1={left} y1={y} x2={width - right} y2={y} className="sales-chart-grid" />
                <text x={left - 10} y={y + 4} textAnchor="end" className="sales-chart-axis">{brCurrency(maxRevenue * level).replace(',00','')}</text>
              </g>
            );
          })}

          {rows.map((item, index) => {
            const revenue = Number(item.product_revenue || 0);
            const x = left + (index * slot) + (slot - barWidth) / 2;
            const barHeight = (revenue / maxRevenue) * innerHeight;
            const y = top + innerHeight - barHeight;
            const active = activeIndex === index;
            return (
              <g
                key={item.period_key}
                className={`sales-chart-hit ${active ? 'active' : ''}`}
                tabIndex="0"
                role="button"
                aria-label={`${monthLabel(item.period_key)}: ${brCurrency(item.product_revenue)}, ${brNumber(item.net_orders)} pedidos`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
                onClick={() => selectPoint(index)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectPoint(index);
                  }
                }}
              >
                <rect
                  x={left + index * slot}
                  y={top}
                  width={slot}
                  height={innerHeight}
                  className="sales-chart-hover-zone"
                />
                {showRevenue && (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx="4"
                    className="sales-chart-bar"
                    style={{ '--sales-delay': `${index * 45}ms` }}
                  />
                )}
                <text x={left + (index * slot) + slot / 2} y={height - 15} textAnchor="middle" className="sales-chart-label">
                  {monthLabel(item.period_key, true)}
                </text>
              </g>
            );
          })}

          {showOrders && (
            <>
              <polyline points={line} className="sales-chart-line" pathLength="1" />
              {points.map(([x, y], index) => (
                <circle
                  key={rows[index].period_key}
                  cx={x}
                  cy={y}
                  r={activeIndex === index ? 6 : 4}
                  className={`sales-chart-point ${activeIndex === index ? 'active' : ''}`}
                  style={{ '--sales-delay': `${index * 45 + 160}ms` }}
                />
              ))}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

const PLATFORM_COLORS = {
  SHOPEE: '#f25a3c',
  ML_NOVO: '#f3b51b',
  ML_ANTIGO: '#3478f6'
};

function PlatformSummary({ rows, loading, onSelect }) {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.metrics?.product_revenue || 0), 0);

  return (
    <section className="sales-side-card">
      <div className="sales-side-head">
        <div><span className="sales-side-icon">▥</span><strong>Resumo por plataforma</strong></div>
      </div>
      {loading ? <div className="sales-side-empty">Calculando plataformas…</div> : (
        <div className="sales-platform-summary">
          <div className="sales-platform-summary-head"><span>Plataforma</span><span>Pedidos</span><span>Unidades</span><span>Faturamento</span><span>% do total</span></div>
          {rows.map((row, index) => {
            const revenue = Number(row.metrics?.product_revenue || 0);
            const share = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
            return (
              <button
                type="button"
                className="sales-platform-summary-row"
                key={row.value}
                onClick={() => onSelect?.(row.value)}
                title={`Filtrar painel por ${row.label}`}
                style={{ '--sales-delay': `${index * 70}ms` }}
              >
                <span className="sales-platform-name"><i style={{ background: PLATFORM_COLORS[row.value] || '#64748b' }} />{row.label}</span>
                <strong>{brNumber(row.metrics?.net_orders)}</strong>
                <strong>{brNumber(row.metrics?.units)}</strong>
                <strong>{brCurrency(revenue)}</strong>
                <span className="sales-platform-share"><b>{brPercent(share)}%</b><em><i style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></em></span>
              </button>
            );
          })}
          {!rows.length && <div className="sales-side-empty">Sem dados para as plataformas selecionadas.</div>}
        </div>
      )}
    </section>
  );
}

function ParticipationCard({ rows, loading, onSelect }) {
  const [activeValue, setActiveValue] = useState(null);
  const total = rows.reduce((sum, row) => sum + Number(row.metrics?.product_revenue || 0), 0);
  let cursor = 0;
  const segments = rows.map(row => {
    const value = Number(row.metrics?.product_revenue || 0);
    const share = total > 0 ? (value / total) * 100 : 0;
    const start = cursor;
    cursor += share;
    return {
      ...row,
      revenue: value,
      share,
      start,
      end: cursor,
      color: PLATFORM_COLORS[row.value] || '#64748b'
    };
  });

  useEffect(() => {
    if (!segments.some(item => item.value === activeValue)) setActiveValue(null);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = segments.find(item => item.value === activeValue) || null;

  return (
    <section className="sales-side-card participation">
      <div className="sales-side-head">
        <div><span className="sales-side-icon">◔</span><strong>Participação de vendas</strong></div>
      </div>
      {loading ? <div className="sales-side-empty">Calculando participação…</div> : (
        <div className="sales-participation-content">
          <div className="sales-donut-wrap">
            <svg className="sales-donut-svg" viewBox="0 0 120 120" role="img" aria-label="Participação de faturamento por plataforma">
              <circle cx="60" cy="60" r="46" className="sales-donut-track" />
              {segments.map((item, index) => (
                <circle
                  key={item.value}
                  cx="60"
                  cy="60"
                  r="46"
                  pathLength="100"
                  className={`sales-donut-segment ${activeValue && activeValue !== item.value ? 'muted' : ''} ${activeValue === item.value ? 'active' : ''}`}
                  style={{
                    stroke: item.color,
                    strokeDasharray: `${item.share} ${100 - item.share}`,
                    strokeDashoffset: -item.start,
                    '--sales-delay': `${index * 80}ms`
                  }}
                  tabIndex="0"
                  role="button"
                  aria-label={`${item.label}: ${brPercent(item.share)}%, ${brCurrency(item.revenue)}`}
                  onMouseEnter={() => setActiveValue(item.value)}
                  onMouseLeave={() => setActiveValue(null)}
                  onFocus={() => setActiveValue(item.value)}
                  onBlur={() => setActiveValue(null)}
                  onClick={() => onSelect?.(item.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect?.(item.value);
                    }
                  }}
                />
              ))}
            </svg>
            <div className="sales-donut-center">
              <strong>{active ? brPercent(active.share) + '%' : brCurrency(total).replace(',00','')}</strong>
              <span>{active ? active.label : 'Total'}</span>
            </div>
          </div>

          <div className="sales-participation-legend">
            {segments.map(item => (
              <button
                type="button"
                key={item.value}
                className={activeValue === item.value ? 'active' : ''}
                onMouseEnter={() => setActiveValue(item.value)}
                onMouseLeave={() => setActiveValue(null)}
                onFocus={() => setActiveValue(item.value)}
                onBlur={() => setActiveValue(null)}
                onClick={() => onSelect?.(item.value)}
                title={`Filtrar painel por ${item.label}`}
              >
                <span><i style={{ background: item.color }} />{item.label}</span>
                <strong>{brPercent(item.share)}%</strong>
                <small>{brCurrency(item.revenue)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function NoSalesDecisionOverview({ insights }) {
  const total = Number(insights?.total || 0);
  const cards = [
    {
      key: 'REVISAR_DESATIVACAO',
      label: 'Revisar para desativação',
      value: Number(insights?.review_for_deactivation || 0),
      helper: 'Sem venda aqui e sem sinal de demanda em outra plataforma.',
      tone: 'danger'
    },
    {
      key: 'OTIMIZAR_ANUNCIO',
      label: 'Melhorar anúncio',
      value: Number(insights?.optimize_listing || 0),
      helper: 'O mesmo SKU vende em outra plataforma.',
      tone: 'warning'
    },
    {
      key: 'JA_VENDEU_ANTES',
      label: 'Já vendeu antes',
      value: Number(insights?.sold_before || 0),
      helper: 'Tem histórico anterior nesta plataforma.',
      tone: 'info'
    }
  ];

  return (
    <section className="sales-no-sales-overview">
      <div className="sales-no-sales-overview-head">
        <div>
          <strong>{brNumber(total)} anúncios sem venda</strong>
          <span>Resumo objetivo para decidir o que revisar primeiro.</span>
        </div>
        <small>{monthLabel(insights?.selected_start_period)} → {monthLabel(insights?.selected_end_period)}</small>
      </div>

      <div className="sales-no-sales-overview-grid">
        {cards.map(card => {
          const share = total > 0 ? card.value / total * 100 : 0;
          return (
            <article key={card.key} className={`sales-no-sales-overview-card ${card.tone}`}>
              <div className="sales-no-sales-overview-number">
                <strong>{brNumber(card.value)}</strong>
                <span>{brPercent(share)}%</span>
              </div>
              <h3>{card.label}</h3>
              <p>{card.helper}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function NoSalesDecisionChart({ insights }) {
  const rows = Array.isArray(insights?.action_groups) ? insights.action_groups : [];
  const total = Number(insights?.total || 0);
  const max = Math.max(1, ...rows.map(item => Number(item.count || 0)));
  const colors = {
    REVISAR_DESATIVACAO: '#df4f4f',
    OTIMIZAR_ANUNCIO: '#e5a21c',
    JA_VENDEU_ANTES: '#4187df'
  };

  return (
    <div className="sales-no-sales-bars sales-decision-bars">
      {rows.map((item, index) => {
        const count = Number(item.count || 0);
        const share = total > 0 ? count / total * 100 : 0;
        return (
          <div className="sales-no-sales-bar-row" key={item.key} style={{ '--sales-delay': `${index * 75}ms` }}>
            <div className="sales-no-sales-bar-label">
              <div>
                <strong>{item.label}</strong>
                <small>{item.key === 'REVISAR_DESATIVACAO'
                  ? 'Sem sinal de demanda'
                  : item.key === 'OTIMIZAR_ANUNCIO'
                    ? 'SKU vende em outra plataforma'
                    : 'Há venda anterior nesta plataforma'}</small>
              </div>
              <span>{brNumber(count)} anúncios · {brPercent(share)}%</span>
            </div>
            <div className="sales-no-sales-bar-track">
              <span
                style={{
                  width: `${Math.max(count ? 3 : 0, count / max * 100)}%`,
                  background: colors[item.key] || '#64748b'
                }}
              />
            </div>
          </div>
        );
      })}

      <div className="sales-no-sales-explainer">
        Priorize o grupo vermelho. O amarelo merece otimização antes de qualquer desativação.
      </div>
    </div>
  );
}

function CrossPlatformEvidenceCard({ insights }) {
  const rows = Array.isArray(insights?.cross_platform_destinations) ? insights.cross_platform_destinations : [];
  const max = Math.max(1, ...rows.map(item => Number(item.items || 0)));

  return (
    <section className="sales-side-card">
      <div className="sales-side-head">
        <div><span className="sales-side-icon">↗</span><strong>Onde o mesmo SKU vende</strong></div>
      </div>
      <div className="sales-no-sales-platforms evidence">
        {rows.map((item, index) => (
          <div key={item.platform_code} className="sales-evidence-row" style={{ '--sales-delay': `${index * 70}ms` }}>
            <div>
              <span><i style={{ background: PLATFORM_COLORS[item.platform_code] || '#64748b' }} />{item.platform_label}</span>
              <strong>{brNumber(item.items)} SKUs</strong>
            </div>
            <em><i style={{ width: `${Math.max(3, Number(item.items || 0) / max * 100)}%` }} /></em>
            <small>{brNumber(item.orders)} pedidos · {brCurrency(item.revenue)}</small>
          </div>
        ))}
        {!rows.length && (
          <div className="sales-side-empty">
            Nenhum dos anúncios sem venda tem o mesmo SKU vendendo em outra plataforma no período.
          </div>
        )}
      </div>
    </section>
  );
}

function NoSalesDecisionCard({ insights }) {
  const rows = Array.isArray(insights?.action_groups) ? insights.action_groups : [];
  const total = Number(insights?.total || 0);
  const colorByKey = {
    REVISAR_DESATIVACAO: '#df4f4f',
    OTIMIZAR_ANUNCIO: '#e5a21c',
    JA_VENDEU_ANTES: '#4187df'
  };

  let cursor = 0;
  const segments = rows.map(item => {
    const count = Number(item.count || 0);
    const share = total > 0 ? count / total * 100 : 0;
    const start = cursor;
    cursor += share;
    return { ...item, count, share, start, end: cursor, color: colorByKey[item.key] || '#64748b' };
  });

  return (
    <section className="sales-side-card sales-no-sales-priority-card">
      <div className="sales-side-head">
        <div><span className="sales-side-icon">◎</span><strong>Sinal para decisão</strong></div>
      </div>

      <div className="sales-no-sales-priority-content">
        <div className="sales-no-sales-donut-wrap">
          <svg viewBox="0 0 120 120" role="img" aria-label="Sinal de decisão dos anúncios sem venda">
            <circle cx="60" cy="60" r="46" className="sales-donut-track" />
            {segments.map((item, index) => (
              <circle
                key={item.key}
                cx="60"
                cy="60"
                r="46"
                pathLength="100"
                className="sales-donut-segment"
                style={{
                  stroke: item.color,
                  strokeDasharray: `${item.share} ${100 - item.share}`,
                  strokeDashoffset: -item.start,
                  '--sales-delay': `${index * 90}ms`
                }}
              />
            ))}
          </svg>
          <div>
            <strong>{brNumber(insights?.review_for_deactivation || 0)}</strong>
            <span>candidatos fortes</span>
          </div>
        </div>

        <div className="sales-no-sales-priority-list">
          {segments.map(item => (
            <div key={item.key}>
              <span><i style={{ background: item.color }} />{item.label}</span>
              <strong>{brNumber(item.count)}</strong>
              <small>{brPercent(item.share)}%</small>
            </div>
          ))}
        </div>
      </div>

      <div className="sales-no-sales-rule decision">
        <strong>Cobertura da análise</strong>
        <span>
          Janela filtrada: <b>{monthLabel(insights?.selected_start_period)} → {monthLabel(insights?.selected_end_period)}</b> ({brNumber(insights?.selected_window_periods)} período(s)).
        </span>
        <span>
          Base de vendas disponível desde <b>{monthLabel(insights?.base_start_period)}</b>. “Sem histórico” significa sem venda encontrada dentro dessa base.
        </span>
      </div>
    </section>
  );
}

function decisionSignalLabel(value) {
  if (value === 'REVISAR_DESATIVACAO') return 'Candidato forte';
  if (value === 'OTIMIZAR_ANUNCIO') return 'Melhorar anúncio';
  if (value === 'JA_VENDEU_ANTES') return 'Já vendeu antes';
  return 'Revisar';
}

function ProductAvatar({ item }) {
  const [failed, setFailed] = useState(false);
  const text = String(item.product_name || item.sku || '?').trim();

  if (item.image_url && !failed) {
    return (
      <img
        className="sales-product-image"
        src={item.image_url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className={`sales-product-avatar ${String(item.platform_code || '').toLowerCase()}`}>
      {text.charAt(0).toUpperCase()}
    </span>
  );
}

function csvCell(value) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

export default function CommerceSalesDashboard() {
  const [filters, setFilters] = useState({ platform: 'TODAS', periodStart: '', periodEnd: '', sku: '', status: 'COM VENDA' });
  const [data, setData] = useState(null);
  const [platformSummary, setPlatformSummary] = useState([]);
  const [previousMetrics, setPreviousMetrics] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (nextOffset = 0, nextFilters) => {
    const requestId = ++requestIdRef.current;
    const requestedFilters = nextFilters || filters;
    setLoading(true);
    setInsightsLoading(true);
    setError('');
    setPlatformSummary([]);
    setPreviousMetrics(null);

    try {
      const payload = await loadSales(requestedFilters, nextOffset);
      if (requestId !== requestIdRef.current) return;

      setData(payload);
      const applied = payload.filters || {};
      const normalizedFilters = {
        platform: applied.platform || requestedFilters.platform || 'TODAS',
        periodStart: applied.period_start || requestedFilters.periodStart || '',
        periodEnd: applied.period_end || requestedFilters.periodEnd || '',
        sku: applied.sku || requestedFilters.sku || '',
        status: applied.status || requestedFilters.status || 'COM VENDA'
      };

      setFilters(current => ({
        ...current,
        periodStart: current.periodStart || normalizedFilters.periodStart,
        periodEnd: current.periodEnd || normalizedFilters.periodEnd
      }));

      const noSalesMode = ['SEM VENDA','SEM_VENDA'].includes(normalizedFilters.status);
      if (noSalesMode) {
        setPlatformSummary([]);
        setPreviousMetrics(null);
        setInsightsLoading(false);
        return;
      }

      const platformOptions = (payload.options?.platforms || []).filter(item =>
        item.value !== 'TODAS' && (normalizedFilters.platform === 'TODAS' || item.value === normalizedFilters.platform)
      );

      const previousFilters = resolvePreviousFilters(applied, payload.options?.periods || []);
      const [breakdown, previous] = await Promise.all([
        Promise.all(platformOptions.map(async item => {
          const result = await loadSales({ ...normalizedFilters, platform: item.value }, 0, 1);
          return { ...item, metrics: result.metrics || {} };
        })),
        previousFilters ? loadSales(previousFilters, 0, 1) : Promise.resolve(null)
      ]);

      if (requestId !== requestIdRef.current) return;
      setPlatformSummary(breakdown);
      setPreviousMetrics(previous?.metrics || null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Falha ao carregar vendas.');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setInsightsLoading(false);
      }
    }
  }, [filters]);

  useEffect(() => { refresh(0, filters); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = data?.options || {};
  const metrics = data?.metrics || {};
  const noSalesInsights = data?.no_sales_insights || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const appliedFilters = data?.filters || {};
  const appliedStatus = appliedFilters.status || 'COM VENDA';
  const history = appliedStatus === 'SEM VENDA' ? [] : (Array.isArray(data?.history) ? data.history : []);
  const pagination = data?.pagination || {};
  const isNoSales = appliedStatus === 'SEM VENDA';
  const totalPages = Math.max(1, Math.ceil(Number(pagination.total || 0) / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const ticketAverage = Number(metrics.net_orders || 0) > 0 ? Number(metrics.product_revenue || 0) / Number(metrics.net_orders || 0) : 0;
  const previousTicket = Number(previousMetrics?.net_orders || 0) > 0
    ? Number(previousMetrics?.product_revenue || 0) / Number(previousMetrics?.net_orders || 0)
    : 0;

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

  async function exportFiltered() {
    if (!data) return;
    setExporting(true);
    setError('');
    try {
      const total = Number(pagination.total || 0);
      const all = [];
      let nextOffset = 0;
      while (nextOffset < total) {
        const payload = await loadSales(filters, nextOffset, EXPORT_PAGE_SIZE);
        const pageItems = Array.isArray(payload.items) ? payload.items : [];
        all.push(...pageItems);
        const actualLimit = Number(payload.pagination?.limit || pageItems.length || 0);
        if (actualLimit <= 0 || pageItems.length === 0) break;
        nextOffset += actualLimit;
      }

      const exportingNoSales = ['SEM VENDA','SEM_VENDA'].includes(String(filters.status || '').toUpperCase());
      const header = exportingNoSales
        ? ['Plataforma','SKU','Produto','Sinal','Vende em outra plataforma','Pedidos em outras plataformas','Faturamento em outras plataformas','Última venda nesta plataforma','Pedidos históricos','Faturamento histórico','Anúncio']
        : ['Plataforma','SKU','Produto','SKU Principal','Pedidos com item','Unidades','Faturamento','Status','Anúncio'];
      const rows = all.map(item => exportingNoSales ? [
        item.platform_label,
        item.sku,
        item.product_name,
        decisionSignalLabel(item.decision_signal),
        item.other_platform_labels || '',
        item.other_platform_orders,
        Number(item.other_platform_revenue || 0).toFixed(2).replace('.', ','),
        item.last_sale_period || 'Sem venda encontrada na base',
        item.historical_orders,
        Number(item.historical_revenue || 0).toFixed(2).replace('.', ','),
        item.listing_url || ''
      ] : [
        item.platform_label,
        item.sku,
        item.product_name,
        item.sku_primary,
        item.orders_with_item,
        item.units,
        Number(item.product_revenue || 0).toFixed(2).replace('.', ','),
        item.row_type === 'ZERO' ? 'Sem venda' : 'Com venda',
        item.listing_url || ''
      ]);
      const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = ['SEM VENDA','SEM_VENDA'].includes(String(filters.status || '').toUpperCase())
        ? 'anuncios_sem_venda_nisti.csv'
        : 'vendas_nisti_filtradas.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Não foi possível exportar as vendas.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="sales-dashboard">
      {!isNoSales && (
        <section className="sales-kpi-grid">
          <MetricCard
            type="revenue"
            label="Faturamento"
            value={metrics.product_revenue}
            currency
            delta={metricDelta(metrics.product_revenue, previousMetrics?.product_revenue)}
            helper="No período filtrado"
          />
          <MetricCard
            type="orders"
            label="Pedidos"
            value={metrics.net_orders}
            delta={metricDelta(metrics.net_orders, previousMetrics?.net_orders)}
            helper="Pedidos líquidos"
          />
          <MetricCard
            type="units"
            label="Unidades"
            value={metrics.units}
            delta={metricDelta(metrics.units, previousMetrics?.units)}
            helper="Unidades vendidas"
          />
          <MetricCard
            type="ticket"
            label="Ticket médio"
            value={ticketAverage}
            currency
            delta={metricDelta(ticketAverage, previousTicket)}
            helper="Faturamento ÷ pedidos"
          />
        </section>
      )}

      <section className="sales-filter-panel">
        <div className="sales-filter-title">
          <div className="sales-filter-title-icon">⌁</div>
          <div>
            <strong>Filtros de vendas</strong>
            <span>Refine os dados para visualizar os resultados desejados.</span>
          </div>
          {data?.snapshot && <small>Base até {new Date(`${data.snapshot.data_through}T12:00:00`).toLocaleDateString('pt-BR')}</small>}
        </div>

        <div className="sales-filter-grid">
          <label>Plataforma
            <select value={filters.platform} onChange={e => applySelectFilter('platform', e.target.value)} disabled={loading}>
              {(options.platforms || [{ value: 'TODAS', label: 'Todas as plataformas' }]).map(item => <option key={item.value} value={item.value}>{item.value === 'TODAS' ? 'Todas as plataformas' : item.label}</option>)}
            </select>
          </label>
          <label>Período inicial
            <select value={filters.periodStart} onChange={e => applySelectFilter('periodStart', e.target.value)} disabled={loading}>
              {periodOptions.map(item => <option key={item.value} value={item.value}>{monthLabel(item.label)}</option>)}
            </select>
          </label>
          <label>Período final
            <select value={filters.periodEnd} onChange={e => applySelectFilter('periodEnd', e.target.value)} disabled={loading}>
              {periodOptions.map(item => <option key={item.value} value={item.value}>{monthLabel(item.label)}</option>)}
            </select>
          </label>
          <label>{isNoSales ? 'Visão' : 'Status'}
            <select value={filters.status} onChange={e => applySelectFilter('status', e.target.value)} disabled={loading}>
              {(options.statuses || ['TODOS','COM VENDA','SEM VENDA']).map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="sales-sku-filter">{isNoSales ? 'Buscar SKU ou produto' : 'Buscar SKU'}
            <input
              value={filters.sku}
              onChange={e => setFilters(v => ({ ...v, sku: e.target.value }))}
              placeholder={isNoSales ? 'Digite o SKU ou nome do produto...' : 'Digite o SKU...'}
              onKeyDown={e => e.key === 'Enter' && apply()}
            />
          </label>
          <button type="button" className="sales-apply" onClick={apply} disabled={loading}>{loading ? 'Carregando…' : 'Aplicar filtros'}</button>
          <button type="button" className="sales-refresh" onClick={() => refresh(0, filters)} disabled={loading}>Atualizar</button>
        </div>
      </section>

      {error && <div className="sales-error">{error}</div>}

      {isNoSales && (
        <CommerceSalesProductPerformance
          context={{
            platform: appliedFilters.platform || filters.platform,
            periodStart: appliedFilters.period_start || filters.periodStart,
            periodEnd: appliedFilters.period_end || filters.periodEnd,
            search: appliedFilters.sku || filters.sku
          }}
        />
      )}

      {!isNoSales && (<>
      <section className={`sales-analytics-grid ${isNoSales ? 'no-sales-mode' : ''}`}>
        {isNoSales ? (
          <>
            <div className="sales-panel sales-no-sales-chart-panel">
              <div className="sales-panel-head">
                <div>
                  <h3>Distribuição das decisões</h3>
                  <p>Quanto de cada grupo precisa de revisão.</p>
                </div>
              </div>
              <NoSalesDecisionChart insights={noSalesInsights} />
            </div>

            <aside className="sales-insights-column sales-no-sales-side">
              <CrossPlatformEvidenceCard insights={noSalesInsights} />
              <section className="sales-side-card sales-no-sales-coverage">
                <div className="sales-side-head">
                  <div><span className="sales-side-icon">i</span><strong>Como interpretar</strong></div>
                </div>
                <div className="sales-no-sales-coverage-body">
                  <p><b>Revisar para desativação:</b> sem venda nesta plataforma e sem venda do mesmo SKU em outra plataforma no período.</p>
                  <p><b>Melhorar anúncio:</b> o produto vende em outra plataforma; este anúncio pode estar fraco.</p>
                  <p><b>Já vendeu antes:</b> houve venda anterior nesta plataforma dentro da base disponível.</p>
                  <small>Base disponível desde {monthLabel(noSalesInsights?.base_start_period)}.</small>
                </div>
              </section>
            </aside>
          </>
        ) : (
          <>
            <div className="sales-panel sales-chart-panel">
              <div className="sales-panel-head">
                <div>
                  <h3>Evolução de vendas</h3>
                  <p>Faturamento e quantidade de pedidos no período selecionado.</p>
                </div>
                <div className="sales-chart-legend"><b>Interativo</b></div>
              </div>
              <SalesChart history={history} />
            </div>

            <aside className="sales-insights-column">
              <PlatformSummary
                rows={platformSummary}
                loading={insightsLoading}
                onSelect={platform => applySelectFilter('platform', platform)}
              />
              <ParticipationCard
                rows={platformSummary}
                loading={insightsLoading}
                onSelect={platform => applySelectFilter('platform', platform)}
              />
            </aside>
          </>
        )}
      </section>

      <section className="sales-panel sales-products-panel">
        <div className="sales-panel-head sales-products-head">
          <div>
            <h3>{isNoSales ? 'Anúncios para revisar' : 'Produtos vendidos'}</h3>
            <p>{isNoSales
              ? `${brNumber(pagination.total)} anúncios ordenados pelo sinal de decisão.`
              : `${brNumber(pagination.total)} SKUs vendidos no filtro atual.`}</p>
          </div>
          <button type="button" className="sales-export" onClick={exportFiltered} disabled={exporting || loading || !pagination.total}>
            {exporting ? 'Exportando…' : 'Exportar'}
          </button>
        </div>

        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              {isNoSales ? (
                <tr>
                  <th>Produto</th>
                  <th>SKU vendido</th>
                  <th>Plataforma</th>
                  <th>Decisão</th>
                  <th>Evidência</th>
                  <th>Anúncio</th>
                </tr>
              ) : (
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Plataforma</th>
                  <th className="num">Pedidos</th>
                  <th className="num">Unidades</th>
                  <th className="num">Faturamento</th>
                  <th>Status</th>
                  <th>Anúncio</th>
                </tr>
              )}
            </thead>
            <tbody>
              {!loading && items.map((item, index) => (
                isNoSales ? (
                  <tr
                    key={`${item.platform_code}-${item.sku}-${index}`}
                    className={`no-sale decision-${String(item.decision_signal || 'REVISAR').toLowerCase()}`}
                  >
                    <td className="product">
                      <div className="sales-product-cell">
                        <ProductAvatar item={item} />
                        <div>
                          <strong>{item.product_name || 'Produto sem nome'}</strong>
                          <small>{item.decision_signal === 'OTIMIZAR_ANUNCIO'
  ? 'O mesmo SKU vende em outra plataforma'
  : item.last_sale_period
    ? 'Já vendeu nesta plataforma antes do período'
    : 'Sem venda encontrada nesta plataforma dentro da base disponível'}</small>
                        </div>
                      </div>
                    </td>
                    <td><code>{item.sku || '—'}</code></td>
                    <td><span className={`platform-tag ${String(item.platform_code || '').toLowerCase()}`}>{item.platform_label}</span></td>
                    <td>
                      <span
                        className={`sales-decision-signal ${String(item.decision_signal || 'REVISAR').toLowerCase()}`}
                        title={noSalesInsights.criteria?.[item.decision_signal] || ''}
                      >
                        {decisionSignalLabel(item.decision_signal)}
                      </span>
                    </td>
                    <td>
                      {item.decision_signal === 'OTIMIZAR_ANUNCIO' ? (
                        <div className="sales-evidence-compact">
                          <strong>{item.other_platform_labels || 'Outra plataforma'}</strong>
                          <small>{brNumber(item.other_platform_orders)} pedidos · {brCurrency(item.other_platform_revenue)}</small>
                        </div>
                      ) : item.decision_signal === 'JA_VENDEU_ANTES' ? (
                        <div className="sales-evidence-compact">
                          <strong>Última venda: {item.last_sale_period ? monthLabel(item.last_sale_period) : '—'}</strong>
                          <small>{brNumber(item.historical_orders)} pedidos · {brCurrency(item.historical_revenue)}</small>
                        </div>
                      ) : (
                        <span className="sales-muted-evidence">Sem venda deste SKU aqui ou em outra plataforma no período.</span>
                      )}
                    </td>
                    <td>{item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir</a> : '—'}</td>
                  </tr>
                ) : (
                  <tr key={`${item.platform_code}-${item.sku}-${item.sku_primary || index}`}>
                    <td className="product">
                      <div className="sales-product-cell">
                        <ProductAvatar item={item} />
                        <div>
                          <strong>{item.product_name || 'Produto sem nome'}</strong>
                          <small>SKU vendido: {item.sku || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td><code>{item.sku || '—'}</code></td>
                    <td><span className={`platform-tag ${String(item.platform_code || '').toLowerCase()}`}>{item.platform_label}</span></td>
                    <td className="num">{brNumber(item.orders_with_item)}</td>
                    <td className="num">{brNumber(item.units)}</td>
                    <td className="num strong">{brCurrency(item.product_revenue)}</td>
                    <td><span className="sales-row-status ok">Com venda</span></td>
                    <td>{item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir</a> : '—'}</td>
                  </tr>
                )
              ))}
              {!loading && !items.length && <tr><td colSpan={isNoSales ? 6 : 8} className="sales-empty-cell">Nenhum item encontrado.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="sales-pagination">
          <span>Página {currentPage} de {totalPages}</span>
          <div>
            <button disabled={loading || currentPage <= 1} onClick={() => movePage(currentPage - 1)}>Anterior</button>
            <button disabled={loading || currentPage >= totalPages} onClick={() => movePage(currentPage + 1)}>Próxima</button>
          </div>
        </div>
      </section>
      </>)}
    </div>
  );
}
