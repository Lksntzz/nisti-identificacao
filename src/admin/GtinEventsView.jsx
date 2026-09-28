import React, { useState, useEffect } from 'react';

function formatProductDate(dateVal) {
  if (!dateVal) return { date: '—', time: '' };
  try {
    const d = new Date(dateVal);
    const date = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(d);
    const time = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
    return { date, time };
  } catch {
    return { date: '—', time: '' };
  }
}

function SidebarIcon({ name }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  switch (name) {
    case 'alert':
      return <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'history':
      return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    default:
      return null;
  }
}

export function GtinEventsView({ initialStatus = '', api, products = [], onLinkSuccess }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionBusyId, setActionBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  // Estado para Associação Rápida de EAN não cadastrado
  const [linkingEvent, setLinkingEvent] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkSuccessMsg, setLinkSuccessMsg] = useState('');

  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ limit: '250' });
      if (status) params.set('status', status);
      if (initialStatus === 'not_found') params.set('pending', '1');
      if (search.trim()) params.set('q', search.trim());
      const data = await api(`/api/admin/gtin-events?${params.toString()}`);
      setEvents(data.events || []);
    } catch (error) {
      setLoadError(error?.message || 'Não foi possível carregar o histórico de leituras.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const statusLabel = value => ({
    identified: 'Identificado',
    not_found: 'Não cadastrado',
    system_error: 'Erro técnico'
  }[value] || value);

  const changeDismissal = async (event, dismiss) => {
    setActionBusyId(event.id);
    setActionError('');
    try {
      await api(`/api/admin/gtin-events/${event.id}/${dismiss ? 'dismiss' : 'restore'}`, { method: 'POST' });
      await load();
      if (onLinkSuccess) onLinkSuccess();
    } catch (error) {
      setActionError(error?.message || 'Não foi possível atualizar esta leitura.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleAssociate = async (e) => {
    e.preventDefault();
    if (!linkingEvent || !selectedProductId) return;
    setLinkBusy(true);
    setLinkError('');
    setLinkSuccessMsg('');

    try {
      await api(`/api/admin/products/${selectedProductId}/gtins`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gtin: linkingEvent.gtin, source: 'NISTI' })
      });
      setLinkSuccessMsg(`EAN ${linkingEvent.gtin} vinculado ao produto com sucesso!`);
      setTimeout(() => {
        setLinkingEvent(null);
        setSelectedProductId('');
        setLinkSuccessMsg('');
        load();
        if (onLinkSuccess) onLinkSuccess();
      }, 1500);
    } catch (err) {
      setLinkError(err.message || 'Falha ao vincular código EAN.');
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon"><SidebarIcon name={initialStatus === 'not_found' ? 'alert' : 'history'} /></div>
          <div>
            <h3 className="table-main-title">{initialStatus === 'not_found' ? 'EAN não Cadastrados' : 'Histórico de Leituras EAN'}</h3>
            <span className="table-sub-title">Leituras registradas pelos aparelhos e operadores na bancada</span>
          </div>
        </div>
        <div className="table-actions-toolbar">
          {!initialStatus && (
            <select className="table-platform-select" value={status} onChange={event => setStatus(event.target.value)}>
              <option value="">Todos os resultados</option>
              <option value="identified">Identificados</option>
              <option value="not_found">Não cadastrados</option>
              <option value="system_error">Erros técnicos</option>
            </select>
          )}
          <input
            className="table-search-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && load()}
            placeholder="Buscar EAN, operador ou SKU"
          />
          <button type="button" className="btn-toolbar-filter" onClick={load}>Buscar</button>
        </div>
      </div>
      {actionError && <div className="form-error-banner" role="alert">{actionError}</div>}
      <div className="table-responsive-container">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>STATUS</th>
              <th>HORÁRIO</th>
              <th>OPERADOR</th>
              <th>EAN</th>
              <th>PRODUTO</th>
              <th>TEMPO</th>
              <th style={{ textAlign: 'right', width: '190px' }}>AÇÃO</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="table-empty-row">Carregando leituras…</td></tr> : loadError ? (
              <tr><td colSpan={7} className="table-empty-row"><span>{loadError}</span> <button type="button" className="btn-toolbar-filter" onClick={load}>Tentar novamente</button></td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={7} className="table-empty-row">Nenhuma leitura registrada neste filtro.</td></tr>
            ) : events.map(event => (
              <tr key={event.id}>
                <td><span className={`status-pill ${event.dismissed_at ? '' : event.status === 'identified' ? 'active' : event.status === 'not_found' ? 'orange' : 'danger'}`}>• {event.dismissed_at ? 'Descartado' : statusLabel(event.status)}</span></td>
                <td><div className="datetime-cell"><span>{formatProductDate(event.created_at).date}</span><small>{formatProductDate(event.created_at).time}</small></div></td>
                <td><strong>{event.operator_name || 'Não identificado'}</strong></td>
                <td><span className="ean-code-cell">{event.gtin}</span></td>
                <td><div className="product-info-cell"><strong>{event.nome || event.sku || 'Sem produto vinculado'}</strong><small>{event.sku || event.error_code || '—'}</small></div></td>
                <td>{event.response_ms ? `${event.response_ms} ms` : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {event.status === 'not_found' && (event.dismissed_at ? (
                    <button type="button" className="btn-toolbar-filter" disabled={actionBusyId === event.id} onClick={() => changeDismissal(event, false)}>Restaurar</button>
                  ) : <>
                    <button
                      type="button"
                      className="btn-toolbar-filter"
                      style={{ background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0', fontSize: '11.5px', fontWeight: 700 }}
                      onClick={() => {
                        setLinkingEvent(event);
                        setSelectedProductId('');
                        setLinkError('');
                        setLinkSuccessMsg('');
                      }}
                    >
                      + Associar
                    </button>
                    {' '}
                    <button type="button" className="btn-toolbar-filter" disabled={actionBusyId === event.id} onClick={() => changeDismissal(event, true)}>Descartar</button>
                  </>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de Associação Rápida de EAN */}
      {linkingEvent && (
        <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && setLinkingEvent(null)}>
          <div className="admin-modal" style={{ maxWidth: '520px' }}>
            <div className="admin-modal-head">
              <div>
                <h3>Vincular Código EAN ao Catálogo</h3>
                <small>EAN lido na bancada: <code>{linkingEvent.gtin}</code></small>
              </div>
              <button type="button" className="admin-modal-close" onClick={() => setLinkingEvent(null)}>✕</button>
            </div>

            <form onSubmit={handleAssociate} className="admin-modal-form">
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '14px', fontSize: '12.5px' }}>
                <p style={{ margin: '0 0 4px', color: '#475569' }}><strong>Operador:</strong> {linkingEvent.operator_name || 'Desconhecido'}</p>
                <p style={{ margin: 0, color: '#475569' }}><strong>Bipado em:</strong> {formatProductDate(linkingEvent.created_at).date} às {formatProductDate(linkingEvent.created_at).time}</p>
              </div>

              <div className="form-group">
                <label>Selecione o Produto para Vincular este EAN *</label>
                <select
                  required
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                  style={{ height: '42px', fontSize: '13px' }}
                >
                  <option value="">Selecione o produto pelo SKU / Capa…</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.nome || p.capa_code} ({p.platform || 'GERAL'})
                    </option>
                  ))}
                </select>
              </div>

              {linkError && <div className="form-error-banner">{linkError}</div>}
              {linkSuccessMsg && <div className="form-success-banner">{linkSuccessMsg}</div>}

              <div className="admin-modal-foot" style={{ marginTop: '16px' }}>
                <button type="button" className="btn-cancel" onClick={() => setLinkingEvent(null)} disabled={linkBusy}>Cancelar</button>
                <button type="submit" className="btn-submit-rainbow" disabled={linkBusy || !selectedProductId}>
                  {linkBusy ? 'Vinculando…' : 'Salvar e Ativar EAN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default GtinEventsView;
