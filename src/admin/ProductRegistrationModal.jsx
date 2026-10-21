import React, { useEffect, useState } from 'react';
import ProductCutoutImage from '../product-cutout-image.jsx';
import { CommerceSyncBadge } from './CommerceSyncBadge.jsx';
import { createEan13Svg, downloadBarcodePng, downloadBarcodeZip } from '../ean-barcode.js';

export function RegistrationBarcodeResult({ items, errors = [], onReset, onClose, title = 'Produtos cadastrados' }) {
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const barcodeItems = items.filter(item => /^\d{13}$/.test(String(item.gtin || '')));

  const downloadAll = async () => {
    setDownloadBusy(true);
    setDownloadError('');
    try {
      await downloadBarcodeZip(barcodeItems, '', 'etiquetas-produtos-cadastrados.zip');
    } catch (error) {
      setDownloadError(error?.message || 'Não foi possível gerar o pacote de etiquetas.');
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="registration-result">
      <div className="registration-result-hero">
        <span className="registration-result-check">✓</span>
        <div><h4>{title}</h4><p>{barcodeItems.length} etiqueta{barcodeItems.length === 1 ? '' : 's'} pronta{barcodeItems.length === 1 ? '' : 's'} para baixar.</p></div>
      </div>

      {barcodeItems.length > 0 && <div className="registration-barcode-list">
        {barcodeItems.map(item => (
          <article className="registration-barcode-card" key={`${item.id || item.sku}-${item.gtin}`}>
            <div className="registration-barcode-preview" dangerouslySetInnerHTML={{ __html: createEan13Svg(item) }} />
            <div className="registration-barcode-info">
              <strong>{item.nome || item.sku}</strong>
              <span>{item.variacao || item.sku}</span>
              <code>{item.gtin}</code>
              <CommerceSyncBadge sync={item.commerce_sync} />
            </div>
            <button type="button" onClick={() => downloadBarcodePng(item).catch(error => setDownloadError(error.message))}>Baixar PNG</button>
          </article>
        ))}
      </div>}

      {errors.length > 0 && <div className="registration-result-errors">
        <strong>{errors.length} item{errors.length === 1 ? '' : 's'} precisa{errors.length === 1 ? '' : 'm'} de atenção</strong>
        {errors.map((item, index) => <p key={`${item.sku || 'item'}-${index}`}><b>{item.sku || `Linha ${item.row || index + 1}`}:</b> {item.error}</p>)}
      </div>}
      {downloadError && <div className="form-error-banner">{downloadError}</div>}

      <div className="registration-result-actions">
        <button type="button" className="btn-cancel" onClick={onReset}>Cadastrar outros produtos</button>
        {barcodeItems.length > 1 && <button type="button" className="btn-download-labels" disabled={downloadBusy} onClick={downloadAll}>{downloadBusy ? 'Gerando ZIP…' : 'Baixar todas em ZIP'}</button>}
        <button type="button" className="btn-submit-rainbow" onClick={onClose}>Concluir</button>
      </div>
    </div>
  );
}

export default function CreateProductModal({ isOpen, onClose, onCreated, api, compressAdminImage }) {
  const [nome, setNome] = useState('');
  const [variants, setVariants] = useState([
    { id: 1, sku: '', gtin: '', variacao: '', file: null, preview: '' }
  ]);
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const hasUnsavedDraft = !result && (
    nome.trim() !== ''
    || variants.length > 1
    || variants.some(variant =>
      String(variant.sku || '').trim() !== ''
      || String(variant.gtin || '').trim() !== ''
      || String(variant.variacao || '').trim() !== ''
      || Boolean(variant.file)
    )
  );

  const resetForm = () => {
    setNome('');
    setVariants([{ id: Date.now(), sku: '', gtin: '', variacao: '', file: null, preview: '' }]);
    setProgressMsg('');
    setError('');
    setResult(null);
    setConfirmCloseOpen(false);
  };

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !hasUnsavedDraft || result) return undefined;

    const protectUnsavedRegistration = event => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', protectUnsavedRegistration);
    return () => window.removeEventListener('beforeunload', protectUnsavedRegistration);
  }, [isOpen, hasUnsavedDraft, result]);

  if (!isOpen) return null;

  const requestClose = () => {
    if (busy) return;
    if (result || !hasUnsavedDraft) {
      onClose();
      return;
    }
    setConfirmCloseOpen(true);
  };

  const discardRegistration = () => {
    resetForm();
    onClose();
  };

  const addVariant = () => {
    setVariants(prev => [
      ...prev,
      { id: Date.now(), sku: '', gtin: '', variacao: '', file: null, preview: '' }
    ]);
  };

  const removeVariant = (id) => {
    if (variants.length <= 1) return;
    setVariants(prev => prev.filter(v => v.id !== id));
  };

  const updateVariant = (id, field, value) => {
    setVariants(prev => prev.map(v => {
      if (v.id !== id) return v;
      if (field === 'file') {
        const file = value;
        const preview = file ? URL.createObjectURL(file) : '';
        return { ...v, file, preview };
      }
      return { ...v, [field]: value };
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setProgressMsg('');

    try {
      const failures = [];
      const registered = [];

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const cleanSku = v.sku.trim().toUpperCase();
        if (!cleanSku) continue;
        const cleanGtin = v.gtin.replace(/\D/g, '');
        if (cleanGtin.length !== 13) {
          failures.push({ sku: cleanSku, error: 'Código EAN-13 inválido (deve ter 13 dígitos).' });
          continue;
        }

        setProgressMsg(`Salvando variação ${i + 1} de ${variants.length} (${cleanSku})…`);

        try {
          const res = await api('/api/products', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sku: cleanSku,
              gtin: cleanGtin,
              nome: nome.trim(),
              variacao: v.variacao.trim() || cleanSku
            })
          });

          const productId = Number(res.id);
          if (!Number.isSafeInteger(productId) || productId <= 0) {
            throw new Error('O cadastro não retornou o ID do produto. Atualize a lista antes de tentar novamente.');
          }

          let commerceSync = res.commerce_sync || null;
          const registeredItem = {
            id: productId,
            sku: cleanSku,
            gtin: cleanGtin,
            nome: nome.trim(),
            variacao: v.variacao.trim() || cleanSku,
            commerce_sync: commerceSync
          };

          if (v.file) {
            try {
              const compressed = await compressAdminImage(v.file);
              const fd = new FormData();
              fd.append('image', compressed || v.file);
              const imageResult = await api(`/api/products/${productId}/image`, {
                method: 'POST',
                body: fd
              });
              commerceSync = imageResult.commerce_sync || commerceSync;
              registeredItem.commerce_sync = commerceSync;
            } catch (imageError) {
              failures.push({ sku: cleanSku, error: `Produto cadastrado, mas a imagem não foi salva: ${imageError.message || 'falha no envio'}. Abra o produto para reenviar a imagem.` });
            }
          }

          registered.push(registeredItem);
        } catch (err) {
          failures.push({ sku: cleanSku, error: err.message || 'Falha ao salvar produto.' });
        }
      }

      if (registered.length > 0) {
        await onCreated?.({
          type: 'created',
          productIds: registered.map(item => Number(item.id)).filter(Number.isSafeInteger),
          skus: registered.map(item => item.sku).filter(Boolean),
          count: registered.length
        });
        setResult({ items: registered, errors: failures });
      } else if (failures.length > 0) {
        setError(`Falha ao cadastrar: ${failures.map(f => `${f.sku}: ${f.error}`).join('; ')}`);
      }
    } catch (err) {
      setError(err.message || 'Falha ao criar produto.');
    } finally {
      setBusy(false);
      setProgressMsg('');
    }
  };

  return (
    <>
      <div className="admin-modal-backdrop" onClick={e => e.target === e.currentTarget && requestClose()}>
        <div className="admin-modal create-modal" style={{ maxWidth: '820px' }}>
        <div className="admin-modal-head">
          <div>
            <h3>Cadastrar Novo Produto com Variações</h3>
            <small>Defina o produto pai e adicione todas as capas/variantes de uma vez.</small>
          </div>
          <button type="button" className="admin-modal-close" onClick={requestClose} disabled={busy} aria-label="Fechar cadastro">✕</button>
        </div>

        {result ? (
          <RegistrationBarcodeResult
            items={result.items}
            errors={result.errors}
            onReset={resetForm}
            onClose={onClose}
          />
        ) : (
          <form onSubmit={handleSubmit} className="admin-modal-form">
            <div className="form-group">
              <label>Nome do Produto Pai *</label>
              <input
                type="text"
                required
                placeholder="Ex: Agenda 2026 Personalizada"
                value={nome}
                onChange={e => setNome(e.target.value)}
              />
              <small>Plataformas e anúncios são vinculados automaticamente pelo Catálogo Comercial.</small>
            </div>

            <div className="variants-section-header">
              <div className="variants-header-title">
                <h4>Capas / Variações</h4>
                <span className="variants-count-badge">{variants.length}</span>
              </div>
              <button type="button" className="btn-add-variant" onClick={addVariant}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Adicionar Outra Capa</span>
              </button>
            </div>

            <div className="variants-card-list">
              {variants.map((v, index) => (
                <div key={v.id} className="variant-entry-box">
                  <div className="variant-entry-head">
                    <span className="variant-badge">Capa #{index + 1}</span>
                    {variants.length > 1 && (
                      <button type="button" className="btn-remove-variant" onClick={() => removeVariant(v.id)}>
                        Remover
                      </button>
                    )}
                  </div>

                  <div className="form-row-3">
                    <div className="form-group">
                      <label>SKU * (Ex: VACMNO_PQV{index + 1}_BBB)</label>
                      <input
                        type="text"
                        required
                        placeholder="SKU da variação"
                        value={v.sku}
                        onChange={e => updateVariant(v.id, 'sku', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>EAN-13 *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength="13"
                        placeholder="7890000000000"
                        value={v.gtin}
                        onChange={e => updateVariant(v.id, 'gtin', e.target.value.replace(/\D/g, '').slice(0, 13))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Nome da Variação / Capa (Ex: CAPA {index + 1})</label>
                      <input
                        type="text"
                        placeholder={`Ex: CAPA ${index + 1}`}
                        value={v.variacao}
                        onChange={e => updateVariant(v.id, 'variacao', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Mockup da Variante</label>
                    <div className="photo-upload-dropzone" style={{ height: '110px', padding: '10px' }}>
                      {v.preview ? (
                        <div className="photo-upload-preview" style={{ height: '90px' }}>
                          <ProductCutoutImage src={v.preview} alt="Prévia" style={{ height: '80px', width: '80px' }} />
                          <label className="photo-change-btn" style={{ fontSize: '11px', padding: '4px 8px' }}>
                            Trocar foto
                            <input type="file" accept="image/*" onChange={e => updateVariant(v.id, 'file', e.target.files?.[0])} />
                          </label>
                        </div>
                      ) : (
                        <label className="photo-empty-drop" style={{ padding: '10px' }}>
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                            <circle cx="9" cy="9" r="2" />
                            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                          </svg>
                          <strong style={{ fontSize: '11px' }}>Selecionar mockup</strong>
                          <input type="file" accept="image/*" onChange={e => updateVariant(v.id, 'file', e.target.files?.[0])} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="form-error-banner" style={{ marginTop: '16px' }}>{error}</div>}

            <div className="admin-modal-foot" style={{ marginTop: '20px' }}>
              <button type="button" className="btn-cancel" onClick={requestClose} disabled={busy}>Cancelar</button>
              <button type="submit" className={`btn-submit-rainbow ${busy ? 'nisti-action-busy' : ''}`} disabled={busy} style={{ minWidth: '180px' }}>
                <span>{busy ? (progressMsg || 'Cadastrando variações…') : `Salvar ${variants.length} produto(s)`}</span>
              </button>
            </div>
          </form>
        )}
        </div>
      </div>

      {confirmCloseOpen && (
        <div className="admin-modal-backdrop unsaved-registration-backdrop" role="presentation">
          <div
            className="unsaved-registration-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-registration-title"
            aria-describedby="unsaved-registration-description"
          >
            <div className="unsaved-registration-icon" aria-hidden="true">!</div>
            <div className="unsaved-registration-copy">
              <h3 id="unsaved-registration-title">Cadastro ainda não foi salvo</h3>
              <p id="unsaved-registration-description">
                Você começou a cadastrar este produto. Deseja continuar cadastrando o item?
              </p>
            </div>
            <div className="unsaved-registration-actions">
              <button
                type="button"
                className="btn-cancel unsaved-registration-discard"
                onClick={discardRegistration}
              >
                Descartar cadastro
              </button>
              <button
                type="button"
                className="btn-submit-rainbow"
                onClick={() => setConfirmCloseOpen(false)}
                autoFocus
              >
                Continuar cadastrando
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

