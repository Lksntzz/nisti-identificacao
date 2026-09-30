import React, { useEffect, useMemo, useState } from 'react';

function ProductVisual({ src, alt, focusKey }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="mural-product-focus-placeholder" role="img" aria-label="Imagem do produto indisponível">
        <span aria-hidden="true">NISTI</span>
      </div>
    );
  }

  return (
    <img
      className={`mural-product-focus-image${loaded ? ' is-loaded' : ''}`}
      src={src}
      alt={alt}
      data-focus={focusKey}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}

function finishSummary(product) {
  return [product?.wireo, product?.tassel, product?.elastico].filter(Boolean);
}

export default function MuralProductExperience({ item }) {
  const product = item?.product || {};
  const [activeFocus, setActiveFocus] = useState(0);

  const focuses = useMemo(() => {
    const finishes = finishSummary(product);
    return [
      {
        key: 'overview',
        label: 'Visão',
        eyebrow: product.type || 'Produto',
        title: item?.title || 'Produto NISTI',
        body: item?.body || item?.subtitle || 'Detalhes editoriais do produto.'
      },
      {
        key: 'identity',
        label: 'Identificação',
        eyebrow: 'Identificação',
        title: product.collection || 'Catálogo NISTI',
        body: product.sku ? `SKU ${product.sku}` : 'Produto integrado ao catálogo atual.'
      },
      {
        key: 'finishes',
        label: 'Acabamentos',
        eyebrow: 'Acabamentos',
        title: finishes.join(' · ') || 'Configuração atual',
        body: 'Wire-o, tassel e elástico são exibidos conforme o cadastro atual do produto.',
        chips: finishes
      },
      {
        key: 'editorial',
        label: 'Editorial',
        eyebrow: 'Conteúdo editorial',
        title: item?.subtitle || 'Sobre este produto',
        body: item?.published_at
          ? `Publicado em ${new Date(item.published_at).toLocaleDateString('pt-BR')}`
          : 'Conteúdo do Mural NISTI.'
      }
    ];
  }, [item, product.collection, product.elastico, product.sku, product.tassel, product.type, product.wireo]);

  useEffect(() => {
    setActiveFocus(0);
  }, [item?.id]);

  const focus = focuses[activeFocus] || focuses[0];

  return (
    <div className="mural-product-focus">
      <section className="mural-product-focus-stage" data-focus={focus.key}>
        <div className="mural-product-focus-glow" aria-hidden="true" />
        <ProductVisual
          src={item?.image_url}
          alt={item?.title || product.type || 'Produto NISTI'}
          focusKey={focus.key}
        />
        <div className="mural-product-focus-caption">
          <span>{item?.badge || 'NISTI'}</span>
          <strong>{product.type || item?.title || 'Produto'}</strong>
        </div>
      </section>

      <nav className="mural-product-focus-tabs" role="tablist" aria-label="Detalhes do produto">
        {focuses.map((entry, index) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={activeFocus === index}
            aria-controls="mural-product-focus-panel"
            className={activeFocus === index ? 'active' : ''}
            onClick={() => setActiveFocus(index)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <section
        id="mural-product-focus-panel"
        className="mural-product-focus-panel"
        role="tabpanel"
        key={focus.key}
      >
        <span>{focus.eyebrow}</span>
        <h3>{focus.title}</h3>
        <p>{focus.body}</p>
        {focus.chips?.length ? (
          <div className="mural-product-focus-chips">
            {focus.chips.map(value => <b key={value}>{value}</b>)}
          </div>
        ) : null}
      </section>

      <section className="mural-product-facts" aria-label="Detalhes técnicos do produto">
        <span className="mural-product-facts-title">Ficha rápida</span>
        {product.sku && <div><span>SKU</span><strong>{product.sku}</strong></div>}
        {product.collection && <div><span>Coleção</span><strong>{product.collection}</strong></div>}
        {product.wireo && <div><span>Wire-o</span><strong>{product.wireo}</strong></div>}
        {product.tassel && <div><span>Tassel</span><strong>{product.tassel}</strong></div>}
        {product.elastico && <div><span>Elástico</span><strong>{product.elastico}</strong></div>}
      </section>
    </div>
  );
}
