import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import {
  COMMERCE_MARKETPLACES,
  COMMERCE_PAGE_SIZE,
  CommerceEmptyState,
  CommerceLoadingBlock,
  CommerceStatusPill,
  commerceFormatNumber,
  commerceStatusLabel
} from './commerce-admin-shared.jsx';

export default function CommerceProductsView() {
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
      const result = await commerceApi(`/api/admin/commerce/products?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar produtos.');
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
          <h2>Produtos Mestre</h2>
          <p>Identidade comercial canônica. SKU histórico e presença em marketplaces são relacionados sem duplicar o produto.</p>
        </div>
        <div className="commerce-filter-row">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome ou SKU" />
            <button type="submit">Buscar</button>
          </form>
          <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
            {COMMERCE_MARKETPLACES.map(([code, label]) => <option key={code || 'all'} value={code}>{label}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            <option value="ACTIVE">Ativos</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="DISCONTINUED">Descontinuados</option>
          </select>
        </div>
      </div>

      {error && <div className="commerce-error">{error}</div>}
      {loading ? <CommerceLoadingBlock label="Carregando produtos…" /> : data.items?.length ? (
        <div className="commerce-table-wrap">
          <table className="commerce-table">
            <thead><tr><th>Produto</th><th>SKU atual</th><th>Categoria</th><th>Tipo</th><th>Plataformas</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.map(product => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>#{product.id}</small></td>
                  <td><code>{product.current_sku || '—'}</code></td>
                  <td>{product.category_name || '—'}{product.subcategory_name ? <small>{product.subcategory_name}</small> : null}</td>
                  <td>{commerceStatusLabel(product.temporal_type)}{product.edition_year ? <small>Edição {product.edition_year}</small> : null}</td>
                  <td>{commerceFormatNumber(product.marketplace_count || 0)}<small>{product.marketplaces || 'Sem anúncio'}</small></td>
                  <td><CommerceStatusPill value={product.internal_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <CommerceEmptyState title="Nenhum produto comercial cadastrado" detail="Os primeiros produtos entrarão após a reconciliação das planilhas Shopee e Mercado Livre." />}

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
