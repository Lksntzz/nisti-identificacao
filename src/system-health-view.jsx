import React, { useMemo, useState } from 'react';
import { formatSaoPauloTimestamp } from './date-time.js';
import { AdminState } from './admin/AdminState.jsx';

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatDate(value) {
  return formatSaoPauloTimestamp(value);
}

function overallMeta(status) {
  if (status === 'healthy') {
    return {
      className: 'healthy',
      title: 'Sistema saudável',
      description: 'Os serviços principais responderam e não há falhas operacionais abertas.'
    };
  }
  if (status === 'attention') {
    return {
      className: 'attention',
      title: 'Sistema funcionando com atenção necessária',
      description: 'A infraestrutura respondeu, mas existem erros técnicos ou pendências de sincronização.'
    };
  }
  return {
    className: 'degraded',
    title: 'Sistema com serviço indisponível',
    description: 'Pelo menos um serviço principal não respondeu à verificação.'
  };
}

function checkMeta(status) {
  if (status === 'healthy') return { label: 'Saudável', className: 'healthy' };
  return { label: 'Indisponível', className: 'error' };
}

function sourceLabel(source) {
  if (source === 'SINCRONIZAÇÃO') return 'Sincronização';
  if (source === 'BIPAGEM') return 'Bipagem';
  return source || 'Sistema';
}

