import React, { useEffect, useState } from 'react';
import { listCommerceSalesImports, stageCommerceSalesWorkbook } from './commerce-import-client.js';
import { readCommerceSalesXlsx } from './commerce-sales-import-reader.js';

function brNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function brCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
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

const PLATFORM_LABELS = {
  SHOPEE: 'Shopee',
  ML_NOVO: 'Mercado Livre Novo',
  ML_ANTIGO: 'Mercado Livre Antigo'
};

function SalesPreview({ parsed }) {
  if (!parsed) return null;
  const s = parsed.summary || {};
  return (
    <div className="commerce-import-preview sales-import-preview">
      <div className="commerce-import-preview-head">
        <div>
          <strong>{parsed.filename}</strong>
          <span>{PLATFORM_LABELS[parsed.platform_code] || parsed.platform_code} · dados até {parsed.data_through ? new Date(parsed.data_through + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</span>
        </div>
        <div className="commerce-import-preview-counts">
          <span><strong>{brNumber(s.net_orders)}</strong> pedidos</span>
          <span><strong>{brNumber(s.units)}</strong> unidades</span>
          <span><strong>{brCurrency(s.product_revenue)}</strong> faturamento</span>
        </div>
      </div>
      <div className="sales-import-periods">
        {(parsed.summaries || []).map(item => (
          <div key={item.period_key}>
            <strong>{item.period_key}</strong>
            <span>{brNumber(item.net_orders)} pedidos · {brNumber(item.units)} un. · {brCurrency(item.product_revenue)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommerceSalesImportPanel({ onSalesChanged }) {
  const [platform, setPlatform] = useState('SHOPEE');
  const [fallbackPeriod, setFallbackPeriod] = useState('');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const result = await listCommerceSalesImports({ limit: 30, offset: 0 });
      setHistory(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o histórico de vendas.');
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { refreshHistory(); }, []);

  async function handleFile(event) {
    const next = event.target.files?.[0] || null;
    setFile(next);
    setParsed(null);
    setError('');
    setMessage('');
    if (!next) return;

    setReading(true);
    try {
      setParsed(await readCommerceSalesXlsx(next, platform, fallbackPeriod));
    } catch (err) {
      setError(err.message || 'Não foi possível interpretar o arquivo de vendas.');
    } finally {
      setReading(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setError('');
    setMessage('');
    try {
      const result = await stageCommerceSalesWorkbook(parsed, setProgress);
      const commitResult = result?.result || {};
      const replacedMonths = Array.isArray(commitResult?.replaced_months)
        ? commitResult.replaced_months
        : [];
      if (commitResult.status === 'WAITING_PARTS') {
        const missing = Array.isArray(commitResult.missing_parts) ? commitResult.missing_parts.join(', ') : '';
        setMessage(
          `Parte recebida com sucesso. ${brNumber(commitResult.parts_received || 0)}/${brNumber(commitResult.parts_expected || 0)} parte(s) recebida(s).${missing ? ` Falta(m): ${missing}.` : ''} O mês só será atualizado quando todas as partes forem importadas.`
        );
      } else {
        const mergedParts = Number(commitResult?.merged_parts || 1);
        setMessage(
          `Vendas consolidadas com sucesso. Snapshot #${commitResult?.snapshot_id || '—'} · ${brNumber(commitResult?.rows || 0)} linhas na base atual.${mergedParts > 1 ? ` ${mergedParts} partes foram unidas automaticamente.` : ''}${replacedMonths.length ? ` Mês(es) atualizado(s): ${replacedMonths.join(', ')}.` : ''}`
        );
      }
      setFile(null);
      setParsed(null);
      setProgress(null);
      await refreshHistory();
      if (result?.result?.status !== 'WAITING_PARTS') onSalesChanged?.();
    } catch (err) {
      setError(err.message || 'Falha ao importar vendas.');
    } finally {
      setImporting(false);
    }
  }

  function changePlatform(event) {
    setPlatform(event.target.value);
    setFile(null);
    setParsed(null);
    setError('');
    setMessage('');
  }

  const phaseLabel = {
    create: 'Criando lote',
    upload: 'Enviando vendas',
    summary: 'Gravando resumo mensal',
    commit: 'Atualizando Painel de Vendas',
    done: 'Concluído'
  }[progress?.phase] || '';

  return (
    <div className="commerce-import-page">
      {error && <div className="commerce-error">{error}</div>}
      {message && <div className="commerce-import-message">{message}</div>}

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Importar arquivo de vendas</h2>
            <p>Ao importar um mês completo, ele substitui automaticamente qualquer versão parcial do mesmo mês e plataforma. Se a plataforma dividir o relatório em várias partes, o sistema aguarda todas e consolida o mês automaticamente. Outros meses e outras plataformas são preservados.</p>
          </div>
        </div>

        <div className="commerce-import-uploader sales-import-uploader">
          <label>
            <span>Plataforma</span>
            <select value={platform} onChange={changePlatform} disabled={reading || importing}>
              <option value="SHOPEE">Shopee</option>
              <option value="ML_NOVO">Mercado Livre Novo</option>
              <option value="ML_ANTIGO">Mercado Livre Antigo</option>
            </select>
          </label>

          <label>
            <span>Mês de referência (se o arquivo não tiver data)</span>
            <input
              type="month"
              value={fallbackPeriod}
              onChange={event => {
                setFallbackPeriod(event.target.value);
                setParsed(null);
              }}
              disabled={reading || importing}
            />
          </label>

          <label className="commerce-import-file">
            <span>Planilha .xlsx</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile}
              disabled={reading || importing}
            />
            <small>{file ? file.name : 'Selecione o relatório exportado da plataforma. Se vier em parte 1/2, parte 2/2 etc., importe todas as partes; o sistema junta automaticamente.'}</small>
          </label>

          <button
            type="button"
            className="commerce-import-primary"
            disabled={!parsed || reading || importing}
            onClick={handleImport}
          >
            {importing ? 'Importando…' : 'Importar vendas'}
          </button>
        </div>

        {reading && <div className="commerce-import-reading">Lendo vendas e identificando as colunas…</div>}
        {progress && phaseLabel && (
          <div className="commerce-import-reading">
            {phaseLabel}{progress.chunk ? ` · lote ${progress.chunk}/${progress.chunks}` : ''}
          </div>
        )}
        <SalesPreview parsed={parsed} />
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Histórico de arquivos de vendas</h2>
            <p>Cada importação gera um snapshot auditável e preserva os períodos não substituídos.</p>
          </div>
          <button type="button" className="commerce-secondary-button" onClick={refreshHistory} disabled={historyLoading}>Atualizar</button>
        </div>

        {historyLoading ? <div className="commerce-import-reading">Carregando importações…</div> : (
          <div className="commerce-table-wrap">
            <table className="commerce-table commerce-import-batches-table">
              <thead>
                <tr><th>Lote</th><th>Plataforma</th><th>Arquivo</th><th>Até</th><th>Linhas</th><th>Status</th><th>Data</th></tr>
              </thead>
              <tbody>
                {history.map(item => (
                  <tr key={item.id}>
                    <td><strong>#{item.id}</strong></td>
                    <td>{PLATFORM_LABELS[item.platform_code] || item.platform_code}</td>
                    <td>{item.source_filename}</td>
                    <td>{item.data_through ? new Date(item.data_through + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                    <td>{brNumber(item.staged_row_count)}</td>
                    <td><span className={`commerce-import-status ${item.status === 'COMMITTED' ? 'ok' : item.status === 'FAILED' ? 'danger' : 'warn'}`}>{item.status}</span></td>
                    <td>{formatDate(item.created_at)}</td>
                  </tr>
                ))}
                {!history.length && <tr><td colSpan="7">Nenhum arquivo de vendas importado ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
