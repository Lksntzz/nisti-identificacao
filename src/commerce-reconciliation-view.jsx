import React, { useEffect, useMemo, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import {
  CommerceEmptyState,
  CommerceLoadingBlock,
  commerceFormatNumber
} from './commerce-admin-shared.jsx';

function uniqSkus(variants = []) {
  return [...new Set((Array.isArray(variants) ? variants : [])
    .map(item => String(item?.sku || '').trim())
    .filter(Boolean))];
}

function defaultSkuSelection(variants = []) {
  const skus = uniqSkus(variants);
  return skus.length === 1 ? skus : [];
}

function Editor({ item, busy, onClose, onResolve }) {
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  const [selectedSkus, setSelectedSkus] = useState(() => defaultSkuSelection(variants));
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [newName, setNewName] = useState(item?.source_product || item?.title || '');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setSelectedSkus(defaultSkuSelection(variants));
    setProducts([]);
    setSelectedProductId(null);
    setSearch('');
    setNewName(item?.source_product || item?.title || '');
  }, [item?.listing_id, item?.relation_count]);

  async function searchProducts(event) {
    event.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ search: search.trim(), limit: '8', offset: '0' });
      const result = await commerceApi(`/api/admin/commerce/products?${params}`);
      setProducts(Array.isArray(result?.items) ? result.items : []);
    } finally {
      setSearching(false);
    }
  }

  function toggleSku(sku) {
    setSelectedSkus(current => current.includes(sku)
      ? current.filter(value => value !== sku)
      : [...current, sku]);
  }

  const familyCount = Number(item?.family_pending_count || 0);
  const relationCount = Number(item?.relation_count || 0);
  const selectableSkus = uniqSkus(variants);
  const selectionRequired = selectableSkus.length > 0 && selectedSkus.length === 0;

  return (
    <div className="commerce-reconciliation-editor">
      <div className="commerce-reconciliation-editor-head">
        <div>
          <span>Anúncio #{item.listing_id}</span>
          <h3>{item.title || item.source_product}</h3>
        </div>
        <button className="commerce-secondary-button" type="button" onClick={onClose} disabled={busy}>Fechar</button>
      </div>

      <div className="commerce-reconciliation-context">
        <div><span>Plataforma</span><strong>{item.marketplace_name || item.marketplace_code}</strong></div>
        <div><span>Família</span><strong>{String(item.family || 'sem família').replaceAll('_', ' ')}</strong></div>
        <div><span>Pendentes na família</span><strong>{familyCount}</strong></div>
        <div><span>Vínculos atuais</span><strong>{relationCount}</strong></div>
      </div>

      <div className="commerce-reconciliation-reason">
        <strong>Motivo da revisão</strong>
        <p>{item.reason || 'A origem não fornece evidência suficiente para decidir automaticamente.'}</p>
        {item.canonical_url ? <a href={item.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : null}
      </div>

      <section className="commerce-reconciliation-section">
        <div>
          <strong>1. SKUs/variações deste Produto Mestre</strong>
          <small>Para anúncio com vários produtos, selecione apenas as variações de um produto, vincule e continue.</small>
        </div>
        <div className="commerce-reconciliation-variants">
          {variants.map((variant, index) => {
            const sku = String(variant?.sku || '').trim();
            return (
              <label key={`${variant?.row_number || index}-${sku}`}>
                <input
                  type="checkbox"
                  checked={sku ? selectedSkus.includes(sku) : true}
                  disabled={!sku || busy}
                  onChange={() => toggleSku(sku)}
                />
                <span><strong>{variant?.variation || 'Variação'}</strong><code>{sku || 'Sem SKU'}</code></span>
              </label>
            );
          })}
        </div>
        {selectionRequired ? <div className="commerce-error">Selecione pelo menos um SKU/variação antes de vincular ou criar um Produto Mestre.</div> : null}
      </section>

      <div className="commerce-reconciliation-columns">
        <section className="commerce-reconciliation-section">
          <div><strong>2A. Produto Mestre existente</strong><small>Busque por nome ou SKU.</small></div>
          <form className="commerce-reconciliation-search" onSubmit={searchProducts}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome ou SKU" />
            <button type="submit" disabled={busy || searching}>{searching ? 'Buscando…' : 'Buscar'}</button>
          </form>
          <div className="commerce-reconciliation-products">
            {products.map(product => {
              const id = Number(product.product_id || 0);
              return (
                <button
                  type="button"
                  key={id}
                  className={selectedProductId === id ? 'selected' : ''}
                  onClick={() => setSelectedProductId(id)}
                >
                  <strong>{product.name}</strong>
                  <small>#{id} · {product.current_sku || 'sem SKU'} · {product.category_name || 'sem categoria'}</small>
                </button>
              );
            })}
          </div>
          <div className="commerce-reconciliation-actions">
            <button type="button" disabled={!selectedProductId || busy || selectionRequired} onClick={() => onResolve({
              action: 'LINK_EXISTING', product_id: selectedProductId, platform_skus: selectedSkus, resolve: true
            })}>Vincular e concluir</button>
            <button type="button" className="secondary" disabled={!selectedProductId || busy || selectionRequired} onClick={() => onResolve({
              action: 'LINK_EXISTING', product_id: selectedProductId, platform_skus: selectedSkus, resolve: false
            })}>Vincular seleção e continuar</button>
            {familyCount > 1 ? <button type="button" className="secondary" disabled={!selectedProductId || busy || selectionRequired} onClick={() => onResolve({
              action: 'LINK_EXISTING', product_id: selectedProductId, platform_skus: selectedSkus, apply_family: true, resolve: true
            })}>Mesma família → mesmo produto</button> : null}
          </div>
        </section>

        <section className="commerce-reconciliation-section">
          <div><strong>2B. Criar Produto Mestre</strong><small>Use somente quando realmente não existir no catálogo.</small></div>
          <label className="commerce-reconciliation-name">
            <span>Nome</span>
            <input value={newName} onChange={e => setNewName(e.target.value)} disabled={busy} />
          </label>
          <div className="commerce-reconciliation-actions">
            <button type="button" disabled={!newName.trim() || busy || selectionRequired} onClick={() => onResolve({
              action: 'CREATE_NEW', product_name: newName.trim(), platform_skus: selectedSkus, resolve: true
            })}>Criar e concluir</button>
            <button type="button" className="secondary" disabled={!newName.trim() || busy || selectionRequired} onClick={() => onResolve({
              action: 'CREATE_NEW', product_name: newName.trim(), platform_skus: selectedSkus, resolve: false
            })}>Criar para seleção e continuar</button>
            {familyCount > 1 ? <button type="button" className="secondary" disabled={!newName.trim() || busy || selectionRequired} onClick={() => onResolve({
              action: 'CREATE_NEW', product_name: newName.trim(), platform_skus: selectedSkus, apply_family: true, resolve: true
            })}>Um Produto Mestre para toda a família</button> : null}
          </div>
        </section>
      </div>

      {relationCount > 0 ? (
        <div className="commerce-reconciliation-complete">
          <span>Já existem {commerceFormatNumber(relationCount)} vínculo(s). Conclua somente quando todas as variações estiverem tratadas.</span>
          <button type="button" disabled={busy} onClick={() => onResolve({ action: 'MARK_RESOLVED', resolve: true })}>Concluir revisão</button>
        </div>
      ) : null}
    </div>
  );
}

