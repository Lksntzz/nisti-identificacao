import React, { useState, useEffect, useMemo } from 'react';

async function defaultApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
}

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
    case 'barcode':
      return <svg {...props}><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" /><path d="M8 5v14M15 5v14M19 5v14" strokeWidth="1" /></svg>;
    default:
      return null;
  }
}

export function GtinRegistryView({ api = defaultApi }) {
  const [data, setData] = useState({ gtins: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await (api || defaultApi)('/api/admin/gtins');
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.gtins || [];
    return (data.gtins || []).filter(item => [item.gtin, item.sku, item.nome, item.capa_code]
      .some(value => String(value || '').toLowerCase().includes(query)));
  }, [data.gtins, search]);

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon"><SidebarIcon name="barcode" /></div>
          <div>
            <h3 className="table-main-title">Códigos EAN do Catálogo</h3>
            <span className="table-sub-title">
              {data.stats?.active_gtins || 0} códigos ativos · {data.stats?.products_without_gtin || 0} produtos ainda sem EAN
            </span>
          </div>
        </div>
        <div className="table-actions-toolbar">
          <input className="table-search-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar EAN, SKU ou produto" />
          <button type="button" className="btn-toolbar-filter" onClick={load}>Atualizar</button>
        </div>
      </div>
      <div className="table-responsive-container">
        <table className="admin-data-table">
          <thead><tr><th>EAN</th><th>PRODUTO</th><th>SKU / CAPA</th><th>ORIGEM</th><th>STATUS</th><th>ATUALIZADO</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="6" className="table-empty-row">Carregando códigos EAN…</td></tr> : rows.length === 0 ? (
              <tr><td colSpan="6" className="table-empty-row">Nenhum código encontrado.</td></tr>
            ) : rows.map(item => (
              <tr key={item.id}>
                <td><span className="ean-code-cell">{item.gtin}</span></td>
                <td><div className="product-info-cell"><strong>{item.nome || item.sku}</strong><small>{item.variacao || 'Sem variação informada'}</small></div></td>
                <td><div className="ean-status-copy"><strong>{item.sku}</strong><small>Capa {item.capa_code || '—'}</small></div></td>
                <td>{item.source || '—'}</td>
                <td><span className={`status-pill ${item.active ? 'active' : 'danger'}`}>{item.active ? '• Ativo' : '• Inativo'}</span></td>
                <td>{formatProductDate(item.updated_at).date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default GtinRegistryView;
