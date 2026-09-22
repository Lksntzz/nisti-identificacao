import React, { useEffect, useMemo, useState } from 'react';
import {
  approveCommerceNewRows,
  commitCommerceImport,
  decideCommerceImportRow,
  getCommerceImport,
  getCommerceImportRows,
  listCommerceImports,
  stageCommerceWorkbook
} from './commerce-import-client.js';
import { readCommerceXlsx } from './commerce-xlsx-reader.js';
import './commerce-import.css';

const REVIEW_PAGE_SIZE = 50;

const IMPORT_STATUS_LABELS = Object.freeze({
  UPLOADED: 'Enviado',
  PARSED: 'Processado',
  REVIEW: 'Revisão necessária',
  COMMITTED: 'Concluído',
  FAILED: 'Falhou',
  PENDING: 'Pendente',
  MATCHED: 'Correspondência exata',
  PROBABLE: 'Correspondência provável',
  NEW_PRODUCT: 'Produto novo',
  CONFLICT: 'Conflito',
  INVALID: 'Inválido',
  IGNORED: 'Ignorado'
});

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(2)} MB`;
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
    return '—';
  }
}

function label(value) {
  return IMPORT_STATUS_LABELS[value] || value || '—';
}

function isProductOnlyNotListed(payload) {
  if (!payload || payload.listing_url) return false;
  return payload.listing_presence_hint === 'NOT_LISTED' || payload.update_hint === 'NOT_LISTED';
}

function ImportStatus({ value }) {
  const normalized = String(value || '').toUpperCase();
  const tone = ['MATCHED', 'COMMITTED', 'PARSED'].includes(normalized)
    ? 'ok'
    : ['PROBABLE', 'NEW_PRODUCT', 'REVIEW', 'PENDING'].includes(normalized)
      ? 'warn'
      : ['CONFLICT', 'INVALID', 'FAILED'].includes(normalized)
        ? 'danger'
        : 'muted';
  return <span className={`commerce-import-status ${tone}`}>{label(normalized)}</span>;
}

function Progress({ progress }) {
  if (!progress) return null;
  const phaseLabels = {
    create: 'Criando lote de importação',
    upload: `Enviando dados${progress.chunks ? ` · lote ${progress.chunk}/${progress.chunks}` : ''}`,
    finalize: 'Validando staging',
    reconcile: 'Reconciliando com o catálogo',
    done: 'Importação pronta para revisão'
  };
  const percent = progress.total > 0 ? Math.round((Number(progress.completed || 0) / progress.total) * 100) : 0;
  return (
    <div className="commerce-import-progress">
      <div><strong>{phaseLabels[progress.phase] || 'Processando'}</strong><span>{percent}%</span></div>
      <div className="commerce-import-progress-track"><span style={{ width: `${Math.max(4, Math.min(100, percent))}%` }} /></div>
    </div>
  );
}

function ParseSummary({ parsed }) {
  if (!parsed) return null;
  return (
    <div className="commerce-import-preview">
      <div className="commerce-import-preview-head">
        <div>
          <strong>{parsed.filename}</strong>
          <span>{formatBytes(parsed.size_bytes)} · SHA-256 {parsed.sha256.slice(0, 12)}…</span>
        </div>
        <div className="commerce-import-preview-counts">
          <span><strong>{formatNumber(parsed.summary.accepted_rows)}</strong> linhas</span>
          <span><strong>{formatNumber(parsed.summary.review_rows)}</strong> revisar</span>
          <span><strong>{formatNumber(parsed.summary.invalid_rows)}</strong> inválidas</span>
        </div>
      </div>
      <div className="commerce-table-wrap">
        <table className="commerce-table commerce-import-sheet-table">
          <thead><tr><th>Aba</th><th>Linhas físicas</th><th>Produtos lidos</th><th>Revisar</th><th>Inválidas</th></tr></thead>
          <tbody>
            {parsed.sheets.map(sheet => (
              <tr key={sheet.name}>
                <td><strong>{sheet.name}</strong></td>
                <td>{formatNumber(sheet.physical_rows)}</td>
                <td>{formatNumber(sheet.accepted_rows)}</td>
                <td>{formatNumber(sheet.review_rows)}</td>
                <td>{formatNumber(sheet.invalid_rows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchStats({ batch }) {
  if (!batch) return null;
  return (
    <div className="commerce-import-batch-stats">
      <div><span>Total</span><strong>{formatNumber(batch.row_count)}</strong></div>
      <div><span>Exatos</span><strong>{formatNumber(batch.matched_count)}</strong></div>
      <div><span>Prováveis</span><strong>{formatNumber(batch.probable_count)}</strong></div>
      <div><span>Novos</span><strong>{formatNumber(batch.new_product_count)}</strong></div>
      <div><span>Não resolvidos</span><strong>{formatNumber(batch.unresolved_count)}</strong></div>
    </div>
  );
}

function RowActions({ row, busy, onDecision }) {
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const payload = row.normalized_payload || {};
  const hasListingUrl = Boolean(payload.listing_url);
  const productOnlyNotListed = isProductOnlyNotListed(payload);
  const canResolveProduct = hasListingUrl || productOnlyNotListed;

  if (row.status === 'MATCHED' || row.status === 'COMMITTED' || row.status === 'IGNORED') return null;

  return (
    <div className="commerce-import-row-actions">
      {['PROBABLE', 'CONFLICT'].includes(row.status) && canResolveProduct && candidates.map(candidate => (
        <button
          type="button"
          key={candidate.product_id}
          disabled={busy}
          onClick={() => onDecision(row.id, 'CONFIRM_PRODUCT', candidate.product_id)}
        >
          Vincular #{candidate.product_id} · {candidate.product_name}
        </button>
      ))}
      {row.status === 'NEW_PRODUCT' && ['NO_MATCH', 'NO_MATCH_NOT_LISTED'].includes(row.match_method) && canResolveProduct && (
        <button type="button" disabled={busy} onClick={() => onDecision(row.id, 'CREATE_NEW')}>Aprovar como produto novo</button>
      )}
      {row.status === 'PROBABLE' && canResolveProduct && (
        <button type="button" className="secondary" disabled={busy} onClick={() => onDecision(row.id, 'CREATE_NEW')}>Não é o mesmo · criar novo</button>
      )}
      <button type="button" className="secondary danger" disabled={busy} onClick={() => onDecision(row.id, 'IGNORE')}>Ignorar linha</button>
    </div>
  );
}

function ReviewTable({ rows, busyRowId, onDecision }) {
  if (!rows.length) {
    return <div className="commerce-import-empty"><strong>Nenhuma linha neste filtro.</strong><span>Selecione outro estado ou abra outro lote.</span></div>;
  }
  return (
    <div className="commerce-import-review-list">
      {rows.map(row => {
        const payload = row.normalized_payload || {};
        const candidates = Array.isArray(row.candidates) ? row.candidates : [];
        const productOnlyNotListed = isProductOnlyNotListed(payload);
        return (
          <article key={row.id} className={`commerce-import-review-row status-${String(row.status || '').toLowerCase()}`}>
            <div className="commerce-import-review-main">
              <div className="commerce-import-row-meta">
                <ImportStatus value={row.status} />
                <span>{row.sheet_name} · linha {row.row_number}</span>
                {row.match_score != null ? <span>{Math.round(Number(row.match_score) * 100)}% confiança</span> : null}
              </div>
              <h4>{payload.product_name || 'Produto sem nome'}</h4>
              <div className="commerce-import-row-data">
                <span><small>SKU base</small><code>{payload.sku_primary || '—'}</code></span>
                <span><small>SKU 2</small><code>{payload.sku_secondary || '—'}</code></span>
                <span><small>Categoria</small><strong>{payload.category || '—'}</strong></span>
                <span><small>Ano</small><strong>{payload.observed_year || '—'}</strong></span>
              </div>
              {payload.listing_url
                ? <a href={payload.listing_url} target="_blank" rel="noreferrer">Abrir anúncio da planilha</a>
                : productOnlyNotListed
                  ? <span className="commerce-import-row-warning">Produto sem anúncio nesta plataforma</span>
                  : <span className="commerce-import-row-warning">Sem URL válida do anúncio</span>}
              {row.error_code ? <div className="commerce-import-row-warning">Conflito: {row.error_code}</div> : null}
              {row.notes ? <div className="commerce-import-row-warning">Aviso de origem: {row.notes}</div> : null}
            </div>

            <div className="commerce-import-candidates">
              {candidates.length ? (
                <>
                  <span>Candidatos encontrados</span>
                  {candidates.slice(0, 4).map(candidate => (
                    <div key={candidate.product_id}>
                      <strong>#{candidate.product_id} · {candidate.product_name}</strong>
                      <small>{candidate.current_sku || 'Sem SKU atual'} · {Math.round(Number(candidate.score || 0) * 100)}% · {candidate.method}</small>
                    </div>
                  ))}
                </>
              ) : <span>Sem candidato de produto existente.</span>}
            </div>

            <RowActions row={row} busy={busyRowId === row.id} onDecision={onDecision} />
          </article>
        );
      })}
    </div>
  );
}

export default function CommerceImportView({ onCatalogChanged }) {
  const [marketplace, setMarketplace] = useState('SHOPEE');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [reading, setReading] = useState(false);
  const [staging, setStaging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [imports, setImports] = useState([]);
  const [importsLoading, setImportsLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [reviewRows, setReviewRows] = useState([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewStatus, setReviewStatus] = useState('');
  const [reviewOffset, setReviewOffset] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [busyRowId, setBusyRowId] = useState(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const canStage = parsed && !reading && !staging;
  const reviewPage = Math.floor(reviewOffset / REVIEW_PAGE_SIZE) + 1;
  const reviewPages = Math.max(1, Math.ceil(reviewTotal / REVIEW_PAGE_SIZE));

  const unresolvedLabel = useMemo(() => {
    if (!batch) return '';
    const unresolved = Number(batch.unresolved_count || 0);
    if (!unresolved) return 'Lote pronto para commit.';
    return `${formatNumber(unresolved)} linha(s) ainda precisam de decisão.`;
  }, [batch]);

  async function refreshImports() {
    setImportsLoading(true);
    try {
      const result = await listCommerceImports({ limit: 50, offset: 0 });
      setImports(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      setError(err.message || 'Não foi possível listar importações.');
    } finally {
      setImportsLoading(false);
    }
  }

  async function loadBatch(batchId, { status = reviewStatus, offset = 0 } = {}) {
    setReviewLoading(true);
    setError('');
    try {
      const [batchData, rowsData] = await Promise.all([
        getCommerceImport(batchId),
        getCommerceImportRows(batchId, { status, limit: REVIEW_PAGE_SIZE, offset })
      ]);
      setSelectedBatchId(Number(batchId));
      setBatch(batchData);
      setReviewRows(Array.isArray(rowsData?.items) ? rowsData.items : []);
      setReviewTotal(Number(rowsData?.pagination?.total || 0));
      setReviewOffset(offset);
    } catch (err) {
      setError(err.message || 'Não foi possível abrir a revisão.');
    } finally {
      setReviewLoading(false);
    }
  }

  useEffect(() => { refreshImports(); }, []);

  useEffect(() => {
    if (selectedBatchId) loadBatch(selectedBatchId, { status: reviewStatus, offset: 0 });
  }, [reviewStatus]);

  async function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setParsed(null);
    setError('');
    setMessage('');
    setProgress(null);
    if (!nextFile) return;

    setReading(true);
    try {
      setParsed(await readCommerceXlsx(nextFile, marketplace));
    } catch (err) {
      setError(err.message || 'Não foi possível ler o arquivo Excel.');
    } finally {
      setReading(false);
    }
  }

  async function handleMarketplaceChange(event) {
    const value = event.target.value;
    setMarketplace(value);
    setParsed(null);
    setFile(null);
    setError('');
    setMessage('');
    setProgress(null);
  }

  async function handleStage() {
    if (!parsed) return;
    setStaging(true);
    setError('');
    setMessage('');
    try {
      const result = await stageCommerceWorkbook(parsed, setProgress);
      setMessage(`Lote #${result.batchId} criado e reconciliado. Revise os conflitos antes do commit.`);
      await refreshImports();
      setReviewStatus('');
      await loadBatch(result.batchId, { status: '', offset: 0 });
    } catch (err) {
      setError(`${err.message || 'Falha na importação.'} O catálogo definitivo não foi alterado.`);
      if (progress?.batchId) await refreshImports();
    } finally {
      setStaging(false);
    }
  }

  async function handleDecision(rowId, action, productId = null) {
    if (!selectedBatchId) return;
    setBusyRowId(rowId);
    setError('');
    try {
      await decideCommerceImportRow(rowId, action, productId);
      await Promise.all([
        loadBatch(selectedBatchId, { status: reviewStatus, offset: reviewOffset }),
        refreshImports()
      ]);
    } catch (err) {
      setError(err.message || 'Não foi possível registrar a decisão.');
    } finally {
      setBusyRowId(null);
    }
  }

  async function handleApproveNew() {
    if (!selectedBatchId) return;
    setBatchBusy(true);
    setError('');
    try {
      const result = await approveCommerceNewRows(selectedBatchId);
      setMessage(`${formatNumber(result?.approved_new_rows || 0)} produto(s) novo(s) aprovados.`);
      await Promise.all([
        loadBatch(selectedBatchId, { status: reviewStatus, offset: 0 }),
        refreshImports()
      ]);
    } catch (err) {
      setError(err.message || 'Não foi possível aprovar os novos produtos.');
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleCommit() {
    if (!selectedBatchId || !batch?.can_commit) return;
    if (!window.confirm(`Confirmar o commit do lote #${selectedBatchId}? Esta ação grava os dados aprovados no Catálogo Comercial.`)) return;
    setBatchBusy(true);
    setError('');
    try {
      const result = await commitCommerceImport(selectedBatchId);
      setMessage(`Lote #${selectedBatchId} concluído: ${formatNumber(result?.committed_rows || 0)} linhas gravadas.`);
      await Promise.all([
        loadBatch(selectedBatchId, { status: '', offset: 0 }),
        refreshImports()
      ]);
      onCatalogChanged?.();
    } catch (err) {
      setError(`${err.message || 'Falha no commit.'} Nenhum commit parcial deve ser aceito.`);
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div className="commerce-import-page">
      {error && <div className="commerce-error">{error}</div>}
      {message && <div className="commerce-import-message">{message}</div>}

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Nova importação Excel</h2>
            <p>O arquivo é lido no navegador. Apenas dados normalizados são enviados ao staging do Supabase; nada entra no catálogo definitivo antes da reconciliação.</p>
          </div>
        </div>
        <div className="commerce-import-uploader">
          <label>
            <span>Plataforma</span>
            <select value={marketplace} onChange={handleMarketplaceChange} disabled={reading || staging}>
              <option value="SHOPEE">Shopee</option>
              <option value="MERCADO_LIVRE">Mercado Livre</option>
            </select>
          </label>
          <label className="commerce-import-file">
            <span>Planilha .xlsx</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileChange} disabled={reading || staging} />
            <small>{file ? file.name : 'Selecione uma cópia da planilha da plataforma.'}</small>
          </label>
          <button type="button" className="commerce-import-primary" disabled={!canStage} onClick={handleStage}>
            {staging ? 'Processando…' : 'Criar lote e reconciliar'}
          </button>
        </div>
        {reading ? <div className="commerce-import-reading">Lendo e normalizando o Excel…</div> : null}
        <Progress progress={progress} />
        <ParseSummary parsed={parsed} />
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Histórico de importações</h2>
            <p>Lotes permanecem auditáveis mesmo quando exigem revisão. Um lote em staging não altera produtos/anúncios definitivos.</p>
          </div>
          <button type="button" className="commerce-secondary-button" onClick={refreshImports} disabled={importsLoading}>Atualizar</button>
        </div>
        {importsLoading ? <div className="commerce-import-reading">Carregando lotes…</div> : imports.length ? (
          <div className="commerce-table-wrap">
            <table className="commerce-table commerce-import-batches-table">
              <thead><tr><th>Lote</th><th>Plataforma</th><th>Arquivo</th><th>Linhas</th><th>Conflitos</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {imports.map(item => (
                  <tr key={item.id} className={selectedBatchId === item.id ? 'selected' : ''}>
                    <td><strong>#{item.id}</strong><small>{formatDate(item.created_at)}</small></td>
                    <td>{item.marketplace_name}</td>
                    <td><strong>{item.source_filename}</strong><small>{item.created_by || 'Administrador'}</small></td>
                    <td>{formatNumber(item.row_count)}</td>
                    <td>{formatNumber(item.conflict_count + item.invalid_count)}</td>
                    <td><ImportStatus value={item.status} /></td>
                    <td><button type="button" className="commerce-secondary-button" onClick={() => loadBatch(item.id, { status: '', offset: 0 })}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="commerce-import-empty"><strong>Nenhuma importação registrada.</strong><span>O primeiro lote aparecerá após enviar uma planilha.</span></div>}
      </section>

      {batch && (
        <section className="commerce-panel commerce-import-review-panel">
          <div className="commerce-panel-header commerce-panel-header-stack">
            <div>
              <h2>Revisão do lote #{batch.id}</h2>
              <p>{batch.marketplace_name} · {batch.source_filename} · criado em {formatDate(batch.created_at)}</p>
            </div>
            <BatchStats batch={batch} />
            <div className="commerce-import-review-toolbar">
              <select value={reviewStatus} onChange={event => setReviewStatus(event.target.value)} disabled={reviewLoading}>
                <option value="">Todas as linhas</option>
                <option value="PROBABLE">Prováveis</option>
                <option value="CONFLICT">Conflitos</option>
                <option value="INVALID">Inválidas</option>
                <option value="NEW_PRODUCT">Produtos novos</option>
                <option value="MATCHED">Correspondências exatas</option>
                <option value="IGNORED">Ignoradas</option>
                <option value="COMMITTED">Concluídas</option>
              </select>
              {Number(batch.unapproved_new_count || 0) > 0 && (
                <button type="button" className="commerce-secondary-button" disabled={batchBusy} onClick={handleApproveNew}>
                  Aprovar {formatNumber(batch.unapproved_new_count)} novo(s)
                </button>
              )}
              <button type="button" className="commerce-import-primary" disabled={!batch.can_commit || batchBusy || batch.status === 'COMMITTED'} onClick={handleCommit}>
                {batch.status === 'COMMITTED' ? 'Lote concluído' : 'Commitar catálogo'}
              </button>
            </div>
            <div className={`commerce-import-readiness ${batch.can_commit ? 'ready' : ''}`}>
              <strong>{unresolvedLabel}</strong>
              <span>{batch.can_commit ? 'Todas as decisões obrigatórias foram resolvidas.' : 'O banco bloqueará o commit enquanto houver pendências.'}</span>
            </div>
          </div>

          {reviewLoading ? <div className="commerce-import-reading">Carregando linhas…</div> : (
            <ReviewTable rows={reviewRows} busyRowId={busyRowId} onDecision={handleDecision} />
          )}

          <div className="commerce-pagination">
            <span>Página {reviewPage} de {reviewPages} · {formatNumber(reviewTotal)} linhas</span>
            <div>
              <button type="button" disabled={reviewOffset <= 0 || reviewLoading} onClick={() => loadBatch(batch.id, { status: reviewStatus, offset: Math.max(0, reviewOffset - REVIEW_PAGE_SIZE) })}>Anterior</button>
              <button type="button" disabled={reviewOffset + REVIEW_PAGE_SIZE >= reviewTotal || reviewLoading} onClick={() => loadBatch(batch.id, { status: reviewStatus, offset: reviewOffset + REVIEW_PAGE_SIZE })}>Próxima</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
