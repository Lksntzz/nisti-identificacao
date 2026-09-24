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

const MARKETPLACE_LABELS = Object.freeze({
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  SHEIN: 'Shein',
  MAGALU: 'Magalu',
  ALIEXPRESS: 'AliExpress',
  TIKTOK: 'TikTok Shop',
  KAWAI: 'Kwai',
  LOJA_INTEGRADA: 'Loja Integrada'
});

function marketplaceLabel(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (MARKETPLACE_LABELS[normalized]) return MARKETPLACE_LABELS[normalized];
  return normalized
    ? normalized.toLowerCase().split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : 'Plataforma';
}

function coverageInfo(marketplaceCodes = []) {
  const codes = Array.isArray(marketplaceCodes) ? marketplaceCodes.filter(Boolean) : [];
  if (codes.length === 0) return { kind: 'none', label: 'Sem anúncio' };
  if (codes.length === 1) return { kind: 'exclusive', label: 'Exclusivo' };
  return { kind: 'multi', label: 'Multiplataforma' };
}

function formatDate(value) {
  if (!value) return 'Nunca verificado';
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
    return 'Data inválida';
  }
}

function ProductImage({ product, className }) {
  if (!product?.thumbnail_url) {
    return <div className={`${className} commerce-image-placeholder`}>Sem foto</div>;
  }
  return (
    <img
      className={className}
      src={product.thumbnail_url}
      alt={product.name || `Produto #${product.product_id}`}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function ProductCoverage({ marketplaceCodes = [], compact = false }) {
  const coverage = coverageInfo(marketplaceCodes);
  return (
    <div className={`commerce-product-coverage ${compact ? 'compact' : ''}`}>
      <span className={`commerce-coverage-tag ${coverage.kind}`}>{coverage.label}</span>
      {marketplaceCodes.length ? (
        <div className="commerce-platform-tags">
          {marketplaceCodes.map(code => (
            <span className="commerce-platform-tag" key={code}>{marketplaceLabel(code)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
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
          <div><span>Cobertura</span><strong>{coverageInfo(marketplaceCodes).label}</strong></div>
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

function ListingPlatformCard({ listing }) {
  return (
    <article className="commerce-platform-listing-card">
      <div className="commerce-platform-listing-media">
        {listing.image_url ? (
          <img
            src={listing.image_url}
            alt={listing.title || `Anúncio #${listing.listing_id}`}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="commerce-image-placeholder">Sem foto</div>
        )}
        {listing.image_source === 'OTHER_MARKETPLACE' ? (
          <small>Mesma foto do produto · {listing.image_source_marketplace_name || marketplaceLabel(listing.image_source_marketplace_code)}</small>
        ) : null}
        {listing.image_source === 'NISTI_ID' ? <small>Imagem NISTI ID</small> : null}
      </div>

      <div className="commerce-platform-listing-copy">
        <div className="commerce-platform-listing-title">
          <div>
            <span>Anúncio #{listing.listing_id}</span>
            <h4>{listing.title || 'Título não capturado'}</h4>
          </div>
          {listing.canonical_url ? (
            <a href={listing.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio</a>
          ) : null}
        </div>

        <div className="commerce-platform-listing-meta">
          <div><span>ID da plataforma</span><strong>{listing.external_listing_id || '—'}</strong></div>
          <div><span>SKU na plataforma</span><strong>{listing.platform_sku || '—'}</strong></div>
          <div><span>Variação</span><strong>{listing.variation_name || '—'}</strong></div>
          <div><span>Última verificação</span><strong>{formatDate(listing.last_checked_at)}</strong></div>
        </div>

        {listing.marketplace_category ? (
          <div className="commerce-platform-category">
            <span>Categoria da plataforma</span>
            <strong>{listing.marketplace_category}</strong>
          </div>
        ) : null}

        <div className="commerce-platform-statuses">
          <div><span>Anúncio</span><CommerceStatusPill value={listing.listing_status} /></div>
          <div><span>Venda</span><CommerceStatusPill value={listing.sales_status} /></div>
          <div><span>Vídeo</span><CommerceStatusPill value={listing.video_status} /></div>
        </div>
      </div>
    </article>
  );
}

function ProductPlatformDrawer({
  product,
  detail,
  loading,
  error,
  activePlatform,
  onPlatformChange,
  onClose,
  onReviewStatus
}) {
  const marketplaces = Array.isArray(detail?.marketplaces) ? detail.marketplaces : [];
  const active = marketplaces.find(item => item.code === activePlatform) || marketplaces[0] || null;
  const codes = marketplaces.map(item => item.code);

  return (
    <div className="commerce-listing-state-backdrop" onClick={onClose}>
      <aside className="commerce-product-detail-panel" onClick={event => event.stopPropagation()}>
        <div className="commerce-product-detail-head">
          <ProductImage product={product} className="commerce-product-detail-image" />
          <div className="commerce-product-detail-heading">
            <span>Produto Mestre #{product.product_id}</span>
            <h3>{product.name}</h3>
            <code>{product.current_sku || 'SKU não informado'}</code>
            <ProductCoverage marketplaceCodes={codes.length ? codes : (product.marketplace_codes || [])} compact />
          </div>
          <button type="button" className="commerce-detail-close" onClick={onClose}>Fechar</button>
        </div>

        <div className="commerce-product-detail-summary">
          <div><span>Categoria</span><strong>{detail?.category_name || product.category_name || '—'}</strong></div>
          <div><span>Tipo</span><strong>{commerceStatusLabel(detail?.temporal_type || product.temporal_type)}</strong></div>
          <div><span>Anúncios</span><strong>{commerceFormatNumber(detail?.listing_count ?? product.listing_count ?? 0)}</strong></div>
          <div><span>Status</span><CommerceStatusPill value={detail?.internal_status || product.internal_status} /></div>
        </div>

        {loading ? (
          <CommerceLoadingBlock label="Carregando informações das plataformas…" />
        ) : error ? (
          <div className="commerce-error commerce-product-detail-error">{error}</div>
        ) : marketplaces.length ? (
          <>
            <div className="commerce-platform-tabs" role="tablist" aria-label="Plataformas do produto">
              {marketplaces.map(item => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active?.code === item.code}
                  className={active?.code === item.code ? 'active' : ''}
                  key={item.code}
                  onClick={() => onPlatformChange(item.code)}
                >
                  <span>{item.name || marketplaceLabel(item.code)}</span>
                  <small>{commerceFormatNumber(item.listing_count || 0)}</small>
                </button>
              ))}
            </div>

            <section className="commerce-platform-detail-section">
              <div className="commerce-platform-detail-title">
                <div>
                  <span>Informações da plataforma</span>
                  <h4>{active?.name || marketplaceLabel(active?.code)}</h4>
                </div>
                <strong>{commerceFormatNumber(active?.listing_count || 0)} anúncio(s)</strong>
              </div>

              <div className="commerce-platform-listings">
                {(active?.listings || []).map(listing => (
                  <ListingPlatformCard key={listing.listing_id} listing={listing} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <CommerceEmptyState
            title="Produto sem anúncio vinculado"
            detail="O Produto Mestre existe no catálogo, mas ainda não possui uma plataforma comercial vinculada."
          />
        )}

        <div className="commerce-product-detail-actions">
          <button type="button" className="secondary" onClick={onClose}>Fechar</button>
          <button type="button" onClick={() => onReviewStatus(product)}>Revisar status do produto</button>
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
  const [stateProduct, setStateProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [activePlatform, setActivePlatform] = useState('');
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

  async function openProductDetail(product) {
    const productId = Number(product?.product_id || 0);
    if (!productId) return;
    setDetailProduct(product);
    setDetail(null);
    setDetailError('');
    setActivePlatform('');
    setDetailLoading(true);
    try {
      const result = await commerceApi(`/api/admin/commerce/products/${productId}/details`);
      setDetail(result || {});
      const marketplaces = Array.isArray(result?.marketplaces) ? result.marketplaces : [];
      setActivePlatform(marketplaces[0]?.code || '');
    } catch (err) {
      setDetailError(err.message || 'Não foi possível carregar as plataformas deste produto.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveProductState(values) {
    const productId = Number(stateProduct?.product_id || 0);
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
      setStateProduct(null);
      setDetailProduct(null);
      setDetail(null);
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
          <p>Visão central por produto. A tag mostra se ele é exclusivo de uma plataforma ou está publicado em múltiplas plataformas.</p>
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
        <div className="commerce-product-card-grid">
          {data.items.map(product => {
            const productId = Number(product.product_id || 0);
            const marketplaceCodes = Array.isArray(product.marketplace_codes) ? product.marketplace_codes : [];
            return (
              <article className="commerce-product-card" key={productId}>
                <button
                  type="button"
                  className="commerce-product-card-main"
                  onClick={() => openProductDetail(product)}
                  aria-label={`Abrir detalhes de ${product.name || product.current_sku || `produto ${productId}`}`}
                >
                  <ProductImage product={product} className="commerce-product-card-image" />

                  <div className="commerce-product-card-copy">
                    <div className="commerce-product-card-title">
                      <div>
                        <h3>{product.name}</h3>
                        <code>{product.current_sku || 'SKU não informado'}</code>
                      </div>
                      <CommerceStatusPill value={product.internal_status} />
                    </div>

                    <ProductCoverage marketplaceCodes={marketplaceCodes} />

                    <div className="commerce-product-card-meta">
                      <span>{product.category_name || 'Sem categoria'}</span>
                      <span>{commerceFormatNumber(product.listing_count || 0)} anúncio(s)</span>
                      {product.thumbnail_source === 'NISTI_ID' ? <span className="commerce-media-source">Foto NISTI ID</span> : null}
                    </div>
                  </div>
                </button>

                <div className="commerce-product-card-footer">
                  <span>Produto Mestre #{productId}</span>
                  <div>
                    <button type="button" className="commerce-card-review-button" onClick={() => setStateProduct(product)}>Revisar status</button>
                    <button type="button" className="commerce-card-detail-button" onClick={() => openProductDetail(product)}>Ver plataformas</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <CommerceEmptyState title="Nenhum produto comercial cadastrado" detail="Os produtos aparecerão aqui após a reconciliação das fontes comerciais." />
      )}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - COMMERCE_PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + COMMERCE_PAGE_SIZE >= total || loading} onClick={() => load(offset + COMMERCE_PAGE_SIZE)}>Próxima</button>
        </div>
      </div>

      {detailProduct && (
        <ProductPlatformDrawer
          product={detailProduct}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          activePlatform={activePlatform}
          onPlatformChange={setActivePlatform}
          onClose={() => {
            setDetailProduct(null);
            setDetail(null);
            setDetailError('');
            setActivePlatform('');
          }}
          onReviewStatus={product => {
            setDetailProduct(null);
            setStateProduct(product);
          }}
        />
      )}

      {stateProduct && (
        <ProductStateEditor
          product={stateProduct}
          busy={saving}
          onClose={() => !saving && setStateProduct(null)}
          onSave={saveProductState}
        />
      )}
    </section>
  );
}
