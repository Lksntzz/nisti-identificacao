import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import {
  COMMERCE_MARKETPLACES,
  COMMERCE_PAGE_SIZE,
  CommerceEmptyState,
  CommerceLoadingBlock,
  CommerceStatusPill,
  commerceFormatNumber
} from './commerce-admin-shared.jsx';

export default function CommerceListingsView() {
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextOffset = offset) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(COMMERCE_PAGE_SIZE), offset: String(nextOffset) });
    if (search.trim()) params.set('search', search.trim());
    if (marketplace) params.set('marketplace', marketplace);
    if (status) params.set('status', status);
    try {
      const result = await commerceApi(`/api/admin/commerce/listings?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar anúncios.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, [marketplace, status]);

  const total = Number(data?.pagination?.total || 0);
  const page = Math.floor(offset / COMMERCE_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / COMMERCE_PAGE_SIZE));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Anúncios por plataforma</h2>
          <p>Um anúncio pode conter múltiplos produtos/variações; o vínculo é N:N e não usa a URL como identidade do produto.</p>
        </div>
        <div className="commerce-filter-row">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar título, SKU ou ID" />
            <button type="submit">Buscar</button>
          </form>
          <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
            {COMMERCE_MARKETPLACES.map(([code, label]) => <option key={code || 'all'} value={code}>{label}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            <option value="ACTIVE">Ativos</option>
            <option value="PAUSED">Pausados</option>
            <option value="INACTIVE">Inativos</option>
            <option value="UNKNOWN">Não verificados</option>
          </select>
        </div>
      </div>

      {error && <div className="commerce-error">{error}</div>}
      {loading ? <CommerceLoadingBlock label="Carregando anúncios…" /> : data.items?.length ? (
        <div className="commerce-table-wrap">
          <table className="commerce-table">
            <thead><tr><th>Plataforma</th><th>Anúncio</th><th>Produtos</th><th>Ano</th><th>Venda</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.map(listing => (
                <tr key={listing.id}>
                  <td><strong>{listing.marketplace_name || listing.marketplace_code}</strong><small>{listing.external_listing_id || 'Sem ID externo'}</small></td>
                  <td>
                    <strong>{listing.title || 'Título não capturado'}</strong>
                    {listing.canonical_url ? <a href={listing.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : null}
                  </td>
                  <td>{commerceFormatNumber(listing.product_count || 0)}<small>{listing.platform_skus || 'Sem SKU vinculado'}</small></td>
                  <td>{listing.observed_year || '—'}</td>
                  <td><CommerceStatusPill value={listing.sales_status} /></td>
                  <td><CommerceStatusPill value={listing.listing_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <CommerceEmptyState title="Nenhum anúncio cadastrado" detail="Os anúncios aparecerão aqui após a primeira importação e reconciliação." />}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - COMMERCE_PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + COMMERCE_PAGE_SIZE >= total || loading} onClick={() => load(offset + COMMERCE_PAGE_SIZE)}>Próxima</button>
        </div>
      </div>
    </section>
  );
}
