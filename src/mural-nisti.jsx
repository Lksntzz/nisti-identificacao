import React, { useEffect, useRef, useState } from 'react';
import './mural-nisti.css';
import MuralProductExperience from './mural-product-experience.jsx';

const muralSessionCache = new Map();

const TABS = [
  ['all', 'Tudo'],
  ['products', 'Produtos'],
  ['collections', 'Coleções'],
  ['notices', 'Avisos']
];

function TabIcon({ value }) {
  const icon = value === 'products' ? '◇' : value === 'collections' ? '≋' : value === 'notices' ? '◁' : '✦';
  return <span className={`mural-tab-icon mural-tab-icon-${value}`} aria-hidden="true">{icon}</span>;
}

function userId() {
  try {
    return localStorage.getItem('nisti_shipping_user_id') || 'op_guest';
  } catch {
    return 'op_guest';
  }
}

function muralQaHeader() {
  try {
    return new URLSearchParams(window.location.search).get('mural') === 'qa'
      ? { 'x-mural-qa': '1' }
      : {};
  } catch {
    return {};
  }
}

async function muralApi(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'x-user-id': userId(),
      ...muralQaHeader(),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar o Mural.');
  return data;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCollectionTitle(collection) {
  if (!collection) return '';
  const name = String(collection.name || '').trim();
  const year = String(collection.year || '').trim();
  if (!year || name.endsWith(year)) return name;
  return `${name} ${year}`.trim();
}

function KindIcon({ kind }) {
  const label = kind === 'product' ? 'P' : kind === 'collection' ? 'C' : '!';
  return <span className="mural-kind-icon" aria-hidden="true">{label}</span>;
}

function MuralImage({ item, eager = false, className = '' }) {
  const src = item?.image_url || '';
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  if (!src || failed) {
    return <div className={`mural-image-placeholder ${className}`}><KindIcon kind={item?.kind} /></div>;
  }
  return (
    <img
      className={`${className} mural-image-media${loaded ? ' is-loaded' : ''}`.trim()}
      src={src}
      alt={item.kind === 'product' ? `${item.product?.type || item.title} ${item.product?.sku || ''}`.trim() : item.title}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}


function CollectionProductImage({ product, className = '', eager = false }) {
  const src = product?.image_url || '';
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <div className={`mural-image-placeholder ${className}`.trim()}><KindIcon kind="product" /></div>;
  }

  return (
    <img
      className={className}
      src={src}
      alt={`${product?.type || 'Produto'} ${product?.sku || ''}`.trim()}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function ReadBadge({ item }) {
  if (item.is_read) return null;
  return <span className="mural-new-badge mural-badge-motion">NOVO</span>;
}

function ProductMeta({ product }) {
  if (!product) return null;
  return (
    <div className="mural-product-meta">
      {product.sku && <span className="mural-sku">{product.sku}</span>}
      {product.collection && <span className="mural-product-collection">{product.collection}</span>}
      <div className="mural-finishes">
        {product.wireo && <span><strong>Wire-o</strong>{product.wireo}</span>}
        {product.tassel && <span><strong>Tassel</strong>{product.tassel}</span>}
        {product.elastico && <span><strong>Elástico</strong>{product.elastico}</span>}
      </div>
    </div>
  );
}

function NoticeLabel({ level }) {
  const labels = { important: 'Importante', attention: 'Atenção', info: 'Informação' };
  return <span className={`mural-notice-label mural-badge-motion ${level || 'info'}`}><span aria-hidden="true">!</span>{labels[level] || labels.info}</span>;
}

function Hero({ item, onOpen }) {
  if (!item) return null;
  return (
    <button type="button" className="mural-hero mural-hero-enter" onClick={() => onOpen(item)}>
      <MuralImage item={item} eager className="mural-hero-image" />
      <span className="mural-hero-shade" aria-hidden="true" />
      <span className="mural-hero-accent" aria-hidden="true"><i /><i /><i /></span>
      <span className="mural-hero-copy">
        <span className="mural-hero-badges">
          <ReadBadge item={item} />
          {item.badge && <span className="mural-editorial-badge mural-badge-motion">{item.badge}</span>}
        </span>
        <strong>{item.title}</strong>
        {item.subtitle && <span>{item.subtitle}</span>}
        <span className="mural-hero-cta">Ver detalhe <span aria-hidden="true">→</span></span>
      </span>
    </button>
  );
}

export function MuralCard({ item, onOpen, eager = false, index = 0 }) {
  const isNotice = item.kind === 'notice';
  const isProduct = item.kind === 'product';
  const isCollection = item.kind === 'collection';
  const revealStyle = { '--mural-card-delay': `${Math.min(index, 8) * 45}ms` };
  const collectionPreviews = isCollection ? (item.collection?.preview_products || []) : [];
  const collectionProductCount = isCollection
    ? Number(item.collection?.product_count || collectionPreviews.length || 0)
    : 0;

  if (isCollection) {
    return (
      <button
        type="button"
        className={`mural-card mural-card-collection mural-reveal${collectionPreviews.length ? ' has-products' : ''}${!item.is_read ? ' unread' : ''}`}
        style={revealStyle}
        data-mural-reveal
        onClick={() => onOpen(item)}
      >
        <MuralImage item={item} eager={eager} className="mural-collection-card-image" />
        <span className="mural-collection-card-shade" aria-hidden="true" />
        {collectionPreviews.length ? (
          <span className="mural-collection-card-products" aria-label={`${collectionProductCount} produtos na coleção`}>
            <span className="mural-collection-card-product-stack" aria-hidden="true">
              {collectionPreviews.map((product, productIndex) => (
                <span className={`mural-collection-card-product-preview preview-${productIndex + 1}`} key={product.id}>
                  <CollectionProductImage product={product} eager={eager && productIndex === 0} />
                </span>
              ))}
            </span>
            <span className="mural-collection-card-product-count">
              <strong>{collectionProductCount}</strong>
              <small>produto{collectionProductCount === 1 ? '' : 's'}</small>
            </span>
          </span>
        ) : null}
        <span className="mural-collection-card-copy">
          <span className="mural-card-badges">
            <ReadBadge item={item} />
            {item.badge && <span className="mural-editorial-badge mural-badge-motion">{item.badge}</span>}
          </span>
          <strong>{item.title}</strong>
          {item.subtitle && <span>{item.subtitle}</span>}
          {item.body && <small>{item.body}</small>}
          <span className="mural-collection-card-cta">Ver coleção <b aria-hidden="true">›</b></span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`mural-card mural-card-${item.kind} mural-reveal${!item.is_read ? ' unread' : ''}`}
      style={revealStyle}
      data-mural-reveal
      onClick={() => onOpen(item)}
    >
      {!isNotice && <MuralImage item={item} eager={eager} className="mural-card-image" />}
      {isNotice && <div className={`mural-notice-icon ${item.notice_level || 'info'}`}><span aria-hidden="true">!</span></div>}
      <span className="mural-card-content">
        <span className="mural-card-badges">
          <ReadBadge item={item} />
          {isNotice ? <NoticeLabel level={item.notice_level} /> : item.badge && <span className="mural-editorial-badge mural-badge-motion">{item.badge}</span>}
        </span>
        <span className="mural-card-title-row">
          <strong>{isProduct ? item.product?.type || item.title : item.title}</strong>
        </span>
        {isProduct && item.title !== item.product?.type && <span className="mural-card-product-name">{item.title}</span>}
        {!isProduct && item.subtitle && <span className="mural-card-subtitle">{item.subtitle}</span>}
        {item.body && <span className="mural-card-summary">{item.body}</span>}
        {isProduct && <ProductMeta product={item.product} />}
        {isNotice && <span className="mural-card-date">{formatDate(item.published_at)}</span>}
      </span>
      <span className="mural-card-arrow" aria-hidden="true">›</span>
    </button>
  );
}

function useAnimatedDialogClose(onClose, duration = 180) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const requestClose = () => {
    if (closing) return;
    const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reduced) {
      onClose();
      return;
    }
    setClosing(true);
    timerRef.current = window.setTimeout(onClose, duration);
  };

  return { closing, requestClose };
}

function DetailDialog({ item, onClose, onOpenCollection }) {
  const closeRef = useRef(null);
  const hasMedia = Boolean(item?.image_url);
  const { closing, requestClose } = useAnimatedDialogClose(onClose);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const immersiveProduct = item.kind === 'product';

  return (
    <div className={`mural-modal-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={event => event.target === event.currentTarget && requestClose()}>
      <section className={`mural-detail${immersiveProduct ? ' mural-detail-immersive' : hasMedia ? '' : ' no-media'}`} role="dialog" aria-modal="true" aria-labelledby="mural-detail-title">
        <button ref={closeRef} type="button" className="mural-detail-close" onClick={requestClose} disabled={closing} aria-label="Fechar detalhe"><span aria-hidden="true">×</span></button>
        {immersiveProduct ? <MuralProductExperience item={item} /> : (
          <>
            {hasMedia && <MuralImage item={item} eager className={`mural-detail-image mural-detail-image-${item.kind}`} />}
            <div className={`mural-detail-body${hasMedia ? '' : ' no-media'}`}>
          <div className="mural-card-badges">
            <ReadBadge item={item} />
            {item.kind === 'notice' ? <NoticeLabel level={item.notice_level} /> : item.badge && <span className="mural-editorial-badge mural-badge-motion">{item.badge}</span>}
          </div>
          {item.kind === 'product' && item.product?.type && <p className="mural-detail-kicker">{item.product.type}</p>}
          <h2 id="mural-detail-title">{item.title}</h2>
          {item.subtitle && <p className="mural-detail-subtitle">{item.subtitle}</p>}
          {item.body && <p className="mural-detail-copy">{item.body}</p>}
          {item.kind === 'product' && <ProductMeta product={item.product} />}
          {item.published_at && <p className="mural-detail-date">Publicado em {formatDate(item.published_at)}</p>}
          {item.kind === 'collection' && item.collection?.slug && (
            <button type="button" className="mural-primary-action" onClick={() => onOpenCollection(item.collection.slug)}>
              Ver produtos da coleção
            </button>
          )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CollectionDialog({ slug, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const closeRef = useRef(null);
  const detailRef = useRef(null);
  const scrollFrame = useRef(0);
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverLoaded, setCoverLoaded] = useState(false);
  const { closing, requestClose } = useAnimatedDialogClose(onClose);

  useEffect(() => {
    let active = true;
    setCoverFailed(false);
    setCoverLoaded(false);
    muralApi(`/api/mural/collections/${encodeURIComponent(slug)}`)
      .then(data => active && setState({ loading: false, data: data.collection, error: '' }))
      .catch(error => active && setState({ loading: false, data: null, error: error.message }));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => event.key === 'Escape' && requestClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  useEffect(() => {
    const root = detailRef.current;
    if (!root || !state.data?.products?.length) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const nodes = [...root.querySelectorAll('[data-collection-reveal]')];
    if (reduced || typeof IntersectionObserver === 'undefined') {
      nodes.forEach(node => node.classList.add('is-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { root, threshold: .16, rootMargin:'0px 0px -4% 0px' });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [state.data]);

  const handleCollectionScroll = event => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const node = event.currentTarget;
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      const max = Math.max(1, node.scrollHeight - node.clientHeight);
      const progress = Math.max(0, Math.min(1, node.scrollTop / max));
      node.style.setProperty('--collection-progress', String(progress));
      scrollFrame.current = 0;
    });
  };

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  const collection = state.data;
  const products = collection?.products || [];
  const featuredProduct = products[0] || null;
  const remainingProducts = products.slice(1);
  const collageProducts = products.filter(product => product.image_url).slice(0, 3);
  const hasCover = Boolean(collection?.image_url && !coverFailed);

  return (
    <div className={`mural-modal-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={event => event.target === event.currentTarget && requestClose()}>
      <section
        ref={detailRef}
        onScroll={handleCollectionScroll}
        className={`mural-detail mural-collection-detail ${hasCover ? 'has-cover' : 'no-cover'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mural-collection-title"
      >
        <span className="mural-collection-progress" aria-hidden="true" />
        <button ref={closeRef} type="button" className="mural-detail-close" onClick={requestClose} disabled={closing} aria-label="Fechar coleção"><span aria-hidden="true">×</span></button>

        {state.loading && <div className="mural-collection-loading">Carregando coleção…</div>}
        {state.error && <div className="mural-collection-error">{state.error}</div>}

        {collection && (
          <div className="mural-collection-editorial">
            <header className="mural-collection-editorial-hero">
              <div className="mural-collection-editorial-media" aria-hidden="true">
                {hasCover ? (
                  <img
                    className={`mural-collection-cover${coverLoaded ? ' is-loaded' : ''}`}
                    src={collection.image_url}
                    alt=""
                    onLoad={() => setCoverLoaded(true)}
                    onError={() => {
                      setCoverLoaded(false);
                      setCoverFailed(true);
                    }}
                  />
                ) : collageProducts.length ? (
                  <div className={`mural-collection-collage mural-collection-collage-${Math.min(collageProducts.length, 3)}`}>
                    {collageProducts.map((product, index) => (
                      <CollectionProductImage
                        key={product.id}
                        product={product}
                        className={`mural-collection-collage-item item-${index + 1}`}
                        eager={index === 0}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mural-collection-art-fallback">
                    <i /><i /><i />
                    <strong>NISTI</strong>
                  </div>
                )}
              </div>

              <div className="mural-collection-editorial-copy">
                <span className="mural-editorial-badge mural-badge-motion">Coleção</span>
                <h2 id="mural-collection-title">{formatCollectionTitle(collection)}</h2>
                {collection.description && <p>{collection.description}</p>}
                <div className="mural-collection-editorial-meta">
                  <strong>{products.length}</strong>
                  <span>produto{products.length === 1 ? '' : 's'} selecionado{products.length === 1 ? '' : 's'}</span>
                </div>
              </div>
            </header>

            {featuredProduct ? (
              <article
                className="mural-collection-featured-product"
                data-collection-reveal
                style={{ '--collection-item-delay': '45ms', '--collection-item-shift': '0px' }}
              >
                <div className="mural-collection-featured-media">
                  <CollectionProductImage product={featuredProduct} eager />
                  <span>DESTAQUE</span>
                </div>
                <div className="mural-collection-featured-copy">
                  <small>Produto em destaque</small>
                  <strong>{featuredProduct.type}</strong>
                  {featuredProduct.name && <p>{featuredProduct.name}</p>}
                  <ProductMeta product={{ ...featuredProduct, collection: formatCollectionTitle(collection) }} />
                </div>
              </article>
            ) : null}

            {remainingProducts.length ? (
              <section className="mural-collection-selection" aria-label="Produtos da coleção">
                <div className="mural-collection-selection-heading">
                  <span>Seleção</span>
                  <strong>Mais produtos da coleção</strong>
                </div>
                <div className="mural-collection-grid">
                  {remainingProducts.map((product, index) => (
                    <article
                      key={product.id}
                      className="mural-collection-product"
                      data-collection-reveal
                      style={{
                        '--collection-item-delay': `${Math.min(index + 1, 8) * 45}ms`,
                        '--collection-item-shift': index % 2 === 0 ? '-8px' : '8px'
                      }}
                    >
                      <CollectionProductImage product={product} />
                      <div>
                        <strong>{product.type}</strong>
                        {product.name && <small>{product.name}</small>}
                        <span>{product.sku}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {!products.length && <p className="mural-empty-inline">Ainda não há produtos publicados nessa coleção.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

export default function MuralNisti({ onUnreadChange }) {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [collectionSlug, setCollectionSlug] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sessionCache = useRef(muralSessionCache);
  const scrollFrame = useRef(0);
  const shellRef = useRef(null);
  const feedRef = useRef(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;

    const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    reducedMotionRef.current = reduced;
    shell.classList.add('motion-ready');

    if (reduced) {
      shell.classList.add('motion-entered');
      return undefined;
    }

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => shell.classList.add('motion-entered'));
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  const load = async currentTab => {
    setLoading(true);
    setError('');
    try {
      const data = await muralApi(`/api/mural?tab=${encodeURIComponent(currentTab)}&limit=20`);
      const fresh = Array.isArray(data.items) ? data.items : [];
      setItems(fresh);
      setNextCursor(data.next_cursor || null);
      sessionCache.current.set(currentTab, { items: fresh, nextCursor: data.next_cursor || null });
      onUnreadChange?.(Number(data.unread_count || 0));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const cached = sessionCache.current.get(tab);
    if (cached) { setItems(cached.items); setNextCursor(cached.nextCursor); }
    else { setItems([]); setNextCursor(null); }
    setLoading(true);
    setError('');
    muralApi(`/api/mural?tab=${encodeURIComponent(tab)}&limit=20`)
      .then(data => {
        if (!active) return;
        const fresh = Array.isArray(data.items) ? data.items : [];
        setItems(fresh);
        setNextCursor(data.next_cursor || null);
        sessionCache.current.set(tab, { items: fresh, nextCursor: data.next_cursor || null });
        onUnreadChange?.(Number(data.unread_count || 0));
      })
      .catch(loadError => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [tab, onUnreadChange]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const data = await muralApi(`/api/mural?tab=${encodeURIComponent(tab)}&limit=20&cursor=${encodeURIComponent(nextCursor)}`);
      const extra = Array.isArray(data.items) ? data.items : [];
      setItems(previous => {
        const known = new Set(previous.map(item => item.id));
        const merged = [...previous, ...extra.filter(item => !known.has(item.id))];
        sessionCache.current.set(tab, { items: merged, nextCursor: data.next_cursor || null });
        return merged;
      });
      setNextCursor(data.next_cursor || null);
      onUnreadChange?.(Number(data.unread_count || 0));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = async item => {
    const opensCollection = item.kind === 'collection' && item.collection?.slug;
    if (opensCollection) {
      setSelected(null);
      setCollectionSlug(item.collection.slug);
    } else {
      setSelected(item);
    }
    if (item.is_read) return;
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, is_read: true } : entry));
    try {
      const data = await muralApi(`/api/mural/${item.id}/read`, { method: 'POST' });
      onUnreadChange?.(Number(data.unread_count || 0));
      if (!opensCollection) setSelected(current => current?.id === item.id ? { ...current, is_read: true } : current);
    } catch {
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, is_read: false } : entry));
    }
  };

  const handleScroll = event => {
    if (reducedMotionRef.current) return;
    const node = event.currentTarget;
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      const shift = Math.max(-18, Math.min(0, node.scrollTop * -0.055));
      node.style.setProperty('--mural-parallax', `${shift}px`);
      scrollFrame.current = 0;
    });
  };

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  const featured = tab === 'all' ? items.find(item => item.featured) : null;
  const feed = featured ? items.filter(item => item.id !== featured.id) : items;
  const activeTabIndex = Math.max(0, TABS.findIndex(([value]) => value === tab));

  useEffect(() => {
    const shell = shellRef.current;
    const feedNode = feedRef.current;
    if (!shell || !feedNode) return undefined;
    const nodes = [...feedNode.querySelectorAll('[data-mural-reveal]')];
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      nodes.forEach(node => node.classList.add('is-visible'));
      return undefined;
    }
    const root = shell.querySelector('.mural-scroll');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { root, threshold: .16, rootMargin:'0px 0px -4% 0px' });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [tab, feed.length, loading]);

  return (
    <section ref={shellRef} className="mural-shell">
      <div className="mural-scroll" onScroll={handleScroll}>
        <div className="mural-column">
          <header className="mural-title-block mural-intro mural-intro-title">
            <h1>Mural NISTI</h1>
            <p>Novidades, coleções e avisos para operadores</p>
          </header>

          {featured && <Hero item={featured} onOpen={openItem} />}

          <nav
            className="mural-tabs mural-intro mural-intro-tabs"
            aria-label="Filtros do Mural"
            style={{ '--mural-tab-index': activeTabIndex }}
          >
            <span className="mural-tabs-indicator" aria-hidden="true" />
            {TABS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={tab === value ? 'active' : ''}
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => setTab(value)}
              >
                <TabIcon value={value} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {error && (
            <div className="mural-error" role="status">
              <span>Não foi possível atualizar o Mural.</span>
              <button type="button" onClick={() => load(tab)}>Tentar novamente</button>
            </div>
          )}

          {loading && items.length === 0 ? (
            <div className="mural-loading" aria-label="Carregando Mural">
              <div className="mural-skeleton mural-skeleton-hero" />
              {[0, 1, 2].map(index => <div className="mural-skeleton mural-skeleton-card" key={index} />)}
            </div>
          ) : feed.length ? (
            <>
              <div ref={feedRef} className="mural-feed">
                {feed.map((item, index) => <MuralCard key={item.id} item={item} onOpen={openItem} eager={index < 2} index={index} />)}
              </div>
              {nextCursor && <button type="button" className="mural-load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando…' : 'Carregar mais'}</button>}
            </>
          ) : !loading && (
            <div className="mural-empty">Nenhuma novidade por aqui agora.</div>
          )}
        </div>
      </div>

      {selected && (
        <DetailDialog
          item={selected}
          onClose={() => setSelected(null)}
          onOpenCollection={slug => {
            setSelected(null);
            setCollectionSlug(slug);
          }}
        />
      )}
      {collectionSlug && <CollectionDialog slug={collectionSlug} onClose={() => setCollectionSlug('')} />}
    </section>
  );
}
