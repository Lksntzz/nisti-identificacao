import React, { useEffect, useRef, useState } from 'react';
import { MuralCard, Hero, CollectionLaunchHero, CollectionLaunchCard } from '../mural-nisti.jsx';
import { productTypeLabel } from '../product-display.js';
import { AdminMuralIcon, request, requestBlob } from './MuralPublishShared.jsx';

export function CanvaArtworkModal({ isOpen, onClose, kind, metadata, imageFiles = [], imageUrls = [], onUseImage, onStatusChange }) {
  const [status, setStatus] = useState({ loading: true, connected: false, art_creation_ready: false, art_missing_scopes: [] });
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [design, setDesign] = useState(null);
  const [manualCreateUrl, setManualCreateUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [createCooldownUntil, setCreateCooldownUntil] = useState(0);
  const createLockRef = useRef(false);

  const load = async () => {
    setError('');
    try {
      const nextStatus = await request('/api/admin/canva/status');
      const st = { loading: false, connected: false, art_creation_ready: false, art_missing_scopes: [], ...nextStatus };
      setStatus(st);
      onStatusChange?.(st);
      if (!nextStatus?.connected || !nextStatus?.art_creation_ready) {
        setTemplates([]);
        return;
      }
      const payload = await request('/api/admin/canva/templates');
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setTemplates(items);
      setTemplateId(current => current && items.some(item => item.id === current) ? current : (items[0]?.id || ''));
    } catch (err) {
      setStatus(current => ({ ...current, loading: false }));
      setError(err.message);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDesign(null);
      setManualCreateUrl('');
      load();
    }
  }, [isOpen, kind]);

  useEffect(() => {
    const remaining = createCooldownUntil - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setCreateCooldownUntil(0), remaining);
    return () => window.clearTimeout(timer);
  }, [createCooldownUntil]);

  if (!isOpen) return null;

  const connect = async () => {
    setBusy('connect');
    setError('');
    try {
      const payload = await request('/api/admin/canva/connect', { method: 'POST' });
      if (!payload?.authorization_url) throw new Error('Canva não retornou a URL de autorização.');
      window.location.assign(payload.authorization_url);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  };

  const appendRemoteImages = async formData => {
    let slot = 1;
    for (const src of imageUrls.filter(Boolean).slice(0, 6)) {
      try {
        const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!/^image\/(png|jpeg|webp)$/i.test(blob.type || '')) continue;
        const key = slot === 1 ? 'image' : `image_${slot}`;
        formData.append(key, new File([blob], `nisti-canva-${slot}.${blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'}`, { type: blob.type }));
        slot += 1;
      } catch {}
    }
  };

  const createDesign = async () => {
    if (createLockRef.current) return;
    if (createCooldownUntil > Date.now()) {
      setError('O Canva está em espera temporária. Aguarde um minuto antes de criar outra arte.');
      return;
    }
    if (!templateId) { setError('Escolha um template do Canva.'); return; }
    createLockRef.current = true;
    setBusy('create'); setError('');
    setManualCreateUrl('');
    setDesign(null);
    try {
      const formData = new FormData();
      formData.append('template_id', templateId);
      formData.append('metadata', JSON.stringify(metadata || {}));
      let slot = 1;
      for (const file of imageFiles.filter(Boolean).slice(0, 6)) {
        const key = slot === 1 ? 'image' : `image_${slot}`;
        formData.append(key, file);
        slot += 1;
      }
      if (slot <= 6) {
        const remoteData = new FormData();
        await appendRemoteImages(remoteData);
        for (const [, value] of remoteData.entries()) {
          if (slot > 6) break;
          const target = slot === 1 ? 'image' : `image_${slot}`;
          formData.append(target, value);
          slot += 1;
        }
      }
      const payload = await request('/api/admin/canva/art/create', { method: 'POST', body: formData });
      if (payload?.mode === 'manual') {
        if (!payload.manual_create_url) throw new Error('O Canva não retornou um link para edição manual.');
        setManualCreateUrl(payload.manual_create_url);
      } else {
        if (!payload?.design?.id) throw new Error('O Canva não retornou a arte criada.');
        setDesign(payload.design);
      }
    } catch (err) {
      if (err?.status === 429) {
        setCreateCooldownUntil(Date.now() + 60_000);
        setError('O Canva atingiu o limite temporário. Aguarde um minuto e tente novamente apenas uma vez.');
      } else setError(err.message);
    } finally {
      createLockRef.current = false;
      setBusy('');
    }
  };

  const importDesign = async () => {
    if (!design?.id) return;
    setBusy('export'); setError('');
    try {
      const blob = await requestBlob('/api/admin/canva/art/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ design_id: design.id })
      });
      const file = new File([blob], `nisti-canva-${kind || 'arte'}-${design.id}.png`, { type: 'image/png' });
      await onUseImage?.(file);
      onClose?.();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const reconnectNeeded = status.connected && !status.art_creation_ready;

  return (
    <div className="mural-canva-modal-backdrop" onClick={onClose}>
      <div className="mural-canva-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Integração Canva">
        <header className="mural-canva-modal-header">
          <div className="mural-canva-modal-title">
            <span className="mural-canva-modal-icon"><AdminMuralIcon name="sparkles" size={18}/></span>
            <div>
              <strong>Arte da publicação · Canva</strong>
              <small>Crie e importe artes de templates oficiais da NISTI diretamente para o Mural.</small>
            </div>
          </div>
          <button type="button" className="mural-canva-modal-close" onClick={onClose} aria-label="Fechar modal Canva">
            <AdminMuralIcon name="close" size={16}/>
          </button>
        </header>

        <div className="mural-canva-modal-body">
          {status.loading ? (
            <div className="mural-publish-v2-canva-state">Verificando conexão com o Canva…</div>
          ) : !status.connected || reconnectNeeded ? (
            <div className="mural-publish-v2-canva-connect">
              <div className="mural-publish-v2-canva-connect-copy">
                <b>{reconnectNeeded ? 'Reconexão necessária' : 'Canva não conectado'}</b>
                <p>{reconnectNeeded ? 'A conexão atual precisa de novas autorizações para criar artes. Reconecte uma vez para continuar.' : 'Conecte sua conta do Canva para gerar e importar banners, produtos e comunicados com templates oficiais NISTI.'}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mural-publish-v2-canva-controls">
                <label>
                  Template Oficial do Canva
                  <select value={templateId} onChange={e => { setTemplateId(e.target.value); setDesign(null); setManualCreateUrl(''); setError(''); }}>
                    {!templates.length && <option value="">Nenhum template oficial disponível</option>}
                    {templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}
                  </select>
                </label>
              </div>
              {!templates.length && (
                <div className="mural-publish-v2-canva-hint">
                  Nenhum template oficial disponível na conta. Publique um Brand Template no Canva para utilizá-lo aqui.
                </div>
              )}
              {manualCreateUrl && (
                <div className="mural-canva-manual-state" role="status">
                  <strong>Edição manual disponível</strong>
                  <p>Este template não possui preenchimento automático. A arte será aberta no Canva para edição manual.</p>
                  <a className="mural-canva-edit-link" href={manualCreateUrl} target="_blank" rel="noopener noreferrer">
                    Abrir template no Canva ↗
                  </a>
                  <small>Depois de editar, exporte em PNG e envie o arquivo pelo campo de imagem da publicação no Mural.</small>
                </div>
              )}
              {design && (
                <div className="mural-publish-v2-canva-design">
                  <span className="mural-publish-v2-canva-design-thumb">
                    {design.thumbnail ? <img src={design.thumbnail} alt="Prévia do design Canva"/> : <AdminMuralIcon name="image" size={24}/>}
                  </span>
                  <div className="mural-publish-v2-canva-design-info">
                    <b>{design.title || 'Arte NISTI no Canva'}</b>
                    <small>Edite no Canva. Quando terminar, volte e importe a versão atualizada.</small>
                  </div>
                  <div className="mural-publish-v2-canva-design-actions">
                    {design.edit_url && (
                      <a href={design.edit_url} target="_blank" rel="noreferrer" className="mural-canva-edit-link">
                        Editar no Canva ↗
                      </a>
                    )}
                    <button type="button" className="mural-canva-use-btn" onClick={importDesign} disabled={Boolean(busy)}>
                      <AdminMuralIcon name="check" size={13}/>
                      {busy === 'export' ? 'Importando…' : 'Usar esta arte'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {error && <div className="mural-admin-error mural-publish-v2-canva-error">{error}</div>}
        </div>

        <footer className="mural-canva-modal-footer">
          <button type="button" className="mural-canva-modal-action mural-canva-modal-action-secondary" onClick={onClose}>Fechar</button>
          {status.connected && status.art_creation_ready && (
            <button
              type="button"
              className="mural-canva-modal-action mural-canva-modal-action-primary"
              disabled={!templateId || Boolean(busy) || createCooldownUntil > Date.now()}
              onClick={createDesign}
            >
              <AdminMuralIcon name="sparkles" size={15}/>
              {busy === 'create' ? 'Criando no Canva…' : createCooldownUntil > Date.now() ? 'Aguarde 1 min' : 'Criar no Canva'}
            </button>
          )}
          {(!status.connected || reconnectNeeded) && !status.loading && (
            <button type="button" className="mural-canva-modal-action mural-canva-modal-action-primary" onClick={connect} disabled={Boolean(busy)}>
              {busy === 'connect' ? 'Abrindo…' : reconnectNeeded ? 'Reconectar Canva' : 'Conectar com o Canva'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function PublishImageField({
  imageUrl,
  image,
  busy,
  onChoose,
  onRemove,
  onOpenCanva,
  title = 'Imagem editorial (opcional)',
  helper = 'PNG, JPG ou WebP · até 5 MB',
  removeLabel = 'Remover imagem editorial'
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const fileInputRef = useRef(null);

  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onChoose?.(file);
  };

  const handleApplyUrl = () => {
    if (urlDraft.trim()) {
      onChoose?.(urlDraft.trim());
      setShowUrlInput(false);
      setUrlDraft('');
    }
  };

  return (
    <div className="mural-publish-v2-image-field">
      <div className="mural-publish-v2-field-label">
        <strong>{title}</strong>
        <AdminMuralIcon name="info" size={14}/>
      </div>

      {imageUrl ? (
        <div className="mural-publish-v2-image-card">
          <div className="mural-publish-v2-image-preview">
            <img src={imageUrl} alt="Imagem da publicação"/>
            <div className="mural-publish-v2-image-preview-overlay">
              <span className="mural-publish-v2-image-badge">
                <AdminMuralIcon name="check" size={12}/> Imagem pronta
              </span>
              <div className="mural-publish-v2-image-actions">
                <button
                  type="button"
                  className="mural-publish-v2-action-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  title="Trocar imagem"
                >
                  <AdminMuralIcon name="upload" size={13}/> Trocar
                </button>
                <button
                  type="button"
                  className="mural-publish-v2-action-btn is-danger"
                  onClick={onRemove}
                  disabled={busy}
                  aria-label={removeLabel}
                  title={removeLabel}
                >
                  <AdminMuralIcon name="close" size={13}/>
                </button>
              </div>
            </div>
          </div>
          {image && (
            <div className="mural-publish-v2-image-meta">
              <span title={image.name}>{image.name}</span>
              <small>{(image.size / (1024 * 1024)).toFixed(2)} MB</small>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files?.[0]) onChoose?.(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      ) : showUrlInput ? (
        <div className="mural-publish-v2-url-box">
          <label>
            <span>Colar link direto da imagem (URL)</span>
            <input
              type="url"
              placeholder="https://exemplo.com/imagem.png"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleApplyUrl(); }}
              autoFocus
            />
          </label>
          <div className="mural-publish-v2-url-actions">
            <button type="button" className="is-cancel" onClick={() => setShowUrlInput(false)}>Cancelar</button>
            <button type="button" className="is-apply" onClick={handleApplyUrl} disabled={!urlDraft.trim()}>Usar URL</button>
          </div>
        </div>
      ) : (
        <div
          className={`mural-publish-v2-upload ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files?.[0]) onChoose?.(e.target.files[0]);
              e.target.value = '';
            }}
          />
          <span className="mural-publish-v2-upload-icon">
            <AdminMuralIcon name="image" size={24}/>
          </span>
          <span className="mural-publish-v2-upload-text">
            <b>Clique para enviar uma imagem</b>
            <small>ou arraste o arquivo até aqui · {helper}</small>
          </span>
          <div className="mural-publish-v2-upload-actions" onClick={e => e.stopPropagation()}>
            <span
              className="mural-publish-v2-upload-action"
              onClick={() => fileInputRef.current?.click()}
            >
              <AdminMuralIcon name="upload" size={14}/> Escolher arquivo
            </span>
            <button
              type="button"
              className="mural-publish-v2-url-toggle-btn"
              onClick={() => setShowUrlInput(true)}
              title="Colar link de imagem da internet"
            >
              Link URL
            </button>
            {onOpenCanva && (
              <button
                type="button"
                className="mural-publish-v2-canva-trigger-btn"
                onClick={onOpenCanva}
                title="Criar arte com Canva"
              >
                <AdminMuralIcon name="sparkles" size={13}/>
                Canva
              </button>
            )}
          </div>
        </div>
      )}
      {image && <small className="mural-publish-v2-image-ready">Imagem preparada e pronta para envio.</small>}
    </div>
  );
}

export function PublishPreviewCard({ activeKind, form, product, collection, selectedProducts = [], imageUrl, onToggleFeatured }) {
  const [viewMode, setViewMode] = useState(form.featured ? 'hero' : 'feed'); // 'feed' | 'hero' | 'detail'
  const [tabFilter, setTabFilter] = useState(() => (
    activeKind === 'product' ? 'product' : activeKind === 'collection' ? 'collection' : activeKind === 'notice' ? 'notice' : 'all'
  ));

  useEffect(() => {
    if (activeKind) {
      setTabFilter(activeKind === 'product' ? 'product' : activeKind === 'collection' ? 'collection' : 'notice');
    }
  }, [activeKind]);

  const title = form.title || form.name || (
    activeKind === 'product' ? (product?.nome || product?.sku || 'Planner Especial') :
    activeKind === 'notice' ? 'Aviso Importante' :
    'Nova Coleção 2027'
  );

  const productPreview = (activeKind === 'product' && product) ? {
    id: Number(product.id),
    sku: product.sku || 'SKU-001',
    nome: product.nome || title,
    type: product.type || productTypeLabel(product) || 'Caderno Argolado',
    collection: product.collection_name || 'Coleção NISTI',
    wireo: product.wireo || 'Bronze',
    tassel: product.tassel || null,
    elastico: product.elastico || 'Rosa',
    image_url: product.image_url || null,
    mural_image_ready: Boolean(product.mural_image_ready)
  } : (activeKind === 'product') ? {
    id: 1,
    sku: 'SKU-EXEMPLO',
    nome: title,
    type: 'Produto NISTI',
    collection: 'Catálogo',
    wireo: 'Bronze',
    tassel: null,
    elastico: 'Preto',
    image_url: null,
    mural_image_ready: false
  } : null;

  const collectionProducts = selectedProducts.length > 0 ? selectedProducts : (collection?.preview_products || []);
  const collectionPreview = (activeKind === 'collection') ? {
    id: Number(collection?.id || 0),
    slug: form.slug || collection?.slug || 'nova-colecao',
    name: form.name || form.title || collection?.name || 'Nova Coleção',
    year: form.year ? Number(form.year) : (collection?.year ? Number(collection.year) : 2027),
    show_year: form.show_year !== false,
    hero_message: form.hero_message || form.subtitle || collection?.hero_message || 'Mais cor e elegância para o ano.',
    description: form.description || form.body || collection?.description || 'Coleção exclusiva com acabamentos premium.',
    preview_products: collectionProducts.slice(0, 4).map(p => ({
      id: Number(p.id),
      sku: p.sku || null,
      type: p.type || productTypeLabel(p),
      image_url: p.image_url || null,
      wireo: p.wireo || null,
      elastico: p.elastico || null,
      image_source: p.mural_image_ready ? 'product-processed' : 'product'
    }))
  } : null;

  const collectionImage = collection?.image_key
    ? `/api/admin/mural/collections/${collection.id}/image?v=${encodeURIComponent(collection.image_key)}`
    : '';

  const displayImage = imageUrl || (activeKind === 'product' ? product?.image_url : null) || collectionImage || null;

  const previewItem = {
    id: 0,
    kind: activeKind || 'notice',
    title,
    subtitle: form.subtitle || form.hero_message || (activeKind === 'notice' ? 'Linha de apoio' : ''),
    body: form.body || form.description || (activeKind === 'notice' ? 'Mensagem e orientações detalhadas para a expedição e produção.' : ''),
    badge: form.badge || (activeKind === 'notice' ? 'COMUNICADO INTERNO' : activeKind === 'collection' ? 'NOVA COLEÇÃO' : 'NOVO'),
    badge_tone: form.badge_tone || null,
    featured: Boolean(form.featured),
    published_at: form.published_at ? new Date(form.published_at).toISOString() : new Date().toISOString(),
    is_read: false,
    image_url: displayImage,
    image_source: imageUrl ? 'post' : (activeKind === 'product' ? 'product' : 'collection'),
    product: productPreview,
    collection: collectionPreview,
    notice_level: activeKind === 'notice' ? (form.notice_level || 'info') : null
  };

  const sampleProductItem = {
    id: 101,
    kind: 'product',
    title: 'Planner Espiral Floral 2027',
    subtitle: 'Acabamento holográfico com visão semanal',
    body: 'Miolo permanente, encadernação wire-o bronze e elástico rosa.',
    badge: 'NOVO',
    published_at: new Date(Date.now() - 3600000).toISOString(),
    is_read: true,
    product: {
      id: 101,
      sku: 'PLN-FLORAL-01',
      nome: 'Planner Espiral Floral 2027',
      type: 'Planner Semanal',
      wireo: 'Bronze',
      elastico: 'Rosa',
      collection: 'Jardim Secreto'
    }
  };

  const sampleNoticeItem = {
    id: 102,
    kind: 'notice',
    title: 'Conferência Obrigatória de Wire-o',
    subtitle: 'Procedimento padrão para turno da tarde',
    body: 'Verificar alinhamento do espiral e fechamento do elástico antes de embalar.',
    badge: 'COMUNICADO INTERNO',
    notice_level: 'attention',
    published_at: new Date(Date.now() - 7200000).toISOString(),
    is_read: true
  };

  const sampleCollectionItem = {
    id: 103,
    kind: 'collection',
    title: 'Coleção Minimalista 2027',
    subtitle: 'Linha executiva com tons pastéis',
    body: 'Lançamento exclusivo com acabamentos sóbrios e ferragens premium.',
    badge: 'NOVA COLEÇÃO',
    published_at: new Date(Date.now() - 14400000).toISOString(),
    is_read: false,
    collection: {
      id: 103,
      name: 'Coleção Minimalista',
      year: 2027,
      hero_message: 'Linha executiva com tons pastéis',
      preview_products: [
        { id: 1, sku: 'MIN-01', type: 'Planner' },
        { id: 2, sku: 'MIN-02', type: 'Caderno' }
      ]
    }
  };

  const [activeDetailItem, setActiveDetailItem] = useState(null);
  const [ctaFeedback, setCtaFeedback] = useState(false);
  const [simulatedPush, setSimulatedPush] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState(null);

  const openDetail = (itemToOpen) => {
    setActiveDetailItem(itemToOpen || previewItem);
    setViewMode('detail');
  };

  const currentDetailItem = activeDetailItem || previewItem;

  const handleAppTabClick = (tabKey) => {
    setTabFilter(tabKey);
    if (viewMode === 'detail') {
      setViewMode(form.featured ? 'hero' : 'feed');
    }
  };

  const triggerPushSimulation = () => {
    setSimulatedPush(true);
    setFeedbackToast('Notificação push simulada enviada para o dispositivo!');
    setTimeout(() => {
      setSimulatedPush(false);
      setFeedbackToast(null);
    }, 4500);
  };

  const handleTestCta = () => {
    setCtaFeedback(true);
    const msg = currentDetailItem.kind === 'notice'
      ? '✓ Leitura registrada no terminal do operador!'
      : currentDetailItem.kind === 'collection'
      ? '✓ Catálogo da coleção acessado com sucesso!'
      : '✓ Ficha técnica do produto aberta no sistema!';
    setFeedbackToast(msg);
    setTimeout(() => {
      setCtaFeedback(false);
      setFeedbackToast(null);
    }, 3000);
  };

  return (
    <aside className="mural-publish-v2-preview">
      <header>
        <div className="mural-publish-v2-preview-title-row">
          <div className="mural-publish-v2-preview-heading">
            <span className="mural-publish-v2-preview-icon"><AdminMuralIcon name="eye" size={20}/></span>
            <span>
              <strong>Prévia no Mural</strong>
              <small>Simulador interativo do app dos operadores</small>
            </span>
          </div>
          <div className="mural-preview-header-actions">
            {onToggleFeatured && (
              <button
                type="button"
                className={`mural-preview-featured-toggle-btn ${form.featured ? 'is-featured' : ''}`}
                onClick={onToggleFeatured}
                title="Fixar ou desfixar destaque no topo do feed"
              >
                <AdminMuralIcon name="star" size={13}/>
                <span>{form.featured ? 'Destaque ativo' : 'Fixar destaque'}</span>
              </button>
            )}
            <button
              type="button"
              className="mural-preview-test-push-btn"
              onClick={triggerPushSimulation}
              title="Testar como a notificação push chega para o operador"
            >
              <AdminMuralIcon name="bell" size={13}/>
              <span>Simular push</span>
            </button>
          </div>
        </div>

        {activeKind && (
          <div className="mural-publish-v2-preview-tabs" role="tablist" aria-label="Modo de visualização">
            <button
              type="button"
              className={viewMode === 'feed' ? 'active' : ''}
              onClick={() => { setViewMode('feed'); setActiveDetailItem(null); }}
              title="Ver no fluxo de cards do feed"
            >
              Feed de Cards
            </button>
            <button
              type="button"
              className={viewMode === 'hero' ? 'active' : ''}
              onClick={() => { setViewMode('hero'); setActiveDetailItem(null); }}
              title="Ver como banner de destaque no topo"
            >
              Banner Destaque {form.featured ? '★' : ''}
            </button>
            <button
              type="button"
              className={viewMode === 'detail' ? 'active' : ''}
              onClick={() => openDetail(previewItem)}
              title="Ver detalhes completos do card clicado"
            >
              Detalhe Expandido
            </button>
          </div>
        )}
      </header>

      <div className="mural-publish-v2-preview-body">
        <div className="mural-preview-smartphone" aria-label="Mockup do aplicativo móvel">
          {/* Dynamic Island */}
          <div className="mural-preview-dynamic-island" aria-hidden="true" />
          
          {/* Simulated Push Notification Banner */}
          {simulatedPush && (
            <div
              className="mural-preview-push-banner"
              onClick={() => { openDetail(previewItem); setSimulatedPush(false); }}
              role="button"
              tabIndex={0}
            >
              <div className="mural-preview-push-icon"><AdminMuralIcon name="notice" size={16}/></div>
              <div className="mural-preview-push-info">
                <div className="mural-preview-push-top">
                  <b>Mural NISTI</b>
                  <span>agora</span>
                </div>
                <strong>{previewItem.title}</strong>
                <p>{previewItem.subtitle || previewItem.body || 'Novo comunicado disponível no mural.'}</p>
              </div>
            </div>
          )}

          {/* Floating feedback toast */}
          {feedbackToast && (
            <div className="mural-preview-toast">
              <span>{feedbackToast}</span>
            </div>
          )}

          {/* Status Bar */}
          <div className="mural-preview-status-bar">
            <span>09:41</span>
            <div className="mural-preview-status-icons" aria-hidden="true">
              <span>5G</span>
              <span>●●●●</span>
              <div className="mural-preview-battery"><div className="mural-preview-battery-fill" /></div>
            </div>
          </div>

          {/* App Header */}
          <div className="mural-preview-app-header">
            <div className="mural-preview-app-title">
              <span className="mural-preview-sparkles" aria-hidden="true">✦✦✦</span>
              <b>Mural NISTI</b>
            </div>
            <div className="mural-preview-app-drops" aria-hidden="true">
              <span className="drop-cyan" />
              <span className="drop-pink" />
              <span className="drop-yellow" />
            </div>
          </div>

          {/* App Category Tabs */}
          <div className="mural-preview-app-tabs" role="tablist" aria-label="Filtro do app">
            <button
              type="button"
              className={tabFilter === 'all' ? 'active' : ''}
              onClick={() => handleAppTabClick('all')}
            >
              Tudo
            </button>
            <button
              type="button"
              className={tabFilter === 'product' ? 'active' : ''}
              onClick={() => handleAppTabClick('product')}
            >
              Produtos
            </button>
            <button
              type="button"
              className={tabFilter === 'collection' ? 'active' : ''}
              onClick={() => handleAppTabClick('collection')}
            >
              Coleções
            </button>
            <button
              type="button"
              className={tabFilter === 'notice' ? 'active' : ''}
              onClick={() => handleAppTabClick('notice')}
            >
              Avisos
            </button>
          </div>

          {/* Viewport */}
          <div className="mural-preview-viewport">
            {!activeKind ? (
              <div className="mural-preview-empty-card">
                <span><AdminMuralIcon name="notice" size={24} /></span>
                <b>Escolha o tipo de publicação</b>
                <small>Selecione Produto, Informação ou Coleção para acompanhar a prévia interativa em tempo real.</small>
              </div>
            ) : viewMode === 'detail' ? (
              <div className="mural-preview-detail-view">
                <button
                  type="button"
                  className="mural-preview-detail-back"
                  onClick={() => setViewMode(form.featured ? 'hero' : 'feed')}
                  aria-label="Voltar para a prévia do feed"
                >
                  ‹ Voltar ao feed
                </button>

                {currentDetailItem.image_url ? (
                  <div className="mural-preview-detail-media">
                    <img src={currentDetailItem.image_url} alt="Arte em destaque" />
                  </div>
                ) : currentDetailItem.kind === 'product' && (
                  <div className="mural-preview-detail-placeholder">
                    <AdminMuralIcon name="product" size={36}/>
                    <small>Foto padrão do catálogo</small>
                  </div>
                )}

                <div className="mural-card-badges">
                  {!currentDetailItem.is_read && <span className="mural-new-badge">NOVO</span>}
                  {currentDetailItem.kind === 'notice' && (
                    <span className={`mural-notice-label ${currentDetailItem.notice_level || 'info'}`}>
                      {currentDetailItem.notice_level === 'important' ? 'Importante' : currentDetailItem.notice_level === 'attention' ? 'Atenção' : 'Informação'}
                    </span>
                  )}
                  {currentDetailItem.badge && currentDetailItem.badge !== 'NOVO' && (
                    <span className="mural-editorial-badge">{currentDetailItem.badge}</span>
                  )}
                </div>

                <div className="mural-preview-detail-typography">
                  {currentDetailItem.kind === 'product' && currentDetailItem.product?.type && (
                    <span className="mural-preview-detail-kicker">{currentDetailItem.product.type}</span>
                  )}
                  <strong>{currentDetailItem.title}</strong>
                  {currentDetailItem.subtitle && <p className="mural-preview-detail-subtitle">{currentDetailItem.subtitle}</p>}
                  {currentDetailItem.body && <p className="mural-preview-detail-body">{currentDetailItem.body}</p>}
                </div>

                {currentDetailItem.kind === 'product' && currentDetailItem.product && (
                  <div className="mural-preview-detail-specs">
                    <div><b>SKU</b><span>{currentDetailItem.product.sku || 'N/A'}</span></div>
                    <div><b>Wire-o</b><span>{currentDetailItem.product.wireo || 'Padrão'}</span></div>
                    <div><b>Elástico</b><span>{currentDetailItem.product.elastico || 'Padrão'}</span></div>
                    <div><b>Coleção</b><span>{currentDetailItem.product.collection || 'Catálogo'}</span></div>
                  </div>
                )}

                {currentDetailItem.kind === 'collection' && (currentDetailItem.collection?.preview_products?.length > 0 || collectionProducts.length > 0) && (
                  <div className="mural-preview-collection-vitrine">
                    <header>
                      <b>Vitrine da coleção</b>
                      <small>{(currentDetailItem.collection?.preview_products || collectionProducts).length} produtos</small>
                    </header>
                    <div className="mural-preview-collection-chips">
                      {(currentDetailItem.collection?.preview_products || collectionProducts).slice(0, 6).map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className="mural-preview-collection-chip-btn"
                          onClick={() => openDetail({
                            id: p.id,
                            kind: 'product',
                            title: p.nome || p.type || p.sku,
                            subtitle: `Produto da coleção ${currentDetailItem.title}`,
                            body: `SKU: ${p.sku || 'N/A'} • Wire-o: ${p.wireo || 'Padrão'} • Elástico: ${p.elastico || 'Padrão'}`,
                            badge: 'COLEÇÃO',
                            image_url: p.image_url || null,
                            product: p
                          })}
                          title={`Ver detalhes do ${p.sku || p.nome}`}
                        >
                          {p.image_url && <img src={p.image_url} alt=""/>}
                          <b>{p.sku || p.nome || p.type}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {currentDetailItem.kind === 'notice' && (
                  <div className={`mural-preview-notice-callout is-${currentDetailItem.notice_level || 'info'}`}>
                    <AdminMuralIcon name="notice" size={18}/>
                    <span>Orientação prioritária para equipes de expedição e triagem.</span>
                  </div>
                )}

                <button
                  type="button"
                  className={`mural-preview-detail-action-btn ${ctaFeedback ? 'is-success' : ''}`}
                  onClick={handleTestCta}
                >
                  <AdminMuralIcon name={ctaFeedback ? 'check' : 'layers'} size={15}/>
                  <span>
                    {ctaFeedback
                      ? 'Ação executada com sucesso!'
                      : currentDetailItem.kind === 'collection'
                      ? 'Ver catálogo da coleção'
                      : currentDetailItem.kind === 'notice'
                      ? 'Confirmar leitura no terminal'
                      : 'Ver produto no catálogo'}
                  </span>
                </button>
              </div>
            ) : viewMode === 'hero' ? (
              <div className="mural-preview-hero-container">
                {activeKind === 'collection' ? (
                  <CollectionLaunchHero item={{ ...previewItem, featured: true }} onOpen={() => openDetail(previewItem)} />
                ) : (
                  <Hero item={{ ...previewItem, featured: true }} onOpen={() => openDetail(previewItem)} />
                )}
                <div className="mural-preview-click-hint">
                  <small>Clique no banner acima para abrir o detalhe em tela cheia.</small>
                </div>
              </div>
            ) : (
              <div className="mural-preview-feed-list">
                {/* Visualização de acordo com o filtro selecionado */}
                {tabFilter === 'all' && (
                  <>
                    {/* Destaque fixado (Hero) se featured for verdadeiro */}
                    {form.featured && (
                      activeKind === 'collection' ? (
                        <CollectionLaunchHero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <Hero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      )
                    )}

                    {/* Card normal de feed */}
                    {!form.featured && (
                      activeKind === 'collection' ? (
                        <CollectionLaunchCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      ) : (
                        <MuralCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    )}

                    {/* Outros itens contextuais interativos para compor o feed completo */}
                    <div className="mural-preview-secondary-card" title="Clique para abrir detalhe deste item">
                      <MuralCard
                        item={activeKind === 'product' ? sampleNoticeItem : sampleProductItem}
                        onOpen={() => openDetail(activeKind === 'product' ? sampleNoticeItem : sampleProductItem)}
                      />
                    </div>

                    <div className="mural-preview-secondary-card" title="Clique para abrir detalhe desta coleção">
                      <CollectionLaunchCard
                        item={sampleCollectionItem}
                        onOpen={() => openDetail(sampleCollectionItem)}
                      />
                    </div>
                  </>
                )}

                {tabFilter === 'product' && (
                  <>
                    {activeKind === 'product' ? (
                      form.featured ? (
                        <Hero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <MuralCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    ) : (
                      <div className="mural-preview-tab-sample-wrap">
                        <div className="mural-preview-tab-sample-header">
                          <small>Exemplo do feed de Produtos:</small>
                        </div>
                        <MuralCard
                          item={sampleProductItem}
                          onOpen={() => openDetail(sampleProductItem)}
                        />
                      </div>
                    )}
                  </>
                )}

                {tabFilter === 'collection' && (
                  <>
                    {activeKind === 'collection' ? (
                      form.featured ? (
                        <CollectionLaunchHero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <CollectionLaunchCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    ) : (
                      <div className="mural-preview-tab-sample-wrap">
                        <div className="mural-preview-tab-sample-header">
                          <small>Exemplo do feed de Coleções:</small>
                        </div>
                        <CollectionLaunchCard
                          item={sampleCollectionItem}
                          onOpen={() => openDetail(sampleCollectionItem)}
                        />
                      </div>
                    )}
                  </>
                )}

                {tabFilter === 'notice' && (
                  <>
                    {activeKind === 'notice' ? (
                      form.featured ? (
                        <Hero item={previewItem} onOpen={() => openDetail(previewItem)} />
                      ) : (
                        <MuralCard item={previewItem} onOpen={() => openDetail(previewItem)} eager />
                      )
                    ) : (
                      <div className="mural-preview-tab-sample-wrap">
                        <div className="mural-preview-tab-sample-header">
                          <small>Exemplo do feed de Avisos:</small>
                        </div>
                        <MuralCard
                          item={sampleNoticeItem}
                          onOpen={() => openDetail(sampleNoticeItem)}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer>
        <span className="mural-publish-v2-preview-pulse" aria-hidden="true" />
        <span>Prévia 100% interativa — teste abas, botões e clique nos cards para abrir o detalhe.</span>
      </footer>
    </aside>
  );
}

