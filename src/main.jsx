import React, { useState, useEffect, useMemo } from 'react';
import './app.css';
import AdminSidebar from './admin/AdminSidebar.jsx';
import AdminNotificationsModal from './admin/AdminNotificationsModal.jsx';
import AdminTopbar from './admin/AdminTopbar.jsx';
import CreateProductModal, { RegistrationBarcodeResult } from './admin/ProductRegistrationModal.jsx';
import { catalogRowsFromCsv } from './admin/catalog-csv-parser.js';
import SystemHealthView from './system-health-view.jsx';
import ExpeditionDashboard from './admin/ExpeditionDashboard.jsx';
import CatalogView, { CatalogPlatformTags } from './admin/CatalogView.jsx';
import BarcodeGeneratorView from './admin/BarcodeGeneratorView.jsx';
import GtinEventsView from './admin/GtinEventsView.jsx';
import ProductsWithoutGtinView from './admin/ProductsWithoutGtinView.jsx';
import MuralNistiAdminView from './admin/MuralNistiAdminView.jsx';
import OperatorPinAdminView from './admin/OperatorPinAdminView.jsx';
import NotificationDispatchView from './admin/NotificationDispatchView.jsx';
import MuralNisti from './mural-nisti.jsx';
import CommerceManagementView from './commerce-management-view.jsx';
import CommerceCommercialDashboard from './commerce-ad-manager.jsx';
import './commerce-admin.css';
import ProductCutoutImage from './product-cutout-image.jsx';
import ProductImageTreatmentWorker from './product-image-treatment-worker.jsx';
import { CommerceSyncBadge, commerceSyncMeta } from './admin/CommerceSyncBadge.jsx';


const WIREO_OPTIONS = [
  ['P', 'Preto'],
  ['B', 'Branco'],
  ['R', 'Rose Gold']
];

const ACCESSORY_OPTIONS = [
  ['P', 'Preto'],
  ['B', 'Branco'],
  ['A', 'Azul'],
  ['R', 'Rosa'],
  ['V', 'Verde'],
  ['L', 'Laranja']
];

const TASSEL_OPTIONS = [
  ['X', 'Sem tassel'],
  ...ACCESSORY_OPTIONS
];

const ELASTIC_OPTIONS = [
  ['X', 'Sem elástico'],
  ...ACCESSORY_OPTIONS
];

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
}

function formatCurrentDateTime() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now);

  const dayWeek = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long'
  }).format(now);

  const timeStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit'
  }).format(now);

  const capitalizedDay = dayWeek.charAt(0).toUpperCase() + dayWeek.slice(1);
  return { date: dateStr, weekdayTime: `${capitalizedDay}, ${timeStr}` };
}

