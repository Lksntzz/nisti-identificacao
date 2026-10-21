import React, { useEffect, useState } from 'react';
import { EMPTY_POST, AdminMuralIcon, request, TransparentMuralProductImage, postForm, compressImage } from './MuralPublishShared.jsx';
import { CanvaArtworkModal, PublishImageField, PublishPreviewCard } from './MuralPublishComponents.jsx';

function MuralPublishWorkspace({ item, products = [], onClose, onSaved, onOpenExistingCollection }) {
  const sourceItem = item && item.mode === 'new' ? null : item;
  const isEditingCollection = Boolean(sourceItem && (sourceItem.kind === 'collection' || sourceItem.product_ids !== undefined));
  const presetKind = sourceItem?.kind || (isEditingCollection ? 'collection' : (item?.mode === 'new' ? item?.kind || null : null));

  const [activeKind, setActiveKind] = useState(presetKind || 'product');
  const [collectionConflict, setCollectionConflict] = useState(null);
  const [form, setForm] = useState(() => postForm(sourceItem || (presetKind ? { ...EMPTY_POST, kind: presetKind } : null)));
  const [collectionForm, setCollectionForm] = useState(() => ({
    name: (isEditingCollection ? sourceItem?.name : '') || '',
    slug: (isEditingCollection ? sourceItem?.slug : '') || '',
    year: (isEditingCollection ? sourceItem?.year : '') || '',
    show_year: isEditingCollection ? (sourceItem?.show_year !== false && Number(sourceItem?.show_year ?? 1) !== 0) : true,
    hero_message: (isEditingCollection ? sourceItem?.hero_message : '') || '',
    visual_direction: (isEditingCollection ? sourceItem?.visual_direction : '') || 'automatic',
    theme_notes: (isEditingCollection ? sourceItem?.theme_notes : '') || '',
    description: (isEditingCollection ? sourceItem?.description : '') || '',
    status: (isEditingCollection ? sourceItem?.status : '') || 'active',
    featured: isEditingCollection ? Boolean(sourceItem?.featured ?? true) : true
  }));

  const [catalogProducts, setCatalogProducts] = useState(products);
  const [productQuery, setProductQuery] = useState(sourceItem?.product_sku || '');
  const [collectionProductQuery, setCollectionProductQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(sourceItem?.product_id ? {
    id: sourceItem.product_id,
    sku: sourceItem.product_sku,
    nome: sourceItem.product_name,
    miolo_code: sourceItem.product_miolo_code,
    type: sourceItem.product_type,
    image_url: sourceItem.product_image_url,
    wireo: sourceItem.product_wireo,
    tassel: sourceItem.product_tassel,
    elastico: sourceItem.product_elastico,
    collection_name: sourceItem.product_collection_name
  } : null);

  const [selectedCollectionProductIds, setSelectedCollectionProductIds] = useState(() => {
    if (isEditingCollection && sourceItem?.product_ids) {
      return String(sourceItem.product_ids).split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
    }
    return [];
  });

  const [image, setImage] = useState(() => sourceItem?.prefillImage || null);
  const [imageUrl, setImageUrl] = useState(() => {
    if (sourceItem?.prefillImage) return URL.createObjectURL(sourceItem.prefillImage);
    if (sourceItem?.image_key) {
      if (isEditingCollection) {
        return `/api/admin/mural/collections/${sourceItem.id}/image?v=${encodeURIComponent(sourceItem.image_key)}`;
      }
      return `/api/admin/mural/posts/${sourceItem.id}/image?v=${encodeURIComponent(sourceItem.image_key)}`;
    }
    return '';
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canvaModalOpen, setCanvaModalOpen] = useState(false);
  const [canvaStatus, setCanvaStatus] = useState({ loading: true, connected: false });

  // Sync Canva status on mount
  useEffect(() => {
    request('/api/admin/canva/status')
      .then(s => setCanvaStatus({ loading: false, connected: Boolean(s?.connected && s?.art_creation_ready) }))
      .catch(() => setCanvaStatus({ loading: false, connected: false }));
  }, []);

  // Sync catalog products if passed or load
  useEffect(() => {
    if (products && products.length > 0) {
      setCatalogProducts(products);
    } else {
      request('/api/admin/mural/products?limit=500')
        .then(data => setCatalogProducts(data.items || []))
        .catch(() => {});
    }
  }, [products]);

  // Real-time product search for single product post
  useEffect(() => {
    if (activeKind !== 'product') return;
    if (!productQuery) return;
    const timer = setTimeout(() => {
      request(`/api/admin/mural/products?q=${encodeURIComponent(productQuery)}`)
        .then(data => setCatalogProducts(prev => {
          const incoming = data.items || [];
          const map = new Map(prev.map(p => [p.id, p]));
          incoming.forEach(p => map.set(p.id, p));
          return Array.from(map.values());
        }))
        .catch(() => {});
    }, 220);
    return () => clearTimeout(timer);
  }, [productQuery, activeKind]);

  useEffect(() => () => {
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setCol = (key, value) => setCollectionForm(current => ({ ...current, [key]: value }));

  const changeKind = nextKind => {
    setActiveKind(nextKind);
    setError('');
    if (nextKind === 'notice') {
      setForm(current => ({
        ...current,
        kind: 'notice',
        product_id: '',
        collection_id: '',
        notice_level: current.notice_level || 'info',
        badge: ['COMUNICADO INTERNO','PROCESSO','NOVIDADE'].includes(current.badge) ? current.badge : 'COMUNICADO INTERNO'
      }));
    } else if (nextKind === 'product') {
      setForm(current => ({
        ...current,
        kind: 'product',
        collection_id: '',
        notice_level: null,
        badge: ['COMUNICADO INTERNO','PROCESSO','NOVIDADE'].includes(current.badge) ? 'NOVO' : (current.badge || 'NOVO')
      }));
    } else if (nextKind === 'collection') {
      setForm(current => ({
        ...current,
        kind: 'collection',
        badge: 'NOVA COLEÇÃO',
        featured: true
      }));
    }
  };

  const chooseProduct = prod => {
    setSelectedProduct(prod);
    setProductQuery(prod.sku || prod.nome || '');
    setForm(current => ({
      ...current,
      kind: 'product',
      product_id: prod.id,
      title: current.title || prod.nome || prod.variacao || prod.sku || ''
    }));
  };

  const toggleCollectionProduct = prodId => {
    setSelectedCollectionProductIds(cur => cur.includes(prodId) ? cur.filter(x => x !== prodId) : [...cur, prodId]);
  };

  const moveCollectionProduct = (prodId, direction) => {
    setSelectedCollectionProductIds(cur => {
      const idx = cur.indexOf(prodId);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const chooseImage = async file => {
    setError('');
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return setError('Use JPEG, PNG ou WebP.');
    try {
      const prepared = await compressImage(file);
      if (prepared.size > 5 * 1024 * 1024) throw new Error('A imagem final excede 5 MB.');
      if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
      setImage(prepared);
      setImageUrl(URL.createObjectURL(prepared));
    } catch (err) { setError(err.message); }
  };

  const useCanvaImage = async file => {
    setError('');
    if (!file) return;
    if (file.type !== 'image/png') return setError('A arte exportada do Canva precisa estar em PNG.');
    if (file.size > 5 * 1024 * 1024) return setError('A arte exportada do Canva excede 5 MB.');
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setImage(file);
    setImageUrl(URL.createObjectURL(file));
  };

  const removeImage = async () => {
    setError('');
    if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    setImage(null);
    if (!sourceItem?.id || !sourceItem?.image_key) { setImageUrl(''); return; }
    setBusy(true);
    try {
      if (isEditingCollection) {
        await request(`/api/admin/mural/collections/${sourceItem.id}/image`, { method: 'DELETE' });
      } else {
        await request(`/api/admin/mural/posts/${sourceItem.id}/image`, { method: 'DELETE' });
      }
      setImageUrl('');
      sourceItem.image_key = null;
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const save = async (publish = false) => {
    setError('');
    setCollectionConflict(null);
    setBusy(true);
    try {
      if (activeKind === 'collection') {
        const name = collectionForm.name?.trim() || form.title?.trim();
        if (!name) { setError('Preencha o nome da coleção.'); setBusy(false); return; }
        if (publish && selectedCollectionProductIds.length === 0) {
          setError('Selecione ao menos 1 produto para publicar a coleção.'); setBusy(false); return;
        }

        const bodyData = {
          name,
          slug: collectionForm.slug?.trim() || '',
          year: collectionForm.year || '',
          show_year: collectionForm.show_year !== false,
          hero_message: collectionForm.hero_message?.trim() || form.subtitle?.trim() || '',
          visual_direction: collectionForm.visual_direction || 'automatic',
          theme_notes: collectionForm.theme_notes?.trim() || '',
          description: collectionForm.description?.trim() || form.body?.trim() || '',
          status: collectionForm.status || 'active'
        };

        const id = (sourceItem && isEditingCollection) ? sourceItem.id : null;
        let savedId = id;
        if (id) {
          await request(`/api/admin/mural/collections/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
        } else {
          const created = await request('/api/admin/mural/collections', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
          savedId = created.id;
        }

        if (selectedCollectionProductIds.length > 0) {
          await request(`/api/admin/mural/collections/${savedId}/products`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ product_ids: selectedCollectionProductIds })
          });
        }

        if (image) {
          const fd = new FormData();
          fd.append('image', image);
          await request(`/api/admin/mural/collections/${savedId}/image`, { method: 'POST', body: fd });
        }

        if (publish) {
          await request(`/api/admin/mural/collections/${savedId}/publish`, { method: 'POST' });
        }
      } else {
        // Product or Notice
        const title = form.title?.trim() || (activeKind === 'product' ? selectedProduct?.nome : '');
        if (!title) { setError('Preencha o título da publicação.'); setBusy(false); return; }
        if (activeKind === 'product' && !selectedProduct && !form.product_id) {
          setError('Selecione um produto no catálogo.'); setBusy(false); return;
        }

        const bodyData = {
          ...form,
          title,
          kind: activeKind,
          product_id: activeKind === 'product' ? Number(selectedProduct?.id || form.product_id) || null : null,
          collection_id: null,
          notice_level: activeKind === 'notice' ? (form.notice_level || 'info') : null,
          priority: Number(form.priority) || 0,
          published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
          expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null
        };

        let id = (sourceItem && !isEditingCollection) ? sourceItem.id : null;
        if (id) {
          await request(`/api/admin/mural/posts/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
        } else {
          const created = await request('/api/admin/mural/posts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyData)
          });
          id = created.id;
        }

        if (image) {
          const fd = new FormData();
          fd.append('image', image);
          await request(`/api/admin/mural/posts/${id}/image`, { method: 'POST', body: fd });
        }

        if (publish) {
          await request(`/api/admin/mural/posts/${id}/publish`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ published_at: form.published_at ? new Date(form.published_at).toISOString() : null })
          });
        }
      }

      await onSaved();
      onClose();
    } catch (err) {
      if (activeKind === 'collection' && !isEditingCollection && /Já existe uma coleção com esse slug/i.test(err.message || '')) {
        const existingSlug = String(collectionForm.slug?.trim() || collectionForm.name?.trim() || form.title?.trim() || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
        setCollectionConflict({ slug: existingSlug, name: collectionForm.name?.trim() || form.title?.trim() || 'Coleção' });
        setError('Esta coleção já está cadastrada. Abra o registro existente para concluir a publicação, sem criar uma duplicata.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // Filtered products for collection picker
  const filteredCollectionCatalog = catalogProducts.filter(p =>
    !collectionProductQuery ||
    `${p.sku} ${p.nome || ''} ${p.variacao || ''}`.toLowerCase().includes(collectionProductQuery.toLowerCase())
  ).slice(0, 10);

  const selectedCollectionProducts = selectedCollectionProductIds
    .map(id => catalogProducts.find(p => Number(p.id) === Number(id)))
    .filter(Boolean);

  const publishLabel = form.published_at && new Date(form.published_at) > new Date() ? 'Agendar' : 'Publicar no Mural';
  const readyToSave = activeKind === 'collection'
    ? Boolean((collectionForm.name || form.title)?.trim())
    : Boolean(form.title?.trim() && (activeKind !== 'product' || selectedProduct || form.product_id));

  return (
    <section className="mural-publisher-workspace mural-studio-workspace" aria-label="Editor de publicação do Mural">
      {/* Top Studio Bar with all Primary Actions and Kind Selector */}
      <header className="mural-studio-topbar">
        <div className="mural-studio-topbar-left">
          <button type="button" className="mural-studio-back-btn" onClick={onClose} title="Voltar ao Painel">
            ‹ Voltar
          </button>
          <div className="mural-studio-heading">
            <h2>{sourceItem ? 'Editar no Mural' : 'Publicar no Mural'}</h2>
            <small>Expedição e produção NISTI</small>
          </div>
          <div className="mural-studio-kind-tabs" role="tablist" aria-label="Tipo de publicação">
            <button
              type="button"
              className={activeKind === 'product' ? 'active' : ''}
              disabled={Boolean(sourceItem)}
              onClick={() => changeKind('product')}
            >
              <AdminMuralIcon name="product" size={15}/>
              <span>Produto</span>
            </button>
            <button
              type="button"
              className={activeKind === 'notice' ? 'active' : ''}
              disabled={Boolean(sourceItem)}
              onClick={() => changeKind('notice')}
            >
              <AdminMuralIcon name="notice" size={15}/>
              <span>Informação</span>
            </button>
            <button
              type="button"
              className={activeKind === 'collection' ? 'active' : ''}
              disabled={Boolean(sourceItem)}
              onClick={() => changeKind('collection')}
            >
              <AdminMuralIcon name="collection" size={15}/>
              <span>Coleção</span>
            </button>
          </div>
        </div>

        <div className="mural-studio-topbar-right">
          <button
            type="button"
            className={`mural-studio-canva-btn ${canvaStatus.connected ? 'is-connected' : ''}`}
            onClick={() => setCanvaModalOpen(true)}
            title={canvaStatus.connected ? 'Abrir criação de arte no Canva' : 'Conectar conta Canva'}
          >
            <AdminMuralIcon name="sparkles" size={15}/>
            <span>{canvaStatus.connected ? 'Criar no Canva' : 'Conectar ao Canva'}</span>
            {canvaStatus.connected && <span className="mural-studio-online-dot" title="Canva pronto e conectado"/>}
          </button>
          <div className="mural-studio-topbar-divider" aria-hidden="true"/>
          <button type="button" className="mural-studio-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="mural-studio-btn-subtle"
            disabled={busy || !readyToSave}
            onClick={() => save(false)}
          >
            <AdminMuralIcon name="document" size={14}/> Salvar rascunho
          </button>
          <button
            type="button"
            className="mural-studio-btn-primary"
            disabled={busy || !readyToSave}
            onClick={() => save(true)}
          >
            <AdminMuralIcon name="notice" size={15}/> {busy ? 'Processando…' : publishLabel}
          </button>
        </div>
      </header>

      {/* Main Studio Body: 2 Columns */}
      <div className="mural-studio-body">
        <form id="mural-publication-form" className="mural-studio-form" onSubmit={e => { e.preventDefault(); save(false); }}>
          
          {/* Card 1: Identificação & Imagem */}
          {activeKind === 'product' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>1. Produto e imagem de destaque</strong>
                <small>Vincule ao catálogo e defina a imagem principal.</small>
              </header>

              <div className="mural-studio-split-row">
                <div className="mural-studio-col">
                  <label className="mural-publish-v2-field mural-publish-v2-search">
                    Buscar produto no catálogo
                    <span>
                      <AdminMuralIcon name="search" size={16}/>
                      <input
                        value={productQuery}
                        onChange={e => setProductQuery(e.target.value)}
                        placeholder="Digite o SKU, nome ou código do produto..."
                      />
                    </span>
                  </label>

                  {selectedProduct && (
                    <div className="mural-studio-selected-product">
                      <figure>
                        {selectedProduct.image_url ? (
                          <TransparentMuralProductImage src={selectedProduct.image_url} alt={selectedProduct.nome || selectedProduct.sku}/>
                        ) : (
                          <AdminMuralIcon name="product" size={28}/>
                        )}
                      </figure>
                      <div className="mural-studio-selected-info">
                        <strong>{selectedProduct.nome || selectedProduct.variacao || 'Produto NISTI'}</strong>
                        <small>SKU: {selectedProduct.sku}{selectedProduct.collection_name ? ` · ${selectedProduct.collection_name}` : ''}</small>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedProduct(null); set('product_id', ''); setProductQuery(''); }}
                        aria-label="Remover produto selecionado"
                        title="Remover produto selecionado"
                      >
                        <AdminMuralIcon name="close" size={14}/>
                      </button>
                    </div>
                  )}

                  {productQuery && !selectedProduct && (
                    <div className="mural-publish-v2-product-results">
                      {catalogProducts.slice(0, 6).map(prod => (
                        <button
                          type="button"
                          className={Number(form.product_id) === Number(prod.id) ? 'selected' : ''}
                          key={prod.id}
                          onClick={() => chooseProduct(prod)}
                        >
                          <figure>
                            {prod.image_url ? (
                              <TransparentMuralProductImage src={prod.image_url} alt="" ariaHidden/>
                            ) : (
                              <AdminMuralIcon name="product" size={19}/>
                            )}
                          </figure>
                          <span>
                            <b>{prod.nome || prod.variacao || prod.sku}</b>
                            <small>{prod.sku}</small>
                          </span>
                          {Number(form.product_id) === Number(prod.id) && <AdminMuralIcon name="check" size={14}/>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mural-studio-col">
                  <PublishImageField
                    imageUrl={imageUrl}
                    image={image}
                    busy={busy}
                    onChoose={chooseImage}
                    onRemove={removeImage}
                    onOpenCanva={() => setCanvaModalOpen(true)}
                    canvaConnected={canvaStatus.connected}
                    title="Imagem de apoio ou foto real (opcional)"
                    helper="PNG, JPG ou WebP · até 5 MB"
                  />
                </div>
              </div>
            </section>
          )}

          {activeKind === 'notice' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>1. Classificação e imagem do comunicado</strong>
                <small>Defina a prioridade e infográfico para a equipe.</small>
              </header>

              <div className="mural-studio-split-row">
                <div className="mural-studio-col">
                  <div className="mural-publish-v2-field-label">
                    <strong>Prioridade do comunicado</strong>
                    <AdminMuralIcon name="info" size={14}/>
                  </div>
                  <div className="mural-publish-v2-priority" role="group" aria-label="Prioridade da publicação">
                    {[
                      ['info','Normal','•'],
                      ['attention','Atenção','!'],
                      ['important','Importante','!']
                    ].map(([val,lbl,sym]) => (
                      <button
                        type="button"
                        key={val}
                        className={form.notice_level === val ? `active is-${val}` : `is-${val}`}
                        onClick={() => set('notice_level', val)}
                      >
                        <span>{sym}</span>{lbl}
                      </button>
                    ))}
                  </div>

                  <div className="mural-publish-v2-field-label" style={{ marginTop: '10px' }}>
                    <strong>Tipo de informação</strong>
                    <small>Define a categoria operacional.</small>
                  </div>
                  <div className="mural-publish-v2-category-chips">
                    {['COMUNICADO INTERNO','PROCESSO','NOVIDADE'].map(cat => (
                      <button
                        type="button"
                        key={cat}
                        className={form.badge === cat ? 'active' : ''}
                        onClick={() => set('badge', cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mural-studio-col">
                  <PublishImageField
                    imageUrl={imageUrl}
                    image={image}
                    busy={busy}
                    onChoose={chooseImage}
                    onRemove={removeImage}
                    onOpenCanva={() => setCanvaModalOpen(true)}
                    canvaConnected={canvaStatus.connected}
                    title="Infográfico ou imagem de apoio (opcional)"
                    helper="PNG, JPG ou WebP · até 5 MB"
                  />
                </div>
              </div>
            </section>
          )}

          {activeKind === 'collection' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>1. Informações da coleção e banner</strong>
                <small>Ano, tema e arte visual da vitrine.</small>
              </header>

              <div className="mural-studio-split-row">
                <div className="mural-studio-col">
                  <div className="mural-publish-v2-field-row">
                    <label className="mural-publish-v2-field mural-publish-v2-year">
                      Ano da coleção
                      <input
                        type="number"
                        value={collectionForm.year}
                        onChange={e => setCol('year', e.target.value)}
                        placeholder="2027"
                      />
                    </label>
                    <label className="mural-publish-v2-field">
                      Slug <em className="muted">(opcional)</em>
                      <input
                        value={collectionForm.slug}
                        onChange={e => setCol('slug', e.target.value)}
                        placeholder="gerado automaticamente"
                      />
                    </label>
                  </div>

                  <label className="mural-publish-v2-field">
                    Direção visual
                    <select
                      value={collectionForm.visual_direction}
                      onChange={e => setCol('visual_direction', e.target.value)}
                    >
                      <option value="automatic">Automática (Harmonização inteligente)</option>
                      <option value="delicate">Delicada (Tons pastéis e florais)</option>
                      <option value="premium">Premium (Dourado, contrastes sóbrios)</option>
                      <option value="minimal">Minimalista (Geométrico, monocromático)</option>
                      <option value="playful">Divertida (Cores vivas e lúdicas)</option>
                    </select>
                  </label>

                  <details className="mural-publish-v2-collection-advanced">
                    <summary>Detalhes editoriais da coleção</summary>
                    <div>
                      <label className="mural-publish-v2-field">
                        Elementos / cores do tema
                        <textarea
                          rows="3"
                          maxLength="500"
                          value={collectionForm.theme_notes}
                          onChange={e => setCol('theme_notes', e.target.value)}
                          placeholder="Ex.: flores suaves, tons pastel e acabamento dourado."
                        />
                      </label>
                    </div>
                  </details>
                </div>

                <div className="mural-studio-col">
                  <PublishImageField
                    imageUrl={imageUrl}
                    image={image}
                    busy={busy}
                    onChoose={chooseImage}
                    onRemove={removeImage}
                    onOpenCanva={() => setCanvaModalOpen(true)}
                    canvaConnected={canvaStatus.connected}
                    title="Arte da coleção (banner 2:1 recomendado)"
                    helper="Recomendado: banner horizontal 2:1 · PNG, JPG ou WebP"
                    removeLabel="Remover banner da coleção"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Card 2: Conteúdo Editorial */}
          <section className="mural-studio-card">
            <header className="mural-studio-card-header">
              <strong>2. Textos e conteúdo da publicação</strong>
              <small>Informações diretas exibidas nos cards para os operadores.</small>
            </header>

            <div className="mural-studio-copy-grid">
              <label className="mural-publish-v2-field">
                {activeKind === 'collection' ? 'Nome da coleção' : activeKind === 'notice' ? 'Título da informação' : 'Título da publicação'} <em>*</em>
                <input
                  maxLength="90"
                  required
                  value={activeKind === 'collection' ? collectionForm.name : form.title}
                  onChange={e => activeKind === 'collection' ? setCol('name', e.target.value) : set('title', e.target.value)}
                  placeholder={activeKind === 'collection' ? 'Ex.: Coleção Minimalista 2027' : activeKind === 'notice' ? 'Ex.: Nova conferência obrigatória de Wire-o' : 'Ex.: Planner Cactus 2027'}
                />
                <small>{String((activeKind === 'collection' ? collectionForm.name : form.title) || '').length}/90</small>
              </label>

              <label className="mural-publish-v2-field">
                {activeKind === 'collection' ? 'Frase de destaque (hero)' : 'Subtítulo / Linha de apoio'}
                <input
                  maxLength="120"
                  value={activeKind === 'collection' ? (collectionForm.hero_message || '') : (form.subtitle || '')}
                  onChange={e => activeKind === 'collection' ? setCol('hero_message', e.target.value) : set('subtitle', e.target.value)}
                  placeholder="Uma frase curta de impacto."
                />
                <small>{String((activeKind === 'collection' ? collectionForm.hero_message : form.subtitle) || '').length}/120</small>
              </label>

              <label className="mural-publish-v2-field mural-publish-v2-wide">
                {activeKind === 'collection' ? 'Descrição da coleção' : activeKind === 'notice' ? 'Mensagem completa do aviso' : 'Descrição curta'}
                <textarea
                  maxLength="700"
                  rows="3"
                  value={activeKind === 'collection' ? (collectionForm.description || '') : (form.body || '')}
                  onChange={e => activeKind === 'collection' ? setCol('description', e.target.value) : set('body', e.target.value)}
                  placeholder={activeKind === 'notice' ? 'Escreva a orientação completa para os operadores da expedição.' : 'Orientações e especificações que os operadores precisam saber.'}
                />
                <small>{String((activeKind === 'collection' ? collectionForm.description : form.body) || '').length}/700</small>
              </label>

              <label className="mural-publish-v2-field">
                Selo do card
                <input
                  maxLength="24"
                  value={form.badge || (activeKind === 'collection' ? 'NOVA COLEÇÃO' : '')}
                  onChange={e => set('badge', e.target.value)}
                  placeholder={activeKind === 'notice' ? 'COMUNICADO INTERNO' : activeKind === 'collection' ? 'NOVA COLEÇÃO' : 'NOVO'}
                />
                <small>{String(form.badge || '').length}/24</small>
              </label>

              <label className="mural-publish-v2-field">
                Ação no Mural
                <input value={activeKind === 'collection' ? 'Ver coleção' : activeKind === 'notice' ? 'Ver aviso' : 'Ver produto'} disabled/>
                <span className="mural-publish-v2-field-note">Padrão do sistema para este tipo de publicação.</span>
              </label>
            </div>
          </section>

          {/* Produtos da Coleção (quando for coleção) */}
          {activeKind === 'collection' && (
            <section className="mural-studio-card">
              <header className="mural-studio-card-header">
                <strong>Produtos da coleção <em>*</em></strong>
                <small>{selectedCollectionProducts.length} produto{selectedCollectionProducts.length === 1 ? '' : 's'} selecionado{selectedCollectionProducts.length === 1 ? '' : 's'}</small>
              </header>

              <label className="mural-publish-v2-field mural-publish-v2-search">
                <span>
                  <AdminMuralIcon name="search" size={16}/>
                  <input
                    value={collectionProductQuery}
                    onChange={e => setCollectionProductQuery(e.target.value)}
                    placeholder="Buscar SKU ou nome do produto para adicionar..."
                  />
                </span>
              </label>

              <div className="mural-publish-v2-collection-product-grid">
                {filteredCollectionCatalog.map(p => (
                  <button
                    type="button"
                    className={selectedCollectionProductIds.includes(p.id) ? 'selected' : ''}
                    key={p.id}
                    onClick={() => toggleCollectionProduct(p.id)}
                  >
                    <figure>
                      {p.image_url ? (
                        <TransparentMuralProductImage src={p.image_url} alt="" ariaHidden/>
                      ) : (
                        <AdminMuralIcon name="product" size={19}/>
                      )}
                    </figure>
                    <span>
                      <b>{p.nome || p.variacao || p.sku}</b>
                      <small>{p.sku}</small>
                    </span>
                    <span className="mural-publish-v2-product-check">
                      {selectedCollectionProductIds.includes(p.id) ? <AdminMuralIcon name="check" size={13}/> : '+'}
                    </span>
                  </button>
                ))}
              </div>

              {selectedCollectionProducts.length > 1 && (
                <div className="mural-publish-v2-order-list">
                  <header>
                    <strong>Ordem editorial</strong>
                    <small>Use as setas para definir a sequência da vitrine.</small>
                  </header>
                  <div>
                    {selectedCollectionProducts.map((product, index) => (
                      <article key={product.id}>
                        <span className="mural-publish-v2-drag" aria-label={`Posição ${index + 1}`}>{index + 1}</span>
                        <figure>
                          {product.image_url ? <TransparentMuralProductImage src={product.image_url} alt="" ariaHidden/> : <AdminMuralIcon name="product" size={18}/>}
                        </figure>
                        <span><b>{product.nome || product.variacao || product.sku}</b><small>{product.sku}</small></span>
                        <span className="mural-publish-v2-order-actions">
                          <button type="button" onClick={() => moveCollectionProduct(product.id, -1)} disabled={index === 0} aria-label={`Mover ${product.sku} para cima`}>↑</button>
                          <button type="button" onClick={() => moveCollectionProduct(product.id, 1)} disabled={index === selectedCollectionProducts.length - 1} aria-label={`Mover ${product.sku} para baixo`}>↓</button>
                        </span>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Card 3: Configurações & Agendamento */}
          <section className="mural-studio-card">
            <header className="mural-studio-card-header">
              <strong>3. Configurações de exibição</strong>
              <small>Defina quando e como o conteúdo será exibido no feed.</small>
            </header>

            <div className="mural-studio-settings-row">
              <label className="mural-publish-v2-setting-tile mural-publish-v2-switch">
                <input
                  type="checkbox"
                  checked={activeKind === 'collection' ? collectionForm.featured : form.featured}
                  onChange={e => activeKind === 'collection' ? setCol('featured', e.target.checked) : set('featured', e.target.checked)}
                />
                <span aria-hidden="true"/>
                <div>
                  <b>Fixar no topo do Mural</b>
                  <small>Exibe em destaque prioritário no feed.</small>
                </div>
              </label>

              {activeKind === 'collection' ? (
                <label className="mural-publish-v2-setting-tile mural-publish-v2-switch">
                  <input
                    type="checkbox"
                    checked={collectionForm.show_year}
                    onChange={e => setCol('show_year', e.target.checked)}
                  />
                  <span aria-hidden="true"/>
                  <div>
                    <b>Mostrar ano no banner</b>
                    <small>Exibe o ano junto ao título da coleção.</small>
                  </div>
                </label>
              ) : (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-input-tile">
                  <div className="mural-publish-v2-tile-label">
                    <AdminMuralIcon name="calendar" size={15}/>
                    <span>Publicar em</span>
                  </div>
                  <input
                    type="datetime-local"
                    value={form.published_at}
                    onChange={e => set('published_at', e.target.value)}
                  />
                </div>
              )}

              {activeKind === 'collection' ? (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-setting-note">
                  <span className="mural-publish-v2-note-icon"><AdminMuralIcon name="clock" size={18}/></span>
                  <div>
                    <b>Publicação imediata</b>
                    <small>Disponível logo após salvar.</small>
                  </div>
                </div>
              ) : (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-input-tile">
                  <div className="mural-publish-v2-tile-label">
                    <AdminMuralIcon name="calendar" size={15}/>
                    <span>Expira em <em className="muted">(opcional)</em></span>
                  </div>
                  <input
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={e => set('expires_at', e.target.value)}
                  />
                </div>
              )}

              {activeKind === 'collection' ? (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-setting-note">
                  <span className="mural-publish-v2-note-icon"><AdminMuralIcon name="collection" size={18}/></span>
                  <div>
                    <b>{selectedCollectionProducts.length} produto{selectedCollectionProducts.length === 1 ? '' : 's'}</b>
                    <small>Na vitrine desta coleção.</small>
                  </div>
                </div>
              ) : (
                <div className="mural-publish-v2-setting-tile mural-publish-v2-input-tile">
                  <div className="mural-publish-v2-tile-label">
                    <AdminMuralIcon name="sliders" size={15}/>
                    <span>Ordem de exibição</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.priority}
                    onChange={e => set('priority', e.target.value)}
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          </section>

          {error && <div className="mural-admin-error mural-publish-v2-error" role="alert">
            {error}
            {collectionConflict && onOpenExistingCollection && (
              <button type="button" className="mural-open-existing-collection"
                onClick={() => onOpenExistingCollection(collectionConflict.slug)}>
                Abrir coleção existente
              </button>
            )}
          </div>}
        </form>

        {/* Prévia Interativa em Tempo Real */}
        <div className="mural-studio-preview-pane">
          <PublishPreviewCard
            activeKind={activeKind}
            form={activeKind === 'collection' ? { ...collectionForm, title: collectionForm.name, body: collectionForm.description, subtitle: collectionForm.hero_message, kind: 'collection', badge: form.badge || 'NOVA COLEÇÃO', featured: collectionForm.featured } : form}
            product={selectedProduct}
            collection={activeKind === 'collection' ? { ...collectionForm, id: sourceItem?.id || 0, preview_products: selectedCollectionProducts } : null}
            selectedProducts={selectedCollectionProducts}
            imageUrl={imageUrl}
            onToggleFeatured={() => {
              if (activeKind === 'collection') {
                setCol('featured', !collectionForm.featured);
              } else {
                set('featured', !form.featured);
              }
            }}
          />
        </div>
      </div>

      {/* Modal Oficial do Canva */}
      <CanvaArtworkModal
        isOpen={canvaModalOpen}
        onClose={() => setCanvaModalOpen(false)}
        kind={activeKind}
        metadata={{
          kind: activeKind,
          kind_label: activeKind === 'product' ? 'Produto' : activeKind === 'notice' ? 'Informação' : 'Coleção',
          title: activeKind === 'collection' ? collectionForm.name : form.title || selectedProduct?.nome || '',
          subtitle: activeKind === 'collection' ? collectionForm.hero_message : form.subtitle || '',
          body: activeKind === 'collection' ? collectionForm.description : form.body || '',
          badge: activeKind === 'collection' ? (form.badge || 'NOVA COLEÇÃO') : form.badge || '',
          sku: selectedProduct?.sku || '',
          cta: activeKind === 'collection' ? 'Ver coleção' : activeKind === 'product' ? 'Ver produto' : 'Ver aviso'
        }}
        imageFiles={image ? [image] : []}
        imageUrls={
          activeKind === 'product' && selectedProduct?.image_url
            ? [selectedProduct.image_url]
            : activeKind === 'collection'
            ? selectedCollectionProducts.slice(0, 6).map(p => p.image_url).filter(Boolean)
            : []
        }
        onUseImage={useCanvaImage}
        onStatusChange={st => setCanvaStatus({ loading: false, connected: Boolean(st?.connected && st?.art_creation_ready) })}
      />
    </section>
  );
}

export function PostEditor(props) {
  return <MuralPublishWorkspace {...props} />;
}

export function CollectionEditor(props) {
  return <MuralPublishWorkspace {...props} initialKind="collection" />;
}

