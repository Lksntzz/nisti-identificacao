import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import { CommerceLoadingBlock, commerceFormatNumber } from './commerce-admin-shared.jsx';
import './commerce-management.css';

const UPDATE_LABELS = Object.freeze({
  UPDATED: 'Sim',
  NOT_UPDATED: 'Não',
  REVIEW: 'Verificar',
  NOT_LISTED: 'Sem anúncio',
  NO_DATA: 'Sem dado'
});

const VIDEO_LABELS = Object.freeze({
  ACTIVE: 'Sim',
  ABSENT: 'Não',
  DISABLED: 'Desativado',
  UNKNOWN: 'Verificar',
  NO_DATA: 'Sem dado'
});

const LISTING_LABELS = Object.freeze({
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  INACTIVE: 'Inativo',
  REMOVED: 'Removido',
  NO_LISTING: 'Sem anúncio',
  UNVERIFIED: 'Não verificado',
  UNKNOWN: 'Não verificado'
});

const RELATION_LABELS = Object.freeze({
  CONFIRMED: 'Confirmado',
  REVIEW: 'Verificar',
  UNMATCHED: 'Sem vínculo'
});

const PRESENCE_LABELS = Object.freeze({
  LINKED: 'Todos vinculados',
  MULTI: 'Multiplataforma',
  EXCLUSIVE: 'Exclusivos',
  UNLINKED: 'Para vincular'
});

function tone(value) {
  const token = String(value || '').toUpperCase();
  if (['UPDATED', 'ACTIVE', 'CONFIRMED'].includes(token)) return 'ok';
  if (['REVIEW', 'UNKNOWN', 'UNVERIFIED', 'DISABLED', 'NO_DATA'].includes(token)) return 'warn';
  if (['NOT_UPDATED', 'ABSENT', 'INACTIVE', 'REMOVED', 'NO_LISTING', 'UNMATCHED', 'NOT_LISTED'].includes(token)) return 'muted';
  return '';
}

function ManagementPill({ value, labels }) {
  return <span className={`commerce-management-pill ${tone(value)}`}>{labels[value] || value || '—'}</span>;
}

function ProductImage({ src, alt, large = false }) {
  if (!src) return <div className={`commerce-product-card-image placeholder ${large ? 'large' : ''}`}>Sem foto</div>;
  return <img className={`commerce-product-card-image ${large ? 'large' : ''}`} src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" />;
}

function linkReviewText(card) {
  if (card.presence_type !== 'UNLINKED') return null;
  if (card.link_review_status === 'SAFE_CANDIDATE') {
    return card.suggested_product_id ? `Sugestão segura · Produto Mestre #${card.suggested_product_id}` : 'Sugestão segura';
  }
  if (card.link_review_status === 'AMBIGUOUS') {
    return `Ambíguo · ${card.candidate_count || 0} candidatos`;
  }
  return 'Sem candidato seguro';
}

function presenceText(card) {
  if (card.presence_type === 'MULTI') return `${card.platform_count} plataformas`;
  if (card.presence_type === 'EXCLUSIVE') {
    const label = card.platforms?.[0]?.label || 'plataforma';
    return `Exclusivo ${label}`;
  }
  return 'Para vincular';
}

