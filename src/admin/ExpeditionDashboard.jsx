import React, { useEffect, useRef, useState } from 'react';
import { formatSaoPauloDateTime } from '../date-time.js';

function formatScanDate(value) {
  return formatSaoPauloDateTime(value);
}

function AnimatedNumber({ value, suffix = '', duration = 900 }) {
  const numericValue = Number(value || 0);
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const startValue = previousValue.current;
    const delta = numericValue - startValue;

    if (reduceMotion || duration <= 0 || delta === 0) {
      previousValue.current = numericValue;
      setDisplayValue(numericValue);
      return undefined;
    }

    let frameId = 0;
    const startedAt = performance.now();

    const tick = now => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + (delta * eased));
      setDisplayValue(nextValue);

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        previousValue.current = numericValue;
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [duration, numericValue]);

  return <>{displayValue.toLocaleString('pt-BR')}{suffix}</>;
}

const SCAN_META = {
  identified: {
    title: 'Bipagens identificadas hoje',
    label: 'Identificado',
    className: 'identified',
    empty: 'Nenhuma bipagem identificada hoje.'
  },
  not_found: {
    title: 'EANs não cadastrados hoje',
    label: 'Não cadastrado',
    className: 'not-found',
    empty: 'Nenhum EAN não cadastrado hoje.'
  },
  system_error: {
    title: 'Erros técnicos de hoje',
    label: 'Erro técnico',
    className: 'system-error',
    empty: 'Nenhum erro técnico hoje.'
  }
};

