import React from 'react';

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
}

export default function ProductsWithoutGtinView({ products = [], onSelect, onBack }) {
  return (
    <section className="admin-table-card missing-gtin-products" aria-labelledby="missing-gtin-title">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <button type="button" className="missing-gtin-back" onClick={onBack} aria-label="Voltar ao catálogo">←</button>
          <div>
            <h3 id="missing-gtin-title" className="table-main-title">Produtos sem EAN</h3>
            <span className="table-sub-title">{products.length} produto{products.length === 1 ? '' : 's'} aguardando código de barras</span>
          </div>
        </div>
      </div>

      <div className="missing-gtin-list">
        {products.map(product => (
          <button
            type="button"
            className="missing-gtin-product"
            key={product.id}
            onClick={() => onSelect?.(product)}
          >
            <span className="missing-gtin-thumb">
              {product.image_url
                ? <img src={productImage(product)} alt="" loading="lazy" />
                : <span aria-hidden="true">EAN</span>}
            </span>
            <span className="missing-gtin-copy">
              <strong>{product.nome || product.sku}</strong>
              <span>SKU {product.sku || '—'} · Capa {product.capa_code || '—'}</span>
              <small>{product.variacao || product.platform || 'Sem variação informada'}</small>
            </span>
            <span className="missing-gtin-open">Ver produto →</span>
          </button>
        ))}
      </div>
    </section>
  );
}
