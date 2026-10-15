import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import { COMMERCE_MARKETPLACES, commerceFormatNumber } from './commerce-admin-shared.jsx';
import ProductCutoutImage from './product-cutout-image.jsx';
import './commerce-sku-listings.css';

function localMonth() {
  return new Date().toLocaleDateString('sv-SE', {timeZone:'America/Sao_Paulo'}).slice(0,7);
}

export default function CommerceSkuListingsView({ salesMode = false, catalogMode = false }) {
  const [search,setSearch] = useState('');
  const [appliedSearch,setAppliedSearch] = useState('');
  const [platform,setPlatform] = useState('');
  const [month,setMonth] = useState(localMonth);
  const [offset,setOffset] = useState(0);
  const [data,setData] = useState({items:[],total:0});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [edits,setEdits] = useState({});
  const [saving,setSaving] = useState('');
  const [expanded,setExpanded] = useState(new Set());
  const limit = 25;

  async function load(nextOffset = offset) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      limit:String(limit),offset:String(nextOffset),
      month,marketplace:platform
    });
    if (appliedSearch) params.set('search',appliedSearch);
    try {
      const result = await commerceApi((catalogMode
        ? '/api/admin/commerce/catalog/active-products?'
        : '/api/admin/commerce/sku-listings?') + params);
      setData(result && typeof result === 'object' ? result : {items:[],total:0});
      setOffset(nextOffset);
      setEdits({});
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o catálogo por SKU.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, [platform,month,appliedSearch,salesMode,catalogMode]);

  async function save(product,listing) {
    const key = product.product_id + ':' + listing.listing_id;
    const value = edits[key] ?? (listing.manual_units ?? '');
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw) || Number(raw) > 100000000) {
      setError('Informe uma quantidade inteira de unidades (zero ou mais).');
      return;
    }
    setSaving(key);
    setError('');
    setNotice('');
    try {
      await commerceApi('/api/admin/commerce/sales/manual-listing', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          listing_id:listing.listing_id,
          product_id:product.product_id,
          month,
          units:Number(raw)
        })
      });
      setNotice('Quantidade salva para o anúncio ' + listing.external_listing_id + ' em ' + month + '.');
      await load(offset);
    } catch (err) {
      setError(err.message || 'Não foi possível registrar as unidades deste anúncio.');
    } finally {
      setSaving('');
    }
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const total = Number(data.total || 0);
  const pages = Math.max(1,Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  function toggleProduct(productId) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  return (
    <section className="commerce-sku-panel">
      <div className="commerce-sku-header">
        <h2>{salesMode ? 'Vendas por anúncio' : 'Catálogo de produtos ativos'}</h2>
        <small>{catalogMode
          ? `${commerceFormatNumber(data.active_ads || 0)} anúncios ativos · ${commerceFormatNumber(total)} grupos de produtos`
          : `${commerceFormatNumber(total)} produtos`}</small>
      </div>

      <div className="commerce-sku-filters">
        <form onSubmit={e=>{e.preventDefault();setAppliedSearch(search.trim());}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Buscar SKU, produto ou ID do anúncio" aria-label="Buscar produto"/>
          <button type="submit">Buscar</button>
        </form>
        <select value={platform} onChange={e=>setPlatform(e.target.value)} aria-label="Plataforma">
          {COMMERCE_MARKETPLACES.map(([code,label])=><option key={code || 'all'} value={code}>{label}</option>)}
        </select>
        {salesMode && (
          <label>Vendas do mês
            <input type="month" value={month} onChange={e=>setMonth(e.target.value || localMonth())}/>
          </label>
        )}
        <button type="button" onClick={()=>load(offset)} disabled={loading}>Atualizar</button>
      </div>

      {error && <p className="commerce-sku-error" role="alert">{error}</p>}
      {notice && <p className="commerce-sku-success" role="status">{notice}</p>}
      {loading && <p className="commerce-sku-empty">Carregando produtos e anúncios…</p>}
      {!loading && !items.length && <p className="commerce-sku-empty">{catalogMode
        ? 'Nenhum anúncio ativo encontrado neste filtro.'
        : 'Nenhum produto vinculado a anúncio ativo neste filtro. Consulte Pendências para anúncios ainda não identificados.'}</p>}

      {!loading && items.length > 0 && (
        <div className="commerce-sku-products">
          {items.map(product => {
            const listings = Array.isArray(product.listings) ? product.listings : [];
            const eans = Array.isArray(product.eans) ? product.eans : [];
            const productKey = product.key || product.product_id;
            const isExpanded = expanded.has(productKey);
            const detailId = 'commerce-sku-details-' + String(productKey).replace(/[^a-zA-Z0-9_-]/g, '-');
            return (
              <article key={productKey} className="commerce-sku-product">
                <div className="commerce-sku-product-summary">
                  <ProductCutoutImage
                    src={product.image_url}
                    alt={product.product_name || product.sku}
                    className="commerce-sku-product-thumb"
                    fallback={<span className="commerce-sku-product-thumb missing">Sem foto</span>}
                  />
                  <div className="commerce-sku-product-main">
                    <strong className="commerce-sku-product-name">{product.product_name || 'Produto NISTI'}</strong>
                    <div className="commerce-sku-listings">
                      {listings.map(listing => (
                        <div key={listing.listing_id} className="commerce-sku-listing">
                          {listing.url ? (
                            <a className="commerce-sku-id-link" href={listing.url}
                              target="_blank" rel="noopener noreferrer"
                              title={'Abrir anúncio ' + listing.external_listing_id}>
                              {listing.external_listing_id}
                              <span aria-hidden="true">↗</span>
                            </a>
                          ) : (
                            <span className="commerce-sku-id-unlinked">{listing.external_listing_id || 'ID indisponível'}</span>
                          )}
                          {catalogMode && Array.isArray(listing.variations) && listing.variations.length > 0 && (
                            <div className="commerce-sku-variations">
                              {listing.variations.map(variation => (
                                <span className="commerce-sku-variation" key={variation.id || variation.sku}>
                                  {variation.image_url && (
                                    <img src={variation.image_url} loading="lazy"
                                      alt={variation.name || 'Variação'} />
                                  )}
                                  <span>{variation.name || 'Variação'}</span>
                                  <code>{variation.current_sku || variation.sku || 'SKU não informado'}</code>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="commerce-sku-expand"
                    onClick={() => toggleProduct(productKey)}
                    aria-expanded={isExpanded}
                    aria-controls={detailId}
                    aria-label={(isExpanded ? 'Ocultar' : 'Mostrar') + ' SKU e EAN de ' + (product.product_name || product.sku)}>
                    {isExpanded ? '−' : '+'}
                  </button>
                </div>
                {isExpanded && (
                  <div className="commerce-sku-details" id={detailId}>
                    <div className="commerce-sku-identifiers">
                      <div><span>SKU</span><code>{product.sku || 'Consulte as variações abaixo'}</code></div>
                      <div><span>EAN</span>
                        {eans.length ? (
                          <div className="commerce-sku-eans">
                            {eans.map(ean => <code key={ean}>{ean}</code>)}
                          </div>
                        ) : <em>Não cadastrado</em>}
                      </div>
                    </div>
                    {salesMode && (
                      <div className="commerce-sku-sales-list">
                        {listings.map(listing => {
                          const key = product.product_id + ':' + listing.listing_id;
                          const value = edits[key] ?? (listing.manual_units ?? '');
                          return (
                            <div key={listing.listing_id} className="commerce-sku-sale-row">
                              <span className="commerce-sku-sale-id">{listing.external_listing_id}</span>
                              <div className="commerce-sku-manual-sale">
                                <label htmlFor={'listing-units-' + key}>Unidades no mês</label>
                                <div>
                                  <input id={'listing-units-' + key} inputMode="numeric"
                                    type="number" min="0" step="1" max="100000000"
                                    value={value} placeholder="Não informado"
                                    onChange={e => setEdits(current => ({...current,[key]:e.target.value}))}/>
                                  <button type="button" disabled={saving !== ''}
                                    onClick={() => save(product,listing)}>
                                    {saving === key ? 'Salvando…' : 'Salvar'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="commerce-sku-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} {catalogMode ? 'grupos de produtos' : 'produtos'}</span>
        <div>
          <button disabled={loading || offset===0} onClick={()=>load(Math.max(0,offset-limit))}>Anterior</button>
          <button disabled={loading || offset+limit>=total} onClick={()=>load(offset+limit)}>Próxima</button>
        </div>
      </div>
    </section>
  );
}
