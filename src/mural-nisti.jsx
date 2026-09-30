import React, { useEffect, useRef, useState } from 'react';
import './mural-nisti.css';
import MuralProductExperience from './mural-product-experience.jsx';
import { useTransparentProductImage } from './mural-transparent-image.js';

const muralSessionCache = new Map();

const TABS = [
  ['all', 'Tudo'],
  ['products', 'Produtos'],
  ['collections', 'Coleções'],
  ['notices', 'Avisos']
];

function MuralIcon({ name, size = 18, className = '' }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true
  };

  if (name === 'package') return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9" /></svg>;
  if (name === 'layers') return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></svg>;
  if (name === 'megaphone') return <svg {...common}><path d="M4 13V9l12-5v14L4 13Z" /><path d="M16 8h2.5A2.5 2.5 0 0 1 21 10.5v1A2.5 2.5 0 0 1 18.5 14H16M6 13l1.5 6h4L10 14" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 5 7 7-7 7" /></svg>;
  if (name === 'star') return <svg {...common}><path d="m12 3 2.4 5.2L20 9l-4 4 1 5.7-5-2.7-5 2.7L8 13 4 9l5.6-.8L12 3Z" /></svg>;
  return <svg {...common}><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></svg>;
}

function TabIcon({ value }) {
  const names = { all: 'sparkles', products: 'package', collections: 'layers', notices: 'megaphone' };
  return <span className={`mural-tab-icon mural-tab-icon-${value}`}><MuralIcon name={names[value] || 'sparkles'} size={17} /></span>;
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

function formatRelativeDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return 'Hoje';
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const days = Math.floor(diffMs / 86400000);
  if (days === 1) return 'há 1 dia';
  if (days > 1 && days < 7) return `há ${days} dias`;
  return formatDate(value);
}

function formatCollectionTitle(collection) {
  if (!collection) return '';
  const name = String(collection.name || '').trim();
  const year = String(collection.year || '').trim();
  if (!year || name.endsWith(year)) return name;
  return `${name} ${year}`.trim();
}

function KindIcon({ kind }) {
  const name = kind === 'product' ? 'package' : kind === 'collection' ? 'layers' : 'megaphone';
  return <span className="mural-kind-icon" aria-hidden="true"><MuralIcon name={name} size={24} /></span>;
}