function ScanDetailsModal({ status, events, loading, error, onClose, onNavigate }) {
  if (!status) return null;
  const meta = SCAN_META[status];

  return (
    <div className="scan-details-backdrop" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="scan-details-modal">
        <div className="scan-details-head">
          <div>
            <span className={`scan-details-status-dot ${meta.className}`} />
            <div>
              <h3>{meta.title}</h3>
              <small>{events.length} leitura{events.length === 1 ? '' : 's'} encontrada{events.length === 1 ? '' : 's'}</small>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="scan-details-body">
          {loading ? (
            <div className="scan-details-empty">Carregando bipagens…</div>
          ) : error ? (
            <div className="scan-details-error">{error}</div>
          ) : events.length === 0 ? (
            <div className="scan-details-empty">{meta.empty}</div>
          ) : (
            <div className="scan-details-list">
              {events.map(event => {
                const when = formatScanDate(event.created_at);
                return (
                  <div className="scan-detail-row" key={event.id}>
                    <div className="scan-detail-product">
                      {event.image_url ? (
                        <img src={event.image_url} alt="" loading="lazy" />
                      ) : (
                        <span className={`scan-detail-placeholder ${meta.className}`}>▥</span>
                      )}
                      <div>
                        <strong>
                          {event.nome || event.sku || (status === 'not_found' ? 'EAN não cadastrado' : 'Leitura sem produto')}
                        </strong>
                        <small>
                          {event.sku ? `SKU: ${event.sku}` : event.error_code ? `Motivo: ${event.error_code}` : meta.label}
                        </small>
                      </div>
                    </div>

                    <div className="scan-detail-ean">
                      <span>EAN</span>
                      <strong>{event.gtin}</strong>
                    </div>

                    <div className="scan-detail-meta">
                      <span>{when.date} · {when.time}</span>
                      <small>{event.operator_name || 'Operador não identificado'}</small>
                    </div>

                    <div className="scan-detail-time">
                      {event.response_ms ? `${event.response_ms} ms` : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="scan-details-foot">
          <button
            type="button"
            className="btn-cancel"
            onClick={() => {
              onClose();
              onNavigate(status === 'not_found' ? 'ean-nao-cadastrados' : 'historico-ean');
            }}
          >
            Ver histórico completo
          </button>
          <button type="button" className="btn-edit-action" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export function ExpeditionDashboard({ gtinDashboard, productsCount, onNavigate, onShowProductsWithoutGtin, api }) {
  const [detailStatus, setDetailStatus] = useState('');
  const [detailEvents, setDetailEvents] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const activeGtins = Number(gtinDashboard?.active_gtins || 0);
  const productsWithGtin = Number(gtinDashboard?.products_with_gtin || 0);
  const todayTotal = Number(gtinDashboard?.today?.total || 0);
  const todayIdentified = Number(gtinDashboard?.today?.identified || 0);
  const todayNotFound = Number(gtinDashboard?.today?.not_found || 0);
  const todayErrors = Number(gtinDashboard?.today?.system_errors || 0);

  const successRate = todayTotal > 0 ? Math.round((todayIdentified / todayTotal) * 100) : 100;
  const coverageRate = productsCount > 0 ? Math.round((productsWithGtin / productsCount) * 100) : 0;
  const productsWithoutGtin = Number(gtinDashboard?.products_without_gtin_count ?? Math.max(0, productsCount - productsWithGtin));

  const openScanDetails = async status => {
    const counts = {
      identified: todayIdentified,
      not_found: todayNotFound,
      system_error: todayErrors
    };
    if (!counts[status] || !api) return;

    setDetailStatus(status);
    setDetailEvents([]);
    setDetailError('');
    setDetailLoading(true);

    try {
      const params = new URLSearchParams({
        status,
        today: '1',
        limit: '100'
      });
      if (status === 'not_found') params.set('pending', '1');
      const result = await api(`/api/admin/gtin-events?${params.toString()}`);
      setDetailEvents(Array.isArray(result?.events) ? result.events : []);
    } catch (error) {
      setDetailError(error?.message || 'Não foi possível carregar os detalhes das bipagens.');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="expedition-dashboard-container" style={{ marginBottom: '24px' }}>
      <div className="kpis-row">
        <div className="kpi-box kpi-blue">
          <div className="kpi-icon-circle blue">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7.5 4.27 9 5.15" />
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </div>
          <div className="kpi-body">
            <span className="kpi-title">Total de Produtos</span>
            <strong className="kpi-num"><AnimatedNumber value={productsCount} /></strong>
            <span className="kpi-tag green"><AnimatedNumber value={coverageRate} suffix="%" /> com EAN cadastrado</span>
          </div>
        </div>

        <div className="kpi-box kpi-green">
          <div className="kpi-icon-circle green">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="kpi-body">
            <span className="kpi-title">EANs Ativos</span>
            <strong className="kpi-num"><AnimatedNumber value={activeGtins} /></strong>
            <span className="kpi-tag green">Vinculados ao catálogo</span>
          </div>
        </div>

        <div className="kpi-box kpi-yellow">
          <div className="kpi-icon-circle yellow">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="kpi-body">
            <span className="kpi-title">Leituras Hoje</span>
            <strong className="kpi-num"><AnimatedNumber value={todayTotal} /></strong>
            <span className="kpi-tag green"><AnimatedNumber value={successRate} suffix="%" /> de acerto</span>
          </div>
        </div>

        {todayNotFound > 0 && (
          <button
            type="button"
            className="kpi-box kpi-purple kpi-action"
            onClick={() => openScanDetails('not_found')}
            title="Ver os EANs não cadastrados de hoje"
          >
            <div className="kpi-icon-circle purple">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#9333ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div className="kpi-body">
              <span className="kpi-title">EAN não Cadastrados</span>
              <strong className="kpi-num"><AnimatedNumber value={todayNotFound} /></strong>
              <span className="kpi-tag orange">Clique para ver as bipagens</span>
            </div>
          </button>
        )}
      </div>

      <div className="expedition-panels-grid">
        <div className="expedition-card">
          <div className="expedition-card-head">
            <div className="expedition-card-title">
              <span style={{ fontSize: '18px' }}>⚡</span>
              <strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: 800 }}>Produtividade da Expedição Hoje</strong>
            </div>
            <span className="status-pill active" style={{ fontSize: '11px', fontWeight: 800 }}>
              <AnimatedNumber value={todayTotal} /> itens bipados
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>Taxa de Sucesso na Bipagem</span>
                <strong style={{ color: successRate >= 95 ? '#16a34a' : '#d97706' }}><AnimatedNumber value={successRate} suffix="%" /></strong>
              </div>
              <div
                className="nisti-progress-track is-success-rate"
                data-label={`${successRate}% de sucesso na bipagem`}
                aria-label={`Taxa de sucesso na bipagem: ${successRate}%`}
              >
                <div
                  key={`success-${successRate}-${todayTotal}`}
                  className="nisti-progress-fill"
                  style={{
                    width: `${todayTotal > 0 ? Math.min(100, Math.max(0, successRate)) : 100}%`,
                    background: successRate >= 95 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : 'linear-gradient(90deg, #f59e0b, #d97706)'
                  }}
                />
              </div>
            </div>

            <div className="expedition-metrics-subgrid">
              <button
                type="button"
                className="expedition-metric-detail identified"
                disabled={todayIdentified === 0}
                onClick={() => openScanDetails('identified')}
              >
                <span>Identificados</span>
                <strong><AnimatedNumber value={todayIdentified} /></strong>
                <small>{todayIdentified > 0 ? 'Ver bipagens ›' : 'Sem leituras'}</small>
              </button>
              <button
                type="button"
                className="expedition-metric-detail not-found"
                disabled={todayNotFound === 0}
                onClick={() => openScanDetails('not_found')}
              >
                <span>Não Cadastrados</span>
                <strong><AnimatedNumber value={todayNotFound} /></strong>
                <small>{todayNotFound > 0 ? 'Ver quais foram ›' : 'Nenhum'}</small>
              </button>
              <button
                type="button"
                className="expedition-metric-detail system-error"
                disabled={todayErrors === 0}
                onClick={() => openScanDetails('system_error')}
              >
                <span>Erros Técnicos</span>
                <strong><AnimatedNumber value={todayErrors} /></strong>
                <small>{todayErrors > 0 ? 'Ver erros ›' : 'Nenhum'}</small>
              </button>
            </div>
          </div>
        </div>

        <div className="expedition-card">
          <div className="expedition-card-head">
            <div className="expedition-card-title">
              <span style={{ fontSize: '18px' }}>🏷️</span>
              <strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: 800 }}>Cobertura EAN do Catálogo</strong>
            </div>
            <span className="status-pill" style={{ fontSize: '11px', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8' }}>
              <AnimatedNumber value={coverageRate} suffix="%" /> coberto
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>Produtos com Código de Barras</span>
                <strong style={{ color: '#2563eb' }}><AnimatedNumber value={productsWithGtin} /> de <AnimatedNumber value={productsCount} /></strong>
              </div>
              <div
                className="nisti-progress-track"
                data-label={`${coverageRate}% do catálogo com EAN`}
                aria-label={`Cobertura EAN do catálogo: ${coverageRate}%`}
              >
                <div
                  key={`coverage-${coverageRate}-${productsCount}`}
                  className="nisti-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, coverageRate))}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)'
                  }}
                />
              </div>
            </div>

            {productsWithoutGtin > 0 && (
              <button type="button" className="missing-gtin-alert" onClick={onShowProductsWithoutGtin}>
                <span>⚠️ <strong>{productsWithoutGtin}</strong> produto{productsWithoutGtin === 1 ? '' : 's'} sem EAN vinculado</span>
                <span>Ver produtos →</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <ScanDetailsModal
        status={detailStatus}
        events={detailEvents}
        loading={detailLoading}
        error={detailError}
        onClose={() => setDetailStatus('')}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default ExpeditionDashboard;
