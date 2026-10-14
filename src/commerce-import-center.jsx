import React, { useEffect, useMemo, useState } from 'react';
import {
  approveCommerceNewRows,
  approveCommerceProbableRows,
  commitCommerceImport,
  decideCommerceImportRow,
  getCommerceImport,
  getCommerceImportRows,
  getCommerceCatalogYearTargets,
  decideCommerceCatalogYear,
  listCommerceImports,
  listCommerceSalesImports,
  stageCommerceSalesWorkbook,
  stageCommerceWorkbook,
  retryCommerceImportReconciliation,
  syncCommerceListingStatuses
} from './commerce-import-client.js';
import { readCommerceSalesXlsx } from './commerce-sales-import-reader.js';
import { readCommerceXlsx } from './commerce-xlsx-reader.js';
import './commerce-import-center.css';

const CATALOG_PLATFORMS = [
  ['SHOPEE', 'Shopee'],
  ['MERCADO_LIVRE', 'Mercado Livre'],
  ['AMAZON', 'Amazon'],
  ['SHEIN', 'Shein'],
  ['LOJA_INTEGRADA', 'Loja Integrada'],
  ['KWAI', 'Kwai'],
  ['TIKTOK', 'TikTok'],
  ['ALIEXPRESS', 'AliExpress'],
  ['MAGALU', 'Magalu']
];

const SALES_PLATFORMS = [
  ['SHOPEE', 'Shopee'],
  ['ML_NOVO', 'Mercado Livre Novo'],
  ['ML_ANTIGO', 'Mercado Livre Antigo']
];

const STATUS_LABELS = {
  UPLOADED: 'Enviado',
  STAGED: 'Preparado',
  PARSED: 'Processado',
  REVIEW: 'Precisa revisão',
  COMMITTED: 'Concluído',
  FAILED: 'Falhou',
  PENDING: 'Pendente',
  MATCHED: 'Vinculado',
  PROBABLE: 'Provável',
  NEW_PRODUCT: 'Produto novo',
  CONFLICT: 'Conflito',
  INVALID: 'Inválido',
  IGNORED: 'Ignorado'
};

function brNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function brCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function brDate(value) {
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
    return '—';
  }
}

function platformLabel(code, sales = false) {
  const source = sales ? SALES_PLATFORMS : CATALOG_PLATFORMS;
  return source.find(([value]) => value === code)?.[1] || code || '—';
}

function StatusPill({ value }) {
  const status = String(value || 'PENDING').toUpperCase();
  const tone = status === 'COMMITTED' || status === 'MATCHED'
    ? 'ok'
    : ['FAILED', 'CONFLICT', 'INVALID'].includes(status)
      ? 'danger'
      : ['REVIEW', 'PROBABLE', 'NEW_PRODUCT', 'PENDING', 'STAGED'].includes(status)
        ? 'warn'
        : 'neutral';

  return <span className={`import-center-status ${tone}`}>{STATUS_LABELS[status] || status}</span>;
}

function ModeIcon({ type }) {
  if (type === 'sales') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 4-5 3 3 5-7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14v13H5z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
      <path d="M9 11h6" />
    </svg>
  );
}

