import React, { useEffect, useMemo, useState } from 'react';
import {
  closeUpdateCampaign,
  createUpdateCampaign,
  getUpdateItem,
  listUpdateCampaigns,
  listUpdateItems,
  setUpdateCheck
} from './commerce-update-client.js';
import { COMMERCE_MARKETPLACES, commerceFormatNumber } from './commerce-admin-shared.jsx';
import './commerce-update.css';

const PAGE_SIZE = 50;
const CHECK_LABELS = Object.freeze({
  SKU: 'SKU',
  TITLE: 'Título',
  DESCRIPTION: 'Descrição',
  IMAGES: 'Imagens',
  VIDEO: 'Vídeo',
  ATTRIBUTES: 'Atributos'
});
const STATUS_LABELS = Object.freeze({
  NOT_CHECKED: 'Não verificado',
  OK: 'OK',
  NEEDS_UPDATE: 'Precisa atualizar',
  IN_PROGRESS: 'Em andamento',
  BLOCKED: 'Bloqueado',
  NOT_APPLICABLE: 'Não aplicável',
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  ARCHIVED: 'Arquivada',
  DRAFT: 'Rascunho'
});

function label(value) {
  return STATUS_LABELS[value] || value || '—';
}

function statusTone(value) {
  const token = String(value || '').toUpperCase();
  if (['OK', 'CLOSED'].includes(token)) return 'ok';
  if (['NEEDS_UPDATE', 'BLOCKED'].includes(token)) return 'danger';
  if (['IN_PROGRESS', 'NOT_CHECKED', 'OPEN', 'DRAFT'].includes(token)) return 'warn';
  return 'muted';
}

function UpdateStatus({ value }) {
  return <span className={`commerce-update-status ${statusTone(value)}`}>{label(value)}</span>;
}

function formatDate(value) {
  if (!value) return '—';
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
    return '—';
  }
}

function CheckEditor({ check, busy, onSave }) {
  const [status, setStatus] = useState(check.status || 'NOT_CHECKED');
  const [detectedValue, setDetectedValue] = useState(check.detected_value || '');
  const [notes, setNotes] = useState(check.notes || '');

  useEffect(() => {
    setStatus(check.status || 'NOT_CHECKED');
    setDetectedValue(check.detected_value || '');
    setNotes(check.notes || '');
  }, [check.id, check.status, check.detected_value, check.notes]);

  return (
    <article className={`commerce-update-check ${check.is_required ? 'required' : 'optional'}`}>
      <div className="commerce-update-check-head">
        <div>
          <strong>{CHECK_LABELS[check.check_type] || check.check_type}</strong>
          <span>{check.is_required ? 'Obrigatório' : 'Opcional'} · {check.expected_value || 'Sem valor esperado'}</span>
        </div>
        <UpdateStatus value={check.status} />
      </div>
      <div className="commerce-update-check-form">
        <label>
          <span>Status</span>
          <select value={status} onChange={event => setStatus(event.target.value)} disabled={busy}>
            <option value="NOT_CHECKED">Não verificado</option>
            <option value="OK">OK</option>
            <option value="NEEDS_UPDATE">Precisa atualizar</option>
            <option value="IN_PROGRESS">Em andamento</option>
            <option value="BLOCKED">Bloqueado</option>
            <option value="NOT_APPLICABLE">Não aplicável</option>
          </select>
        </label>
        <label>
          <span>Valor encontrado</span>
          <input value={detectedValue} onChange={event => setDetectedValue(event.target.value)} placeholder="Ex.: 2026 encontrado no título" disabled={busy} />
        </label>
        <label className="commerce-update-notes-field">
          <span>Observação</span>
          <input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Observação da revisão" disabled={busy} />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(check.id, { status, detectedValue, expectedValue: check.expected_value, notes })}
        >
          Salvar verificação
        </button>
      </div>
    </article>
  );
}

function ItemDrawer({ item, busyCheckId, onSaveCheck, onClose }) {
  if (!item) return null;
  const checks = Array.isArray(item.checks) ? item.checks : [];
  return (
    <div className="commerce-update-drawer-backdrop" onClick={onClose}>
      <aside className="commerce-update-drawer" onClick={event => event.stopPropagation()}>
        <div className="commerce-update-drawer-head">
          <div>
            <span>{item.marketplace_name} · anúncio #{item.external_listing_id || item.listing_id}</span>
            <h3>{item.product_name}</h3>
            <small>SKU atual: {item.current_sku || '—'} · edição {item.edition_year || '—'}</small>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
        <div className="commerce-update-drawer-summary">
          <UpdateStatus value={item.overall_status} />
          {item.listing_url ? <a href={item.listing_url} target="_blank" rel="noreferrer">Abrir anúncio</a> : null}
        </div>
        <div className="commerce-update-check-list">
          {checks.map(check => (
            <CheckEditor key={check.id} check={check} busy={busyCheckId === check.id} onSave={onSaveCheck} />
          ))}
        </div>
      </aside>
    </div>
  );
}