function HealthKpi({ label, value, note, tone = 'neutral' }) {
  return (
    <div className={`health-kpi health-kpi-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export default function SystemHealthView({
  metrics,
  storage,
  health,
  healthError,
  onRefresh
}) {
  const [refreshing, setRefreshing] = useState(false);
  const db = metrics?.database || {};
  const r2 = storage?.r2 || {};
  const sync = health?.sync || {};
  const checks = Array.isArray(health?.checks) ? health.checks : [];
  const issues = Array.isArray(health?.recent_issues) ? health.recent_issues : [];
  const meta = overallMeta(health?.overall_status || (healthError ? 'degraded' : 'healthy'));

  const issueCounts = useMemo(() => {
    return issues.reduce((acc, issue) => {
      const key = issue.source === 'SINCRONIZAÇÃO' ? 'sync' : 'scan';
      acc[key] += 1;
      return acc;
    }, { sync: 0, scan: 0 });
  }, [issues]);

  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="admin-table-card system-health-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="m7 16 4-5 4 3 4-7" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Saúde & Logs</h3>
            <span className="table-sub-title">Diagnóstico real da API, bancos, imagens, sincronização e bipagens</span>
          </div>
        </div>

        <button
          type="button"
          className={`btn-toolbar-filter ${refreshing ? 'nisti-action-busy' : ''}`}
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? 'Verificando…' : 'Verificar agora'}
        </button>
      </div>

      <div className="system-health-content">
        {healthError ? (
          <AdminState
            tone="error"
            title="Não foi possível concluir o diagnóstico"
            description={healthError}
            actionLabel={refreshing ? '' : 'Verificar novamente'}
            onAction={refreshing ? undefined : refresh}
            className="system-health-load-error"
          />
        ) : (
          <div className={`system-health-overall ${meta.className}`}>
            <div className="system-health-overall-icon">
              {meta.className === 'healthy' ? '✓' : meta.className === 'attention' ? '!' : '×'}
            </div>
            <div>
              <strong>{meta.title}</strong>
              <p>{meta.description}</p>
              <small>Última verificação: {formatDate(health?.measured_at)}</small>
            </div>
          </div>
        )}

        <div className="system-health-check-grid">
          {checks.length === 0 ? (
            <AdminState
              tone={refreshing ? 'loading' : 'info'}
              compact
              title={refreshing ? 'Verificando serviços' : 'Aguardando verificação'}
              description={refreshing
                ? 'Consultando API, banco, armazenamento e integrações.'
                : 'Execute uma verificação para obter o estado atual dos serviços.'}
              className="system-health-empty-checks"
            />
          ) : checks.map(check => {
            const state = checkMeta(check.status);
            return (
              <div className="system-health-service" key={check.key}>
                <div className="system-health-service-head">
                  <strong>{check.label}</strong>
                  <span className={`system-health-status ${state.className}`}>{state.label}</span>
                </div>
                <p>{check.detail || check.error || 'Sem detalhes disponíveis.'}</p>
                <small>
                  {Number.isFinite(Number(check.latency_ms))
                    ? `Resposta em ${Number(check.latency_ms)} ms`
                    : 'Tempo de resposta indisponível'}
                </small>
              </div>
            );
          })}
        </div>

        <section className="system-health-section">
          <div className="system-health-section-head">
            <div>
              <h4>Sincronização NISTI → Catálogo</h4>
              <p>Estado real dos vínculos entre Produtos NISTI e o Catálogo Comercial.</p>
            </div>
            <span>Última sincronização: {formatDate(sync.last_synced_at)}</span>
          </div>

          <div className="system-health-kpis">
            <HealthKpi
              label="Produtos NISTI"
              value={formatNumber(sync.nisti_products)}
              note="Base atual do NISTI ID"
            />
            <HealthKpi
              label="Sincronizados"
              value={formatNumber(sync.linked_total)}
              note="Confirmados no Catálogo"
              tone="good"
            />
            <HealthKpi
              label="Sem vínculo"
              value={formatNumber(sync.unlinked)}
              note="Ainda não confirmados"
              tone={Number(sync.unlinked || 0) > 0 ? 'warn' : 'neutral'}
            />
            <HealthKpi
              label="Conflitos / Erros"
              value={formatNumber(Number(sync.conflicts || 0) + Number(sync.errors || 0))}
              note={`${formatNumber(sync.conflicts)} conflitos · ${formatNumber(sync.errors)} erros`}
              tone={Number(sync.conflicts || 0) + Number(sync.errors || 0) > 0 ? 'bad' : 'good'}
            />
          </div>
        </section>

        <section className="system-health-section">
          <div className="system-health-section-head">
            <div>
              <h4>Erros e ocorrências recentes</h4>
              <p>Somente problemas realmente registrados pelo sistema.</p>
            </div>
            <span>{issueCounts.sync} sincronização · {issueCounts.scan} bipagem</span>
          </div>

          <div className="system-health-log-wrap">
            {issues.length === 0 ? (
              <AdminState
                tone="success"
                compact
                title="Nenhum erro recente registrado"
                description="Bipagem e sincronização não possuem ocorrências técnicas recentes neste diagnóstico."
                className="system-health-no-issues"
              />
            ) : (
              <table className="admin-data-table system-health-log-table">
                <thead>
                  <tr>
                    <th>ORIGEM</th>
                    <th>OCORRÊNCIA</th>
                    <th>PRODUTO / EAN</th>
                    <th>DATA</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue, index) => (
                    <tr key={`${issue.source}-${issue.sku || issue.gtin || 'item'}-${issue.created_at || index}`}>
                      <td>
                        <span className={`health-log-source ${issue.source === 'SINCRONIZAÇÃO' ? 'sync' : 'scan'}`}>
                          {sourceLabel(issue.source)}
                        </span>
                      </td>
                      <td>
                        <div className="health-log-copy">
                          <strong>{issue.title}</strong>
                          <small>{issue.detail || 'Sem detalhe técnico.'}</small>
                        </div>
                      </td>
                      <td>
                        <div className="health-log-copy">
                          <strong>{issue.sku || issue.gtin || '—'}</strong>
                          <small>
                            {issue.sku && issue.gtin
                              ? `EAN ${issue.gtin}`
                              : issue.operator_name
                                ? issue.operator_name
                                : '—'}
                          </small>
                        </div>
                      </td>
                      <td>{formatDate(issue.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="system-health-section system-health-storage-section">
          <div className="system-health-section-head">
            <div>
              <h4>Uso da infraestrutura</h4>
              <p>Medições observadas pelo próprio NISTI. Não representam faturamento do provedor.</p>
            </div>
          </div>

          <div className="system-health-usage-grid">
            <div>
              <span>D1</span>
              <strong>{formatBytes(db.used_bytes)}</strong>
              <small>{formatNumber(db.products)} produtos no banco</small>
            </div>
            <div>
              <span>R2</span>
              <strong>{r2.complete === false ? '≥ ' : ''}{formatBytes(r2.used_bytes)}</strong>
              <small>{formatNumber(r2.object_count)} objetos no bucket</small>
            </div>
            <div>
              <span>Erros técnicos hoje</span>
              <strong>{formatNumber(health?.scan?.technical_errors_today)}</strong>
              <small>Último: {formatDate(health?.scan?.last_error_at)}</small>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