function PlatformDrawer({ selection, onClose }) {
  if (!selection) return null;
  const { card, platform } = selection;
  const items = Array.isArray(platform?.items) ? platform.items : [];

  return (
    <div className="commerce-management-backdrop" onClick={onClose}>
      <aside className="commerce-management-drawer" onClick={event => event.stopPropagation()}>
        <div className="commerce-management-drawer-head">
          <div>
            <span>{platform.label}</span>
            <h3>{card.product_name || 'Produto sem nome'}</h3>
            <code>{card.master_sku || 'SKU Mestre não informado'}</code>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>

        <div className="commerce-platform-summary">
          <div><span>Produto Mestre</span><strong>{card.product_id ? `#${card.product_id}` : 'Ainda sem vínculo'}</strong></div>
          <div><span>Tipo</span><strong>{card.presence_type === 'MULTI' ? 'Multiplataforma' : card.presence_type === 'EXCLUSIVE' ? 'Exclusivo' : 'Para vincular'}</strong></div>
          <div><span>Categoria</span><strong>{card.category_name || '—'}</strong></div>
          <div><span>Ano</span><strong>{card.edition_year || '—'}</strong></div>
        </div>

        <div className="commerce-platform-listings">
          {items.map((item, index) => (
            <article className="commerce-platform-detail" key={item.source_row_id || index}>
              <div className="commerce-platform-detail-top">
                <ProductImage src={item.image_url} alt={item.product_name || item.sku} large />
                <div>
                  <span>SKU nesta plataforma</span>
                  <code>{item.sku || '—'}</code>
                  <small>{item.product_name || card.product_name}</small>
                </div>
              </div>

              <div className="commerce-platform-detail-grid">
                <div><span>Atualizado</span><ManagementPill value={item.update_status} labels={UPDATE_LABELS} /></div>
                <div><span>Vídeo</span><ManagementPill value={item.video_status} labels={VIDEO_LABELS} /></div>
                <div><span>Status</span><ManagementPill value={item.listing_status} labels={LISTING_LABELS} /></div>
                <div><span>Vínculo</span><ManagementPill value={item.relation_status} labels={RELATION_LABELS} /></div>
              </div>

              <div className="commerce-platform-image-source">
                <span>Origem da foto</span>
                <strong>
                  {item.image_source === 'MARKETPLACE'
                    ? 'Própria plataforma'
                    : item.image_source === 'OTHER_MARKETPLACE'
                      ? `Outra plataforma${item.image_source_marketplace_name ? ` · ${item.image_source_marketplace_name}` : ''}`
                      : item.image_source === 'NISTI_ID'
                        ? 'NISTI ID'
                        : 'Sem foto'}
                </strong>
                {item.image_source_sku ? <code>{item.image_source_sku}</code> : null}
              </div>

              {item.listing_url
                ? <a className="commerce-platform-open-link" href={item.listing_url} target="_blank" rel="noreferrer">Abrir anúncio</a>
                : <span className="commerce-platform-no-link">Link do anúncio não disponível.</span>}
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function LinkReviewDrawer({ review, loading, error, saving, onClose, onResolve }) {
  if (!review) return null;
  const source = review.data?.source || null;
  const candidates = Array.isArray(review.data?.candidates) ? review.data.candidates : [];

  return (
    <div className="commerce-management-backdrop" onClick={onClose}>
      <aside className="commerce-management-drawer commerce-link-review-drawer" onClick={event => event.stopPropagation()}>
        <div className="commerce-management-drawer-head">
          <div>
            <span>Revisão de vínculo</span>
            <h3>{source?.product_name || review.card?.product_name || 'Produto para vincular'}</h3>
            <code>{source?.sku || review.card?.master_sku || 'SKU não informado'}</code>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>

        <div className="commerce-link-source">
          <ProductImage src={source?.image_url || review.card?.image_url} alt={source?.product_name || review.card?.product_name} large />
          <div>
            <span>Item da plataforma</span>
            <strong>{source?.platform || review.card?.platforms?.[0]?.label || '—'}</strong>
            <code>{source?.sku || review.card?.master_sku || '—'}</code>
            <small>{source?.category_name || review.card?.category_name || 'Sem categoria'} · {source?.edition_year || review.card?.edition_year || 'Sem ano'}</small>
          </div>
        </div>

        <div className="commerce-link-review-note">
          Homologação: a escolha abaixo altera somente o sandbox/preview.
        </div>

        {loading ? <CommerceLoadingBlock label="Buscando Produtos Mestre candidatos…" /> : null}
        {error ? <div className="commerce-error commerce-management-error">{error}</div> : null}

        {!loading && !error ? (
          <div className="commerce-link-candidates">
            {candidates.length ? candidates.map(candidate => (
              <article className="commerce-link-candidate" key={candidate.product_id}>
                <div className="commerce-link-candidate-media">
                  <ProductImage src={candidate.image_url} alt={candidate.product_name} large />
                </div>
                <div className="commerce-link-candidate-body">
                  <span>Produto Mestre #{candidate.product_id}</span>
                  <h4>{candidate.product_name || 'Produto sem nome'}</h4>
                  <code>{candidate.master_sku || 'SKU não informado'}</code>
                  <div className="commerce-link-candidate-meta">
                    <small>{candidate.category_name || 'Sem categoria'}</small>
                    <small>{candidate.edition_year || 'Sem ano'}</small>
                  </div>
                  <div className="commerce-link-candidate-platforms">
                    {(candidate.platforms || []).map(platform => (
                      <span key={platform.source_code}>{platform.label}</span>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(saving)}
                    onClick={() => onResolve(candidate.product_id)}
                  >
                    {saving === candidate.product_id ? 'Vinculando…' : 'Vincular a este no preview'}
                  </button>
                </div>
              </article>
            )) : (
              <div className="commerce-empty-state">
                <strong>Nenhum candidato encontrado.</strong>
                <p>Este item precisa de investigação manual.</p>
              </div>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default function CommerceManagementView() {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [presence, setPresence] = useState('LINKED');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0, limit: 24, offset: 0 } });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState(null);
  const [linkReview, setLinkReview] = useState(null);
  const [linkReviewLoading, setLinkReviewLoading] = useState(false);
  const [linkReviewError, setLinkReviewError] = useState('');
  const [linkReviewSaving, setLinkReviewSaving] = useState(null);

  async function load(nextOffset = 0) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      presence,
      limit: '24',
      offset: String(nextOffset)
    });
    if (submittedSearch) params.set('search', submittedSearch);

    try {
      const result = await commerceApi(`/api/admin/commerce/management/products?${params}`);
      setData(result || { items: [], pagination: { total: 0, limit: 24, offset: 0 } });
      setOffset(nextOffset);
      setSelection(null);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a Gestão.');
    } finally {
      setLoading(false);
    }
  }

  async function openLinkReview(card) {
    const sourceRowId = card?.platforms?.[0]?.items?.[0]?.source_row_id;
    if (!sourceRowId) return;
    setLinkReview({ card, data: null });
    setLinkReviewLoading(true);
    setLinkReviewError('');
    setLinkReviewSaving(null);
    try {
      const result = await commerceApi(`/api/admin/commerce/management/link-review/${sourceRowId}`);
      setLinkReview({ card, data: result });
    } catch (err) {
      setLinkReviewError(err.message || 'Não foi possível carregar os candidatos.');
    } finally {
      setLinkReviewLoading(false);
    }
  }

  async function resolveLinkReview(productId) {
    const sourceRowId = linkReview?.data?.source?.source_row_id;
    if (!sourceRowId || !productId) return;
    setLinkReviewSaving(productId);
    setLinkReviewError('');
    try {
      await commerceApi(`/api/admin/commerce/management/link-review/${sourceRowId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product_id: productId })
      });
      setLinkReview(null);
      await Promise.all([load(offset), loadSummary()]);
    } catch (err) {
      setLinkReviewError(err.message || 'Não foi possível salvar o vínculo no preview.');
    } finally {
      setLinkReviewSaving(null);
    }
  }

  async function loadSummary() {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      setSummary(await commerceApi('/api/admin/commerce/management/product-summary'));
    } catch (err) {
      setSummary(null);
      setSummaryError(err.message || 'Não foi possível carregar os indicadores.');
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => { load(0); }, [presence, submittedSearch]);
  useEffect(() => { loadSummary(); }, []);

  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.pagination?.total || 0);
  const limit = Number(data?.pagination?.limit || 24);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  const metrics = [
    ['LINKED', 'Produtos vinculados', summary?.linked_products || 0],
    ['MULTI', 'Multiplataforma', summary?.multiplatform || 0],
    ['EXCLUSIVE', 'Exclusivos', summary?.exclusive || 0],
    ['UNLINKED', 'Para vincular', summary?.unlinked || 0]
  ];

  return (
    <div className="commerce-management-page">
      <section className="commerce-panel commerce-management-hero">
        <div className="commerce-panel-header commerce-panel-header-stack">
          <div>
            <h2>Gestão de produtos</h2>
            <p>Um card por Produto Mestre. As plataformas aparecem dentro do produto e cada uma abre somente os dados daquele cadastro.</p>
          </div>
        </div>

        <div className="commerce-management-metrics simple">
          {metrics.map(([code, label, value]) => (
            <button type="button" key={code} className={presence === code ? 'active' : ''} onClick={() => setPresence(code)}>
              <span>{label}</span>
              <strong>{summaryLoading ? '…' : summaryError ? '—' : commerceFormatNumber(value)}</strong>
              <small>
                {code === 'MULTI'
                  ? '2 ou mais plataformas'
                  : code === 'EXCLUSIVE'
                    ? 'somente 1 plataforma'
                    : code === 'UNLINKED'
                      ? `${commerceFormatNumber(summary?.ambiguous_candidates || 0)} ambíguos · ${commerceFormatNumber(summary?.no_safe_candidate || 0)} sem candidato`
                      : 'Produtos Mestre cruzados'}
              </small>
            </button>
          ))}
        </div>
        {summaryError ? (
          <div className="commerce-management-summary-warning">
            Indicadores indisponíveis no momento.
            <button type="button" onClick={loadSummary}>Tentar novamente</button>
          </div>
        ) : null}
      </section>

      <section className="commerce-panel commerce-management-catalog">
        <div className="commerce-panel-header commerce-panel-header-stack">
          <form className="commerce-management-search" onSubmit={event => {
            event.preventDefault();
            setSubmittedSearch(search.trim());
          }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por Produto Mestre ou SKU de qualquer plataforma" />
            <button type="submit">Buscar</button>
            {(submittedSearch || search) ? (
              <button type="button" className="secondary" onClick={() => {
                setSearch('');
                setSubmittedSearch('');
              }}>Limpar</button>
            ) : null}
          </form>
          <div className="commerce-management-view-caption">
            <strong>{PRESENCE_LABELS[presence]}</strong>
            <span>{commerceFormatNumber(total)} resultados</span>
          </div>
        </div>

        {error ? <div className="commerce-error commerce-management-error">{error}</div> : null}

        {loading ? <CommerceLoadingBlock label="Cruzando produtos e plataformas…" /> : items.length ? (
          <div className="commerce-product-card-grid">
            {items.map(card => {
              const platforms = Array.isArray(card.platforms) ? card.platforms : [];
              return (
                <article className="commerce-product-card" key={card.card_key}>
                  <div className="commerce-product-card-media">
                    <ProductImage src={card.image_url} alt={card.product_name || card.master_sku} />
                    <span className={`commerce-presence-badge ${String(card.presence_type || '').toLowerCase()}`}>
                      {card.presence_type === 'MULTI' ? 'Multiplataforma' : card.presence_type === 'EXCLUSIVE' ? 'Exclusivo' : 'Para vincular'}
                    </span>
                  </div>

                  <div className="commerce-product-card-body">
                    <div className="commerce-product-card-title">
                      <h3>{card.product_name || 'Produto sem nome'}</h3>
                      <code>{card.master_sku || 'SKU não informado'}</code>
                    </div>

                    <div className="commerce-product-card-meta">
                      <span>{card.category_name || 'Sem categoria'}</span>
                      <span>{card.edition_year || 'Ano não informado'}</span>
                    </div>

                    <div className="commerce-product-platforms">
                      <span className="commerce-product-platforms-label">Cadastrado em</span>
                      <div>
                        {platforms.map(platform => (
                          <button
                            type="button"
                            key={platform.source_code}
                            onClick={() => setSelection({ card, platform })}
                          >
                            {platform.label}
                            {Number(platform.item_count || 0) > 1 ? <small>{platform.item_count}</small> : null}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="commerce-product-card-footer">
                      <strong>{presenceText(card)}</strong>
                      {card.product_id
                        ? <span>Produto Mestre #{card.product_id}</span>
                        : ['AMBIGUOUS', 'SAFE_CANDIDATE'].includes(card.link_review_status)
                          ? (
                            <button
                              type="button"
                              className={`commerce-link-review ${String(card.link_review_status || '').toLowerCase()}`}
                              onClick={() => openLinkReview(card)}
                            >
                              {card.link_review_status === 'AMBIGUOUS' ? `Comparar ${card.candidate_count || 0} candidatos` : linkReviewText(card)}
                            </button>
                          )
                          : <span className={`commerce-link-review ${String(card.link_review_status || '').toLowerCase()}`}>{linkReviewText(card)}</span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="commerce-empty-state">
            <strong>Nenhum produto encontrado.</strong>
            <p>Altere a busca ou escolha outro grupo.</p>
          </div>
        )}

        <div className="commerce-pagination">
          <span>Página {page} de {pages} · {commerceFormatNumber(total)} produtos</span>
          <div>
            <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - limit))}>Anterior</button>
            <button type="button" disabled={offset + limit >= total || loading} onClick={() => load(offset + limit)}>Próxima</button>
          </div>
        </div>
      </section>

      <PlatformDrawer selection={selection} onClose={() => setSelection(null)} />
      <LinkReviewDrawer
        review={linkReview}
        loading={linkReviewLoading}
        error={linkReviewError}
        saving={linkReviewSaving}
        onClose={() => setLinkReview(null)}
        onResolve={resolveLinkReview}
      />
    </div>
  );
}
