import React from 'react';

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
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(value));
  } catch { return String(value); }
}

function MetricBox({ tag, title, value, children }) {
  return (
    <div className="system-metric-box">
      <div className="metric-box-head"><span className="metric-tag">{tag}</span><h4>{title}</h4></div>
      <div className="metric-big-num">{value}</div>
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

export default function SystemHealthView({ metrics, storage, onRefresh }) {
  const db = metrics?.database || {};
  const r2 = storage?.r2 || {};

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" /><path d="m7 16 4-5 4 3 4-7" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Saúde do Sistema EAN</h3>
            <span className="table-sub-title">Infraestrutura usada pelo catálogo, scanner e histórico de leituras</span>
          </div>
        </div>
        <button type="button" className="btn-toolbar-filter" onClick={() => onRefresh?.()}>Atualizar medições</button>
      </div>

      <div style={{ padding: '0 24px 18px' }}>
        <div className="free-tier-health-banner" style={{ alignItems: 'flex-start' }}>
          <div className="free-tier-health-icon">✓</div>
          <div>
            <strong>Fluxo principal sem dependência de IA</strong>
            <p style={{ marginBottom: 0 }}>A identificação atual consulta o código EAN diretamente no catálogo. Falhas do antigo reconhecimento visual não entram mais nos indicadores operacionais.</p>
          </div>
        </div>
      </div>

      <div className="admin-metrics-grid" style={{ padding: '0 24px 20px' }}>
        <MetricBox tag="D1" title="Banco do catálogo" value={formatBytes(db.used_bytes)}>
          {formatNumber(db.products)} produtos armazenados. O D1 mantém produtos, vínculos EAN e eventos de leitura.
        </MetricBox>
        <MetricBox tag="R2" title="Imagens de produtos" value={`${r2.complete === false ? '≥ ' : ''}${formatBytes(r2.used_bytes)}`}>
          {formatNumber(r2.object_count)} imagens e arquivos no bucket de produtos.
        </MetricBox>
        <MetricBox tag="Worker" title="Última medição" value={formatDate(metrics?.measured_at)}>
          API do scanner, consulta EAN e painel administrativo respondendo pela mesma aplicação.
        </MetricBox>
      </div>

      <div style={{ padding: '0 24px 28px' }}>
        <div className="table-responsive-container" style={{ border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <table className="admin-data-table">
            <thead><tr><th>COMPONENTE</th><th>FUNÇÃO ATUAL</th><th>STATUS</th><th>MEDIÇÃO</th></tr></thead>
            <tbody>
              <tr><td><strong>Scanner EAN</strong></td><td>Leitura e validação do GTIN-13</td><td><span className="status-pill active">• Ativo</span></td><td>Cliente móvel</td></tr>
              <tr><td><strong>D1</strong></td><td>Catálogo, códigos e histórico</td><td><span className="status-pill active">• Ativo</span></td><td>{formatBytes(db.used_bytes)}</td></tr>
              <tr><td><strong>R2</strong></td><td>Miniaturas e capas dos produtos</td><td><span className="status-pill active">• Ativo</span></td><td>{formatBytes(r2.used_bytes)}</td></tr>
              <tr><td><strong>Reconhecimento por IA</strong></td><td>Fluxo antigo, fora da operação EAN</td><td><span className="status-pill orange">Desativado no painel</span></td><td>Não utilizado</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
