import React, { useEffect, useRef, useState } from 'react';
import './mural-nisti.css';

const muralSessionCache = new Map();

const TABS = [
  ['all', 'Tudo'],
  ['products', 'Produtos'],
  ['collections', 'Coleções'],
  ['notices', 'Avisos']
];

function userId() {
  try {
    return localStorage.getItem('nisti_shipping_user_id') || 'op_guest';
  } catch {
    return 'op_guest';
  }
}

async function muralApi(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'x-user-id': userId(),
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

function KindIcon({ kind }) {
  const label = kind === 'product' ? 'P' : kind === 'collection' ? 'C' : '!';
  return <span className="mural-kind-icon" aria-hidden="true">{label}</span>;
}

function MuralImage({ item, eager = false, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!item?.image_url || failed) {
    return <div className={`mural-image-placeholder ${className}`}><KindIcon kind={item?.kind} /></div>;
  }
  return (
    <img
      className={className}
      src={item.image_url}
      alt={item.kind === 'product' ? `${item.product?.type || item.title} ${item.product?.sku || ''}`.trim() : item.title}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function ReadBadge({ item }) {
  if (item.is_read) return null;
  return <span className="mural-new-badge">NOVO</span>;
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
  return <span className={`mural-notice-label ${level || 'info'}`}><span aria-hidden="true">!</span>{labels[level] || labels.info}</span>;
}

function Hero({ item, onOpen }) {
  if (!item) return null;
  return (
    <button type="button" className="mural-hero" onClick={() => onOpen(item)}>
      <MuralImage item={item} eager className="mural-hero-image" />
      <span className="mural-hero-shade" aria-hidden="true" />
      <span className="mural-hero-copy">
        <span className="mural-hero-badges">
          <ReadBadge item={item} />
          {item.badge && <span className="mural-editorial-badge">{item.badge}</span>}
        </span>
        <strong>{item.title}</strong>
        {item.subtitle && <span>{item.subtitle}</span>}
        <span className="mural-hero-cta">Ver detalhe <span aria-hidden="true">→</span></span>
      </span>
    </button>
  );
}

export function MuralCard({ item, onOpen, eager = false }) {
  const isNotice = item.kind === 'notice';
  const isProduct = item.kind === 'product';
  return (
    <button
      type="button"
      className={`mural-card mural-card-${item.kind}${!item.is_read ? ' unread' : ''}`}
      onClick={() => onOpen(item)}
    >
      {!isNotice && <MuralImage item={item} eager={eager} className="mural-card-image" />}
      {isNotice && <div className={`mural-notice-icon ${item.notice_level || 'info'}`}><span aria-hidden="true">!</span></div>}
      <span className="mural-card-content">
        <span className="mural-card-badges">
          <ReadBadge item={item} />
          {isNotice ? <NoticeLabel level={item.notice_level} /> : item.badge && <span className="mural-editorial-badge">{item.badge}</span>}
        </span>
        <span className="mural-card-title-row">
          <strong>{isProduct ? item.product?.type || item.title : item.title}</strong>
          {item.kind === 'collection' && item.collection?.year && <small>{item.collection.year}</small>}
        </span>
        {isProduct && item.title !== item.product?.type && <span className="mural-card-product-name">{item.title}</span>}
        {!isProduct && item.subtitle && <span className="mural-card-subtitle">{item.subtitle}</span>}
        {item.body && <span className="mural-card-summary">{item.body}</span>}
        {isProduct && <ProductMeta product={item.product} />}
        {item.kind === 'collection' && <span className="mural-card-cta">Ver coleção →</span>}
        {isNotice && <span className="mural-card-date">{formatDate(item.published_at)}</span>}
      </span>
    </button>
  );
}

function DetailDialog({ item, onClose, onOpenCollection }) {
  const closeRef = useRef(null);
  const hasMedia = Boolean(item?.image_url);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mural-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={`mural-detail${hasMedia ? '' : ' no-media'}`} role="dialog" aria-modal="true" aria-labelledby="mural-detail-title">
        <button ref={closeRef} type="button" className="mural-detail-close" onClick={onClose} aria-label="Fechar detalhe"><span aria-hidden="true">×</span></button>
        {hasMedia && <MuralImage item={item} eager className={`mural-detail-image mural-detail-image-${item.kind}`} />}
        <div className={`mural-detail-body${hasMedia ? '' : ' no-media'}`}>
          <div className="mural-card-badges">
            <ReadBadge item={item} />
            {item.kind === 'notice' ? <NoticeLabel level={item.notice_level} /> : item.badge && <span className="mural-editorial-badge">{item.badge}</span>}
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
      </section>
    </div>
  );
}

function CollectionDialog({ slug, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const closeRef = useRef(null);

  useEffect(() => {
    let active = true;
    muralApi(`/api/mural/collections/${encodeURIComponent(slug)}`)
      .then(data => active && setState({ loading: false, data: data.collection, error: '' }))
      .catch(error => active && setState({ loading: false, data: null, error: error.message }));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const collection = state.data;
  return (
    <div className="mural-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="mural-detail mural-collection-detail" role="dialog" aria-modal="true" aria-labelledby="mural-collection-title">
        <button ref={closeRef} type="button" className="mural-detail-close" onClick={onClose} aria-label="Fechar coleção"><span aria-hidden="true">×</span></button>
        {state.loading && <div className="mural-collection-loading">Carregando coleção…</div>}
        {state.error && <div className="mural-collection-error">{state.error}</div>}
        {collection && (
          <>
            {collection.image_url && <img className="mural-detail-image" src={collection.image_url} alt={collection.name} />}
            <div className="mural-detail-body">
              <span className="mural-editorial-badge">Coleção</span>
              <h2 id="mural-collection-title">{formatCollectionTitle(collection)}</h2>
              {collection.description && <p className="mural-detail-copy">{collection.description}</p>}
              <p className="mural-collection-count">{collection.products?.length || 0} produto{collection.products?.length === 1 ? '' : 's'}</p>
              {collection.products?.length ? (
                <div className="mural-collection-grid">
                  {collection.products.map(product => (
                    <article key={product.id} className="mural-collection-product">
                      {product.image_url ? <img src={product.image_url} alt={`${product.type} ${product.sku}`} loading="lazy" /> : <div className="mural-image-placeholder"><KindIcon kind="product" /></div>}
                      <div><strong>{product.type}</strong><span>{product.sku}</span></div>
                    </article>
                  ))}
                </div>
              ) : <p className="mural-empty-inline">Ainda não há produtos publicados nessa coleção.</p>}
            </div>
          </>
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
    setSelected(item);
    if (item.is_read) return;
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, is_read: true } : entry));
    try {
      const data = await muralApi(`/api/mural/${item.id}/read`, { method: 'POST' });
      onUnreadChange?.(Number(data.unread_count || 0));
      setSelected(current => current?.id === item.id ? { ...current, is_read: true } : current);
    } catch {
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, is_read: false } : entry));
    }
  };

  const featured = tab === 'all' ? items.find(item => item.featured) : null;
  const feed = featured ? items.filter(item => item.id !== featured.id) : items;

  return (
    <section className="mural-shell">
      <div className="mural-scroll">
        <div className="mural-column">
          <header className="mural-title-block">
            <h1>Mural NISTI</h1>
            <p>Novidades, coleções e avisos para operadores</p>
          </header>

          {featured && <Hero item={featured} onOpen={openItem} />}

          <nav className="mural-tabs" aria-label="Filtros do Mural">
            {TABS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={tab === value ? 'active' : ''}
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => setTab(value)}
              >
                {label}
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
              <div className="mural-feed">
                {feed.map((item, index) => <MuralCard key={item.id} item={item} onOpen={openItem} eager={index < 2} />)}
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
