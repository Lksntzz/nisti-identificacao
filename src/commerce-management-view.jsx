import React, { useEffect, useMemo, useState } from 'react';
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

function DetailDrawer({ item, onClose }) {
  if (!item) return null;
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

        <div className="commerce-management-drawer-grid">
          <div><span>Categoria</span><strong>{item.category_name || '—'}</strong></div>
          <div><span>Ano</span><strong>{item.edition_year || '—'}</strong></div>
          <div><span>Produto Mestre</span><strong>{item.product_id ? `#${item.product_id}` : 'Sem vínculo'}</strong></div>
          <div><span>Anúncio interno</span><strong>{item.listing_id ? `#${item.listing_id}` : 'Ainda não criado'}</strong></div>
          <div><span>Atualizado</span><ManagementPill value={item.update_status} labels={UPDATE_LABELS} /></div>
          <div><span>Vídeo</span><ManagementPill value={item.video_status} labels={VIDEO_LABELS} /></div>
          <div><span>Status</span><ManagementPill value={item.listing_status} labels={LISTING_LABELS} /></div>
          <div><span>Vínculo</span><ManagementPill value={item.relation_status} labels={RELATION_LABELS} /></div>
        </div>

        <div className="commerce-management-drawer-actions">
          {item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : <span>Link não disponível nesta fonte.</span>}
        </div>
      </aside>
    </div>
  );
}

export default function CommerceManagementView() {
  const [source, setSource] = useState('AMAZON');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [videoStatus, setVideoStatus] = useState('');
  const [imageStatus, setImageStatus] = useState('');
  const [relationStatus, setRelationStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0, limit: 50, offset: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  async function load(nextOffset = 0) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      source,
      limit: '50',
      offset: String(nextOffset)
    });
    if (submittedSearch) params.set('search', submittedSearch);
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

  useEffect(() => { load(0); }, [source, updateStatus, videoStatus, imageStatus, relationStatus, submittedSearch]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.pagination?.total || 0);
  const limit = Number(data?.pagination?.limit || 50);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  const pageStats = useMemo(() => ({
    withImage: items.filter(item => item.image_url).length,
    updated: items.filter(item => item.update_status === 'UPDATED').length,
    review: items.filter(item => item.update_status === 'REVIEW' || item.relation_status !== 'CONFIRMED').length
  }), [items]);

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
              <button type="button" key={code} className={source === code ? 'active' : ''} onClick={() => setSource(code)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="commerce-management-metrics">
          <article><span>Total</span><strong>{commerceFormatNumber(total)}</strong><small>na fonte selecionada</small></article>
          <article><span>Com foto</span><strong>{commerceFormatNumber(pageStats.withImage)}</strong><small>nesta página</small></article>
          <article><span>Atualizados</span><strong>{commerceFormatNumber(pageStats.updated)}</strong><small>nesta página</small></article>
          <article><span>Verificar</span><strong>{commerceFormatNumber(pageStats.review)}</strong><small>nesta página</small></article>
        </div>
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
            </select>
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
                {items.map(item => (
                  <tr key={item.source_row_id} onClick={() => setSelected(item)}>
                    <td><ImageCell item={item} /></td>
                    <td><code>{item.sku || '—'}</code></td>
                    <td><strong>{item.product_name || 'Produto sem nome'}</strong><small>{item.product_id ? `Produto Mestre #${item.product_id}` : 'Sem Produto Mestre'}</small></td>
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
                ))}
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

      <DetailDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
