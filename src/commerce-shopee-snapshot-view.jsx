import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import {
  COMMERCE_PAGE_SIZE,
  CommerceEmptyState,
  CommerceLoadingBlock,
  commerceFormatNumber
} from './commerce-admin-shared.jsx';

function matchLabel(status) {
  if (status === 'MATCHED') return 'Vinculado ao catálogo';
  if (status === 'NEW_PENDING') return 'Novo · pendente';
  if (status === 'CONFLICT') return 'Conflito';
  return status || '—';
}

function publicShopeeUrl(item) {
  if (item?.canonical_url) return item.canonical_url;
  const id = String(item?.external_listing_id || '').trim();
  return id ? `https://shopee.com.br/product/376221706/${encodeURIComponent(id)}/` : '';
}

function ImageThumb({ src, alt, className = '' }) {
  if (!src) return <div className={`commerce-image-placeholder ${className}`}>Sem imagem</div>;
  return (
    <img
      className={className}
      src={src}
      alt={alt || ''}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

export default function CommerceShopeeSnapshotView() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextOffset = offset) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      limit: String(Math.max(COMMERCE_PAGE_SIZE, 40)),
      offset: String(nextOffset)
    });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);

    try {
      const result = await commerceApi(`/api/admin/commerce/shopee-snapshot?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar o snapshot da Shopee.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, [status]);

  const total = Number(data?.pagination?.total || 0);
  const limit = Number(data?.pagination?.limit || Math.max(COMMERCE_PAGE_SIZE, 40));
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Shopee · Capas e variações</h2>
          <p>
            Snapshot oficial enviado pela Shopee. As imagens servem para conferência visual; opções de capa sem SKU individual não são vinculadas automaticamente a um Produto Mestre.
          </p>
        </div>

        <div className="commerce-filter-row">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar título, SKU de referência ou ID Shopee"
            />
            <button type="submit">Buscar</button>
          </form>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Todos</option>
            <option value="MATCHED">Vinculados</option>
            <option value="NEW_PENDING">Novos pendentes</option>
            <option value="CONFLICT">Conflitos</option>
          </select>
        </div>
      </div>

      <div className="commerce-shopee-summary">
        <strong>{commerceFormatNumber(total)}</strong>
        <span>{status ? matchLabel(status) : 'itens no filtro atual'}</span>
      </div>

      {error && <div className="commerce-error">{error}</div>}

      {loading ? <CommerceLoadingBlock label="Carregando capas da Shopee…" /> : data.items?.length ? (
        <div className="commerce-shopee-grid">
          {data.items.map(item => {
            const variations = Array.isArray(item.variation_options) ? item.variation_options : [];
            const itemUrl = publicShopeeUrl(item);
            return (
              <article className="commerce-shopee-card" key={item.snapshot_id}>
                <div className="commerce-shopee-cover">
                  <ImageThumb
                    src={item.cover_image_url}
                    alt={item.title || `Shopee ${item.external_listing_id}`}
                    className="commerce-shopee-cover-image"
                  />
                  <span className={`commerce-snapshot-badge ${String(item.match_status || '').toLowerCase()}`}>
                    {matchLabel(item.match_status)}
                  </span>
                </div>

                <div className="commerce-shopee-copy">
                  <h3>{item.title || 'Título não informado'}</h3>
                  <div className="commerce-shopee-meta">
                    <code>{item.parent_sku || 'Sem SKU de referência'}</code>
                    <span>ID {item.external_listing_id}</span>
                    {item.listing_id ? <span>Catálogo #{item.listing_id} · {commerceFormatNumber(item.product_count || 0)} produto(s)</span> : null}
                  </div>
                  <small>{item.marketplace_category || 'Categoria Shopee não informada'}</small>
                  {itemUrl ? <a href={itemUrl} target="_blank" rel="noreferrer">Abrir na Shopee</a> : null}
                </div>

                {variations.length ? (
                  <div className="commerce-shopee-variations">
                    <strong>{item.variation_name || 'Variações'} · {variations.length}</strong>
                    <div>
                      {variations.map((variation, index) => (
                        <figure key={`${item.snapshot_id}-${variation.position || index}`}>
                          <ImageThumb
                            src={variation.image_url}
                            alt={variation.name || `Variação ${index + 1}`}
                            className="commerce-variation-image"
                          />
                          <figcaption>{variation.name || `Opção ${index + 1}`}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="commerce-shopee-no-variation">Sem capas/variações separadas no arquivo.</div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <CommerceEmptyState
          title="Nenhum item da Shopee encontrado"
          detail="Altere os filtros ou a busca para consultar o snapshot importado."
        />
      )}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - limit))}>Anterior</button>
          <button type="button" disabled={offset + limit >= total || loading} onClick={() => load(offset + limit)}>Próxima</button>
        </div>
      </div>
    </section>
  );
}
