import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import { CommerceLoadingBlock, commerceFormatNumber } from './commerce-admin-shared.jsx';
import './commerce-management.css';

const SOURCES = Object.freeze([
  ['SHOPEE', 'Shopee'],
  ['ML_NOVO', 'ML Novo'],
  ['ML_ANTIGO', 'ML Antigo'],
  ['AMAZON', 'Amazon'],
  ['SHEIN', 'Shein'],
  ['LOJA_INTEGRADA', 'Loja Integrada'],
  ['KWAI', 'Kwai'],
  ['TIKTOK', 'TikTok'],
  ['ALIEXPRESS', 'AliExpress'],
  ['MAGALU', 'Magalu']
]);

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

function ImageCell({ item }) {
  if (!item.image_url) return <div className="commerce-management-image commerce-image-placeholder">Sem foto</div>;
  return (
    <img
      className="commerce-management-image"
      src={item.image_url}
      alt={item.product_name || item.sku || ''}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function rowPriority(item) {
  const state = rowVisualState(item);
  if (state.level === 'attention') return 0;
  if (state.level === 'review') return 1;
  return 2;
}

function rowVisualState(item) {
  if (!item) return { level: 'ok', label: 'OK' };

  const critical =
    !item.image_url ||
    !item.listing_url ||
    item.relation_status === 'UNMATCHED' ||
    item.update_status === 'NOT_UPDATED' ||
    ['NO_LISTING', 'REMOVED', 'INACTIVE'].includes(item.listing_status);

  if (critical) return { level: 'attention', label: 'Atenção' };

  const review =
    item.relation_status === 'REVIEW' ||
    ['REVIEW', 'NO_DATA'].includes(item.update_status) ||
    ['UNKNOWN', 'NO_DATA', 'DISABLED'].includes(item.video_status) ||
    item.listing_status === 'UNVERIFIED';

  if (review) return { level: 'review', label: 'Verificar' };
  return { level: 'ok', label: 'OK' };
}

function issueList(item) {
  if (!item) return [];
  const issues = [];
  if (!item.image_url) issues.push('Sem foto segura');
  if (item.relation_status === 'UNMATCHED') issues.push('Sem vínculo com Produto Mestre');
  if (item.relation_status === 'REVIEW') issues.push('Vínculo precisa ser verificado');
  if (['UNKNOWN', 'NO_DATA', 'DISABLED'].includes(item.video_status)) issues.push('Vídeo precisa ser verificado');
  if (item.update_status === 'NOT_UPDATED') issues.push('Produto não atualizado');
  if (['REVIEW', 'NO_DATA'].includes(item.update_status)) issues.push('Atualização precisa ser verificada');
  if (!item.listing_url) issues.push('Sem link do anúncio');
  if (['UNVERIFIED', 'NO_LISTING'].includes(item.listing_status)) issues.push('Status do anúncio não confirmado');
  return issues;
}

function DetailDrawer({ item, detail, detailLoading, detailError, onClose }) {
  if (!item) return null;
  const issues = issueList(item);
  const platforms = Array.isArray(detail?.platforms) ? detail.platforms : [];

  return (
    <div className="commerce-management-backdrop" onClick={onClose}>
      <aside className="commerce-management-drawer" onClick={event => event.stopPropagation()}>
        <div className="commerce-management-drawer-head">
          <div>
            <span>{item.source_name || item.source_code}</span>
            <h3>{item.product_name || 'Produto sem nome'}</h3>
            <code>{item.sku || 'SKU não informado'}</code>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>

        <div className="commerce-management-drawer-image">
          <ImageCell item={item} />
          <div>
            <span>Origem da imagem</span>
            <strong>{item.image_source === 'MARKETPLACE' ? 'Própria plataforma' : item.image_source === 'OTHER_MARKETPLACE' ? 'Outra plataforma compatível' : item.image_source === 'NISTI_ID' ? 'NISTI ID' : 'Sem imagem'}</strong>
            {item.image_source_marketplace_name ? <small>{item.image_source_marketplace_name}</small> : null}
            {item.image_source_sku ? <code>{item.image_source_sku}</code> : null}
          </div>
        </div>

        {issues.length ? (
          <section className="commerce-management-pending">
            <div>
              <span>Pendências</span>
              <strong>{issues.length}</strong>
            </div>
            <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
          </section>
        ) : (
          <section className="commerce-management-pending ok">
            <div><span>Pendências</span><strong>0</strong></div>
            <p>Sem pendências básicas nesta linha.</p>
          </section>
        )}

        <div className="commerce-management-drawer-grid">
          <div><span>Categoria</span><strong>{item.category_name || '—'}</strong></div>
          <div><span>Ano</span><strong>{item.edition_year || '—'}</strong></div>
          <div><span>Produto Mestre</span><strong>{detail?.product?.id ? `#${detail.product.id} · ${detail.product.current_sku || ''}` : item.product_id ? `#${item.product_id}` : 'Sem vínculo'}</strong></div>
          <div><span>Anúncio interno</span><strong>{item.listing_id ? `#${item.listing_id}` : 'Ainda não criado'}</strong></div>
          <div><span>Atualizado</span><ManagementPill value={item.update_status} labels={UPDATE_LABELS} /></div>
          <div><span>Vídeo</span><ManagementPill value={item.video_status} labels={VIDEO_LABELS} /></div>
          <div><span>Status</span><ManagementPill value={item.listing_status} labels={LISTING_LABELS} /></div>
          <div><span>Vínculo</span><ManagementPill value={item.relation_status} labels={RELATION_LABELS} /></div>
        </div>

        <section className="commerce-management-cross-platform">
          <div className="commerce-management-section-title">
            <span>Mesmo produto em outras plataformas</span>
            {detail?.product?.name ? <small>{detail.product.name}</small> : null}
          </div>

          {detailLoading ? <p className="commerce-management-detail-state">Carregando plataformas…</p> : null}
          {detailError ? <p className="commerce-management-detail-state error">{detailError}</p> : null}
          {!detailLoading && !detailError && platforms.length === 0 ? (
            <p className="commerce-management-detail-state">Nenhuma relação segura encontrada em outra plataforma.</p>
          ) : null}

          {!detailLoading && !detailError ? platforms.map(platform => (
            <article className="commerce-management-platform-card" key={platform.source_code}>
              <div className="commerce-management-platform-card-head">
                <strong>{platform.label}</strong>
                <span>{platform.item_count} {Number(platform.item_count) === 1 ? 'item' : 'itens'}</span>
              </div>
              <div className="commerce-management-platform-items">
                {(platform.items || []).map(related => (
                  <div className="commerce-management-platform-item" key={related.source_row_id}>
                    <div>
                      <code>{related.sku || 'SKU não informado'}</code>
                      <small>{related.product_name || 'Produto sem nome'}</small>
                    </div>
                    <div className="commerce-management-platform-status">
                      <ManagementPill value={related.update_status} labels={UPDATE_LABELS} />
                      <ManagementPill value={related.video_status} labels={VIDEO_LABELS} />
                      <ManagementPill value={related.relation_status} labels={RELATION_LABELS} />
                    </div>
                    {related.listing_url ? <a href={related.listing_url} target="_blank" rel="noreferrer">Abrir</a> : <span className="commerce-management-no-link">Sem link</span>}
                  </div>
                ))}
              </div>
            </article>
          )) : null}
        </section>

        <div className="commerce-management-drawer-actions">
          {item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir anúncio desta plataforma</a> : <span>Link não disponível nesta fonte.</span>}
        </div>
      </aside>
    </div>
  );
}

export default function CommerceManagementView() {
  const [source, setSource] = useState('AMAZON');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [listingStatus, setListingStatus] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [videoStatus, setVideoStatus] = useState('');
  const [imageStatus, setImageStatus] = useState('');
  const [relationStatus, setRelationStatus] = useState('');
  const [filterOptions, setFilterOptions] = useState({ categories: [], years: [], listing_statuses: [] });
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0, limit: 50, offset: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  async function load(nextOffset = 0) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      source,
      limit: '50',
      offset: String(nextOffset)
    });
    if (submittedSearch) params.set('search', submittedSearch);
    if (category) params.set('category', category);
    if (year) params.set('year', year);
    if (listingStatus) params.set('listing_status', listingStatus);
    if (updateStatus) params.set('update_status', updateStatus);
    if (videoStatus) params.set('video_status', videoStatus);
    if (imageStatus) params.set('image_status', imageStatus);
    if (relationStatus) params.set('relation_status', relationStatus);

    try {
      const result = await commerceApi(`/api/admin/commerce/management?${params}`);
      setData(result || { items: [], pagination: { total: 0, limit: 50, offset: 0 } });
      setOffset(nextOffset);
      setSelected(null);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar a Gestão.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, [source, category, year, listingStatus, updateStatus, videoStatus, imageStatus, relationStatus, submittedSearch]);

  async function loadFilterOptions() {
    try {
      const result = await commerceApi(`/api/admin/commerce/management/options?source=${encodeURIComponent(source)}`);
      setFilterOptions({
        categories: Array.isArray(result?.categories) ? result.categories : [],
        years: Array.isArray(result?.years) ? result.years : [],
        listing_statuses: Array.isArray(result?.listing_statuses) ? result.listing_statuses : []
      });
    } catch {
      setFilterOptions({ categories: [], years: [], listing_statuses: [] });
    }
  }

  async function loadSummary() {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      setSummary(await commerceApi(`/api/admin/commerce/management/summary?source=${encodeURIComponent(source)}`));
    } catch (err) {
      setSummary(null);
      setSummaryError(err.message || 'Não foi possível carregar os indicadores.');
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    loadFilterOptions();
  }, [source]);

  function clearFilters() {
    setSearch('');
    setSubmittedSearch('');
    setCategory('');
    setYear('');
    setListingStatus('');
    setUpdateStatus('');
    setVideoStatus('');
    setImageStatus('');
    setRelationStatus('');
  }

  function changeSource(code) {
    clearFilters();
    setSource(code);
  }

  function applyMetricFilter(kind) {
    clearFilters();

    if (kind === 'with_image') setImageStatus('WITH_IMAGE');
    if (kind === 'without_image') setImageStatus('WITHOUT_IMAGE');
    if (kind === 'updated') setUpdateStatus('UPDATED');
    if (kind === 'not_updated') setUpdateStatus('NOT_UPDATED');
    if (kind === 'with_video') setVideoStatus('ACTIVE');
    if (kind === 'without_video') setVideoStatus('ABSENT');
    if (kind === 'verify') setRelationStatus('NEEDS_REVIEW');
    if (kind === 'unmatched') setRelationStatus('UNMATCHED');
  }

  async function loadDetail(sourceRowId) {
    if (!sourceRowId) return;
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      setDetail(await commerceApi(`/api/admin/commerce/management/${sourceRowId}/details`));
    } catch (err) {
      setDetailError(err.message || 'Não foi possível carregar as outras plataformas.');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (selected?.source_row_id) loadDetail(selected.source_row_id);
    else {
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
    }
  }, [selected?.source_row_id]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const orderedItems = [...items].sort((a, b) => {
    const priority = rowPriority(a) - rowPriority(b);
    if (priority !== 0) return priority;
    return Number(a.source_row_number || a.source_row_id || 0) - Number(b.source_row_number || b.source_row_id || 0);
  });
  const total = Number(data?.pagination?.total || 0);
  const limit = Number(data?.pagination?.limit || 50);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="commerce-management-page">
      <section className="commerce-panel commerce-management-hero">
        <div className="commerce-panel-header commerce-panel-header-stack">
          <div>
            <h2>Gestão por plataforma</h2>
            <p>Mesma lógica da planilha, usando os dados do sistema. A imagem só é herdada quando SKU e ano são compatíveis.</p>
          </div>

          <div className="commerce-management-source-tabs">
            {SOURCES.map(([code, label]) => (
              <button type="button" key={code} className={source === code ? 'active' : ''} onClick={() => changeSource(code)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="commerce-management-metrics">
          <button type="button" onClick={() => applyMetricFilter('total')}>
            <span>Total</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.total || 0)}</strong><small>produtos da plataforma</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('with_image')}>
            <span>Com foto</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.with_image || 0)}</strong><small>imagem segura encontrada</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('without_image')}>
            <span>Sem foto</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.without_image || 0)}</strong><small>precisam de imagem</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('updated')}>
            <span>Atualizados</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.updated || 0)}</strong><small>marcados como atualizados</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('not_updated')}>
            <span>Não atualizados</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.not_updated || 0)}</strong><small>precisam de atualização</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('verify')}>
            <span>Verificar</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.verify || 0)}</strong><small>vínculo ou atualização</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('with_video')}>
            <span>Com vídeo</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.with_video || 0)}</strong><small>{commerceFormatNumber(summary?.video_review || 0)} a verificar</small>
          </button>
          <button type="button" onClick={() => applyMetricFilter('without_video')}>
            <span>Sem vídeo</span><strong>{summaryLoading ? '…' : commerceFormatNumber(summary?.without_video || 0)}</strong><small>confirmados sem vídeo</small>
          </button>
        </div>
        {summaryError ? <div className="commerce-management-summary-error">{summaryError}</div> : null}
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header commerce-panel-header-stack">
          <form className="commerce-management-search" onSubmit={event => {
            event.preventDefault();
            setSubmittedSearch(search.trim());
          }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por SKU, produto ou link" />
            <button type="submit">Buscar</button>
          </form>

          <div className="commerce-management-filters">
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">Categoria: todas</option>
              {filterOptions.categories.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={year} onChange={event => setYear(event.target.value)}>
              <option value="">Ano: todos</option>
              {filterOptions.years.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={listingStatus} onChange={event => setListingStatus(event.target.value)}>
              <option value="">Status: todos</option>
              {filterOptions.listing_statuses.map(value => <option key={value} value={value}>{LISTING_LABELS[value] || value}</option>)}
            </select>
            <select value={updateStatus} onChange={event => setUpdateStatus(event.target.value)}>
              <option value="">Atualização: todos</option>
              <option value="UPDATED">Atualizados</option>
              <option value="NOT_UPDATED">Não atualizados</option>
              <option value="REVIEW">Verificar</option>
              <option value="NOT_LISTED">Sem anúncio</option>
              <option value="NO_DATA">Sem dado</option>
            </select>
            <select value={videoStatus} onChange={event => setVideoStatus(event.target.value)}>
              <option value="">Vídeo: todos</option>
              <option value="ACTIVE">Com vídeo</option>
              <option value="ABSENT">Sem vídeo</option>
              <option value="DISABLED">Desativado</option>
              <option value="UNKNOWN">Verificar</option>
              <option value="NO_DATA">Sem dado</option>
            </select>
            <select value={imageStatus} onChange={event => setImageStatus(event.target.value)}>
              <option value="">Imagem: todas</option>
              <option value="WITH_IMAGE">Com foto</option>
              <option value="WITHOUT_IMAGE">Sem foto</option>
              <option value="MARKETPLACE">Própria plataforma</option>
              <option value="OTHER_MARKETPLACE">Outra plataforma</option>
              <option value="NISTI_ID">NISTI ID</option>
            </select>
            <select value={relationStatus} onChange={event => setRelationStatus(event.target.value)}>
              <option value="">Vínculo: todos</option>
              <option value="CONFIRMED">Confirmados</option>
              <option value="REVIEW">Verificar</option>
              <option value="UNMATCHED">Sem vínculo</option>
              <option value="NEEDS_REVIEW">Verificar pendências</option>
            </select>
            <button type="button" className="commerce-management-clear-filters" onClick={clearFilters}>Limpar filtros</button>
          </div>
        </div>

        {error && <div className="commerce-error commerce-management-error">{error}</div>}

        {loading ? <CommerceLoadingBlock label="Carregando Gestão…" /> : items.length ? (
          <div className="commerce-table-wrap">
            <table className="commerce-table commerce-management-table">
              <thead>
                <tr>
                  <th>Foto</th>
                  <th>SKU</th>
                  <th>Nome do produto</th>
                  <th>Categoria</th>
                  <th>Atualizado?</th>
                  <th>Vídeo?</th>
                  <th>Status</th>
                  <th>Ano</th>
                  <th>Vínculo</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {orderedItems.map(item => {
                  const visual = rowVisualState(item);
                  return (
                  <tr
                    key={item.source_row_id}
                    className={`commerce-management-row ${visual.level}`}
                    onClick={() => setSelected(item)}
                  >
                    <td><ImageCell item={item} /></td>
                    <td><code className="commerce-management-sku">{item.sku || '—'}</code></td>
                    <td>
                      <div className="commerce-management-product-cell">
                        <div>
                          <strong>{item.product_name || 'Produto sem nome'}</strong>
                          <small>{item.product_id ? `Produto Mestre #${item.product_id}` : 'Sem Produto Mestre'}</small>
                        </div>
                        <span className={`commerce-management-row-state ${visual.level}`}>{visual.label}</span>
                      </div>
                    </td>
                    <td>{item.category_name || '—'}</td>
                    <td><ManagementPill value={item.update_status} labels={UPDATE_LABELS} /></td>
                    <td><ManagementPill value={item.video_status} labels={VIDEO_LABELS} /></td>
                    <td><ManagementPill value={item.listing_status} labels={LISTING_LABELS} /></td>
                    <td>{item.edition_year || '—'}</td>
                    <td><ManagementPill value={item.relation_status} labels={RELATION_LABELS} /></td>
                    <td onClick={event => event.stopPropagation()}>
                      {item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : <span className="commerce-management-no-link">—</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="commerce-empty-state">
            <strong>Nenhum item encontrado.</strong>
            <p>Esta plataforma ainda pode não ter uma fonte importada ou os filtros não encontraram resultados.</p>
          </div>
        )}

        <div className="commerce-pagination">
          <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
          <div>
            <button type="button" disabled={offset <= 0 || loading} onClick={() => setOffset(current => {
              const next = Math.max(0, current - limit);
              load(next);
              return next;
            })}>Anterior</button>
            <button type="button" disabled={offset + limit >= total || loading} onClick={() => setOffset(current => {
              const next = current + limit;
              load(next);
              return next;
            })}>Próxima</button>
          </div>
        </div>
      </section>

      <DetailDrawer
        item={selected}
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