export default function CommerceUpdateView({ onCatalogChanged }) {
  const nowYear = new Date().getFullYear();
  const [sourceYear, setSourceYear] = useState(nowYear);
  const [targetYear, setTargetYear] = useState(nowYear + 1);
  const [name, setName] = useState(`Atualização ${nowYear + 1}`);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsOffset, setItemsOffset] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [busyCheckId, setBusyCheckId] = useState(null);
  const [closing, setClosing] = useState(false);

  const currentCampaign = useMemo(
    () => campaigns.find(item => item.id === selectedCampaign?.id) || selectedCampaign,
    [campaigns, selectedCampaign]
  );

  async function refreshCampaigns() {
    setCampaignsLoading(true);
    try {
      const result = await listUpdateCampaigns({ limit: 50, offset: 0 });
      setCampaigns(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      setError(err.message || 'Não foi possível listar campanhas.');
    } finally {
      setCampaignsLoading(false);
    }
  }

  async function loadItems(campaign, nextOffset = 0, next = {}) {
    if (!campaign?.id) return;
    setItemsLoading(true);
    setError('');
    try {
      const result = await listUpdateItems(campaign.id, {
        status: next.status ?? status,
        marketplace: next.marketplace ?? marketplace,
        search: next.search ?? search,
        limit: PAGE_SIZE,
        offset: nextOffset
      });
      setSelectedCampaign(campaign);
      setItems(Array.isArray(result?.items) ? result.items : []);
      setItemsTotal(Number(result?.pagination?.total || 0));
      setItemsOffset(nextOffset);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os itens da campanha.');
    } finally {
      setItemsLoading(false);
    }
  }

  useEffect(() => { refreshCampaigns(); }, []);

  useEffect(() => {
    if (selectedCampaign?.id) loadItems(selectedCampaign, 0);
  }, [status, marketplace]);

  async function handleCreate(event) {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const created = await createUpdateCampaign({ name, sourceYear, targetYear });
      setMessage(`Campanha criada com ${commerceFormatNumber(created?.item_count || 0)} item(ns) anuais.`);
      await refreshCampaigns();
      const campaign = {
        id: Number(created.campaign_id),
        name,
        source_year: Number(sourceYear),
        target_year: Number(targetYear),
        status: 'OPEN',
        item_count: Number(created.item_count || 0),
        pending_count: Number(created.item_count || 0)
      };
      setSelectedCampaign(campaign);
      await loadItems(campaign, 0);
      onCatalogChanged?.();
    } catch (err) {
      setError(err.message || 'Não foi possível criar a campanha.');
    } finally {
      setCreating(false);
    }
  }

  async function openItem(itemId) {
    setError('');
    try {
      setSelectedItem(await getUpdateItem(itemId));
    } catch (err) {
      setError(err.message || 'Não foi possível abrir o item.');
    }
  }

  async function handleSaveCheck(checkId, values) {
    setBusyCheckId(checkId);
    setError('');
    try {
      const updatedItem = await setUpdateCheck(checkId, values);
      setSelectedItem(updatedItem);
      if (selectedCampaign) {
        await Promise.all([
          loadItems(selectedCampaign, itemsOffset),
          refreshCampaigns()
        ]);
      }
      onCatalogChanged?.();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar a verificação.');
    } finally {
      setBusyCheckId(null);
    }
  }

  async function handleCloseCampaign() {
    if (!currentCampaign?.id || currentCampaign.status !== 'OPEN') return;
    if (Number(currentCampaign.pending_count || 0) > 0) return;
    if (!window.confirm(`Fechar a campanha “${currentCampaign.name}”?`)) return;
    setClosing(true);
    setError('');
    try {
      await closeUpdateCampaign(currentCampaign.id);
      setMessage('Campanha fechada com sucesso.');
      await refreshCampaigns();
      onCatalogChanged?.();
    } catch (err) {
      setError(err.message || 'Não foi possível fechar a campanha.');
    } finally {
      setClosing(false);
    }
  }

  const page = Math.floor(itemsOffset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(itemsTotal / PAGE_SIZE));

  return (
    <div className="commerce-update-page">
      {error && <div className="commerce-error">{error}</div>}
      {message && <div className="commerce-update-message">{message}</div>}

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Nova campanha anual</h2>
            <p>Inclui somente produtos classificados como ANUAL da edição de origem. Produtos permanentes ficam fora automaticamente.</p>
          </div>
        </div>
        <form className="commerce-update-create" onSubmit={handleCreate}>
          <label><span>Nome</span><input value={name} onChange={event => setName(event.target.value)} required /></label>
          <label><span>Ano origem</span><input type="number" min="2000" max="2100" value={sourceYear} onChange={event => setSourceYear(event.target.value)} required /></label>
          <label><span>Ano destino</span><input type="number" min="2000" max="2100" value={targetYear} onChange={event => setTargetYear(event.target.value)} required /></label>
          <button type="submit" disabled={creating}>{creating ? 'Criando…' : 'Criar campanha'}</button>
        </form>
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div><h2>Campanhas</h2><p>Histórico e progresso das viradas anuais.</p></div>
          <button type="button" className="commerce-secondary-button" onClick={refreshCampaigns} disabled={campaignsLoading}>Atualizar</button>
        </div>
        {campaignsLoading ? <div className="commerce-update-loading">Carregando campanhas…</div> : campaigns.length ? (
          <div className="commerce-table-wrap">
            <table className="commerce-table commerce-update-campaign-table">
              <thead><tr><th>Campanha</th><th>Período</th><th>Itens</th><th>Concluídos</th><th>Pendentes</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {campaigns.map(campaign => (
                  <tr key={campaign.id} className={currentCampaign?.id === campaign.id ? 'selected' : ''}>
                    <td><strong>{campaign.name}</strong><small>{formatDate(campaign.created_at)}</small></td>
                    <td>{campaign.source_year} → {campaign.target_year}</td>
                    <td>{commerceFormatNumber(campaign.item_count)}</td>
                    <td>{commerceFormatNumber(campaign.ok_count)}</td>
                    <td>{commerceFormatNumber(campaign.pending_count)}</td>
                    <td><UpdateStatus value={campaign.status} /></td>
                    <td><button type="button" className="commerce-secondary-button" onClick={() => loadItems(campaign, 0)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="commerce-update-empty"><strong>Nenhuma campanha criada.</strong><span>Crie a primeira quando o catálogo anual estiver importado.</span></div>}
      </section>

      {currentCampaign && (
        <section className="commerce-panel">
          <div className="commerce-panel-header commerce-panel-header-stack">
            <div>
              <h2>{currentCampaign.name}</h2>
              <p>{currentCampaign.source_year} → {currentCampaign.target_year} · {commerceFormatNumber(currentCampaign.pending_count)} pendente(s)</p>
            </div>
            <div className="commerce-update-toolbar">
              <form onSubmit={event => { event.preventDefault(); loadItems(currentCampaign, 0, { search }); }}>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar produto, SKU ou anúncio" />
                <button type="submit">Buscar</button>
              </form>
              <select value={marketplace} onChange={event => setMarketplace(event.target.value)}>
                {COMMERCE_MARKETPLACES.map(([code, text]) => <option value={code} key={code || 'all'}>{text}</option>)}
              </select>
              <select value={status} onChange={event => setStatus(event.target.value)}>
                <option value="">Todos os estados</option>
                <option value="NOT_CHECKED">Não verificados</option>
                <option value="NEEDS_UPDATE">Precisa atualizar</option>
                <option value="IN_PROGRESS">Em andamento</option>
                <option value="BLOCKED">Bloqueados</option>
                <option value="OK">OK</option>
              </select>
              <button
                type="button"
                className="commerce-update-close"
                disabled={closing || currentCampaign.status !== 'OPEN' || Number(currentCampaign.pending_count || 0) > 0}
                onClick={handleCloseCampaign}
              >
                {currentCampaign.status === 'CLOSED' ? 'Campanha fechada' : 'Fechar campanha'}
              </button>
            </div>
          </div>

          {itemsLoading ? <div className="commerce-update-loading">Carregando itens…</div> : items.length ? (
            <div className="commerce-table-wrap">
              <table className="commerce-table commerce-update-items-table">
                <thead><tr><th>Produto</th><th>Plataforma</th><th>Anúncio</th><th>Progresso obrigatório</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td><strong>{item.product_name}</strong><small>{item.current_sku || 'Sem SKU atual'} · edição {item.edition_year || '—'}</small></td>
                      <td>{item.marketplace_name}</td>
                      <td><strong>{item.external_listing_id || `#${item.listing_id}`}</strong><small>{item.listing_title || 'Título não capturado'}</small></td>
                      <td>{commerceFormatNumber(item.required_ok)} / {commerceFormatNumber(item.required_total)}</td>
                      <td><UpdateStatus value={item.overall_status} /></td>
                      <td><button type="button" className="commerce-secondary-button" onClick={() => openItem(item.id)}>Revisar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="commerce-update-empty"><strong>Nenhum item neste filtro.</strong><span>A campanha pode não possuir produtos anuais da edição selecionada ou o filtro não encontrou resultados.</span></div>}

          <div className="commerce-pagination">
            <span>Página {page} de {pages} · {commerceFormatNumber(itemsTotal)} itens</span>
            <div>
              <button type="button" disabled={itemsOffset <= 0 || itemsLoading} onClick={() => loadItems(currentCampaign, Math.max(0, itemsOffset - PAGE_SIZE))}>Anterior</button>
              <button type="button" disabled={itemsOffset + PAGE_SIZE >= itemsTotal || itemsLoading} onClick={() => loadItems(currentCampaign, itemsOffset + PAGE_SIZE)}>Próxima</button>
            </div>
          </div>
        </section>
      )}

      <ItemDrawer item={selectedItem} busyCheckId={busyCheckId} onSaveCheck={handleSaveCheck} onClose={() => setSelectedItem(null)} />
    </div>
  );
}