export default function CommerceReconciliationView({ onCatalogChanged }) {
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await commerceApi('/api/admin/commerce/reconciliation?limit=50&offset=0');
      setData(result || { items: [], pagination: { total: 0 } });
      const ids = new Set((result?.items || []).map(item => Number(item.listing_id || 0)));
      setSelectedId(current => ids.has(Number(current || 0)) ? current : null);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a fila.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const selected = useMemo(
    () => (data.items || []).find(item => Number(item.listing_id) === Number(selectedId)) || null,
    [data.items, selectedId]
  );

  async function resolve(payload) {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await commerceApi(`/api/admin/commerce/reconciliation/${selected.listing_id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const parts = [];
      if (result?.links_added) parts.push(`${result.links_added} vínculo(s) adicionado(s)`);
      if (result?.created_product_id) parts.push(`Produto Mestre #${result.created_product_id} criado`);
      parts.push(result?.resolved_count ? `${result.resolved_count} revisão(ões) concluída(s)` : 'revisão mantida aberta');
      setMessage(parts.join(' · '));
      await load();
      if (typeof onCatalogChanged === 'function') await onCatalogChanged();
    } catch (err) {
      setError(err.message || 'Não foi possível aplicar a decisão.');
    } finally {
      setBusy(false);
    }
  }

  const total = Number(data?.pagination?.total || 0);

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header">
        <div>
          <h2>Fila de revisão de vínculos</h2>
          <p>Casos em que o sistema não possui evidência suficiente para decidir sozinho. Suporta anúncios com vários produtos e várias SKUs.</p>
        </div>
        <div className="commerce-reconciliation-counter"><strong>{commerceFormatNumber(total)}</strong><span>pendência(s)</span></div>
      </div>

      {error && <div className="commerce-error">{error}</div>}
      {message && <div className="commerce-reconciliation-message">{message}</div>}

      {loading ? <CommerceLoadingBlock label="Carregando pendências…" /> : data.items?.length ? (
        <div className="commerce-reconciliation-list">
          {data.items.map(item => {
            const id = Number(item.listing_id || 0);
            const active = id === Number(selectedId);
            const variants = Array.isArray(item.variants) ? item.variants : [];
            return (
              <article key={id} className={active ? 'active' : ''}>
                <div className="commerce-reconciliation-card">
                  <div><span>{item.marketplace_name || item.marketplace_code}</span>{item.source_account ? <small>{item.source_account}</small> : null}</div>
                  <div>
                    <strong>{item.title || item.source_product}</strong>
                    <small>{item.reason}</small>
                    <small>{variants.length} variação(ões) · {Number(item.family_pending_count || 0)} pendente(s) na família</small>
                  </div>
                  <button type="button" className="commerce-secondary-button" onClick={() => setSelectedId(active ? null : id)}>
                    {active ? 'Fechar' : 'Revisar'}
                  </button>
                </div>
                {active && selected ? <Editor item={selected} busy={busy} onClose={() => !busy && setSelectedId(null)} onResolve={resolve} /> : null}
              </article>
            );
          })}
        </div>
      ) : <CommerceEmptyState title="Nenhuma pendência de reconciliação" detail="Todos os anúncios importados possuem decisão de Produto Mestre." />}
    </section>
  );
}
