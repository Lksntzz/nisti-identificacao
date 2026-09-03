import React, { useEffect, useMemo, useState } from 'react';
import './geometric-shadow-observability.css';

const API_PATH = '/api/admin/geometric-shadow-evidence/observability?limit=500';

function pct(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function score(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function verdictLabel(value) {
  const labels = {
    pending: 'Aguardando confirmação',
    excluded_non_independent: 'Excluída por conteúdo repetido',
    retrieval_correct: 'Fastpath correto',
    retrieval_incorrect: 'Fastpath incorreto',
    geometric_incremental_correct: 'Geometria corrigiria',
    geometric_incremental_incorrect: 'Geometria erraria',
    no_safe_acceptance: 'Fail-closed'
  };
  return labels[value] || value || '—';
}

function verdictClass(value) {
  if (['retrieval_correct', 'geometric_incremental_correct'].includes(value)) return 'good';
  if (['retrieval_incorrect', 'geometric_incremental_incorrect'].includes(value)) return 'bad';
  if (value === 'pending') return 'pending';
  return 'neutral';
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(rows) {
  const headers = [
    'id','created_at','platform','operator_name','occurrence_id','confirmed_capa_code',
    'production_capa_code','production_correct','retrieval_eligible','retrieval_capa_code',
    'retrieval_top_score','retrieval_top2_code','retrieval_top2_score','retrieval_margin',
    'geometric_evaluated','geometric_eligible','geometric_capa_code','geometric_score',
    'geometric_good_matches','geometric_inliers','geometric_inlier_ratio','geometric_reference_coverage',
    'verdict','would_fix_production','would_worsen_production','content_independent','confirmation_source'
  ];
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    const values = [
      row.id,row.created_at,row.platform,row.operator_name,row.occurrence_id,row.confirmed_capa_code,
      row.production?.capa_code,row.production?.correct,row.retrieval?.eligible,row.retrieval?.capa_code,
      row.retrieval?.top_score,row.retrieval?.top2_code,row.retrieval?.top2_score,row.retrieval?.margin,
      row.geometric?.evaluated,row.geometric?.eligible,row.geometric?.capa_code,row.geometric?.score,
      row.geometric?.good_matches,row.geometric?.inliers,row.geometric?.inlier_ratio,row.geometric?.reference_coverage,
      row.verdict,row.would_fix_production,row.would_worsen_production,row.content_independent,row.confirmation_source
    ];
    lines.push(values.map(csvEscape).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

function MetricCard({ label, value, detail, tone = 'default' }) {
  return (
    <div className={`shadow-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export default function GeometricShadowObservability() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch(API_PATH, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        window.location.href = '/admin-login';
        return;
      }
      if (!response.ok || !data?.ok) throw new Error(data?.error || `Erro ${response.status}`);
      setReport(data.report);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar observabilidade.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const rows = report?.rows || [];
  const platforms = useMemo(() => [...new Set(rows.map(row => row.platform).filter(Boolean))].sort(), [rows]);
  const filteredRows = useMemo(() => {
    const term = search.trim().toUpperCase();
    return rows.filter(row => {
      if (platform !== 'ALL' && row.platform !== platform) return false;
      if (status !== 'ALL' && row.verdict !== status) return false;
      if (!term) return true;
      return [
        row.confirmed_capa_code,
        row.production?.capa_code,
        row.retrieval?.capa_code,
        row.geometric?.capa_code,
        row.operator_name,
        row.occurrence_id,
        row.id
      ].some(value => String(value || '').toUpperCase().includes(term));
    });
  }, [rows, platform, status, search]);

  const summary = report?.summary || {};
  const overall = summary?.overall || {};
  const rollout = summary?.rollout_evidence || {};
  const incremental = overall?.geometric_incremental || {};
  const fastpath = overall?.retrieval_fastpath || {};
  const hybrid = overall?.hybrid || {};
  const progress = Math.min(100, (Number(rollout?.observed_unique_incremental_accepted || 0) / Math.max(1, Number(rollout?.min_unique_incremental_accepted || 30))) * 100);

  const exportJson = () => {
    if (!report) return;
    downloadBlob(
      `nisti-shadow-observability-${new Date().toISOString().slice(0,10)}.json`,
      JSON.stringify(report, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportCsv = () => {
    downloadBlob(
      `nisti-shadow-evidence-${new Date().toISOString().slice(0,10)}.csv`,
      buildCsv(filteredRows),
      'text/csv;charset=utf-8'
    );
  };

  return (
    <main className="shadow-observability-page">
      <header className="shadow-observability-header">
        <div>
          <a className="shadow-back-link" href="/admin">← Voltar ao Painel ADM</a>
          <h1>Observabilidade do Reconhecimento Shadow</h1>
          <p>Fastpath + geometria estrita em produção real, sem autoridade sobre o resultado entregue ao operador.</p>
        </div>
        <div className="shadow-header-actions">
          <span className={`shadow-rollout-pill ${rollout?.safe_for_promotion ? 'ready' : 'blocked'}`}>
            {rollout?.safe_for_promotion ? 'Promoção liberada' : 'Promoção bloqueada'}
          </span>
          <button type="button" onClick={load} disabled={loading}>Atualizar</button>
        </div>
      </header>

      {error && <div className="shadow-error">{error}</div>}
      {loading && !report && <div className="shadow-loading">Carregando evidências…</div>}

      {report && (
        <>
          <section className="shadow-metrics-grid">
            <MetricCard label="Fotos únicas confirmadas" value={summary.confirmed_unique ?? 0} detail={`${summary.pending_rows ?? 0} pendentes`} />
            <MetricCard label="Fastpath observado" value={pct(fastpath.precision)} detail={`${fastpath.correct ?? 0}/${fastpath.accepted ?? 0} corretos`} tone={fastpath.incorrect ? 'danger' : 'safe'} />
            <MetricCard label="Geometria incremental" value={pct(incremental.precision)} detail={`${incremental.correct ?? 0}/${incremental.accepted ?? 0} corretos`} tone={incremental.incorrect ? 'danger' : 'safe'} />
            <MetricCard label="Cobertura híbrida" value={pct(hybrid.coverage)} detail={`${hybrid.correct ?? 0}/${hybrid.accepted ?? 0} corretos`} tone={hybrid.incorrect ? 'danger' : 'safe'} />
            <MetricCard label="Falsos positivos" value={(incremental.incorrect ?? 0) + (hybrid.incorrect ?? 0)} detail="deve permanecer em zero" tone={(incremental.incorrect ?? 0) + (hybrid.incorrect ?? 0) ? 'danger' : 'safe'} />
            <MetricCard label="Casos não independentes" value={summary.excluded_non_independent_confirmed_rows ?? 0} detail="fora do rollout" />
          </section>

          <section className="shadow-rollout-card">
            <div className="shadow-rollout-head">
              <div>
                <strong>Gate de promoção geométrica</strong>
                <span>{rollout.observed_unique_incremental_accepted ?? 0} / {rollout.min_unique_incremental_accepted ?? 30} aceitações incrementais únicas</span>
              </div>
              <b>{progress.toFixed(0)}%</b>
            </div>
            <div className="shadow-progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="shadow-rollout-rules">
              <span className={(rollout.observed_unique_incremental_incorrect ?? 0) === 0 ? 'ok' : 'bad'}>FP geométrico: {rollout.observed_unique_incremental_incorrect ?? 0}</span>
              <span className={(rollout.observed_unique_hybrid_incorrect ?? 0) === 0 ? 'ok' : 'bad'}>Erros híbridos: {rollout.observed_unique_hybrid_incorrect ?? 0}</span>
              <span className={(summary.label_conflicts || []).length === 0 ? 'ok' : 'bad'}>Conflitos de rótulo: {(summary.label_conflicts || []).length}</span>
              <span className="ok">Somente conteúdo independente</span>
            </div>
          </section>

          <section className="shadow-platform-grid">
            {Object.entries(summary.by_platform || {}).map(([name, data]) => (
              <article key={name} className="shadow-platform-card">
                <strong>{name}</strong>
                <span>Avaliadas: {data.evaluated ?? 0}</span>
                <span>Fastpath: {data.retrieval_fastpath?.correct ?? 0}/{data.retrieval_fastpath?.accepted ?? 0} · {pct(data.retrieval_fastpath?.precision)}</span>
                <span>Geometria: {data.geometric_incremental?.correct ?? 0}/{data.geometric_incremental?.accepted ?? 0} · {pct(data.geometric_incremental?.precision)}</span>
                <span>Híbrido: {pct(data.hybrid?.coverage)} cobertura</span>
              </article>
            ))}
          </section>

          <section className="shadow-evidence-card">
            <div className="shadow-table-toolbar">
              <div>
                <h2>Evidências individuais</h2>
                <p>{filteredRows.length} de {rows.length} registros recentes</p>
              </div>
              <div className="shadow-toolbar-actions">
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar CAPA, ocorrência ou operador" />
                <select value={platform} onChange={event => setPlatform(event.target.value)}>
                  <option value="ALL">Todas plataformas</option>
                  {platforms.map(item => <option value={item} key={item}>{item}</option>)}
                </select>
                <select value={status} onChange={event => setStatus(event.target.value)}>
                  <option value="ALL">Todos status</option>
                  <option value="pending">Pendentes</option>
                  <option value="retrieval_correct">Fastpath correto</option>
                  <option value="retrieval_incorrect">Fastpath incorreto</option>
                  <option value="geometric_incremental_correct">Geometria corrigiria</option>
                  <option value="geometric_incremental_incorrect">Geometria erraria</option>
                  <option value="no_safe_acceptance">Fail-closed</option>
                  <option value="excluded_non_independent">Não independente</option>
                </select>
                <button type="button" onClick={exportJson}>JSON</button>
                <button type="button" onClick={exportCsv}>CSV</button>
              </div>
            </div>

            <div className="shadow-table-wrap">
              <table className="shadow-evidence-table">
                <thead>
                  <tr>
                    <th>Foto</th>
                    <th>Plataforma</th>
                    <th>Ground truth</th>
                    <th>Produção</th>
                    <th>Vectorize</th>
                    <th>Geometria strict</th>
                    <th>Resultado shadow</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => (
                    <tr key={row.evidence_token || row.id} className={row.would_worsen_production ? 'risk-row' : row.would_fix_production ? 'fix-row' : ''}>
                      <td>
                        <strong>#{row.id}</strong>
                        <small>{formatDate(row.created_at)}</small>
                        {row.occurrence_id && <small>Ocorrência {row.occurrence_id}</small>}
                        {row.operator_name && <small>{row.operator_name}</small>}
                      </td>
                      <td><span className="shadow-platform-pill">{row.platform || '—'}</span></td>
                      <td>
                        <strong>{row.confirmed_capa_code || 'Pendente'}</strong>
                        <small>{row.confirmation_source || 'aguardando humano'}</small>
                      </td>
                      <td>
                        <strong>{row.production?.capa_code || 'Sem resultado'}</strong>
                        <small>{row.production?.identified_by || `HTTP ${row.production?.http_status || '—'}`}</small>
                      </td>
                      <td>
                        <strong>{row.retrieval?.capa_code || '—'} {row.retrieval?.eligible ? '✓' : ''}</strong>
                        <small>score {score(row.retrieval?.top_score)} · margem {score(row.retrieval?.margin)}</small>
                        <small>2º {row.retrieval?.top2_code || '—'} {score(row.retrieval?.top2_score)}</small>
                      </td>
                      <td>
                        <strong>{row.geometric?.capa_code || (row.geometric?.evaluated ? 'Sem vencedor' : 'Não executada')} {row.geometric?.eligible ? '✓' : ''}</strong>
                        <small>score {score(row.geometric?.score, 3)} · rank vetorial {row.geometric?.vector_rank || '—'}</small>
                        <small>{row.geometric?.good_matches || 0} matches · {row.geometric?.inliers || 0} inliers · {pct(row.geometric?.inlier_ratio)}</small>
                      </td>
                      <td>
                        <span className={`shadow-verdict ${verdictClass(row.verdict)}`}>{verdictLabel(row.verdict)}</span>
                        {row.would_fix_production && <small className="shadow-impact fix">Corrigiria a produção</small>}
                        {row.would_worsen_production && <small className="shadow-impact bad">Pioraria a produção</small>}
                        {!row.content_independent && <small className="shadow-impact neutral">Conteúdo repetido</small>}
                      </td>
                    </tr>
                  ))}
                  {!filteredRows.length && (
                    <tr><td colSpan="7" className="shadow-empty">Nenhuma evidência com os filtros atuais.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="shadow-observability-footer">
            Observabilidade v8.20 · shadow {summary.shadow_version || '—'} · gate {summary.gate_version || '—'} · production_changed=false · atualizado {formatDate(report.generated_at)}
          </footer>
        </>
      )}
    </main>
  );
}
