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
import './commerce-listing-state.css';

function coverageLabel(marketplaceCodes = []) {
  if (!Array.isArray(marketplaceCodes) || marketplaceCodes.length === 0) return 'Sem anúncio';
  if (marketplaceCodes.length > 1) return 'Multiplataforma';
  const code = marketplaceCodes[0];
  if (code === 'SHOPEE') return 'Exclusivo Shopee';
  if (code === 'MERCADO_LIVRE') return 'Exclusivo Mercado Livre';
  if (code === 'AMAZON') return 'Exclusivo Amazon';
  return `Exclusivo ${code}`;
}

function ProductStateEditor({ product, busy, onClose, onSave }) {
  const [internalStatus, setInternalStatus] = useState(product.internal_status || 'DRAFT');
  const marketplaceCodes = Array.isArray(product.marketplace_codes) ? product.marketplace_codes : [];

  return (
    <div className="commerce-listing-state-backdrop" onClick={onClose}>
      <aside className="commerce-listing-state-panel" onClick={event => event.stopPropagation()}>
        <div className="commerce-listing-state-head">
          <div>
            <span>Produto Mestre #{product.product_id}</span>
            <h3>{product.name}</h3>
            <small>{product.current_sku || 'SKU não informado'}</small>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>Fechar</button>
        </div>

        <div className="commerce-listing-state-context">
          <div><span>Categoria</span><strong>{product.category_name || '—'}</strong></div>
          <div><span>Cobertura</span><strong>{coverageLabel(marketplaceCodes)}</strong></div>
          <div><span>Anúncios</span><strong>{commerceFormatNumber(product.listing_count || 0)}</strong></div>
        </div>

        <div className="commerce-listing-state-form">
          <label>
            <span>Status do Produto Mestre</span>
            <select value={internalStatus} onChange={event => setInternalStatus(event.target.value)} disabled={busy}>
              <option value="DRAFT">Rascunho</option>
              <option value="ACTIVE">Ativo</option>
              <option value="DISCONTINUED">Descontinuado</option>
            </select>
            <small>
              Ative apenas produtos comercialmente válidos. Use Descontinuado quando o produto não deve mais operar, sem apagar seu histórico.
            </small>
          </label>
        </div>

        <div className="commerce-listing-state-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button
            type="button"
            onClick={() => onSave({ internalStatus })}
            disabled={busy || internalStatus === product.internal_status}
          >
            {busy ? 'Salvando…' : 'Salvar revisão'}
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function CommerceProductsView() {
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [saving, setSaving] = useState(false);

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

  async function saveProductState(values) {
    const productId = Number(selectedProduct?.product_id || 0);
    if (!productId) return;

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await commerceApi(`/api/admin/commerce/products/${productId}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ internal_status: values.internalStatus })
      });

      setMessage(`Produto Mestre #${productId} atualizado para ${commerceStatusLabel(updated.internal_status)}.`);
      setSelectedProduct(null);
      await load(0);
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar o Produto Mestre.');
    } finally {
      setSaving(false);
    }
  }

  const total = Number(data?.pagination?.total || 0);
  const page = Math.floor(offset / COMMERCE_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / COMMERCE_PAGE_SIZE));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Produtos Mestre</h2>
          <p>Identidade comercial canônica. Revise o status manualmente sem apagar histórico; a cobertura mostra se o produto é exclusivo de uma plataforma ou compartilhado entre marketplaces.</p>
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
      {message && <div className="commerce-listing-state-message">{message}</div>}
      {loading ? <CommerceLoadingBlock label="Carregando produtos…" /> : data.items?.length ? (
        <div className="commerce-table-wrap">
          <table className="commerce-table">
            <thead><tr><th>Produto</th><th>SKU atual</th><th>Categoria</th><th>Tipo</th><th>Cobertura</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.items.map(product => {
                const productId = Number(product.product_id || 0);
                const marketplaceCodes = Array.isArray(product.marketplace_codes) ? product.marketplace_codes : [];
                const listingCount = Number(product.listing_count || 0);
                return (
                  <tr key={productId}>
                    <td>
                      <div className="commerce-product-identity">
                        {product.thumbnail_url ? (
                          <img
                            className="commerce-product-thumbnail"
                            src={product.thumbnail_url}
                            alt={product.name || `Produto #${productId}`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : <div className="commerce-product-thumbnail commerce-image-placeholder">Sem foto</div>}
                        <div><strong>{product.name}</strong><small>#{productId}</small></div>
                      </div>
                    </td>
                    <td><code>{product.current_sku || '—'}</code></td>
                    <td>{product.category_name || '—'}{product.subcategory_name ? <small>{product.subcategory_name}</small> : null}</td>
                    <td>{commerceStatusLabel(product.temporal_type)}{product.edition_year ? <small>Edição {product.edition_year}</small> : null}</td>
                    <td>
                      <strong>{coverageLabel(marketplaceCodes)}</strong>
                      <small>{marketplaceCodes.length ? marketplaceCodes.join(' · ') : 'Nenhuma plataforma'}</small>
                      <small>{commerceFormatNumber(listingCount)} anúncio(s)</small>
                    </td>
                    <td><CommerceStatusPill value={product.internal_status} /></td>
                    <td><button type="button" className="commerce-secondary-button" onClick={() => setSelectedProduct(product)}>Revisar</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <CommerceEmptyState title="Nenhum produto comercial cadastrado" detail="Os produtos aparecerão aqui após a reconciliação das planilhas." />}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - COMMERCE_PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + COMMERCE_PAGE_SIZE >= total || loading} onClick={() => load(offset + COMMERCE_PAGE_SIZE)}>Próxima</button>
        </div>
      </div>

      {selectedProduct && (
        <ProductStateEditor
          product={selectedProduct}
          busy={saving}
          onClose={() => !saving && setSelectedProduct(null)}
          onSave={saveProductState}
        />
      )}
    </section>
  );
}
