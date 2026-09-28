import React, { useEffect, useMemo, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import { commerceFormatNumber } from './commerce-admin-shared.jsx';
import './commerce-catalog-workspace.css';

const STATUS_OPTIONS = [
  ['ACTIVE', 'Ativo'],
  ['PAUSED', 'Pausado'],
  ['INACTIVE', 'Inativo'],
  ['REMOVED', 'Removido'],
  ['UNKNOWN', 'Não verificado']
];

const BULK_FIELDS = [
  ['LISTING_STATUS', 'Status do anúncio'],
  ['TITLE', 'Título'],
  ['PRICE', 'Preço'],
  ['OBSERVED_YEAR', 'Ano'],
  ['IMAGE_URL', 'Imagem principal'],
  ['TITLE_ADD', 'Adicionar texto ao título'],
  ['TITLE_REMOVE', 'Remover texto do título'],
  ['CATEGORY', 'Categoria'],
  ['NOTE', 'Observação']
];

function Icon({ name, size = 17 }) {
  const common = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
  if (name === 'edit') return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
  if (name === 'image') return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
  if (name === 'sync') return <svg {...common}><path d="M20 7h-5V2" /><path d="M20 2 16.5 5.5A8 8 0 1 0 21 12" /></svg>;
  if (name === 'external') return <svg {...common}><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>;
  return <svg {...common}><path d="M12 3v18M3 12h18" /></svg>;
}

function statusLabel(value) {
  const code = String(value || 'UNKNOWN').toUpperCase();
  return STATUS_OPTIONS.find(([id]) => id === code)?.[1] || code;
}

function MarketplaceMark({ code, label }) {
  const token = String(code || '').toUpperCase();
  let text = String(label || code || '?').slice(0, 2).toUpperCase();
  let className = 'commerce-marketplace-mark';
  if (token.includes('SHOPEE')) {
    text = 'S';
    className += ' shopee';
  } else if (token.includes('AMAZON')) {
    text = 'a';
    className += ' amazon';
  } else if (token.includes('ML')) {
    text = 'ML';
    className += ' mercado-livre';
  } else if (token.includes('SHEIN')) {
    text = 'SH';
    className += ' shein';
  }
  return <span className={className} title={label || code}>{text}</span>;
}

function ProductImage({ src, alt, className = '' }) {
  const [active, setActive] = useState(src || null);
  useEffect(() => setActive(src || null), [src]);
  if (!active) return <div className={'commerce-catalog-image placeholder ' + className}>Sem foto</div>;
  return (
    <img
      className={'commerce-catalog-image ' + className}
      src={active}
      alt={alt || ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setActive(null)}
    />
  );
}

function collectListings(card) {
  const map = new Map();
  for (const platform of Array.isArray(card?.platforms) ? card.platforms : []) {
    for (const item of Array.isArray(platform?.items) ? platform.items : []) {
      const listingId = Number(item?.listing_id || 0);
      const key = listingId > 0 ? 'listing:' + listingId : 'row:' + String(item?.source_row_id || Math.random());
      const existing = map.get(key);
      if (existing) {
        if (item?.sku && !existing.skus.includes(item.sku)) existing.skus.push(item.sku);
        continue;
      }
      map.set(key, {
        ...item,
        listing_id: listingId > 0 ? listingId : null,
        platform_code: platform.source_code,
        platform_label: platform.label,
        skus: item?.sku ? [item.sku] : []
      });
    }
  }
  return [...map.values()];
}

function ListingEditModal({ target, onClose, onSaved }) {
  const listingId = Number(target?.listing_id || 0);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    title: '',
    listing_status: 'UNKNOWN',
    observed_year: '',
    image_url: '',
    price: '',
    category: '',
    note: ''
  });
  const [loading, setLoading] = useState(Boolean(listingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    commerceApi('/api/admin/commerce/listings/' + listingId + '/editor')
      .then(result => {
        if (cancelled) return;
        setDetail(result || {});
        setForm({
          title: result?.title || target?.listing_title || target?.product_name || '',
          listing_status: result?.listing_status || target?.listing_status || 'UNKNOWN',
          observed_year: result?.observed_year || target?.edition_year || '',
          image_url: result?.image_url || target?.image_url || '',
          price: result?.price || target?.price || '',
          category: result?.category || target?.listing_category || '',
          note: result?.note || target?.listing_note || ''
        });
      })
      .catch(err => !cancelled && setError(err.message || 'Não foi possível abrir o anúncio.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [listingId]);

  if (!target) return null;

  async function save() {
    if (!listingId) return;
    setSaving(true);
    setError('');
    try {
      await commerceApi('/api/admin/commerce/listings/' + listingId + '/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: form })
      });
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar o anúncio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="commerce-editor-backdrop" onClick={onClose}>
      <section className="commerce-editor-modal" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <span>Editar anúncio individual</span>
            <h3>{detail?.marketplace_name || target.platform_label || 'Plataforma'}</h3>
            <small>{target.skus?.join(' · ') || target.sku || 'SKU não informado'}</small>
          </div>
          <button type="button" className="commerce-icon-button" onClick={onClose}>×</button>
        </header>

        {loading ? <div className="commerce-editor-loading">Carregando anúncio…</div> : (
          <div className="commerce-editor-form">
            {error ? <div className="commerce-editor-error">{error}</div> : null}
            <label className="wide">
              <span>Título</span>
              <textarea value={form.title} rows={3} onChange={event => setForm(v => ({ ...v, title: event.target.value }))} />
            </label>
            <label>
              <span>Status do anúncio</span>
              <select value={form.listing_status} onChange={event => setForm(v => ({ ...v, listing_status: event.target.value }))}>
                {STATUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Ano</span>
              <input type="number" min="2000" max="2100" value={form.observed_year} onChange={event => setForm(v => ({ ...v, observed_year: event.target.value }))} />
            </label>
            <label>
              <span>Preço</span>
              <input value={form.price} onChange={event => setForm(v => ({ ...v, price: event.target.value }))} placeholder="Ex.: 89,90" />
            </label>
            <label>
              <span>Categoria</span>
              <input value={form.category} onChange={event => setForm(v => ({ ...v, category: event.target.value }))} placeholder="Categoria na plataforma" />
            </label>
            <label className="wide">
              <span>Imagem principal</span>
              <input value={form.image_url} onChange={event => setForm(v => ({ ...v, image_url: event.target.value }))} placeholder="https://..." />
              {form.image_url ? <ProductImage src={form.image_url} alt={form.title} className="commerce-editor-image-preview" /> : null}
            </label>
            <label className="wide">
              <span>Observação</span>
              <textarea value={form.note} rows={3} onChange={event => setForm(v => ({ ...v, note: event.target.value }))} />
            </label>
          </div>
        )}

        <footer>
          <div>
            <strong>Alteração local</strong>
            <span>A edição fica registrada no histórico. O envio à plataforma é feito pela ação Sincronizar.</span>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" onClick={save} disabled={loading || saving || !listingId}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function BulkEditModal({ cards, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [action, setAction] = useState('LISTING_STATUS');
  const [value, setValue] = useState('ACTIVE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const listings = useMemo(() => {
    const map = new Map();
    for (const card of cards || []) {
      for (const listing of collectListings(card)) {
        if (listing.listing_id) map.set(listing.listing_id, listing);
      }
    }
    return [...map.values()];
  }, [cards]);

  const platforms = [...new Set(listings.map(row => row.platform_label).filter(Boolean))];

  useEffect(() => {
    if (action === 'LISTING_STATUS') setValue('ACTIVE');
    else setValue('');
  }, [action]);

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      await commerceApi('/api/admin/commerce/listings/bulk-edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          listing_ids: listings.map(row => row.listing_id),
          action,
          value
        })
      });
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível concluir a edição em massa.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="commerce-editor-backdrop" onClick={onClose}>
      <section className="commerce-bulk-modal" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h3>Editar anúncios em massa</h3>
            <p>{cards.length} produto(s) selecionado(s) · {listings.length} anúncio(s)</p>
          </div>
          <button type="button" className="commerce-icon-button" onClick={onClose}>×</button>
        </header>

        <div className="commerce-bulk-steps">
          <span className={step >= 1 ? 'active' : ''}><b>1</b> Selecionar campo</span>
          <span className={step >= 2 ? 'active' : ''}><b>2</b> Configurar alteração</span>
          <span className={step >= 3 ? 'active' : ''}><b>3</b> Revisar e confirmar</span>
        </div>

        {error ? <div className="commerce-editor-error">{error}</div> : null}

        {step === 1 ? (
          <div className="commerce-bulk-field-grid">
            {BULK_FIELDS.map(([code, label]) => (
              <button type="button" key={code} className={action === code ? 'active' : ''} onClick={() => setAction(code)}>
                <span className="commerce-bulk-radio" />
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="commerce-bulk-config">
            <h4>{BULK_FIELDS.find(([code]) => code === action)?.[1]}</h4>
            {action === 'LISTING_STATUS' ? (
              <div className="commerce-status-choice">
                {STATUS_OPTIONS.slice(0, 4).map(([code, label]) => (
                  <label key={code}>
                    <input type="radio" name="bulk-status" value={code} checked={value === code} onChange={() => setValue(code)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            ) : action === 'OBSERVED_YEAR' ? (
              <input type="number" min="2000" max="2100" value={value} onChange={event => setValue(event.target.value)} placeholder="Ex.: 2027" />
            ) : action === 'NOTE' ? (
              <textarea rows={5} value={value} onChange={event => setValue(event.target.value)} placeholder="Observação para os anúncios selecionados" />
            ) : (
              <input value={value} onChange={event => setValue(event.target.value)} placeholder="Novo valor" />
            )}
            <small>A alteração será aplicada somente aos anúncios com ID reconhecido no catálogo.</small>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="commerce-bulk-review">
            <h4>Confirmar alteração em massa</h4>
            <p>Revise antes de aplicar.</p>
            <dl>
              <div><dt>Campo</dt><dd>{BULK_FIELDS.find(([code]) => code === action)?.[1]}</dd></div>
              <div><dt>Novo valor</dt><dd>{action === 'LISTING_STATUS' ? statusLabel(value) : (value || 'Limpar valor')}</dd></div>
              <div><dt>Produtos selecionados</dt><dd>{cards.length}</dd></div>
              <div><dt>Anúncios alterados</dt><dd>{listings.length}</dd></div>
              <div><dt>Plataformas</dt><dd>{platforms.join(', ') || '—'}</dd></div>
            </dl>
            <div className="commerce-bulk-audit-note"><Icon name="clock" /> Essa ação será registrada no histórico de cada anúncio.</div>
          </div>
        ) : null}

        <footer>
          <button type="button" className="secondary" onClick={step === 1 ? onClose : () => setStep(step - 1)} disabled={saving}>
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          {step < 3 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={step === 2 && action !== 'LISTING_STATUS' && value.trim() === ''}>
              Próximo
            </button>
          ) : (
            <button type="button" onClick={confirm} disabled={saving || !listings.length}>
              {saving ? 'Aplicando…' : 'Confirmar alteração'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function ProductDrawer({ card, onClose, onEdit, onReload, onMessage }) {
  const [tab, setTab] = useState('listings');
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [historyDetail, setHistoryDetail] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const listings = useMemo(() => collectListings(card), [card]);

  useEffect(() => {
    setSelectedListingId(listings.find(row => row.listing_id)?.listing_id || null);
    setHistoryDetail(null);
    setTab('listings');
  }, [card?.card_key]);

  const selectedListing = listings.find(row => row.listing_id === selectedListingId) || listings[0] || null;

  async function queueSync(listing) {
    if (!listing?.listing_id) return;
    try {
      await commerceApi('/api/admin/commerce/listings/' + listing.listing_id + '/sync', { method: 'POST' });
      onMessage('Anúncio colocado na fila de sincronização.');
      await onReload?.();
    } catch (err) {
      onMessage(err.message || 'Não foi possível preparar a sincronização.', true);
    }
  }

  async function loadHistory() {
    if (!selectedListing?.listing_id) {
      setHistoryDetail(null);
      return;
    }
    setHistoryLoading(true);
    try {
      setHistoryDetail(await commerceApi('/api/admin/commerce/listings/' + selectedListing.listing_id + '/editor'));
    } catch {
      setHistoryDetail(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, selectedListingId]);

  if (!card) return null;

  return (
    <div className="commerce-product-drawer-backdrop" onClick={onClose}>
      <aside className="commerce-product-drawer" onClick={event => event.stopPropagation()}>
        <header className="commerce-product-drawer-header">
          <ProductImage src={card.image_url} alt={card.product_name} className="commerce-product-drawer-cover" />
          <div>
            <div className="commerce-product-master-line">
              <strong>{card.master_sku || 'Sem SKU'}</strong>
              <span>Produto Mestre</span>
            </div>
            <h2>{card.product_name || 'Produto sem nome'}</h2>
            <p>Ano: {card.edition_year || '—'}</p>
            <p>Categoria: {card.category_name || '—'}</p>
          </div>
          <button type="button" className="commerce-icon-button" onClick={onClose}>×</button>
        </header>

        <nav className="commerce-product-tabs">
          <button type="button" className={tab === 'images' ? 'active' : ''} onClick={() => setTab('images')}>Imagens</button>
          <button type="button" className={tab === 'listings' ? 'active' : ''} onClick={() => setTab('listings')}>Anúncios ({listings.length})</button>
          <button type="button" className={tab === 'product' ? 'active' : ''} onClick={() => setTab('product')}>Dados do produto</button>
          <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Histórico</button>
        </nav>

        {tab === 'images' ? (
          <section className="commerce-product-images-panel">
            <ProductImage src={card.image_url} alt={card.product_name} className="commerce-product-main-image" />
            <div>
              <strong>Imagem principal do Produto Mestre</strong>
              <p>As imagens específicas de cada plataforma aparecem na aba Anúncios.</p>
            </div>
          </section>
        ) : null}

        {tab === 'product' ? (
          <section className="commerce-product-data-panel">
            <div><span>Produto Mestre</span><strong>#{card.product_id || '—'}</strong></div>
            <div><span>SKU Mestre</span><strong>{card.master_sku || '—'}</strong></div>
            <div><span>Nome</span><strong>{card.product_name || '—'}</strong></div>
            <div><span>Ano</span><strong>{card.edition_year || '—'}</strong></div>
            <div><span>Categoria</span><strong>{card.category_name || '—'}</strong></div>
            <div><span>Plataformas</span><strong>{card.platform_count || 0}</strong></div>
          </section>
        ) : null}

        {tab === 'listings' ? (
          <div className="commerce-product-listing-layout">
            <section className="commerce-product-listing-cards">
              {listings.map((listing, index) => (
                <article
                  className={'commerce-product-listing-card ' + (selectedListing?.listing_id === listing.listing_id ? 'selected' : '')}
                  key={(listing.listing_id || 'row') + ':' + index}
                  onClick={() => listing.listing_id && setSelectedListingId(listing.listing_id)}
                >
                  <MarketplaceMark code={listing.platform_code} label={listing.platform_label} />
                  <div className="commerce-product-listing-copy">
                    <strong>{listing.platform_label}</strong>
                    <small>SKU: {listing.skus.join(' · ') || listing.sku || '—'}</small>
                    <span className={'commerce-listing-status ' + String(listing.listing_status || '').toLowerCase()}>{statusLabel(listing.listing_status)}</span>
                  </div>
                  <ProductImage src={listing.image_url || card.image_url} alt={listing.listing_title || listing.product_name} className="commerce-listing-mini-image" />
                  <div className="commerce-product-listing-price">
                    <strong>{listing.price ? 'R$ ' + listing.price : '—'}</strong>
                    {listing.listing_url ? <a href={listing.listing_url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>Ver anúncio <Icon name="external" size={12} /></a> : null}
                  </div>
                </article>
              ))}
            </section>

            <aside className="commerce-product-actions">
              <button type="button" className="primary" disabled={!selectedListing?.listing_id} onClick={() => onEdit(selectedListing)}>
                <Icon name="edit" /> Editar anúncio
              </button>
              {selectedListing?.listing_url ? (
                <a href={selectedListing.listing_url} target="_blank" rel="noreferrer"><Icon name="external" /> Ver no marketplace</a>
              ) : (
                <button type="button" disabled><Icon name="external" /> Ver no marketplace</button>
              )}
              <button type="button" disabled={!selectedListing?.listing_id} onClick={() => onEdit(selectedListing, 'image_url')}>
                <Icon name="image" /> Atualizar imagem
              </button>
              <button type="button" disabled={!selectedListing?.listing_id} onClick={() => onEdit(selectedListing, 'listing_status')}>
                <Icon name="clock" /> Alterar status
              </button>
              <button type="button" disabled={!selectedListing?.listing_id} onClick={() => queueSync(selectedListing)}>
                <Icon name="sync" /> Sincronizar
              </button>
              <small>Sincronizar registra o anúncio como pendente. O envio externo depende da integração da plataforma.</small>
            </aside>
          </div>
        ) : null}

        {tab === 'history' ? (
          <section className="commerce-listing-history">
            {historyLoading ? <p>Carregando histórico…</p> : Array.isArray(historyDetail?.history) && historyDetail.history.length ? (
              historyDetail.history.map(entry => (
                <article key={entry.id}>
                  <div><Icon name="clock" /><strong>{entry.field_name}</strong></div>
                  <span>{entry.operator_name || 'Administrador'}</span>
                  <time>{entry.created_at ? new Date(entry.created_at).toLocaleString('pt-BR') : '—'}</time>
                </article>
              ))
            ) : <p>Nenhuma alteração manual registrada para este anúncio.</p>}
          </section>
        ) : null}
      </aside>
    </div>
  );
}

export default function CommerceCatalogWorkspace({
  items,
  summary,
  summaryLoading,
  summaryError,
  loading,
  error,
  search,
  setSearch,
  submittedSearch,
  setSubmittedSearch,
  total,
  page,
  pages,
  offset,
  limit,
  load
}) {
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [activeCard, setActiveCard] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [platformFilter, setPlatformFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [offset, submittedSearch]);

  useEffect(() => {
    if (!activeCard) return;
    const next = items.find(card => card.card_key === activeCard.card_key);
    if (next) setActiveCard(next);
  }, [items]);

  const filterOptions = useMemo(() => {
    const platforms = new Map();
    const categories = new Set();
    const years = new Set();
    for (const card of items) {
      if (card.category_name) categories.add(card.category_name);
      if (card.edition_year) years.add(String(card.edition_year));
      for (const platform of Array.isArray(card.platforms) ? card.platforms : []) {
        platforms.set(platform.source_code, platform.label);
      }
    }
    return {
      platforms: [...platforms.entries()],
      categories: [...categories].sort(),
      years: [...years].sort().reverse()
    };
  }, [items]);

  const visibleItems = useMemo(() => items.filter(card => {
    if (categoryFilter && card.category_name !== categoryFilter) return false;
    if (yearFilter && String(card.edition_year || '') !== yearFilter) return false;
    const listings = collectListings(card);
    if (platformFilter && !listings.some(row => row.platform_code === platformFilter)) return false;
    if (statusFilter && !listings.some(row => String(row.listing_status || 'UNKNOWN') === statusFilter)) return false;
    return true;
  }), [items, platformFilter, categoryFilter, yearFilter, statusFilter]);

  const selectedCards = items.filter(card => selectedKeys.has(card.card_key));
  const selectedListingCount = useMemo(() => {
    const ids = new Set();
    for (const card of selectedCards) {
      for (const listing of collectListings(card)) if (listing.listing_id) ids.add(listing.listing_id);
    }
    return ids.size;
  }, [selectedCards]);

  function toggle(card) {
    setSelectedKeys(current => {
      const next = new Set(current);
      if (next.has(card.card_key)) next.delete(card.card_key);
      else next.add(card.card_key);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedKeys(current => {
      const next = new Set(current);
      const allSelected = visibleItems.length && visibleItems.every(card => next.has(card.card_key));
      for (const card of visibleItems) {
        if (allSelected) next.delete(card.card_key);
        else next.add(card.card_key);
      }
      return next;
    });
  }

  async function refresh() {
    await load(offset);
  }

  function message(text, isError = false) {
    setNotice({ text, isError });
    window.setTimeout(() => setNotice(null), 4200);
  }

  return (
    <div className="commerce-catalog-workspace">
      <section className="commerce-catalog-heading">
        <div>
          <h2>Catálogo Comercial</h2>
          <p>Gerencie Produtos Mestre, imagens e anúncios em todas as plataformas.</p>
        </div>
      </section>

      <section className="commerce-catalog-metrics">
        <article><span>Total de produtos</span><strong>{summaryLoading ? '…' : summaryError ? '—' : commerceFormatNumber(summary?.linked_products || total)}</strong><small>Produtos vinculados</small></article>
        <article><span>Multiplataforma</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.multiplatform || 0)}</strong><small>2 ou mais plataformas</small></article>
        <article><span>Uma plataforma</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.exclusive || 0)}</strong><small>Produtos exclusivos</small></article>
        <article><span>Pendências</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.unlinked || 0)}</strong><small>Precisam de revisão</small></article>
      </section>

      <section className="commerce-catalog-controls">
        <form onSubmit={event => { event.preventDefault(); setSubmittedSearch(search.trim()); }}>
          <Icon name="search" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por SKU, nome ou produto..." />
        </form>
        <select value={platformFilter} onChange={event => setPlatformFilter(event.target.value)}>
          <option value="">Plataforma</option>
          {filterOptions.platforms.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
          <option value="">Categoria</option>
          {filterOptions.categories.map(value => <option key={value}>{value}</option>)}
        </select>
        <select value={yearFilter} onChange={event => setYearFilter(event.target.value)}>
          <option value="">Ano</option>
          {filterOptions.years.map(value => <option key={value}>{value}</option>)}
        </select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">Status</option>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {(platformFilter || categoryFilter || yearFilter || statusFilter || submittedSearch) ? (
          <button type="button" className="clear" onClick={() => {
            setPlatformFilter('');
            setCategoryFilter('');
            setYearFilter('');
            setStatusFilter('');
            setSearch('');
            setSubmittedSearch('');
          }}>Limpar</button>
        ) : null}
      </section>

      {selectedKeys.size ? (
        <section className="commerce-bulk-toolbar">
          <strong>{selectedKeys.size} selecionado(s)</strong>
          <span>{selectedListingCount} anúncio(s)</span>
          <button type="button" className="primary" onClick={() => setBulkOpen(true)}><Icon name="edit" /> Editar em massa</button>
          <button type="button" onClick={() => {
            setBulkOpen(true);
          }}>Alterar status</button>
          <button type="button" onClick={() => setBulkOpen(true)}>Alterar ano</button>
          <button type="button" onClick={() => setBulkOpen(true)}>Trocar imagem</button>
        </section>
      ) : null}

      {notice ? <div className={'commerce-catalog-notice ' + (notice.isError ? 'error' : '')}>{notice.text}</div> : null}
      {error ? <div className="commerce-catalog-notice error">{error}</div> : null}

      <section className="commerce-catalog-table-wrap">
        <table className="commerce-catalog-table">
          <thead>
            <tr>
              <th className="check"><input type="checkbox" checked={Boolean(visibleItems.length) && visibleItems.every(card => selectedKeys.has(card.card_key))} onChange={toggleAllVisible} /></th>
              <th>Imagem</th>
              <th>SKU Mestre</th>
              <th>Nome do produto</th>
              <th>Ano</th>
              <th>Categoria</th>
              <th>Plataformas</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="commerce-catalog-empty">Carregando catálogo…</td></tr>
            ) : visibleItems.length ? visibleItems.map(card => {
              const listings = collectListings(card);
              const hasLocalChange = listings.some(row => ['LOCAL', 'PENDING'].includes(String(row.sync_status || '')));
              const hasEditable = listings.some(row => row.listing_id);
              return (
                <tr key={card.card_key} className={selectedKeys.has(card.card_key) ? 'selected' : ''} onClick={() => setActiveCard(card)}>
                  <td className="check" onClick={event => event.stopPropagation()}>
                    <input type="checkbox" checked={selectedKeys.has(card.card_key)} onChange={() => toggle(card)} />
                  </td>
                  <td><ProductImage src={card.image_url} alt={card.product_name} className="commerce-catalog-thumb" /></td>
                  <td><code>{card.master_sku || '—'}</code></td>
                  <td><strong>{card.product_name || 'Produto sem nome'}</strong><small>Produto Mestre #{card.product_id || '—'}</small></td>
                  <td><span className="commerce-year-chip">{card.edition_year || '—'}</span></td>
                  <td>{card.category_name || '—'}</td>
                  <td>
                    <div className="commerce-marketplace-row">
                      {Array.from(new Map(listings.map(row => [row.platform_code, row])).values()).map(row => (
                        <MarketplaceMark key={row.platform_code} code={row.platform_code} label={row.platform_label} />
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={'commerce-product-completeness ' + (hasEditable ? 'complete' : 'pending')}>
                      {hasLocalChange ? 'Alterado' : hasEditable ? 'Completo' : 'Pendente'}
                    </span>
                  </td>
                  <td><button type="button" className="commerce-more-button" onClick={event => { event.stopPropagation(); setActiveCard(card); }}><Icon name="more" /></button></td>
                </tr>
              );
            }) : (
              <tr><td colSpan="9" className="commerce-catalog-empty">Nenhum produto encontrado com os filtros atuais.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="commerce-catalog-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} produtos</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - limit))}>Anterior</button>
          <button type="button" disabled={offset + limit >= total || loading} onClick={() => load(offset + limit)}>Próxima</button>
        </div>
      </section>

      {activeCard ? (
        <ProductDrawer
          card={activeCard}
          onClose={() => setActiveCard(null)}
          onEdit={listing => setEditTarget(listing)}
          onReload={refresh}
          onMessage={message}
        />
      ) : null}

      {editTarget ? (
        <ListingEditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            message('Anúncio atualizado e registrado no histórico.');
            await refresh();
          }}
        />
      ) : null}

      {bulkOpen ? (
        <BulkEditModal
          cards={selectedCards}
          onClose={() => setBulkOpen(false)}
          onSaved={async () => {
            message('Edição em massa concluída.');
            setSelectedKeys(new Set());
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