function Step({ number, title, subtitle, children, complete = false, className = '' }) {
  return (
    <section className={`import-center-step ${complete ? 'complete' : ''} ${className}`.trim()}>
      <div className="import-center-step-index">{complete ? '✓' : number}</div>
      <div className="import-center-step-body">
        <div className="import-center-step-heading">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function FileDrop({ file, accept, disabled, onChange, hint }) {
  return (
    <label className={`import-center-file ${disabled ? 'disabled' : ''}`}>
      <input type="file" accept={accept} disabled={disabled} onChange={onChange} />
      <span className="import-center-file-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      </span>
      <strong>{file ? file.name : 'Clique para selecionar o arquivo'}</strong>
      <small>{file ? 'Clique novamente para trocar o arquivo.' : hint}</small>
    </label>
  );
}

function StatCard({ label, value, tone = 'blue' }) {
  return (
    <div className={`import-center-stat ${tone}`}>
      <span className="import-center-stat-dot" />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function CatalogPreview({ parsed }) {
  const s = parsed?.summary || {};
  return (
    <div className={`import-center-preview ${parsed ? '' : 'empty'}`}>
      <StatCard label="Linhas reconhecidas" value={parsed ? brNumber(s.accepted_rows) : '—'} tone="blue" />
      <StatCard label="Prontas" value={parsed ? brNumber(s.ready_rows) : '—'} tone="green" />
      <StatCard label="Revisar" value={parsed ? brNumber(s.review_rows) : '—'} tone="amber" />
      <StatCard label="Inválidas" value={parsed ? brNumber(s.invalid_rows) : '—'} tone="red" />
    </div>
  );
}

function SalesPreview({ parsed }) {
  const s = parsed?.summary || {};
  return (
    <div className={`import-center-preview ${parsed ? '' : 'empty'}`}>
      <StatCard label="Pedidos líquidos" value={parsed ? brNumber(s.net_orders) : '—'} tone="blue" />
      <StatCard label="Unidades" value={parsed ? brNumber(s.units) : '—'} tone="green" />
      <StatCard label="Faturamento" value={parsed ? brCurrency(s.product_revenue) : '—'} tone="amber" />
      <StatCard label="Períodos" value={parsed ? brNumber(s.period_count) : '—'} tone="purple" />
    </div>
  );
}

function ProgressBlock({ progress, text, disabledText = 'Aguardando arquivo…' }) {
  const total = Number(progress?.total || 0);
  const completed = Number(progress?.completed || 0);
  let percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  if (progress?.phase === 'done') percent = 100;
  if (progress?.phase === 'reconcile') percent = Math.min(95, Math.max(percent, 90));
  if (progress?.phase === 'commit') percent = Math.max(percent, 90);
  if (progress?.phase === 'failed') percent = 0;
  if (progress?.phase === 'finalize' || progress?.phase === 'summary') percent = Math.max(percent, 75);

  return (
    <div className="import-center-progress-block">
      <div className="import-center-progress-top">
        <strong>{percent}%</strong>
        <span>{text || disabledText}</span>
      </div>
      <div className="import-center-progress-track">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ImportHistory({ mode, items, loading, onOpen, onRefresh }) {
  return (
    <section className="import-center-side-card import-center-history">
      <div className="import-center-side-head">
        <div>
          <span className="import-center-side-icon">◷</span>
          <strong>Últimas importações</strong>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>Atualizar</button>
      </div>

      {loading ? <div className="import-center-side-empty">Carregando histórico…</div> : (
        <div className="import-center-history-list">
          {items.slice(0, 10).map(item => {
            const content = (
              <>
                <span className="import-center-history-file">▤</span>
                <div className="import-center-history-copy">
                  <strong>#{item.id} · {mode === 'sales' ? platformLabel(item.platform_code, true) : item.marketplace_name}</strong>
                  <span>{item.source_filename || 'Arquivo sem nome'}</span>
                </div>
                <StatusPill value={item.status} />
                <small>{brDate(item.created_at)}</small>
              </>
            );

            return mode === 'catalog' ? (
              <button
                type="button"
                key={item.id}
                className="import-center-history-row"
                onClick={() => onOpen?.(item)}
              >
                {content}
              </button>
            ) : (
              <div key={item.id} className="import-center-history-row static">
                {content}
              </div>
            );
          })}
          {!items.length && <div className="import-center-side-empty">Nenhuma importação registrada.</div>}
        </div>
      )}
    </section>
  );
}

function ImportSummary({ mode, history, batch }) {
  const latest = history?.[0] || null;
  const platform = mode === 'sales'
    ? platformLabel(latest?.platform_code, true)
    : (latest?.marketplace_name || '—');
  const pending = mode === 'catalog'
    ? Number(batch?.unresolved_count ?? latest?.unresolved_count ?? 0)
    : 0;

  return (
    <section className="import-center-side-card import-center-summary">
      <div className="import-center-side-head">
        <div>
          <span className="import-center-side-icon">▥</span>
          <strong>Resumo</strong>
        </div>
      </div>

      <dl>
        <div>
          <dt>Última importação</dt>
          <dd>{latest ? `#${latest.id} · ${platform}` : 'Nenhuma'}</dd>
        </div>
        <div>
          <dt>Última atualização</dt>
          <dd>{latest ? brDate(latest.completed_at || latest.imported_at || latest.created_at) : '—'}</dd>
        </div>
        <div>
          <dt>Status atual</dt>
          <dd>{latest ? <StatusPill value={latest.status} /> : '—'}</dd>
        </div>
        <div>
          <dt>Pendências abertas</dt>
          <dd className={pending > 0 ? 'pending' : ''}>{mode === 'catalog' ? `${brNumber(pending)} itens` : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}

function CatalogBatchReview({ batch, rows, yearTargets, busy, page, onPageChange, onDecision, onYearDecision, onApproveProbable, onApproveNew, onCommit, onSyncStatuses, onRetryReconcile }) {
  const unresolved = Number(batch?.unresolved_count || 0);
  const totalPages = Math.max(1, Math.ceil(Number(batch?.row_count || 0) / 20));
  const rowCount = Number(batch?.row_count || 0);
  const matched = Number(batch?.matched_count || 0);
  const probable = Number(batch?.probable_count || 0);
  const invalid = Number(batch?.invalid_count || 0);
  const ignored = Number(batch?.ignored_count || 0);
  const reviewCount = Math.max(0, rowCount - matched - invalid - ignored);

  return (
    <section className={`import-center-review-card ${batch ? '' : 'empty'}`}>
      <div className="import-center-review-header">
        <div className="import-center-review-title">
          <span className="import-center-step-index">{batch ? '5' : '5'}</span>
          <div>
            <h3>Revisão do lote</h3>
            <p>{batch ? `Lote #${batch.id} · ${batch.marketplace_name}${batch.account_code === 'ANTIGO' ? ' — Conta Antiga' : batch.account_code === 'NOVO' ? ' — Conta Nova' : ''} · ${batch.source_filename}` : 'Confira os itens que precisam de atenção antes de gravar no catálogo.'}</p>
          </div>
        </div>
        {batch && (
          <div className="import-center-review-totals">
            <span>{brNumber(rowCount)} itens</span>
            <small className="green">Prontas: {brNumber(matched)}</small>
            <small className="amber">Revisar: {brNumber(reviewCount)}</small>
            <small className="red">Inválidas: {brNumber(invalid)}</small>
          </div>
        )}
      </div>

      {!batch ? (
        <div className="import-center-review-empty">
          Prepare uma planilha para gerar o lote de revisão.
        </div>
      ) : (
        <>
          <div className="import-center-review-table-wrap">
            <table className="import-center-review-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Situação</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const payload = row.normalized_payload || {};
                  const year = yearTargets[row.id];
                  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
                  const duplicateSku = row.status === 'CONFLICT' && row.error_code === 'duplicate_sku_in_batch';
                  const variation = payload.source_variation || '';
                  const variationId = payload.source_variation_id || '';
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{payload.product_name || 'Produto sem nome'}</strong>
                        <small>{row.sheet_name} · linha {row.row_number}</small>
                        {(variation || variationId) && <small>Variação: {variation || 'sem nome'}{variationId ? ` · ID ${variationId}` : ''}</small>}
                        {payload.external_listing_id && <small>Anúncio: {payload.external_listing_id}</small>}
                      </td>
                      <td>
                        <code>{payload.sku_primary || payload.sku_secondary || '—'}</code>
                        {year?.suggested_sku && <small className="import-center-pb27-target">NISTI 2027: <code>{year.suggested_sku}</code></small>}
                        {year?.match_state === 'VERIFIED_TARGET' && <small>Correspondência validada no catálogo</small>}
                        {year?.platform_status === 'PENDING_PLATFORM' && <small className="import-center-pb27-warning">Aguardando alteração manual na plataforma</small>}
                        {year?.platform_status === 'CONFIRMED_MANUALLY' && <small className="import-center-pb27-target">Alteração declarada como concluída</small>}
                      </td>
                      <td>
                        <StatusPill value={row.status} />
                        {duplicateSku && <small title="SKU compartilhado por linhas da mesma importação; a capa/variação precisa ser conferida antes do vínculo.">SKU repetido no lote. Conferir capa e variação.</small>}
                        {row.status === 'CONFLICT' && !duplicateSku && row.error_code && <small>Motivo: {row.error_code}</small>}
                      </td>
                      <td>
                        <div className="import-center-row-actions">
                          {['PROBABLE', 'CONFLICT'].includes(row.status) && candidates.slice(0, 1).map(candidate => (
                            <button
                              type="button"
                              className="primary"
                              key={candidate.product_id}
                              disabled={busy}
                              title={`Confirmar manualmente vínculo com ${candidate.product_name || `produto #${candidate.product_id}`}`}
                              onClick={() => onDecision(row.id, 'CONFIRM_PRODUCT', candidate.product_id)}
                            >
                              Conferir vínculo
                            </button>
                          ))}
                          {['NEW_PRODUCT', 'PROBABLE'].includes(row.status) && (
                            <button type="button" disabled={busy} onClick={() => onDecision(row.id, 'CREATE_NEW')}>Criar novo</button>
                          )}
                          {!['MATCHED', 'COMMITTED', 'IGNORED'].includes(row.status) && (
                            <button type="button" className="danger" disabled={busy} onClick={() => onDecision(row.id, 'IGNORE')}>Ignorar</button>
                          )}
                          {batch.status === 'COMMITTED' && year?.match_state === 'VERIFIED_TARGET' && year?.platform_status === 'NOT_REGISTERED' && (
                            <button type="button" disabled={busy} onClick={() => onYearDecision(row.id,'REGISTER_PENDING')}>Registrar PB27 pendente</button>
                          )}
                          {batch.status === 'COMMITTED' && year?.platform_status === 'PENDING_PLATFORM' && (
                            <button type="button" disabled={busy} onClick={() => onYearDecision(row.id,'CONFIRM_PLATFORM')}>Confirmei na plataforma</button>
                          )}
                          {['MATCHED', 'COMMITTED'].includes(row.status) && <span className="import-center-row-done">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan="4" className="import-center-review-empty-cell">
                      Nenhuma linha pendente neste lote.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav className="import-center-review-pages" aria-label="Páginas da revisão">
              <button type="button" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
              <span>Página {page} de {totalPages} · {rowCount.toLocaleString('pt-BR')} itens</span>
              <button type="button" disabled={busy || page >= totalPages} onClick={() => onPageChange(page + 1)}>Próxima</button>
            </nav>
          )}
          <div className="import-center-review-footer">
            <div>
              {['PARSED', 'REVIEW'].includes(batch.status) && Number(batch.pending_count || 0) > 0 && (
                <button type="button" className="import-center-primary compact" disabled={busy}
                  onClick={onRetryReconcile}
                  title="Retoma a reconciliação do lote já enviado, sem duplicar registros e sem publicar anúncios.">
                  Retomar comparação ({brNumber(batch.pending_count)} linhas)
                </button>
              )}
              {Number(batch.approvable_probable_count || 0) > 0 && (
                <button type="button" disabled={busy} onClick={onApproveProbable}>
                  Aprovar prováveis ({brNumber(batch.approvable_probable_count)})
                </button>
              )}
              {Number(batch.unapproved_new_count || 0) > 0 && (
                <button type="button" disabled={busy} onClick={onApproveNew}>
                  Aprovar novos ({brNumber(batch.unapproved_new_count)})
                </button>
              )}
            </div>
            {batch.marketplace_code === 'MERCADO_LIVRE' && ['REVIEW', 'PARSED', 'COMMITTED'].includes(batch.status) && (
              <button type="button" disabled={busy} onClick={onSyncStatuses}
                title="Aplica apenas os status explicitamente informados no Excel. Não altera SKUs nem vínculos e não desativa anúncios ausentes.">
                Atualizar status dos anúncios
              </button>
            )}
            <button
              type="button"
              className="import-center-primary compact"
              disabled={busy || !batch.can_commit || batch.status === 'COMMITTED'}
              onClick={onCommit}
            >
              {batch.status === 'COMMITTED' ? 'Importação concluída' : 'Confirmar no catálogo'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function CommerceImportCenter({ onSalesChanged }) {
  const [mode, setMode] = useState('catalog');

  const [catalogPlatform, setCatalogPlatform] = useState('SHOPEE');
  const [catalogAccount, setCatalogAccount] = useState('');
  const [catalogFile, setCatalogFile] = useState(null);
  const [catalogParsed, setCatalogParsed] = useState(null);
  const [catalogReading, setCatalogReading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState(null);
  const [catalogHistory, setCatalogHistory] = useState([]);
  const [catalogHistoryLoading, setCatalogHistoryLoading] = useState(false);
  const [catalogBatch, setCatalogBatch] = useState(null);
  const [catalogRows, setCatalogRows] = useState([]);
  const [catalogYearTargets, setCatalogYearTargets] = useState({});
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogBusy, setCatalogBusy] = useState(false);

  const [salesPlatform, setSalesPlatform] = useState('SHOPEE');
  const [salesMonth, setSalesMonth] = useState('');
  const [salesFile, setSalesFile] = useState(null);
  const [salesParsed, setSalesParsed] = useState(null);
  const [salesReading, setSalesReading] = useState(false);
  const [salesImporting, setSalesImporting] = useState(false);
  const [salesProgress, setSalesProgress] = useState(null);
  const [salesHistory, setSalesHistory] = useState([]);
  const [salesHistoryLoading, setSalesHistoryLoading] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refreshCatalogHistory() {
    setCatalogHistoryLoading(true);
    try {
      const result = await listCommerceImports({ limit: 30, offset: 0 });
      setCatalogHistory(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o histórico do catálogo.');
    } finally {
      setCatalogHistoryLoading(false);
    }
  }

  async function refreshSalesHistory() {
    setSalesHistoryLoading(true);
    try {
      const result = await listCommerceSalesImports({ limit: 30, offset: 0 });
      setSalesHistory(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o histórico de vendas.');
    } finally {
      setSalesHistoryLoading(false);
    }
  }

  async function openCatalogBatch(batchId, page = catalogPage) {
    setCatalogBusy(true);
    setError('');
    try {
      const [batch, rowsResult, targetResult] = await Promise.all([
        getCommerceImport(batchId),
        getCommerceImportRows(batchId, { limit: 20, offset: (page - 1) * 20 }),
        getCommerceCatalogYearTargets(batchId)
      ]);
      setCatalogYearTargets(Object.fromEntries((targetResult?.items || []).map(item => [item.import_row_id, item])));
      setCatalogPage(page);
      setCatalogBatch(batch);
      setCatalogRows(Array.isArray(rowsResult?.items) ? rowsResult.items : []);
    } catch (err) {
      setError(err.message || 'Não foi possível abrir o lote.');
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => {
    refreshCatalogHistory();
    refreshSalesHistory();
  }, []);

  async function handleCatalogFile(event) {
    const file = event.target.files?.[0] || null;
    setCatalogFile(file);
    setCatalogParsed(null);
    setCatalogBatch(null);
    setCatalogRows([]);
    setCatalogYearTargets({});
    setCatalogPage(1);
    setCatalogProgress(null);
    setError('');
    setMessage('');
    if (!file) return;

    setCatalogReading(true);
    try {
      setCatalogParsed(await readCommerceXlsx(file, catalogPlatform, catalogPlatform === 'MERCADO_LIVRE' ? catalogAccount : null));
    } catch (err) {
      setError(err.message || 'Não foi possível validar a planilha.');
    } finally {
      setCatalogReading(false);
    }
  }

  async function handleCatalogImport() {
    if (!catalogParsed) return;
    if (catalogParsed.marketplace === 'MERCADO_LIVRE' && !['ANTIGO','NOVO'].includes(catalogParsed.account_code)) {
      setError('Selecione a conta de origem antes de preparar a importação.');
      return;
    }
    setCatalogImporting(true);
    setError('');
    setMessage('');
    try {
      const result = await stageCommerceWorkbook(catalogParsed, setCatalogProgress);
      setMessage(`Lote #${result.batchId} preparado. O catálogo só será alterado após a confirmação final.`);
      await Promise.all([refreshCatalogHistory(), openCatalogBatch(result.batchId, 1)]);
    } catch (err) {
      setCatalogProgress({ phase: 'failed', completed: 0, total: catalogParsed?.rows?.length || 1 });
      if (err.batchId) {
        await Promise.all([refreshCatalogHistory(), openCatalogBatch(err.batchId, 1)]);
        setError(`A comparação do lote #${err.batchId} não terminou. O arquivo continua salvo. Abra o lote no histórico e clique em Retomar comparação. Nenhum anúncio foi alterado.`);
      } else {
        setError(err.message || 'Falha ao preparar a importação do catálogo.');
      }
    } finally {
      setCatalogImporting(false);
    }
  }

  async function handleCatalogRetryReconcile() {
    if (!catalogBatch?.id || !['PARSED', 'REVIEW'].includes(catalogBatch.status)) return;
    setCatalogBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await retryCommerceImportReconciliation(catalogBatch.id);
      setMessage(`Lote #${catalogBatch.id} comparado. ${brNumber(result.matched)} vínculos diretos; os demais continuam em revisão. Nenhum anúncio foi publicado.`);
      await Promise.all([refreshCatalogHistory(), openCatalogBatch(catalogBatch.id, 1)]);
    } catch (err) {
      setError(`Não foi possível retomar o lote #${catalogBatch.id}. Os dados enviados permanecem salvos e os anúncios não foram modificados.`);
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleCatalogDecision(rowId, action, productId = null) {
    if (!catalogBatch?.id) return;
    setCatalogBusy(true);
    setError('');
    try {
      await decideCommerceImportRow(rowId, action, productId);
      await Promise.all([openCatalogBatch(catalogBatch.id), refreshCatalogHistory()]);
    } catch (err) {
      setError(err.message || 'Não foi possível registrar a decisão.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleCatalogYearDecision(rowId, action) {
    if (!catalogBatch?.id) return;
    setCatalogBusy(true);
    setError('');
    try {
      await decideCommerceCatalogYear(rowId, action);
      await openCatalogBatch(catalogBatch.id, catalogPage);
      setMessage(action === 'REGISTER_PENDING'
        ? 'SKU PB27 registrado como meta interna. Atualize o anúncio manualmente na plataforma.'
        : 'Atualização manual declarada como concluída. O NISTI não altera a plataforma automaticamente.');
    } catch (err) {
      setError(err.message || 'Não foi possível registrar a decisão de atualização.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleApproveProbable() {
    if (!catalogBatch?.id) return;
    setCatalogBusy(true);
    try {
      await approveCommerceProbableRows(catalogBatch.id);
      await Promise.all([openCatalogBatch(catalogBatch.id), refreshCatalogHistory()]);
    } catch (err) {
      setError(err.message || 'Não foi possível aprovar as correspondências prováveis.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleApproveNew() {
    if (!catalogBatch?.id) return;
    setCatalogBusy(true);
    try {
      await approveCommerceNewRows(catalogBatch.id);
      await Promise.all([openCatalogBatch(catalogBatch.id), refreshCatalogHistory()]);
    } catch (err) {
      setError(err.message || 'Não foi possível aprovar os produtos novos.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleCatalogStatusSync() {
    if (!catalogBatch?.id || catalogBatch.marketplace_code !== 'MERCADO_LIVRE') return;
    setCatalogBusy(true);
    setError('');
    try {
      const result = await syncCommerceListingStatuses(catalogBatch.id);
      setMessage(`Conta ${result.account_code === 'ANTIGO' ? 'Antiga' : 'Nova'}: ${brNumber(result.observed_listings)} anúncios observados; ${brNumber(result.created)} registros criados, ${brNumber(result.status_changed)} status atualizados.${result.ambiguous_unassigned ? ' ' + brNumber(result.ambiguous_unassigned) + ' anúncio(s) aguardam revisão de conta.' : ''} Nenhum SKU foi modificado.`);
      await Promise.all([openCatalogBatch(catalogBatch.id), refreshCatalogHistory()]);
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar os status dos anúncios.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleCatalogCommit() {
    if (!catalogBatch?.id || !catalogBatch.can_commit) return;
    setCatalogBusy(true);
    setError('');
    try {
      const result = await commitCommerceImport(catalogBatch.id);
      setMessage(`Lote #${catalogBatch.id} concluído com ${brNumber(result?.committed_rows || result?.batch?.committed_row_count || 0)} linha(s).`);
      await Promise.all([openCatalogBatch(catalogBatch.id), refreshCatalogHistory()]);
    } catch (err) {
      setError(err.message || 'Não foi possível confirmar a importação.');
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleSalesFile(event) {
    const file = event.target.files?.[0] || null;
    setSalesFile(file);
    setSalesParsed(null);
    setSalesProgress(null);
    setError('');
    setMessage('');
    if (!file) return;

    setSalesReading(true);
    try {
      setSalesParsed(await readCommerceSalesXlsx(file, salesPlatform, salesMonth));
    } catch (err) {
      setError(err.message || 'Não foi possível validar o relatório de vendas.');
    } finally {
      setSalesReading(false);
    }
  }

  async function handleSalesImport() {
    if (!salesParsed) return;
    setSalesImporting(true);
    setError('');
    setMessage('');
    try {
      const result = await stageCommerceSalesWorkbook(salesParsed, setSalesProgress);
      const outcome = result?.result || {};
      if (outcome.status === 'WAITING_PARTS') {
        const missing = Array.isArray(outcome.missing_parts) ? outcome.missing_parts.join(', ') : '';
        setMessage(`Parte recebida (${outcome.parts_received || '?'} de ${outcome.parts_expected || '?'}). Aguardando as demais partes${missing ? ': ' + missing : ''}. Nenhuma venda foi consolidada ainda.`);
      } else {
        setMessage(`Vendas importadas. Snapshot #${outcome.snapshot_id || '—'} atualizado.`);
        onSalesChanged?.();
      }
      setSalesFile(null);
      setSalesParsed(null);
      setSalesProgress(null);
      await refreshSalesHistory();
    } catch (err) {
      setError(err.message || 'Falha ao importar as vendas.');
    } finally {
      setSalesImporting(false);
    }
  }

  const catalogProgressText = useMemo(() => {
    if (!catalogProgress) return '';
    const labels = {
      create: 'Criando lote',
      upload: 'Enviando dados',
      finalize: 'Validando arquivo',
      reconcile: 'Comparando com o catálogo',
      failed: 'Comparação interrompida; lote salvo para retomada',
      done: 'Pronto para revisão'
    };
    return labels[catalogProgress.phase] || 'Processando';
  }, [catalogProgress]);

  const salesProgressText = useMemo(() => {
    if (!salesProgress) return '';
    const labels = {
      create: 'Criando lote',
      upload: 'Enviando vendas',
      summary: 'Consolidando períodos',
      commit: 'Atualizando painel',
      done: 'Concluído'
    };
    return labels[salesProgress.phase] || 'Processando';
  }, [salesProgress]);

  const history = mode === 'catalog' ? catalogHistory : salesHistory;
  const historyLoading = mode === 'catalog' ? catalogHistoryLoading : salesHistoryLoading;

  return (
    <div className="import-center">
      <div className="import-center-mode-grid">
        <button type="button" className={mode === 'catalog' ? 'active' : ''} onClick={() => setMode('catalog')}>
          <span className="import-center-mode-icon"><ModeIcon type="catalog" /></span>
          <strong>Importar catálogo</strong>
          <small>Produtos, SKUs, anúncios e vínculos</small>
        </button>
        <button type="button" className={mode === 'sales' ? 'active' : ''} onClick={() => setMode('sales')}>
          <span className="import-center-mode-icon"><ModeIcon type="sales" /></span>
          <strong>Importar vendas</strong>
          <small>Pedidos, unidades e faturamento</small>
        </button>
      </div>

      {error && <div className="import-center-alert error">{error}</div>}
      {message && <div className="import-center-alert success">{message}</div>}

      <div className="import-center-layout">
        <div className="import-center-flow">
          {mode === 'catalog' ? (
            <>
              <Step number="1" title="Escolha a plataforma" complete={Boolean(catalogPlatform)}>
                <select
                  className="import-center-select"
                  value={catalogPlatform}
                  disabled={catalogReading || catalogImporting}
                  onChange={event => {
                    setCatalogPlatform(event.target.value);
                    setCatalogAccount('');
                    setCatalogFile(null);
                    setCatalogParsed(null);
                    setCatalogBatch(null);
                    setCatalogRows([]);
                    setCatalogProgress(null);
                  }}
                >
                  {CATALOG_PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {catalogPlatform === 'MERCADO_LIVRE' && (
                  <div className="import-center-account-select">
                    <label htmlFor="ml-import-account">Conta do Mercado Livre</label>
                    <select id="ml-import-account" className="import-center-select" value={catalogAccount}
                      disabled={catalogReading || catalogImporting}
                      onChange={event => {
                        setCatalogAccount(event.target.value);
                        setCatalogFile(null);
                        setCatalogParsed(null);
                        setCatalogBatch(null);
                        setCatalogRows([]);
                        setCatalogProgress(null);
                      }}>
                      <option value="">Selecione a conta antes de enviar</option>
                      <option value="ANTIGO">Mercado Livre — Conta Antiga</option>
                      <option value="NOVO">Mercado Livre — Conta Nova</option>
                    </select>
                    <small>Os IDs e os status serão atualizados somente na conta selecionada.</small>
                  </div>
                )}
              </Step>

              <Step number="2" title="Selecione a planilha" complete={Boolean(catalogFile)}>
                <FileDrop
                  file={catalogFile}
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={catalogReading || catalogImporting || (catalogPlatform === 'MERCADO_LIVRE' && !catalogAccount)}
                  onChange={handleCatalogFile}
                  hint="Aceita planilhas .xlsx exportadas da plataforma"
                />
                {catalogReading && <div className="import-center-loading">Lendo e validando a planilha…</div>}
              </Step>

              <Step number="3" title="Conferência antes de enviar" complete={Boolean(catalogParsed)}>
                <CatalogPreview parsed={catalogParsed} />
              </Step>

              <Step
                number="4"
                title="Importação"
                subtitle="O arquivo será validado antes de alterar os dados."
              >
                <div className="import-center-action-line">
                  <button
                    type="button"
                    className="import-center-primary"
                    disabled={!catalogParsed || catalogReading || catalogImporting}
                    onClick={handleCatalogImport}
                  >
                    {catalogImporting ? 'Preparando…' : 'Preparar e comparar com o catálogo'}
                  </button>
                  <ProgressBlock progress={catalogProgress} text={catalogProgressText} />
                </div>
              </Step>

              <CatalogBatchReview
                batch={catalogBatch}
                rows={catalogRows}
                yearTargets={catalogYearTargets}
                busy={catalogBusy}
                page={catalogPage}
                onPageChange={nextPage => openCatalogBatch(catalogBatch.id, nextPage)}
                onDecision={handleCatalogDecision}
                onYearDecision={handleCatalogYearDecision}
                onApproveProbable={handleApproveProbable}
                onApproveNew={handleApproveNew}
                onCommit={handleCatalogCommit}
                onSyncStatuses={handleCatalogStatusSync}
                onRetryReconcile={handleCatalogRetryReconcile}
              />
            </>
          ) : (
            <>
              <Step number="1" title="Escolha a origem" complete={Boolean(salesPlatform)}>
                <div className="import-center-inline-fields">
                  <label>
                    <span>Plataforma</span>
                    <select
                      className="import-center-select"
                      value={salesPlatform}
                      disabled={salesReading || salesImporting}
                      onChange={event => {
                        setSalesPlatform(event.target.value);
                        setSalesFile(null);
                        setSalesParsed(null);
                        setSalesProgress(null);
                      }}
                    >
                      {SALES_PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Mês de referência, se necessário</span>
                    <input
                      className="import-center-input"
                      type="month"
                      value={salesMonth}
                      disabled={salesReading || salesImporting}
                      onChange={event => {
                        setSalesMonth(event.target.value);
                        setSalesParsed(null);
                        setSalesProgress(null);
                      }}
                    />
                  </label>
                </div>
              </Step>

              <Step number="2" title="Selecione o relatório" complete={Boolean(salesFile)}>
                <FileDrop
                  file={salesFile}
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={salesReading || salesImporting}
                  onChange={handleSalesFile}
                  hint="Aceita relatórios .xlsx exportados da plataforma"
                />
                {salesReading && <div className="import-center-loading">Lendo vendas e identificando colunas…</div>}
              </Step>

              <Step number="3" title="Conferência antes de enviar" complete={Boolean(salesParsed)}>
                <SalesPreview parsed={salesParsed} />
              </Step>

              <Step
                number="4"
                title="Importação"
                subtitle="Os períodos do arquivo serão consolidados antes de atualizar o painel."
              >
                <div className="import-center-action-line">
                  <button
                    type="button"
                    className="import-center-primary"
                    disabled={!salesParsed || salesReading || salesImporting}
                    onClick={handleSalesImport}
                  >
                    {salesImporting ? 'Importando…' : 'Importar vendas'}
                  </button>
                  <ProgressBlock progress={salesProgress} text={salesProgressText} />
                </div>
              </Step>
            </>
          )}
        </div>

        <aside className="import-center-sidebar">
          <ImportHistory
            mode={mode}
            items={history}
            loading={historyLoading}
            onOpen={item => openCatalogBatch(item.id, 1)}
            onRefresh={mode === 'catalog' ? refreshCatalogHistory : refreshSalesHistory}
          />
          <ImportSummary
            mode={mode}
            history={history}
            batch={mode === 'catalog' ? catalogBatch : null}
          />
        </aside>
      </div>
    </div>
  );
}