async function compressAdminImage(file) {
  if (!file) return null;
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise(resolve => {
    img.onload = resolve;
    img.src = url;
  });
  URL.revokeObjectURL(url);

  let width = img.width;
  let height = img.height;
  const maxSide = 768;
  
  if (width > height && width > maxSide) {
    height = Math.round(height * maxSide / width);
    width = maxSide;
  } else if (height > width && height > maxSide) {
    width = Math.round(width * maxSide / height);
    height = maxSide;
  } else if (width <= maxSide && height <= maxSide) {
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
}

/* =========================================================================
   TOPBAR COMPONENT
   ========================================================================= */
/* =========================================================================
   WELCOME & LIVE DATE BANNER
   ========================================================================= */
function WelcomeDateBanner() {
  const [nowData, setNowData] = useState(formatCurrentDateTime());

  useEffect(() => {
    const timer = setInterval(() => setNowData(formatCurrentDateTime()), 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="welcome-banner">
      <div className="welcome-copy">
        <h2>Bem-vindo, Administrador</h2>
        <p>Gerencie o catálogo de produtos e acompanhe as identificações da expedição.</p>
      </div>

      <div className="live-date-card">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <div className="live-date-info">
          <strong>{nowData.date}</strong>
          <small>{nowData.weekdayTime}</small>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   REGISTRATION & MODAL HELPERS
   ========================================================================= */
function ProductGtinManager({ productId }) {
  const [gtins, setGtins] = useState([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await api(`/api/products/${productId}/gtins`);
      setGtins((data.gtins || []).filter(item => item.active));
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os códigos EAN.');
    }
  };

  useEffect(() => { load(); }, [productId]);

  const add = async () => {
    const gtin = value.replace(/\D/g, '');
    if (gtin.length !== 13) {
      setError('Informe um EAN-13 válido com 13 dígitos.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/products/${productId}/gtins`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gtin, source: 'NISTI' })
      });
      setValue('');
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível vincular o EAN.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async gtin => {
    if (!confirm(`Desvincular o EAN ${gtin} deste produto?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/products/${productId}/gtins/${encodeURIComponent(gtin)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message || 'Não foi possível desvincular o EAN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="product-gtin-manager">
      <div className="product-gtin-heading">
        <div>
          <strong>Códigos EAN vinculados</strong>
          <small>O scanner usa estes códigos para localizar o produto diretamente.</small>
        </div>
        <span>{gtins.length} ativo{gtins.length === 1 ? '' : 's'}</span>
      </div>
      <div className="product-gtin-add">
        <input
          type="text"
          inputMode="numeric"
          maxLength="13"
          placeholder="Digite os 13 números do EAN"
          value={value}
          onChange={event => setValue(event.target.value.replace(/\D/g, '').slice(0, 13))}
        />
        <button type="button" onClick={add} disabled={busy || value.length !== 13}>Vincular</button>
      </div>
      {gtins.length > 0 ? (
        <div className="product-gtin-list">
          {gtins.map(item => (
            <div key={item.id} className="product-gtin-row">
              <span>▥</span>
              <strong>{item.gtin}</strong>
              <small>{item.source || 'NISTI'}</small>
              <button type="button" onClick={() => remove(item.gtin)} disabled={busy}>Remover</button>
            </div>
          ))}
        </div>
      ) : <p className="product-gtin-empty">Nenhum EAN cadastrado para este produto.</p>}
      {error && <div className="form-error-banner">{error}</div>}
    </section>
  );
}

function EditProductModal({ product, isOpen, onClose, onUpdated }) {
  const [sku, setSku] = useState('');
  const [nome, setNome] = useState('');
  const [variacao, setVariacao] = useState('');
  const [platform, setPlatform] = useState('MERCADO LIVRE');
  const [link, setLink] = useState('');
  const [wireo, setWireo] = useState('B');
  const [tassel, setTassel] = useState('X');
  const [elastico, setElastico] = useState('B');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (product) {
      setSku(product.sku || '');
      setNome(product.nome || '');
      setVariacao(product.variacao || '');
      setPlatform(product.platform || 'MERCADO LIVRE');
      setLink(product.link || '');
      setWireo(product.wireo_code || 'B');
      setTassel(product.tassel_code || 'X');
      setElastico(product.elastico_code || 'B');
      setFile(null);
      setPreview('');
      setError('');
    }
  }, [product, isOpen]);

  if (!isOpen || !product) return null;

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const updateResult = await api(`/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sku: sku.trim().toUpperCase(),
          nome: nome.trim(),
          variacao: variacao.trim(),
          platform: platform.trim().toUpperCase(),
          link: link.trim(),
          wireo_code: wireo,
          tassel_code: tassel,
          elastico_code: elastico
        })
      });

      let commerceSync = updateResult.commerce_sync || null;

      if (file) {
        const compressed = await compressAdminImage(file);
        const fd = new FormData();
        fd.append('image', compressed || file);
        const imageResult = await api(`/api/products/${product.id}/image`, {
          method: 'POST',
          body: fd
        });
        commerceSync = imageResult.commerce_sync || commerceSync;
      }

      const savedSyncStatus = String(commerceSync?.status || commerceSync?.sync_status || '').toUpperCase();
      await onUpdated?.({
        type: commerceSync && savedSyncStatus !== 'SYNCED' ? 'updated-sync-pending' : 'updated',
        productIds: [Number(product.id)],
        skus: [sku.trim().toUpperCase()],
        count: 1
      });

      if (commerceSync && savedSyncStatus !== 'SYNCED') {
        const syncMeta = commerceSyncMeta(commerceSync);
        setError(`Produto salvo no NISTI ID. Catálogo: ${syncMeta.label}. ${syncMeta.detail}`);
        return;
      }

      onClose();
    } catch (err) {
      setError(err.message || 'Falha ao salvar produto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Editar Produto</h3>
            <small>ID: #{product.id} · Capa: {product.capa_code || '—'}</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSave} className="admin-modal-form">
          <div className="form-row-2">
            <div className="form-group">
              <label>SKU *</label>
              <input
                type="text"
                required
                value={sku}
                onChange={e => setSku(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Plataforma</label>
              <select value={platform} onChange={e => setPlatform(e.target.value)}>
                <option value="MERCADO LIVRE">Mercado Livre</option>
                <option value="SHOPEE">Shopee</option>
                <option value="AMAZON">Amazon</option>
                <option value="MAGALU">Magalu</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Nome do Produto</label>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label>Variação</label>
              <input
                type="text"
                value={variacao}
                onChange={e => setVariacao(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Link do Anúncio</label>
              <input
                type="url"
                value={link}
                onChange={e => setLink(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row-3">
            <div className="form-group">
              <label>Wire-O</label>
              <select value={wireo} onChange={e => setWireo(e.target.value)}>
                {WIREO_OPTIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Tassel</label>
              <select value={tassel} onChange={e => setTassel(e.target.value)}>
                {TASSEL_OPTIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Elástico</label>
              <select value={elastico} onChange={e => setElastico(e.target.value)}>
                {ELASTIC_OPTIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Mockup / Capa</label>
            <div className="photo-upload-dropzone">
              {preview || product.image_url ? (
                <div className="photo-upload-preview">
                  <ProductCutoutImage src={preview || productImage(product)} alt="Prévia" />
                  <label className="photo-change-btn">
                    Trocar foto
                    <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                  </label>
                </div>
              ) : (
                <label className="photo-empty-drop">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#6366f1" strokeWidth="2">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                  </svg>
                  <strong>Selecione uma imagem</strong>
                  <input type="file" accept="image/*" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
              )}
            </div>
          </div>

          <ProductGtinManager productId={product.id} />

          {error && <div className="form-error-banner">{error}</div>}

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className={`btn-submit-rainbow ${busy ? 'nisti-action-busy' : ''}`} disabled={busy}>
              <span>{busy ? 'Salvando…' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewProductModal({ product, isOpen, onClose, onEdit, onSyncComplete }) {
  const [syncState, setSyncState] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    setSyncState(product?.commerce_sync || null);
    setSyncMessage('');
    setSyncError('');
  }, [product?.id, product?.commerce_sync]);

  if (!isOpen || !product) return null;

  const syncMeta = commerceSyncMeta(syncState);

  const repairCommerceSync = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncMessage('');
    setSyncError('');

    try {
      const result = await api(`/api/admin/commerce-sync/nisti-products/${product.id}/repair`, {
        method: 'POST'
      });
      const nextSync = result?.sync || syncState;
      setSyncState(nextSync);

      if (String(nextSync?.status || nextSync?.sync_status || '').toUpperCase() === 'SYNCED') {
        const reconcileStatus = String(result?.reconcile?.status || '').toUpperCase();
        setSyncMessage(
          reconcileStatus === 'ERROR'
            ? 'Produto sincronizado. A reconciliação dos anúncios ficou pendente e pode ser tentada novamente.'
            : 'Sincronização corrigida. Produto Mestre e vínculos do Catálogo foram reconciliados.'
        );
      } else {
        setSyncError(nextSync?.error || nextSync?.last_error || 'O Catálogo ainda não confirmou a sincronização.');
      }

      await onSyncComplete?.(product.id, nextSync);
    } catch (error) {
      setSyncError(error?.message || 'Não foi possível corrigir a sincronização agora.');
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal view-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Detalhes do Produto</h3>
            <small>{product.sku}</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="view-modal-body">
          <div className="view-modal-image-col">
            {product.image_url ? (
              <ProductCutoutImage src={productImage(product)} alt={product.sku} className="view-large-thumb" />
            ) : (
              <div className="view-placeholder-box">Sem mockup cadastrado</div>
            )}
          </div>

          <div className="view-modal-info-col">
            <div className="view-badge-row">
              <span className="capa-code-pill-lg">{product.capa_code}</span>
              <CatalogPlatformTags product={{ ...product, commerce_sync: syncState }} />
              <span className="status-pill active">• Ativo</span>
              <CommerceSyncBadge sync={syncState} />
            </div>

            <h4 className="view-prod-title">{product.nome || 'Produto sem título'}</h4>
            {product.variacao && <p className="view-prod-variation"><strong>Variação:</strong> {product.variacao}</p>}

            <div className="view-spec-grid">
              <div className="view-spec-item">
                <span>Miolo</span>
                <strong>{product.miolo_code || '—'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Acabamento</span>
                <strong>{product.acabamento_code || '—'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Wire-O</span>
                <strong>{WIREO_OPTIONS.find(([v]) => v === product.wireo_code)?.[1] || product.wireo_code || 'Branco'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Tassel</span>
                <strong>{TASSEL_OPTIONS.find(([v]) => v === product.tassel_code)?.[1] || product.tassel_code || 'Sem'}</strong>
              </div>
              <div className="view-spec-item">
                <span>Elástico</span>
                <strong>{ELASTIC_OPTIONS.find(([v]) => v === product.elastico_code)?.[1] || product.elastico_code || 'Branco'}</strong>
              </div>
            </div>

            <div className={`view-sync-repair ${syncMeta.state}`}>
              <div className="view-sync-repair-copy">
                <strong>Sincronização com o Catálogo</strong>
                <span>{syncMeta.detail}</span>
              </div>
              <button
                type="button"
                className={`btn-sync-repair ${syncBusy ? 'nisti-action-busy' : ''}`}
                onClick={repairCommerceSync}
                disabled={syncBusy}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 7h-5V2" />
                  <path d="M4 17h5v5" />
                  <path d="M5.1 9A8 8 0 0 1 18 5l2 2" />
                  <path d="M18.9 15A8 8 0 0 1 6 19l-2-2" />
                </svg>
                <span>{syncBusy ? 'Corrigindo…' : syncMeta.state === 'synced' ? 'Ressincronizar Catálogo' : 'Corrigir sincronização'}</span>
              </button>
            </div>

            {syncMessage && <div className="view-sync-feedback success" aria-live="polite">{syncMessage}</div>}
            {syncError && <div className="view-sync-feedback error" aria-live="polite">{syncError}</div>}

            {product.link && (
              <a href={product.link} target="_blank" rel="noopener noreferrer" className="view-link-btn">
                Abrir Anúncio na Plataforma ↗
              </a>
            )}
          </div>
        </div>

        <div className="admin-modal-foot view-modal-foot">
          <button type="button" className="btn-cancel" onClick={onClose}>Fechar</button>
          <button type="button" className="btn-edit-action" onClick={() => { onClose(); onEdit(product); }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: '6px' }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span>Editar Produto</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportCsvModal({ isOpen, onClose, onImported }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      setMessage('');
      setError('');
      setResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    setMessage('');
    setError('');

    try {
      const rows = catalogRowsFromCsv(await file.text());
      if (!rows.length) throw new Error('Nenhum SKU válido encontrado na planilha.');

      let created = 0;
      let updated = 0;
      const importedItems = [];
      const importErrors = [];
      const rowsBySku = new Map(rows.map(row => [String(row.sku || '').trim().toUpperCase(), row]));

      for (let i = 0; i < rows.length; i += 50) {
        const data = await api('/api/admin/bulk-products', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: rows.slice(i, i + 50) })
        });
        created += data.created || 0;
        updated += data.updated || 0;
        const syncByProductId = new Map(
          (data.commerce_sync?.results || []).map(sync => [Number(sync.nisti_product_id), sync])
        );
        const bulkSyncFallback = data.commerce_sync?.status === 'ERROR'
          ? { status: 'ERROR', error: data.commerce_sync.error || 'commerce_bulk_sync_failed' }
          : null;

        for (const item of data.imported || []) {
          const source = rowsBySku.get(String(item.sku || '').trim().toUpperCase()) || {};
          importedItems.push({
            ...source,
            ...item,
            gtin: item.gtin || source.gtin,
            nome: source.nome,
            variacao: source.variacao,
            commerce_sync: syncByProductId.get(Number(item.id)) || bulkSyncFallback
          });
        }
        importErrors.push(...(data.errors || []));
      }

      setMessage(`Importação concluída: ${created} novos produtos cadastrados, ${updated} atualizados.`);
      for (const item of importedItems) {
        if (!/^\d{13}$/.test(String(item.gtin || ''))) {
          importErrors.push({ sku: item.sku, error: 'Produto salvo sem EAN válido; nenhuma etiqueta foi gerada.' });
        }
      }
      setResult({ items: importedItems, errors: importErrors, created, updated });
      await onImported();
    } catch (err) {
      setError(err.message || 'Falha ao importar arquivo CSV.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <div>
            <h3>Importar Produtos em Lote (CSV)</h3>
            <small>Envie uma planilha com seus produtos para atualização rápida.</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>

        {result ? <RegistrationBarcodeResult
          items={result.items}
          errors={result.errors}
          title={`Importação concluída: ${result.created} novos e ${result.updated} atualizados`}
          onReset={() => { setResult(null); setMessage(''); setError(''); }}
          onClose={onClose}
        /> : <div className="admin-modal-form">
          <label className={`photo-empty-drop ${busy ? 'nisti-import-busy' : ''}`} style={{ minHeight: '180px' }}>
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
            <strong>{busy ? 'Processando planilha…' : 'Clique para selecionar a planilha CSV'}</strong>
            <span>Use as colunas SKU, EAN, Nome, Variação, Plataforma e Link</span>
            <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => handleUpload(e.target.files?.[0])} />
          </label>

          {message && <div className="form-success-banner nisti-feedback-enter" role="status">{message}</div>}
          {error && <div className="form-error-banner nisti-feedback-enter" role="alert">{error}</div>}

          <div className="admin-modal-foot">
            <button type="button" className="btn-cancel" onClick={onClose}>Fechar</button>
          </div>
        </div>}
      </div>
    </div>
  );
}

/* =========================================================================
   MAIN ADMIN APP ROOT
   ========================================================================= */
function AdminApp() {
  const muralQaMode = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mural') === 'qa';
  const exitMuralQa = () => window.location.assign('/admin#admin/mural-nisti');
  const desktopPreview = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('desktop') === '1';

  const toggleDesktopPreview = () => {
    const url = new URL(window.location.href);
    if (desktopPreview) url.searchParams.delete('desktop');
    else url.searchParams.set('desktop', '1');
    window.location.assign(url.toString());
  };

  const [activeView, setActiveView] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash === '#admin/mural-nisti' || hash === '#mural-nisti' || hash === '#mural-admin' || hash === '#admin-mural') {
      return 'mural-nisti';
    }
    return 'catalogo';
  });

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#admin/mural-nisti' || hash === '#mural-nisti' || hash === '#mural-admin' || hash === '#admin-mural') {
        setActiveView('mural-nisti');
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);
  const [muralSection,setMuralSection]=useState('dashboard');
  const [commerceSection,setCommerceSection]=useState('catalog');
  const [salesRevision,setSalesRevision]=useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [storage, setStorage] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [gtinDashboard, setGtinDashboard] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [createModalOpen, setCreateModalOpen] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('new-scanner-product'));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('new-scanner-product')) {
      url.searchParams.delete('new-scanner-product');
      window.history.replaceState(window.history.state,'',url.toString());
    }
  }, []);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [viewProduct, setViewProduct] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const [recentProductIds, setRecentProductIds] = useState([]);
  const [operationFeedback, setOperationFeedback] = useState(null);

  useEffect(() => {
    if (!operationFeedback && recentProductIds.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setOperationFeedback(null);
      setRecentProductIds([]);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [operationFeedback, recentProductIds]);

  const refreshProducts = async () => {
    try {
      const [p, syncPayload] = await Promise.all([
        api('/api/products'),
        api('/api/admin/commerce-sync/nisti-products/statuses').catch(() => null)
      ]);

      const statuses = new Map(
        (syncPayload?.statuses || []).map(item => [Number(item.nisti_product_id), item])
      );
      const syncAvailable = Boolean(syncPayload?.ok);

      setProducts((p.products || []).map(product => ({
        ...product,
        commerce_sync: syncAvailable
          ? (statuses.get(Number(product.id)) || { sync_status: 'NOT_LINKED', nisti_product_id: Number(product.id) })
          : { sync_status: 'UNKNOWN', nisti_product_id: Number(product.id) }
      })));
    } catch (err) {
      if (/não autorizado|401|403/i.test(err.message)) {
        window.location.href = '/admin-login';
      }
    }
  };

  const refreshMetrics = async (fresh = false) => {
    const suffix = fresh ? '?fresh=1' : '';
    try {
      const [m, s, healthResult, unread, gtin] = await Promise.all([
        api(`/api/admin/system-metrics${suffix}`).catch(() => null),
        api(`/api/admin/storage-metrics${suffix}`).catch(() => null),
        api(`/api/admin/system-health${suffix}`)
          .then(data => ({ data, error: '' }))
          .catch(error => ({ data: null, error: error?.message || 'Falha ao verificar saúde do sistema' })),
        api('/api/admin/system-notifications/unread-count').catch(() => ({ unread_count: 0 })),
        api('/api/admin/gtin-dashboard').catch(() => null)
      ]);
      if (m) setMetrics(m);
      if (s) setStorage(s);
      if (healthResult?.data) setHealth(healthResult.data);
      setHealthError(healthResult?.error || '');
      if (gtin) setGtinDashboard(gtin);
      if (unread?.unread_count !== undefined) setUnreadCount(unread.unread_count);
    } catch (error) {
      setHealthError(error?.message || 'Falha ao atualizar medições');
    }
  };

  const refreshAll = async () => {
    await Promise.all([refreshProducts(), refreshMetrics()]);
  };

  const reportProductChange = async (payload = {}) => {
    await refreshAll();
    const ids = (payload.productIds || []).map(Number).filter(Number.isSafeInteger);
    const skus = (payload.skus || []).filter(Boolean);
    if (ids.length) setRecentProductIds(ids);

    const firstSku = skus[0] || 'Produto';
    if (payload.type === 'created') {
      setOperationFeedback({
        tone: 'success',
        message: payload.count > 1
          ? `${payload.count} produtos cadastrados e catálogo atualizado.`
          : `${firstSku} cadastrado e catálogo atualizado.`
      });
      return;
    }

    if (payload.type === 'updated-sync-pending') {
      setOperationFeedback({
        tone: 'warning',
        message: `${firstSku} salvo no NISTI ID. A sincronização do Catálogo ainda está pendente.`
      });
      return;
    }

    setOperationFeedback({
      tone: 'success',
      message: `${firstSku} atualizado com sucesso.`
    });
  };

  useEffect(() => {
    let cancelled = false;

    // Opening the Scanner admin panel is strictly read-only for Commerce.
    // Imports are the source of marketplace badges; do not auto-seed catalogs.
    refreshAll().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const refreshMetricsIfVisible = () => {
      if (document.visibilityState === 'visible') refreshMetrics();
    };
    const interval = setInterval(refreshMetricsIfVisible, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleDeleteProduct = async (id, sku) => {
    if (!window.confirm(`Tem certeza que deseja excluir o produto ${sku}?`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      await refreshAll();
    } catch (err) {
      alert(err.message || 'Falha ao excluir produto.');
    }
  };

  const handleNavChange = viewId => {
    setActiveView(viewId);
  };
  const productsWithoutGtin = gtinDashboard?.products_without_gtin || [];

  const showProductsWithoutGtin = () => {
    if (productsWithoutGtin.length === 1) {
      setViewProduct(productsWithoutGtin[0]);
      return;
    }
    if (productsWithoutGtin.length > 1) setActiveView('produtos-sem-ean');
  };

  if (loading) {
    return (
      <div className="admin-loading-screen">
        <div className="admin-loading-spinner" />
        <span>Carregando NISTI ID…</span>
      </div>
    );
  }

  return (
    <div className={`admin-layout-root ${desktopPreview ? 'admin-desktop-preview' : ''}`}>
      <ProductImageTreatmentWorker
        enabled
        onBatchComplete={async () => {
          await refreshProducts();
        }}
      />
      <AdminSidebar
        activeView={activeView}
        onViewChange={handleNavChange}
        activeMuralSection={muralSection}
        onMuralSectionChange={setMuralSection}
        activeCommerceSection={commerceSection}
        onCommerceSectionChange={setCommerceSection}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

      <div className="admin-main-wrapper">
        <AdminTopbar
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          unreadCount={unreadCount}
          activeView={activeView}
          activeCommerceSection={commerceSection}
          onOpenNotifications={() => setNotificationsOpen(true)}
          desktopPreview={desktopPreview}
          onToggleDesktopPreview={toggleDesktopPreview}
        />

        <AdminNotificationsModal
          api={api}
          isOpen={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
          unreadCount={unreadCount}
          setUnreadCount={setUnreadCount}
        />

        {operationFeedback && (
          <div className={`nisti-operation-toast ${operationFeedback.tone || 'success'}`} role="status" aria-live="polite">
            <span className="nisti-operation-toast-icon" aria-hidden="true">
              {operationFeedback.tone === 'warning' ? '!' : '✓'}
            </span>
            <span>{operationFeedback.message}</span>
          </div>
        )}

        <main className="admin-page-content">
          <div key={activeView} className="admin-view-transition">
            {!['mural-nisti','commerce','operadores-pin','nisti-dispatch'].includes(activeView) && (
              <>
                <WelcomeDateBanner />
                {/* Dashboard de Produtividade da Expedição & KPIs */}
                <ExpeditionDashboard
                  gtinDashboard={gtinDashboard}
                  productsCount={products.length}
                  onNavigate={handleNavChange}
                  onShowProductsWithoutGtin={showProductsWithoutGtin}
                  api={api}
                />
              </>
            )}

            {activeView === 'mural-nisti' && (muralQaMode ? (
              <section className="admin-mural-qa-view" aria-label="Área de teste do Mural NISTI">
                <header className="admin-mural-qa-header">
                  <div><strong>Área de teste — Mural NISTI</strong><p>Prévia administrativa do aplicativo dos operadores. Não libera o Mural em produção.</p></div>
                  <button type="button" onClick={exitMuralQa}>Voltar ao painel</button>
                </header>
                <MuralNisti />
              </section>
            ) : <MuralNistiAdminView activeSection={muralSection} onSectionChange={setMuralSection} />)}

            {activeView === 'commerce' && (
              <div className="commerce-admin-inline-view">
                {(commerceSection === 'catalog' || commerceSection === 'sales') && <CommerceCommercialDashboard key={salesRevision} salesRevision={salesRevision} />}
                {commerceSection === 'pending' && <CommerceManagementView mode="pending" onCreateScanner={() => { setActiveView('catalogo'); setCreateModalOpen(true); }} />}
              </div>
            )}

            {activeView === 'catalogo' && (
              <CatalogView
                products={products}
                highlightedProductIds={recentProductIds}
                onRefresh={refreshAll}
                onOpenCreate={() => setCreateModalOpen(true)}
                onOpenImport={() => setImportModalOpen(true)}
                onViewProduct={p => setViewProduct(p)}
                onEditProduct={p => setEditProduct(p)}
                onDeleteProduct={handleDeleteProduct}
              />
            )}

            {activeView === 'gerador-barras' && <BarcodeGeneratorView api={api} />}

            {activeView === 'historico-ean' && (
              <GtinEventsView
                api={api}
                products={products}
                onLinkSuccess={refreshAll}
              />
            )}

            {activeView === 'ean-nao-cadastrados' && (
              <GtinEventsView
                initialStatus="not_found"
                api={api}
                products={products}
                onLinkSuccess={refreshAll}
              />
            )}

            {activeView === 'produtos-sem-ean' && (
              <ProductsWithoutGtinView
                products={productsWithoutGtin}
                onSelect={product => setViewProduct(product)}
                onBack={() => setActiveView('catalogo')}
              />
            )}

            {activeView === 'nisti-dispatch' && <NotificationDispatchView />}

            {activeView === 'operadores-pin' && <OperatorPinAdminView />}

            {activeView === 'logs' && (
              <SystemHealthView
                metrics={metrics}
                storage={storage}
                health={health}
                healthError={healthError}
                onRefresh={() => refreshMetrics(true)}
              />
            )}
          </div>
        </main>

        <footer className="admin-global-footer">
          <p>© {new Date().getFullYear()} NISTI ID · Sistema de Identificação por EAN. Todos os direitos reservados.</p>
        </footer>
      </div>

      <CreateProductModal
        api={api}
        compressAdminImage={compressAdminImage}
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={reportProductChange}
      />

      <ImportCsvModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={refreshAll}
      />

      <ViewProductModal
        product={viewProduct}
        isOpen={Boolean(viewProduct)}
        onClose={() => setViewProduct(null)}
        onEdit={p => setEditProduct(p)}
        onSyncComplete={async (productId, sync) => {
          setViewProduct(current => current && Number(current.id) === Number(productId)
            ? { ...current, commerce_sync: sync }
            : current);
          setProducts(current => current.map(item => Number(item.id) === Number(productId)
            ? { ...item, commerce_sync: sync }
            : item));
          await refreshProducts();

          const numericId = Number(productId);
          if (Number.isSafeInteger(numericId)) setRecentProductIds([numericId]);
          const syncStatus = String(sync?.status || sync?.sync_status || '').toUpperCase();
          const syncedSku = viewProduct?.sku || 'Produto';
          setOperationFeedback({
            tone: syncStatus === 'SYNCED' ? 'success' : 'warning',
            message: syncStatus === 'SYNCED'
              ? `${syncedSku} sincronizado com o Catálogo.`
              : `${syncedSku} atualizado, mas o Catálogo ainda não confirmou a sincronização.`
          });
        }}
      />

      <EditProductModal
        product={editProduct}
        isOpen={Boolean(editProduct)}
        onClose={() => setEditProduct(null)}
        onUpdated={reportProductChange}
      />
    </div>
  );
}

export {
  CatalogView,
  BarcodeGeneratorView,
  GtinEventsView,
  ProductGtinManager,
  RegistrationBarcodeResult
};

export default AdminApp;