function MuralImage({ item, eager = false, className = '' }) {
  const src = item?.image_url || '';
  const shouldRemoveBackground = item?.kind === 'product' && item?.image_source === 'product';
  const displaySrc = useTransparentProductImage(src, shouldRemoveBackground);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [displaySrc]);

  if (!displaySrc || failed) {
    return <div className={`mural-image-placeholder ${className}`}><KindIcon kind={item?.kind} /></div>;
  }
  return (
    <img
      className={`${className} mural-image-media${shouldRemoveBackground ? ' mural-product-transparent' : ''}${loaded ? ' is-loaded' : ''}`.trim()}
      src={displaySrc}
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
  const displaySrc = useTransparentProductImage(src, true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [displaySrc]);

  if (!displaySrc || failed) {
    return <div className={`mural-image-placeholder ${className}`.trim()}><KindIcon kind="product" /></div>;
  }

  return (
    <img
      className={`${className} mural-product-transparent`.trim()}
      src={displaySrc}
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

function CollectionFinishChips({ product }) {
  if (!product) return null;
  const chips = [
    ['Wire-o', product.wireo],
    ['Tassel', product.tassel],
    ['Elástico', product.elastico]
  ].filter(([, value]) => value);
  if (!chips.length) return null;
  return (
    <span className="mural-collection-finish-chips">
      {chips.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}
    </span>
  );
}

function NoticeLabel({ level }) {
  const labels = { important: 'Importante', attention: 'Atenção', info: 'Informação' };
  return <span className={`mural-notice-label mural-badge-motion ${level || 'info'}`}><MuralIcon name="megaphone" size={12} />{labels[level] || labels.info}</span>;
}

function HeroScene({ item, collectionPreviews }) {
  const hasEditorialScene = item.image_source === 'post' && item.image_url;
  if (hasEditorialScene) {
    return (
      <span className="mural-hero-scene mural-hero-scene-photo">
        <MuralImage item={item} eager className="mural-hero-scene-image" />
      </span>
    );
  }

  const previewProducts = collectionPreviews.slice(0, 3);
  return (
    <span className="mural-hero-scene mural-hero-scene-composed" aria-hidden="true">
      <span className="mural-scene-wall" />
      <span className="mural-scene-surface" />
      <span className="mural-scene-books"><i /><i /><i /></span>
      <span className="mural-scene-plant"><i /><b /><b /><b /></span>
      <span className="mural-scene-pen" />
      {previewProducts.length ? (
        <span className="mural-scene-products">
          {previewProducts.map((product, index) => (
            <span className={`mural-scene-product product-${index + 1}`} key={product.id}>
              <CollectionProductImage product={product} eager={index === 0} />
            </span>
          ))}
        </span>
      ) : (
        <span className="mural-scene-single-product">
          <MuralImage item={item} eager className="mural-scene-single-image" />
        </span>
      )}
    </span>
  );
}

function CollectionLaunchHero({ item, onOpen }) {
  const previews = item.collection?.preview_products || [];
  const hasBanner = Boolean(item.image_url);
  const title = formatCollectionTitle(item.collection) || item.title;
  const supporting = item.collection?.description || item.subtitle || item.body || 'Uma nova coleção chegou ao Mural NISTI.';

  return (
    <button
      type="button"
      className={`mural-launch-hero mural-hero-enter${hasBanner ? ' has-banner' : ' is-composed'}`}
      onClick={() => onOpen(item)}
      aria-label={`Abrir coleção ${title}`}
    >
      {hasBanner ? (
        <>
          <MuralImage item={item} eager className="mural-launch-hero-banner" />
          <span className="mural-launch-banner-shade" aria-hidden="true" />
          <span className="mural-launch-system-badge">NOVA COLEÇÃO</span>
          <span className="mural-launch-banner-arrow" aria-hidden="true"><MuralIcon name="chevron" size={22} /></span>
        </>
      ) : (
        <>
          <span className="mural-launch-copy">
            <span className="mural-launch-system-badge">NOVA COLEÇÃO</span>
            <strong>{title}</strong>
            <span>{supporting}</span>
            <em>Lançamento <MuralIcon name="chevron" size={15} /></em>
          </span>
          <span className="mural-launch-products" aria-hidden="true">
            {previews.slice(0, 4).map((product, index) => (
              <span className={`mural-launch-product product-${index + 1}`} key={product.id}>
                <CollectionProductImage product={product} eager={index < 2} />
              </span>
            ))}
          </span>
        </>
      )}
    </button>
  );
}

function Hero({ item, onOpen }) {
  if (!item) return null;
  const isCollection = item.kind === 'collection';
  if (isCollection) return <CollectionLaunchHero item={item} onOpen={onOpen} />;

  const collectionPreviews = [];
  return (
    <button
      type="button"
      className="mural-hero mural-hero-enter mural-hero-editorial"
      onClick={() => onOpen(item)}
    >
      <HeroScene item={item} collectionPreviews={collectionPreviews} />
      <span className="mural-hero-shade" aria-hidden="true" />
      <span className="mural-hero-featured-badge"><MuralIcon name="star" size={13} /> DESTAQUE</span>
      {!item.is_read && <span className="mural-hero-new-badge">NOVO</span>}
      <span className="mural-hero-copy">
        {item.badge && item.badge !== 'NOVO' && <span className="mural-hero-eyebrow">{item.badge}</span>}
        <strong>{item.title}</strong>
        {item.subtitle && <span className="mural-hero-subtitle">{item.subtitle}</span>}
        {item.body && <span className="mural-hero-body">{item.body}</span>}
        <span className="mural-hero-cta">Ver detalhe <MuralIcon name="chevron" size={15} /></span>
      </span>
    </button>
  );
}

function CollectionLaunchCard({ item, onOpen, eager = false, index = 0 }) {
  const previews = item.collection?.preview_products || [];
  const title = formatCollectionTitle(item.collection) || item.title;
  const supporting = item.collection?.description || item.subtitle || item.body || 'Conheça os produtos desta nova coleção.';
  const tone = Number(item.collection?.id || item.id || index) % 4;
  const revealStyle = { '--mural-card-delay': `${Math.min(index, 8) * 45}ms` };

  return (
    <button
      type="button"
      className={`mural-collection-launch-card mural-collection-tone-${tone} mural-reveal`}
      style={revealStyle}
      data-mural-reveal
      onClick={() => onOpen(item)}
      aria-label={`Abrir coleção ${title}`}
    >
      <span className="mural-collection-launch-copy">
        <strong>{title}</strong>
        <span>{supporting}</span>
        <em>NOVA COLEÇÃO</em>
      </span>
      <span className="mural-collection-launch-products" aria-hidden="true">
        {previews.length ? previews.slice(0, 3).map((product, productIndex) => (
          <span className={`mural-collection-launch-product product-${productIndex + 1}`} key={product.id}>
            <CollectionProductImage product={product} eager={eager && productIndex === 0} />
          </span>
        )) : (
          <MuralImage item={item} eager={eager} className="mural-collection-launch-fallback" />
        )}
      </span>
      <span className="mural-collection-launch-arrow" aria-hidden="true"><MuralIcon name="chevron" size={22} /></span>
    </button>
  );
}

export function MuralCard({ item, onOpen, eager = false, index = 0 }) {
  const isNotice = item.kind === 'notice';
  const isProduct = item.kind === 'product';
  const isCollection = item.kind === 'collection';
  if (isCollection) return <CollectionLaunchCard item={item} onOpen={onOpen} eager={eager} index={index} />;
  const revealStyle = { '--mural-card-delay': `${Math.min(index, 8) * 45}ms` };
  const relativeDate = formatRelativeDate(item.published_at);

  return (
    <button
      type="button"
      className={`mural-card mural-card-${item.kind} mural-card-reference mural-reveal${!item.is_read ? ' unread' : ''}`}
      style={revealStyle}
      data-mural-reveal
      onClick={() => onOpen(item)}
    >
      {isNotice ? (
        <span className={`mural-card-media mural-notice-visual ${item.notice_level || 'info'}`}><MuralIcon name="megaphone" size={40} /></span>
      ) : (
        <span className="mural-card-media"><MuralImage item={item} eager={eager} className="mural-card-image" /></span>
      )}

      <span className="mural-card-content">
        <span className="mural-card-topline">
          <span className="mural-card-badges">
            {!item.is_read && <span className="mural-card-new-pill">NOVO</span>}
            {isNotice && <span className="mural-card-notice-pill"><i />AVISO</span>}
          </span>
          {relativeDate && <span className="mural-card-relative-date">{relativeDate}</span>}
        </span>

        <span className="mural-card-title-row">
          <strong>{isProduct ? item.product?.type || item.title : item.title}</strong>
        </span>

        {isProduct && item.title !== item.product?.type && <span className="mural-card-product-name">{item.title}</span>}
        {isNotice && item.subtitle && <span className="mural-card-subtitle">{item.subtitle}</span>}
        {isNotice && item.body && <span className="mural-card-summary">{item.body}</span>}

        {isProduct && (
          <span className="mural-card-reference-meta">
            <MuralIcon name="layers" size={14} />
            <span>{item.product?.wireo ? `Wire-o ${item.product.wireo}` : item.product?.collection || 'Produto NISTI'}</span>
            {item.product?.elastico && <><i>•</i><span>Elástico {item.product.elastico}</span></>}
          </span>
        )}

      </span>

      <span className="mural-card-arrow" aria-hidden="true"><MuralIcon name="chevron" size={21} /></span>
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

function collectionRevealPosition(index) {
  const lane = Math.ceil(index / 2);
  const side = index % 2 ? -1 : 1;
  const spread = 58 + ((lane - 1) % 4) * 28;
  const depth = Math.floor((lane - 1) / 4);
  return {
    side: side < 0 ? 'left' : 'right',
    x: `${side * spread}px`,
    y: `${Math.min(22, lane * 4 + depth * 3)}%`,
    rotation: `${side * Math.min(22, 8 + lane * 3)}deg`,
    scale: String(Math.max(.68, .96 - lane * .055))
  };
}

function CollectionRevealIntro({ products, title, onComplete }) {
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const secondaryCount = Math.max(0, products.length - 1);
  const lastCoverFinish = secondaryCount
    ? 700 + (secondaryCount - 1) * 720 + 1100
    : 2100;
  const mainFloatCycles = Math.max(1, Math.ceil((lastCoverFinish + 650 - 1020) / 1800));

  useEffect(() => {
    const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reduced) {
      onComplete();
      return undefined;
    }

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setReady(true));
    });
    const leaveTimer = window.setTimeout(() => setLeaving(true), lastCoverFinish + 650);
    const completeTimer = window.setTimeout(onComplete, lastCoverFinish + 990);

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(completeTimer);
    };
  }, [lastCoverFinish, onComplete]);

  const mainProduct = products[0];
  const secondaryProducts = products.slice(1);

  return (
    <div
      className={`mural-collection-reveal-intro${ready ? ' is-ready' : ''}${leaving ? ' is-leaving' : ''}`}
      role="img"
      aria-label={`Apresentação dos produtos da coleção ${title}`}
    >
      <span className="mural-collection-reveal-vignette" aria-hidden="true" />
      <span className="mural-collection-reveal-white-arc" aria-hidden="true" />
      <div className="mural-collection-reveal-fan" aria-hidden="true">
        <span
          className="mural-collection-reveal-product is-main"
          style={{ '--main-float-cycles': String(mainFloatCycles) }}
        >
          <CollectionProductImage product={mainProduct} eager />
        </span>
        {secondaryProducts.map((product, secondaryIndex) => {
          const index = secondaryIndex + 1;
          const position = collectionRevealPosition(index);
          return (
          <span
            key={product.id}
            className={`mural-collection-reveal-product is-secondary from-${position.side}`}
            style={{
              '--reveal-product-delay': `${700 + secondaryIndex * 720}ms`,
              '--reveal-final-x': position.x,
              '--reveal-final-y': position.y,
              '--reveal-final-rotation': position.rotation,
              '--reveal-final-scale': position.scale,
              zIndex: 10 + index
            }}
          >
            <CollectionProductImage product={product} eager />
          </span>
          );
        })}
      </div>
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
  const [introComplete, setIntroComplete] = useState(false);
  const { closing, requestClose } = useAnimatedDialogClose(onClose);

  useEffect(() => {
    let active = true;
    setCoverFailed(false);
    setCoverLoaded(false);
    setIntroComplete(false);
    muralApi(`/api/mural/collections/${encodeURIComponent(slug)}`)
      .then(data => active && setState({ loading: false, data: data.collection, error: '' }))
      .catch(error => active && setState({ loading: false, data: null, error: error.message }));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    const onKey = event => event.key === 'Escape' && requestClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  useEffect(() => {
    if (introComplete || (state.data && !state.data.products?.length)) closeRef.current?.focus();
  }, [introComplete, state.data]);

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
  const showIntro = Boolean(collection && products.length && !introComplete);

  return (
    <div className={`mural-modal-backdrop mural-collection-modal-backdrop${showIntro ? ' is-intro' : ''}${closing ? ' is-closing' : ''}`} onMouseDown={event => event.target === event.currentTarget && requestClose()}>
      {showIntro && (
        <CollectionRevealIntro
          products={products}
          title={formatCollectionTitle(collection)}
          onComplete={() => setIntroComplete(true)}
        />
      )}

      {!showIntro && (
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
                <span className="mural-editorial-badge mural-badge-motion">NOVA COLEÇÃO</span>
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
                        {product.name && <small className="mural-collection-cover-name">Capa · {product.name}</small>}
                        <span>{product.sku}</span>
                        <CollectionFinishChips product={product} />
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
      )}
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
    let firstLoad = true;
    const cached = sessionCache.current.get(tab);
    if (cached) { setItems(cached.items); setNextCursor(cached.nextCursor); }
    else { setItems([]); setNextCursor(null); }
    setLoading(true);
    setError('');

    const refresh = async ({ quiet = false } = {}) => {
      try {
        const data = await muralApi(`/api/mural?tab=${encodeURIComponent(tab)}&limit=20`);
        if (!active) return;
        const fresh = Array.isArray(data.items) ? data.items : [];
        setItems(fresh);
        setNextCursor(data.next_cursor || null);
        sessionCache.current.set(tab, { items: fresh, nextCursor: data.next_cursor || null });
        onUnreadChange?.(Number(data.unread_count || 0));
        if (!quiet) setError('');
      } catch (loadError) {
        if (active && !quiet) setError(loadError.message);
      } finally {
        if (active && firstLoad) {
          firstLoad = false;
          setLoading(false);
        }
      }
    };

    refresh();
    const isQa = (() => {
      try { return new URLSearchParams(window.location.search).get('mural') === 'qa'; }
      catch { return false; }
    })();
    const interval = window.setInterval(() => refresh({ quiet:true }), isQa ? 5000 : 30000);
    const handleFocus = () => refresh({ quiet:true });
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh({ quiet:true });
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
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

  const featured = items.find(item => item.featured) || null;
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
            <span className="mural-title-sparkles" aria-hidden="true">
              <i className="star-1">✦</i>
              <i className="star-2">✦</i>
              <i className="star-3">✦</i>
            </span>
            <span className="mural-title-copy">
              <h1>Mural NISTI</h1>
              <p>Novidades, coleções e avisos para operadores</p>
            </span>
            <span className="mural-title-accent" aria-hidden="true">
              <svg className="mural-reference-drop drop-cyan" viewBox="0 0 32 70" focusable="false"><path d="M16 1C25.4 1 30 9 27.5 20.5C24.8 33.7 18.4 50.1 14.9 67.8C14.5 69.7 12.1 69.7 11.7 67.8C8.3 50.3 1.9 34.1 2.2 20.8C2.5 9.1 7.1 1 16 1Z" /></svg>
              <svg className="mural-reference-drop drop-pink" viewBox="0 0 32 70" focusable="false"><path d="M16 1C25.4 1 30 9 27.5 20.5C24.8 33.7 18.4 50.1 14.9 67.8C14.5 69.7 12.1 69.7 11.7 67.8C8.3 50.3 1.9 34.1 2.2 20.8C2.5 9.1 7.1 1 16 1Z" /></svg>
              <svg className="mural-reference-drop drop-yellow" viewBox="0 0 32 70" focusable="false"><path d="M16 1C25.4 1 30 9 27.5 20.5C24.8 33.7 18.4 50.1 14.9 67.8C14.5 69.7 12.1 69.7 11.7 67.8C8.3 50.3 1.9 34.1 2.2 20.8C2.5 9.1 7.1 1 16 1Z" /></svg>
            </span>
          </header>

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

          {featured && <Hero item={featured} onOpen={openItem} />}

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
