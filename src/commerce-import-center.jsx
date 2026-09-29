import React, { useEffect, useMemo, useState } from 'react';
import {
  approveCommerceNewRows,
  approveCommerceProbableRows,
  commitCommerceImport,
  decideCommerceImportRow,
  getCommerceImport,
  getCommerceImportRows,
  listCommerceImports,
  listCommerceSalesImports,
  stageCommerceSalesWorkbook,
  stageCommerceWorkbook
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

function Step({ number, title, children, complete = false }) {
  return (
    <section className={`import-center-step ${complete ? 'complete' : ''}`}>
      <div className="import-center-step-index">{complete ? '✓' : number}</div>
      <div className="import-center-step-body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  );
}

function FileDrop({ file, accept, disabled, onChange, hint }) {
  return (
    <label className={`import-center-file ${disabled ? 'disabled' : ''}`}>
      <input type="file" accept={accept} disabled={disabled} onChange={onChange} />
      <span className="import-center-file-icon">↑</span>
      <strong>{file ? file.name : 'Selecionar arquivo'}</strong>
      <small>{file ? 'Clique para trocar o arquivo.' : hint}</small>
    </label>
  );
}

function CatalogPreview({ parsed }) {
  if (!parsed) return <div className="import-center-placeholder">Selecione uma planilha para validar antes de enviar.</div>;
  const s = parsed.summary || {};
  return (
    <div className="import-center-preview">
      <div>
        <span>Linhas reconhecidas</span>
        <strong>{brNumber(s.accepted_rows)}</strong>
      </div>
      <div>
        <span>Prontas</span>
        <strong>{brNumber(s.ready_rows)}</strong>
      </div>
      <div>
        <span>Revisar</span>
        <strong>{brNumber(s.review_rows)}</strong>
      </div>
      <div>
        <span>Inválidas</span>
        <strong>{brNumber(s.invalid_rows)}</strong>
      </div>
    </div>
  );
}

function SalesPreview({ parsed }) {
  if (!parsed) return <div className="import-center-placeholder">Selecione um relatório de vendas para conferir os totais.</div>;
  const s = parsed.summary || {};
  return (
    <div className="import-center-preview">
      <div>
        <span>Pedidos líquidos</span>
        <strong>{brNumber(s.net_orders)}</strong>
      </div>
      <div>
        <span>Unidades</span>
        <strong>{brNumber(s.units)}</strong>
      </div>
      <div>
        <span>Faturamento</span>
        <strong>{brCurrency(s.product_revenue)}</strong>
      </div>
      <div>
        <span>Períodos</span>
        <strong>{brNumber(s.period_count)}</strong>
      </div>
    </div>
  );
}

function ImportHistory({ mode, items, loading, onOpen }) {
  return (
    <section className="import-center-history">
      <div className="import-center-section-head">
        <div>
          <strong>Últimas importações</strong>
          <span>{mode === 'catalog' ? 'Catálogo' : 'Vendas'}</span>
        </div>
      </div>

      {loading ? <div className="import-center-placeholder">Carregando histórico…</div> : (
        <div className="import-center-history-list">
          {items.slice(0, 10).map(item => (
            <button
              type="button"
              key={item.id}
              className="import-center-history-row"
              onClick={() => onOpen?.(item)}
            >
              <div>
                <strong>#{item.id} · {mode === 'sales' ? platformLabel(item.platform_code, true) : item.marketplace_name}</strong>
                <span>{item.source_filename}</span>
              </div>
              <div>
                <StatusPill value={item.status} />
                <small>{brDate(item.created_at)}</small>
              </div>
            </button>
          ))}
          {!items.length && <div className="import-center-placeholder">Nenhuma importação registrada.</div>}
        </div>
      )}
    </section>
  );
}

function CatalogBatchReview({ batch, rows, busy, onDecision, onApproveProbable, onApproveNew, onCommit }) {
  if (!batch) return null;
  const unresolved = Number(batch.unresolved_count || 0);

  return (
    <section className="import-center-batch">
      <div className="import-center-section-head">
        <div>
          <strong>Lote #{batch.id}</strong>
          <span>{batch.marketplace_name} · {batch.source_filename}</span>
        </div>
        <StatusPill value={batch.status} />
      </div>

      <div className="import-center-preview compact">
        <div><span>Total</span><strong>{brNumber(batch.row_count)}</strong></div>
        <div><span>Vinculados</span><strong>{brNumber(batch.matched_count)}</strong></div>
        <div><span>Prováveis</span><strong>{brNumber(batch.probable_count)}</strong></div>
        <div><span>Pendentes</span><strong>{brNumber(unresolved)}</strong></div>
      </div>

      {unresolved > 0 && (
        <div className="import-center-review-list">
          {rows.slice(0, 20).map(row => {
            const payload = row.normalized_payload || {};
            const candidates = Array.isArray(row.candidates) ? row.candidates : [];
            return (
              <article key={row.id} className="import-center-review-row">
                <div className="import-center-review-copy">
                  <div><StatusPill value={row.status} /><small>{row.sheet_name} · linha {row.row_number}</small></div>
                  <strong>{payload.product_name || 'Produto sem nome'}</strong>
                  <code>{payload.sku_primary || payload.sku_secondary || 'Sem SKU'}</code>
                </div>
                <div className="import-center-review-actions">
                  {['PROBABLE', 'CONFLICT'].includes(row.status) && candidates.slice(0, 3).map(candidate => (
                    <button
                      type="button"
                      key={candidate.product_id}
                      disabled={busy}
                      onClick={() => onDecision(row.id, 'CONFIRM_PRODUCT', candidate.product_id)}
                    >
                      Vincular #{candidate.product_id}
                    </button>
                  ))}
                  {['NEW_PRODUCT', 'PROBABLE'].includes(row.status) && (
                    <button type="button" disabled={busy} onClick={() => onDecision(row.id, 'CREATE_NEW')}>Criar novo</button>
                  )}
                  {!['MATCHED', 'COMMITTED', 'IGNORED'].includes(row.status) && (
                    <button type="button" className="ghost danger" disabled={busy} onClick={() => onDecision(row.id, 'IGNORE')}>Ignorar</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="import-center-batch-actions">
        {Number(batch.approvable_probable_count || 0) > 0 && (
          <button type="button" className="secondary" disabled={busy} onClick={onApproveProbable}>
            Aprovar prováveis seguros ({brNumber(batch.approvable_probable_count)})
          </button>
        )}
        {Number(batch.unapproved_new_count || 0) > 0 && (
          <button type="button" className="secondary" disabled={busy} onClick={onApproveNew}>
            Aprovar novos ({brNumber(batch.unapproved_new_count)})
          </button>
        )}
        <button type="button" className="primary" disabled={busy || !batch.can_commit || batch.status === 'COMMITTED'} onClick={onCommit}>
          {batch.status === 'COMMITTED' ? 'Importação concluída' : 'Confirmar no catálogo'}
        </button>
      </div>
    </section>
  );
}

export default function CommerceImportCenter({ onSalesChanged }) {
  const [mode, setMode] = useState('catalog');

  const [catalogPlatform, setCatalogPlatform] = useState('SHOPEE');
  const [catalogFile, setCatalogFile] = useState(null);
  const [catalogParsed, setCatalogParsed] = useState(null);
  const [catalogReading, setCatalogReading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState(null);
  const [catalogHistory, setCatalogHistory] = useState([]);
  const [catalogHistoryLoading, setCatalogHistoryLoading] = useState(false);
  const [catalogBatch, setCatalogBatch] = useState(null);
  const [catalogRows, setCatalogRows] = useState([]);
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

  async function openCatalogBatch(batchId) {
    setCatalogBusy(true);
    setError('');
    try {
      const [batch, rowsResult] = await Promise.all([
        getCommerceImport(batchId),
        getCommerceImportRows(batchId, { limit: 50, offset: 0 })
      ]);
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
    setError('');
    setMessage('');
    if (!file) return;

    setCatalogReading(true);
    try {
      setCatalogParsed(await readCommerceXlsx(file, catalogPlatform));
    } catch (err) {
      setError(err.message || 'Não foi possível validar a planilha.');
    } finally {
      setCatalogReading(false);
    }
  }

  async function handleCatalogImport() {
    if (!catalogParsed) return;
    setCatalogImporting(true);
    setError('');
    setMessage('');
    try {
      const result = await stageCommerceWorkbook(catalogParsed, setCatalogProgress);
      setMessage(`Lote #${result.batchId} preparado. O catálogo só será alterado após a confirmação final.`);
      await Promise.all([refreshCatalogHistory(), openCatalogBatch(result.batchId)]);
    } catch (err) {
      setError(err.message || 'Falha ao preparar a importação do catálogo.');
    } finally {
      setCatalogImporting(false);
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
      setMessage(`Vendas importadas. Snapshot #${result?.result?.snapshot_id || '—'} atualizado.`);
      setSalesFile(null);
      setSalesParsed(null);
      setSalesProgress(null);
      await refreshSalesHistory();
      onSalesChanged?.();
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

  return (
    <div className="import-center">
      <section className="import-center-hero">
        <div>
          <span className="import-center-eyebrow">NOVA ÁREA</span>
          <h2>Central de Importações</h2>
          <p>Um fluxo separado para atualizar catálogo e vendas sem misturar com a tela antiga.</p>
        </div>
        <div className="import-center-hero-note">
          <strong>Validação antes de gravar</strong>
          <span>O arquivo é conferido primeiro. Catálogo exige confirmação final.</span>
        </div>
      </section>

      <div className="import-center-mode-grid">
        <button type="button" className={mode === 'catalog' ? 'active' : ''} onClick={() => setMode('catalog')}>
          <span className="import-center-mode-icon">▦</span>
          <strong>Importar catálogo</strong>
          <small>Produtos, SKUs, anúncios e vínculos.</small>
        </button>
        <button type="button" className={mode === 'sales' ? 'active' : ''} onClick={() => setMode('sales')}>
          <span className="import-center-mode-icon">↗</span>
          <strong>Importar vendas</strong>
          <small>Pedidos, unidades e faturamento.</small>
        </button>
      </div>

      {error && <div className="import-center-alert error">{error}</div>}
      {message && <div className="import-center-alert success">{message}</div>}

      {mode === 'catalog' ? (
        <div className="import-center-layout">
          <div className="import-center-flow">
            <Step number="1" title="Escolha a plataforma" complete={Boolean(catalogPlatform)}>
              <select
                className="import-center-select"
                value={catalogPlatform}
                disabled={catalogReading || catalogImporting}
                onChange={event => {
                  setCatalogPlatform(event.target.value);
                  setCatalogFile(null);
                  setCatalogParsed(null);
                  setCatalogBatch(null);
                }}
              >
                {CATALOG_PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Step>

            <Step number="2" title="Selecione a planilha" complete={Boolean(catalogFile)}>
              <FileDrop
                file={catalogFile}
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={catalogReading || catalogImporting}
                onChange={handleCatalogFile}
                hint="Arquivo .xlsx exportado da plataforma."
              />
              {catalogReading && <div className="import-center-loading">Lendo e validando a planilha…</div>}
            </Step>

            <Step number="3" title="Confira antes de enviar" complete={Boolean(catalogParsed)}>
              <CatalogPreview parsed={catalogParsed} />
            </Step>

            <Step number="4" title="Preparar a importação">
              <button
                type="button"
                className="import-center-primary"
                disabled={!catalogParsed || catalogReading || catalogImporting}
                onClick={handleCatalogImport}
              >
                {catalogImporting ? 'Preparando…' : 'Preparar e comparar com o catálogo'}
              </button>
              {catalogProgressText && <div className="import-center-progress">{catalogProgressText}</div>}
            </Step>

            <CatalogBatchReview
              batch={catalogBatch}
              rows={catalogRows}
              busy={catalogBusy}
              onDecision={handleCatalogDecision}
              onApproveProbable={handleApproveProbable}
              onApproveNew={handleApproveNew}
              onCommit={handleCatalogCommit}
            />
          </div>

          <ImportHistory
            mode="catalog"
            items={catalogHistory}
            loading={catalogHistoryLoading}
            onOpen={item => openCatalogBatch(item.id)}
          />
        </div>
      ) : (
        <div className="import-center-layout">
          <div className="import-center-flow">
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
                hint="Relatório .xlsx exportado da plataforma."
              />
              {salesReading && <div className="import-center-loading">Lendo vendas e identificando colunas…</div>}
            </Step>

            <Step number="3" title="Confira os números" complete={Boolean(salesParsed)}>
              <SalesPreview parsed={salesParsed} />
            </Step>

            <Step number="4" title="Atualizar o Painel de Vendas">
              <button
                type="button"
                className="import-center-primary"
                disabled={!salesParsed || salesReading || salesImporting}
                onClick={handleSalesImport}
              >
                {salesImporting ? 'Importando…' : 'Importar vendas'}
              </button>
              {salesProgressText && <div className="import-center-progress">{salesProgressText}</div>}
            </Step>
          </div>

          <ImportHistory
            mode="sales"
            items={salesHistory}
            loading={salesHistoryLoading}
            onOpen={() => {}}
          />
        </div>
      )}
    </div>
  );
}
