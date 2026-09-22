import React, { useEffect, useState } from 'react';
import { commerceApi } from './commerce-admin-api.js';
import {
  COMMERCE_MARKETPLACES,
  COMMERCE_PAGE_SIZE,
  CommerceEmptyState,
  CommerceLoadingBlock,
  CommerceStatusPill,
  commerceFormatNumber,
  commerceStatusLabel
} from './commerce-admin-shared.jsx';
import './commerce-listing-state.css';

function formatDate(value) {
  if (!value) return 'Nunca verificado';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return 'Data inválida';
  }
}

function ListingStateEditor({ listing, busy, onClose, onSave }) {
  const [listingStatus, setListingStatus] = useState(listing.listing_status || 'UNKNOWN');
  const [salesStatus, setSalesStatus] = useState(listing.sales_status || 'UNKNOWN');
  const [videoStatus, setVideoStatus] = useState(listing.video_status || 'UNKNOWN');

  return (
    <div className="commerce-listing-state-backdrop" onClick={onClose}>
      <aside className="commerce-listing-state-panel" onClick={event => event.stopPropagation()}>
        <div className="commerce-listing-state-head">
          <div>
            <span>{listing.marketplace_name || listing.marketplace_code}</span>
            <h3>{listing.title || 'Título não capturado'}</h3>
            <small>{listing.external_listing_id || `Anúncio #${listing.listing_id}`}</small>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>Fechar</button>
        </div>

        <div className="commerce-listing-state-context">
          <div><span>Última verificação</span><strong>{formatDate(listing.last_checked_at)}</strong></div>
          <div><span>Ano observado</span><strong>{listing.observed_year || '—'}</strong></div>
          <div><span>Produtos vinculados</span><strong>{commerceFormatNumber(listing.product_count || 0)}</strong></div>
        </div>

        <div className="commerce-listing-state-form">
          <label>
            <span>Status do anúncio</span>
            <select value={listingStatus} onChange={event => setListingStatus(event.target.value)} disabled={busy}>
              <option value="UNKNOWN">Não verificado</option>
              <option value="ACTIVE">Ativo</option>
              <option value="PAUSED">Pausado</option>
              <option value="INACTIVE">Inativo</option>
              <option value="REMOVED">Removido</option>
            </select>
            <small>Indica se a publicação está disponível na plataforma.</small>
          </label>

          <label>
            <span>Situação de vendas</span>
            <select value={salesStatus} onChange={event => setSalesStatus(event.target.value)} disabled={busy}>
              <option value="UNKNOWN">Não verificado</option>
              <option value="SELLING">Vendendo</option>
              <option value="NO_SALES">Sem vendas</option>
            </select>
            <small>Manual na V1. Futuramente poderá ser calculado a partir das APIs dos marketplaces.</small>
          </label>

          <label>
            <span>Vídeo</span>
            <select value={videoStatus} onChange={event => setVideoStatus(event.target.value)} disabled={busy}>
              <option value="UNKNOWN">Não verificado</option>
              <option value="ACTIVE">Ativo</option>
              <option value="ABSENT">Não possui</option>
              <option value="DISABLED">Desativado</option>
            </select>
            <small>Não confundir vídeo ausente com vídeo desativado.</small>
          </label>
        </div>

        {listing.canonical_url ? (
          <a className="commerce-listing-state-link" href={listing.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio para conferência</a>
        ) : null}

        <div className="commerce-listing-state-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button
            type="button"
            onClick={() => onSave({ listingStatus, salesStatus, videoStatus })}
            disabled={busy}
          >
            {busy ? 'Salvando…' : 'Salvar verificação'}
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function CommerceListingsView() {
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ items: [], pagination: { total: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedListing, setSelectedListing] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load(nextOffset = offset) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(COMMERCE_PAGE_SIZE), offset: String(nextOffset) });
    if (search.trim()) params.set('search', search.trim());
    if (marketplace) params.set('marketplace', marketplace);
    if (status) params.set('status', status);
    try {
      const result = await commerceApi(`/api/admin/commerce/listings?${params}`);
      setData(result || { items: [], pagination: { total: 0 } });
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Falha ao carregar anúncios.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(0); }, [marketplace, status]);

  async function saveListingState(values) {
    const listingId = Number(selectedListing?.listing_id || 0);
    if (!listingId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await commerceApi(`/api/admin/commerce/listings/${listingId}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          listing_status: values.listingStatus,
          sales_status: values.salesStatus,
          video_status: values.videoStatus
        })
      });
      setMessage(`Anúncio #${listingId} verificado e atualizado.`);
      setSelectedListing(null);
      setData(current => ({
        ...current,
        items: (current.items || []).map(item => item.listing_id === listingId
          ? { ...item, ...updated }
          : item)
      }));
    } catch (err) {
      setError(err.message || 'Não foi possível atualizar o anúncio.');
    } finally {
      setSaving(false);
    }
  }

  const total = Number(data?.pagination?.total || 0);
  const page = Math.floor(offset / COMMERCE_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / COMMERCE_PAGE_SIZE));

  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header commerce-panel-header-stack">
        <div>
          <h2>Anúncios por plataforma</h2>
          <p>Um anúncio pode conter múltiplos produtos/variações. Status do anúncio, venda e vídeo são controlados separadamente.</p>
        </div>
        <div className="commerce-filter-row">
          <form onSubmit={event => { event.preventDefault(); load(0); }}>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar título, SKU ou ID" />
            <button type="submit">Buscar</button>
          </form>
          <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
            {COMMERCE_MARKETPLACES.map(([code, label]) => <option key={code || 'all'} value={code}>{label}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Todos os estados</option>
            <option value="ACTIVE">Ativos</option>
            <option value="PAUSED">Pausados</option>
            <option value="INACTIVE">Inativos</option>
            <option value="REMOVED">Removidos</option>
            <option value="UNKNOWN">Não verificados</option>
          </select>
        </div>
      </div>

      {error && <div className="commerce-error">{error}</div>}
      {message && <div className="commerce-listing-state-message">{message}</div>}
      {loading ? <CommerceLoadingBlock label="Carregando anúncios…" /> : data.items?.length ? (
        <div className="commerce-table-wrap">
          <table className="commerce-table commerce-listings-table">
            <thead><tr><th>Plataforma</th><th>Anúncio</th><th>Produtos</th><th>Ano</th><th>Vídeo</th><th>Venda</th><th>Status</th><th>Verificação</th><th></th></tr></thead>
            <tbody>
              {data.items.map(listing => {
                const listingId = Number(listing.listing_id || 0);
                const platformSkus = Array.isArray(listing.platform_skus) ? listing.platform_skus : [];
                return (
                  <tr key={listingId}>
                    <td><strong>{listing.marketplace_name || listing.marketplace_code}</strong><small>{listing.external_listing_id || `#${listingId}`}</small></td>
                    <td>
                      <strong>{listing.title || 'Título não capturado'}</strong>
                      {listing.canonical_url ? <a href={listing.canonical_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : null}
                    </td>
                    <td>{commerceFormatNumber(listing.product_count || 0)}<small>{platformSkus.length ? platformSkus.join(' · ') : 'Sem SKU vinculado'}</small></td>
                    <td>{listing.observed_year || '—'}</td>
                    <td>{commerceStatusLabel(listing.video_status)}</td>
                    <td><CommerceStatusPill value={listing.sales_status} /></td>
                    <td><CommerceStatusPill value={listing.listing_status} /></td>
                    <td><small>{formatDate(listing.last_checked_at)}</small></td>
                    <td><button type="button" className="commerce-secondary-button" onClick={() => setSelectedListing(listing)}>Verificar</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <CommerceEmptyState title="Nenhum anúncio cadastrado" detail="Os anúncios aparecerão aqui após a primeira importação e reconciliação." />}

      <div className="commerce-pagination">
        <span>Página {page} de {pages} · {commerceFormatNumber(total)} registros</span>
        <div>
          <button type="button" disabled={offset <= 0 || loading} onClick={() => load(Math.max(0, offset - COMMERCE_PAGE_SIZE))}>Anterior</button>
          <button type="button" disabled={offset + COMMERCE_PAGE_SIZE >= total || loading} onClick={() => load(offset + COMMERCE_PAGE_SIZE)}>Próxima</button>
        </div>
      </div>

      {selectedListing && (
        <ListingStateEditor
          listing={selectedListing}
          busy={saving}
          onClose={() => !saving && setSelectedListing(null)}
          onSave={saveListingState}
        />
      )}
    </section>
  );
}
