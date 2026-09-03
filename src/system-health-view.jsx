import React, { useState } from 'react';

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
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
    return String(value);
  }
}

function Progress({ value }) {
  const pct = clampPct(value);
  return (
    <div className="quota-progress-track">
      <div className="quota-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function MetricBox({ tag, title, value, children, progress }) {
  return (
    <div className="system-metric-box">
      <div className="metric-box-head">
        <span className="metric-tag">{tag}</span>
        <h4>{title}</h4>
      </div>
      <div className="metric-big-num">{value}</div>
      {progress !== undefined && <Progress value={progress} />}
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
}

export default function SystemHealthView({ metrics, storage, onRefresh }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const db = metrics?.database || {};
  const r2 = storage?.r2 || {};
  const vectorize = metrics?.vectorize || {};
  const recognition = metrics?.recognition || {};
  const gemini = metrics?.gemini || {};
  const limits = metrics?.documented_limits || {};
  const policy = metrics?.measurement_policy || {};

  const d1Limit = Number(db.free_max_database_bytes || limits?.d1?.free_max_database_bytes || 0);
  const d1Pct = d1Limit > 0 ? (Number(db.used_bytes || 0) / d1Limit) * 100 : 0;
  const r2Reference = Number(r2.free_standard_storage_reference_bytes || 10_000_000_000);
  const r2Pct = r2Reference > 0 ? (Number(r2.used_bytes || 0) / r2Reference) * 100 : 0;
  const vectorStoredLimit = Number(limits?.vectorize?.free_stored_dimensions || 0);
  const vectorPct = vectorStoredLimit > 0
    ? (Number(vectorize.expected_stored_dimensions || 0) / vectorStoredLimit) * 100
    : 0;

  const handleSyncVectorize = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const response = await fetch('/api/admin/reindex-cover-embeddings', {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
      setSyncMessage(`Reindexação concluída: ${data?.indexed || 0} referências sincronizadas.`);
      await onRefresh?.();
    } catch (error) {
      setSyncMessage(`Falha na reindexação: ${error?.message || 'erro desconhecido'}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="m7 16 4-5 4 3 4-7" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Saúde & Consumo do Sistema</h3>
            <span className="table-sub-title">Medições reais do NISTI separadas de limites documentados dos provedores</span>
          </div>
        </div>

        <div className="table-actions-toolbar">
          <button type="button" className="btn-toolbar-filter" onClick={() => onRefresh?.()}>
            Atualizar medições
          </button>
          <button
            type="button"
            className="btn-create-product-gradient"
            onClick={handleSyncVectorize}
            disabled={syncing}
          >
            <span>{syncing ? 'Sincronizando…' : 'Reindexar Vectorize'}</span>
          </button>
        </div>
      </div>

      <div style={{ padding: '0 24px 18px' }}>
        <div className="free-tier-health-banner" style={{ alignItems: 'flex-start' }}>
          <div className="free-tier-health-icon">i</div>
          <div>
            <strong>Sem números inventados de billing</strong>
            <p style={{ marginBottom: 0 }}>
              O painel mostra somente o que o NISTI consegue medir diretamente. Consumo total da conta Cloudflare e quotas ativas do Gemini
              ficam marcados como não medidos quando a API de billing/analytics do provedor não está conectada.
              {limits?.verified_on ? ` Referências documentais verificadas em ${limits.verified_on}.` : ''}
            </p>
          </div>
        </div>
      </div>

      {syncMessage && (
        <div style={{ padding: '0 24px 16px' }}>
          <div className={syncMessage.startsWith('Falha') ? 'form-error-banner' : 'form-success-banner'}>{syncMessage}</div>
        </div>
      )}

      <div className="admin-metrics-grid" style={{ padding: '0 24px 20px' }}>
        <MetricBox
          tag="D1 medido"
          title="Banco de dados"
          value={`${formatBytes(db.used_bytes)} / ${formatBytes(d1Limit)}`}
          progress={d1Pct}
        >
          <div>{formatNumber(db.products)} produtos · {formatNumber(db.cover_visual_references)} referências visuais.</div>
          <div>{d1Pct.toFixed(2)}% do máximo de 500 MB por banco no Workers Free.</div>
          <div>Fonte: D1Result.meta.size_after. Atualiza após cadastros, alterações e treinamentos.</div>
        </MetricBox>

        <MetricBox
          tag="R2 medido"
          title="Imagens e fotos"
          value={`${r2.complete === false ? '≥ ' : ''}${formatBytes(r2.used_bytes)}`}
          progress={r2Pct}
        >
          <div>{formatNumber(r2.object_count)} objetos no bucket PRODUCT_IMAGES.</div>
          <div>Snapshot atual equivalente a {r2Pct.toFixed(2)}% da referência de 10 GB.</div>
          <div>R2 cobra GB-mês e operações; este número é tamanho atual do bucket, não valor de fatura.</div>
        </MetricBox>

        <MetricBox
          tag="Vectorize derivado"
          title="Índice vetorial esperado"
          value={`${formatNumber(vectorize.expected_vector_copies)} vetores`}
          progress={vectorPct}
        >
          <div>{formatNumber(vectorize.indexed_references)} referências indexadas · {formatNumber(vectorize.expected_stored_dimensions)} dimensões esperadas.</div>
          <div>{vectorPct.toFixed(2)}% da referência Free de {formatNumber(vectorStoredLimit)} dimensões armazenadas.</div>
          <div>Estimativa derivada do D1 e escopo por plataforma; billing real do Vectorize não é consultado.</div>
        </MetricBox>

        <MetricBox
          tag="Gemini observado"
          title="Atividade de IA hoje"
          value={`${formatNumber(gemini?.observed_today?.recognition_generation_requests)} verificações`}
        >
          <div>{formatNumber(gemini?.observed_today?.recognition_embedding_requests)} embeddings em identificações.</div>
          <div>{formatNumber(gemini?.observed_today?.embeddings_updated_in_catalog)} embeddings de catálogo/referências atualizados hoje.</div>
          <div>Quota ativa não é estimada: Google aplica limites por projeto, modelo e tier.</div>
        </MetricBox>
      </div>

      <div style={{ padding: '0 24px 20px' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '15px', color: '#1e293b' }}>Configuração ativa do NISTI</h4>
        <div className="table-responsive-container" style={{ border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>COMPONENTE</th>
                <th>VALOR ATUAL</th>
                <th>COMO É MEDIDO</th>
                <th>ÚLTIMA MEDIÇÃO</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>D1</strong></td>
                <td>{formatBytes(db.used_bytes)} · {formatNumber(db.products)} produtos</td>
                <td>Tamanho retornado pelo próprio D1 após consulta</td>
                <td>{formatDate(metrics?.measured_at)}</td>
              </tr>
              <tr>
                <td><strong>R2</strong></td>
                <td>{r2.complete === false ? '≥ ' : ''}{formatBytes(r2.used_bytes)} · {formatNumber(r2.object_count)} objetos</td>
                <td>{r2.complete === false ? 'Varredura parcial do bucket' : 'Varredura completa do bucket'}</td>
                <td>{formatDate(storage?.measured_at)}</td>
              </tr>
              <tr>
                <td><strong>Vectorize</strong></td>
                <td>{formatNumber(vectorize.expected_vector_copies)} vetores esperados</td>
                <td>Derivado das referências D1 e plataformas</td>
                <td>{formatDate(metrics?.measured_at)}</td>
              </tr>
              <tr>
                <td><strong>Gemini principal</strong></td>
                <td>{gemini?.models?.recognition || 'não configurado'}</td>
                <td>Variável GEMINI_MODEL do Worker</td>
                <td>{formatDate(metrics?.measured_at)}</td>
              </tr>
              <tr>
                <td><strong>Gemini verificador</strong></td>
                <td>{gemini?.models?.verifier || 'não configurado'}</td>
                <td>Variável GEMINI_VERIFIER_MODEL do Worker</td>
                <td>{formatDate(metrics?.measured_at)}</td>
              </tr>
              <tr>
                <td><strong>Gemini embedding</strong></td>
                <td>{gemini?.models?.embedding || 'não configurado'}</td>
                <td>Variável GEMINI_EMBEDDING_MODEL do Worker</td>
                <td>{formatDate(metrics?.measured_at)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ padding: '0 24px 28px' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '15px', color: '#1e293b' }}>Limites documentados x consumo realmente conhecido</h4>
        <div className="table-responsive-container" style={{ border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>SERVIÇO</th>
                <th>REFERÊNCIA DOCUMENTAL</th>
                <th>O NISTI MEDE?</th>
                <th>OBSERVAÇÃO</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Workers</strong></td>
                <td>{formatNumber(limits?.workers?.free_requests_per_day)} requests/dia no Free</td>
                <td><span className="status-pill orange">Não, conta total</span></td>
                <td>Identificações não são equivalentes ao total de requests do Worker.</td>
              </tr>
              <tr>
                <td><strong>D1</strong></td>
                <td>{formatNumber(limits?.d1?.free_rows_read_per_day)} rows read/dia · {formatNumber(limits?.d1?.free_rows_written_per_day)} rows write/dia</td>
                <td><span className="status-pill active">Storage: sim</span></td>
                <td>Rows read/write totais da conta exigem Analytics da Cloudflare.</td>
              </tr>
              <tr>
                <td><strong>R2 Standard</strong></td>
                <td>{limits?.r2?.free_standard_storage_gb_month || 10} GB-mês · {formatNumber(limits?.r2?.free_class_a_operations_per_month)} Class A · {formatNumber(limits?.r2?.free_class_b_operations_per_month)} Class B</td>
                <td><span className="status-pill active">Snapshot: sim</span></td>
                <td>Operações mensais e GB-mês da fatura não são inferidos pelo snapshot.</td>
              </tr>
              <tr>
                <td><strong>Vectorize</strong></td>
                <td>{formatNumber(limits?.vectorize?.free_stored_dimensions)} dims armazenadas · {formatNumber(limits?.vectorize?.free_queried_dimensions_per_month)} dims consultadas/mês</td>
                <td><span className="status-pill orange">Estimativa local</span></td>
                <td>Uso billable real exige Analytics/Billing da Cloudflare.</td>
              </tr>
              <tr>
                <td><strong>Gemini</strong></td>
                <td>Limites ativos variam por projeto, modelo e tier</td>
                <td><span className="status-pill orange">Atividade local</span></td>
                <td>O painel não exibe mais RPM/RPD fixos sem fonte da conta.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ padding: '0 24px 28px', fontSize: '12px', color: '#64748b' }}>
        <strong>Atividade do reconhecimento hoje:</strong> {formatNumber(recognition?.today?.attempts)} tentativas · {formatNumber(recognition?.today?.successes)} sucessos · {formatNumber(recognition?.today?.unmatched)} sem match · {formatNumber(recognition?.today?.system_errors)} erros técnicos.
        {policy?.note ? <div style={{ marginTop: '6px' }}>{policy.note}</div> : null}
      </div>
    </div>
  );
}
