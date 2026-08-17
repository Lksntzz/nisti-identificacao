import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = async (path, options = {}) => {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na operação');
  return data;
};

function Badge({ label, value }) {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  return <div className="badge"><span>{label}</span><strong>{display}</strong></div>;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => String(value).trim() !== '')) rows.push(row);
  return rows;
}

function catalogRowsFromCsv(text) {
  const table = parseCsv(String(text || '').replace(/^\uFEFF/, ''));
  const catalog = [];

  for (const row of table) {
    const sku = String(row[5] || row[14] || '').trim();
    if (!sku || sku.toUpperCase() === 'SKU') continue;

    catalog.push({
      nome: String(row[2] || row[9] || '').trim(),
      variacao: String(row[3] || row[13] || '').trim(),
      platform: String(row[4] || row[11] || '').trim(),
      sku,
      link: String(row[6] || row[12] || '').trim()
    });
  }

  return catalog;
}

function normalizeVariation(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function groupPendingShopee(products) {
  const grouped = new Map();
  for (const product of products) {
    if (product.image_url) continue;
    if (String(product.platform || '').trim().toUpperCase() !== 'SHOPEE') continue;
    const link = String(product.link || '').trim();
    if (!link) continue;

    if (!grouped.has(link)) {
      grouped.set(link, { link, products: [], name: product.nome || '' });
    }
    grouped.get(link).products.push(product);
  }

  return [...grouped.values()].sort((a, b) => {
    if (b.products.length !== a.products.length) return b.products.length - a.products.length;
    return a.link.localeCompare(b.link);
  });
}

function exactShopeeVariation(product, variations) {
  const target = normalizeVariation(product.variacao);
  if (!target) return null;

  const matched = (variations || []).filter(variation => {
    const labels = [variation.name, ...(variation.labels || [])];
    return labels.some(label => normalizeVariation(label) === target);
  });

  const uniqueByImage = new Map();
  for (const variation of matched) {
    if (variation.image_source_url && !uniqueByImage.has(variation.image_source_url)) {
      uniqueByImage.set(variation.image_source_url, variation);
    }
  }

  return uniqueByImage.size === 1 ? [...uniqueByImage.values()][0] : null;
}

function Admin() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ sku: '', nome: '', variacao: '', platform: '', link: '' });
  const [parsed, setParsed] = useState(null);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [indexInfo, setIndexInfo] = useState(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexMessage, setIndexMessage] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [skuFiles, setSkuFiles] = useState({});
  const [skuPreviews, setSkuPreviews] = useState({});
  const [skuBusy, setSkuBusy] = useState(null);
  const [skuMessage, setSkuMessage] = useState('');
  const [skippedSkuIds, setSkippedSkuIds] = useState([]);
  const [shopeeAnalysis, setShopeeAnalysis] = useState(null);
  const [shopeeSelections, setShopeeSelections] = useState({});
  const [shopeeBusy, setShopeeBusy] = useState(false);
  const [shopeeSaveBusy, setShopeeSaveBusy] = useState(false);
  const [shopeeMessage, setShopeeMessage] = useState('');

  const shopeeGroups = groupPendingShopee(products);
  const currentShopeeGroup = shopeeGroups[0] || null;
  const shopeePendingSkuCount = shopeeGroups.reduce((sum, group) => sum + group.products.length, 0);

  const refresh = async () => {
    const data = await api('/api/products');
    setProducts(data.products || []);
  };

  const refreshIndex = async () => {
    const data = await api('/api/admin/cover-index');
    setIndexInfo(data);
    return data;
  };

  useEffect(() => {
    refresh().catch(() => {});
    refreshIndex().catch(() => {});
  }, []);

  useEffect(() => {
    setShopeeAnalysis(null);
    setShopeeSelections({});
    setShopeeMessage('');
  }, [currentShopeeGroup?.link]);

  useEffect(() => {
    const sku = form.sku.trim();
    if (!sku) return setParsed(null);
    const timer = setTimeout(() => {
      api('/api/sku/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku })
      }).then(setParsed).catch(() => setParsed(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.sku]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const created = await api('/api/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form })
      });
      if (image) {
        const fd = new FormData();
        fd.append('image', image);
        await api(`/api/products/${created.id}/image`, { method: 'POST', body: fd });
      }
      setForm({ sku: '', nome: '', variacao: '', platform: '', link: '' });
      setImage(null);
      setParsed(null);
      setMessage('Produto cadastrado.');
      await Promise.all([refresh(), refreshIndex().catch(() => null)]);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const importCatalogCsv = async (file) => {
    if (!file) return;
    setBulkBusy(true);
    setBulkMessage('');
    try {
      const text = await file.text();
      const rows = catalogRowsFromCsv(text);
      if (!rows.length) throw new Error('Nenhum SKU encontrado no CSV. Exporte a aba ANÚNCIOS completa.');

      let created = 0;
      let updated = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const result = await api('/api/admin/bulk-products', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: batch })
        });
        created += result.created || 0;
        updated += result.updated || 0;
        if (result.errors?.length) {
          errors.push(...result.errors.map(error => ({ ...error, batch_start: i + 1 })));
        }
      }

      setBulkMessage(errors.length
        ? `Catálogo processado: ${created} novos, ${updated} atualizados, ${errors.length} erro(s) de SKU para revisar.`
        : `Catálogo importado: ${created} novos e ${updated} atualizados.`);
      await Promise.all([refresh(), refreshIndex().catch(() => null)]);
    } catch (err) {
      setBulkMessage(err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const indexPendingCovers = async () => {
    setIndexBusy(true);
    setIndexMessage('');
    try {
      let info = await refreshIndex();
      let safety = 0;
      let processedTotal = 0;
      while (info.pending_covers > 0 && safety < 100) {
        const result = await api('/api/admin/reindex-cover-embeddings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 6 })
        });
        processedTotal += result.processed?.length || 0;
        if (result.errors?.length) {
          setIndexMessage(`Indexação parcial: ${processedTotal} capa(s) processadas. ${result.errors.length} erro(s).`);
          break;
        }
        info = await refreshIndex();
        safety += 1;
      }
      info = await refreshIndex();
      if (info.pending_covers === 0) {
        setIndexMessage(`Índice visual atualizado. ${info.indexed_covers} capa(s) indexadas.`);
      } else {
        setIndexMessage(`Ainda faltam ${info.pending_covers} capa(s) para indexar.`);
      }
    } catch (err) {
      setIndexMessage(err.message);
    } finally {
      setIndexBusy(false);
    }
  };

  const analyzeShopeeGroup = async () => {
    if (!currentShopeeGroup) return;
    setShopeeBusy(true);
    setShopeeMessage('');
    setShopeeAnalysis(null);
    setShopeeSelections({});

    try {
      const result = await api('/api/admin/shopee-analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: currentShopeeGroup.link })
      });

      const selections = {};
      let automatic = 0;
      for (const product of currentShopeeGroup.products) {
        const match = exactShopeeVariation(product, result.variations || []);
        if (match) {
          selections[product.id] = match.key;
          automatic += 1;
        }
      }

      setShopeeAnalysis(result);
      setShopeeSelections(selections);
      setShopeeMessage(
        `${result.variation_count || result.variations?.length || 0} variação(ões) encontrada(s). ` +
        `${automatic} SKU(s) foram associados automaticamente por nome exato. Confira antes de salvar.`
      );
    } catch (err) {
      setShopeeMessage(err.message);
    } finally {
      setShopeeBusy(false);
    }
  };

  const saveShopeeSelections = async () => {
    if (!currentShopeeGroup || !shopeeAnalysis) return;

    const selectedRows = currentShopeeGroup.products
      .map(product => ({
        product,
        variation: (shopeeAnalysis.variations || []).find(
          variation => variation.key === shopeeSelections[product.id]
        )
      }))
      .filter(row => row.variation?.image_source_url);

    if (!selectedRows.length) {
      setShopeeMessage('Selecione pelo menos uma correspondência antes de salvar.');
      return;
    }

    setShopeeSaveBusy(true);
    setShopeeMessage('');
    let saved = 0;
    const errors = [];

    try {
      for (const row of selectedRows) {
        try {
          await api(`/api/products/${row.product.id}/image-from-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image_url: row.variation.image_source_url })
          });
          saved += 1;
        } catch (err) {
          errors.push(`${row.product.sku}: ${err.message}`);
        }
      }

      await Promise.all([refresh(), refreshIndex().catch(() => null)]);
      setShopeeMessage(
        errors.length
          ? `${saved} SKU(s) salvos. ${errors.length} falharam: ${errors[0]}`
          : `${saved} SKU(s) salvos neste anúncio. ${saved === currentShopeeGroup.products.length ? 'Próximo anúncio carregado.' : 'Revise os SKUs que ficaram sem correspondência.'}`
      );

      if (!errors.length && saved === currentShopeeGroup.products.length) {
        setShopeeAnalysis(null);
        setShopeeSelections({});
      }
    } finally {
      setShopeeSaveBusy(false);
    }
  };

  const chooseSkuImage = (product, file) => {
    if (!file || !String(file.type || '').startsWith('image/')) return;
    setSkuFiles(current => ({ ...current, [product.id]: file }));
    setSkuPreviews(current => {
      if (current[product.id]) URL.revokeObjectURL(current[product.id]);
      return { ...current, [product.id]: URL.createObjectURL(file) };
    });
    setSkuMessage(`Imagem selecionada para ${product.sku}. Confira e salve para avançar.`);
  };

  const pasteSkuImage = (product, event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find(item => String(item.type || '').startsWith('image/'));
    const file = imageItem?.getAsFile?.();
    if (file) {
      event.preventDefault();
      chooseSkuImage(product, file);
    }
  };

  const dropSkuImage = (product, event) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer?.files || []).find(item => String(item.type || '').startsWith('image/'));
    if (file) chooseSkuImage(product, file);
  };

  const clearSkuDraft = (productId) => {
    setSkuFiles(current => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setSkuPreviews(current => {
      const next = { ...current };
      if (next[productId]) URL.revokeObjectURL(next[productId]);
      delete next[productId];
      return next;
    });
  };

  const saveSkuImage = async (product) => {
    const file = skuFiles[product.id];
    if (!file) {
      setSkuMessage(`Selecione ou cole a imagem correta do SKU ${product.sku}.`);
      return;
    }

    setSkuBusy(product.id);
    setSkuMessage('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const result = await api(`/api/products/${product.id}/image`, {
        method: 'POST',
        body: fd
      });

      clearSkuDraft(product.id);
      setSkippedSkuIds(current => current.filter(id => id !== product.id));
      setSkuMessage(result.embedding_indexed
        ? `SKU ${product.sku} salvo e indexado. Próximo SKU carregado abaixo.`
        : `SKU ${product.sku} salvo. O índice visual precisa ser refeito: ${result.embedding_error || 'erro desconhecido'}`);
      await Promise.all([refresh(), refreshIndex().catch(() => null)]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSkuMessage(err.message);
    } finally {
      setSkuBusy(null);
    }
  };

  const skipSku = (product) => {
    clearSkuDraft(product.id);
    setSkippedSkuIds(current => [...new Set([...current, product.id])]);
    setSkuMessage(`SKU ${product.sku} pulado nesta sessão. Próximo SKU carregado.`);
  };

  const withoutImage = products.filter(product => !product.image_url).length;
  const withImage = products.length - withoutImage;
  const pendingSkuProducts = products.filter(product => !product.image_url && !skippedSkuIds.includes(product.id));
  const currentSku = pendingSkuProducts[0] || null;
  const skippedCount = skippedSkuIds.filter(id => products.some(product => product.id === id && !product.image_url)).length;
  const progressPercent = products.length ? Math.round((withImage / products.length) * 100) : 0;
  const selectedShopeeCount = currentShopeeGroup
    ? currentShopeeGroup.products.filter(product => Boolean(shopeeSelections[product.id])).length
    : 0;

  return <section className="panel">
    <div className="panel-head">
      <div><p className="eyebrow">ADMIN</p><h2>Produtos</h2></div>
      <span>{products.length} cadastrados</span>
    </div>

    <div className="form shopee-batch">
      <div className="panel-head">
        <div>
          <strong>Shopee em lote — 1 anúncio por vez</strong>
          <small>Analisa as variações do anúncio, cruza com o nome da variação do catálogo e permite salvar vários SKUs de uma vez.</small>
        </div>
        <span>{shopeeGroups.length} anúncio(s) pendente(s)</span>
      </div>

      <div className="parsed quick-stats">
        <Badge label="Anúncios Shopee" value={shopeeGroups.length}/>
        <Badge label="SKUs Shopee" value={shopeePendingSkuCount}/>
        <Badge label="Neste anúncio" value={currentShopeeGroup?.products.length || 0}/>
        <Badge label="Selecionados" value={selectedShopeeCount}/>
      </div>

      {!currentShopeeGroup && <div className="quick-done">
        <strong>Nenhum anúncio da Shopee pendente.</strong>
        <span>Use o modo manual abaixo para outras plataformas ou SKUs sem link.</span>
      </div>}

      {currentShopeeGroup && <div className="listing-batch-card">
        <div className="listing-batch-head">
          <div>
            <p className="eyebrow">PRÓXIMO ANÚNCIO SHOPEE</p>
            <h3>{currentShopeeGroup.name || 'Anúncio da Shopee'}</h3>
            <small>{currentShopeeGroup.products.length} SKU(s) sem imagem neste anúncio.</small>
          </div>
          <a className="open-listing" href={currentShopeeGroup.link} target="_blank" rel="noreferrer">Abrir anúncio</a>
        </div>

        <div className="listing-sku-chips">
          {currentShopeeGroup.products.map(product =>
            <span key={product.id}>{product.variacao || product.sku}</span>
          )}
        </div>

        <button type="button" disabled={shopeeBusy || shopeeSaveBusy} onClick={analyzeShopeeGroup}>
          {shopeeBusy ? 'Analisando variações da Shopee...' : shopeeAnalysis ? 'Analisar novamente' : 'Analisar variações deste anúncio'}
        </button>

        {shopeeMessage && <p className="message quick-message">{shopeeMessage}</p>}

        {shopeeAnalysis && <div className="variation-mapping">
          <div className="variation-source">
            <strong>{shopeeAnalysis.variation_count} variação(ões) encontradas</strong>
            <span>Fonte: {shopeeAnalysis.source || 'Shopee'} · selecione somente quando a variação e a imagem estiverem corretas.</span>
          </div>

          {currentShopeeGroup.products.map(product => {
            const selectedKey = shopeeSelections[product.id] || '';
            const selectedVariation = (shopeeAnalysis.variations || []).find(
              variation => variation.key === selectedKey
            );

            return <div className={`variation-map-row ${selectedVariation ? 'matched' : 'unmatched'}`} key={product.id}>
              <div className="variation-product">
                <strong>{product.sku}</strong>
                <span>Catálogo: {product.variacao || '—'}</span>
              </div>

              <select
                value={selectedKey}
                disabled={shopeeSaveBusy}
                onChange={event => setShopeeSelections(current => ({
                  ...current,
                  [product.id]: event.target.value
                }))}
              >
                <option value="">Selecionar variação da Shopee...</option>
                {(shopeeAnalysis.variations || []).map(variation =>
                  <option value={variation.key} key={variation.key}>{variation.name}</option>
                )}
              </select>

              <div className="variation-preview">
                {selectedVariation
                  ? <><img src={selectedVariation.image_url} alt={`Variação ${selectedVariation.name}`}/><span>{selectedVariation.name}</span></>
                  : <span>SEM CORRESPONDÊNCIA</span>}
              </div>
            </div>;
          })}

          <button
            type="button"
            className="save-next"
            disabled={shopeeSaveBusy || selectedShopeeCount === 0}
            onClick={saveShopeeSelections}
          >
            {shopeeSaveBusy
              ? 'Salvando SKUs deste anúncio...'
              : `Salvar ${selectedShopeeCount} correspondência(s) selecionada(s)`}
          </button>
        </div>}
      </div>}
    </div>

    <div className="form quick-workflow">
      <div className="panel-head">
        <div>
          <strong>Modo manual de fallback — 1 SKU por vez</strong>
          <small>Use quando o anúncio não puder ser analisado automaticamente ou para Mercado Livre/Amazon.</small>
        </div>
        <span>{withImage}/{products.length}</span>
      </div>

      <div className="quick-progress">
        <div className="quick-progress-bar"><span style={{ width: `${progressPercent}%` }} /></div>
        <div className="parsed quick-stats">
          <Badge label="Concluídos" value={withImage}/>
          <Badge label="Restantes" value={withoutImage}/>
          <Badge label="Progresso" value={`${progressPercent}%`}/>
          <Badge label="Pulados" value={skippedCount}/>
        </div>
      </div>

      {skuMessage && <p className="message quick-message">{skuMessage}</p>}

      {!currentSku && withoutImage === 0 && <div className="quick-done"><strong>Cadastro de imagens concluído.</strong><span>Todos os SKUs têm imagem própria.</span></div>}

      {!currentSku && withoutImage > 0 && <div className="quick-done">
        <strong>Não há SKU disponível nesta sessão.</strong>
        <span>{skippedCount} SKU(s) foram pulados.</span>
        <button type="button" onClick={() => setSkippedSkuIds([])}>Voltar aos SKUs pulados</button>
      </div>}

      {currentSku && (() => {
        const product = currentSku;
        const preview = skuPreviews[product.id];
        const isBusy = skuBusy === product.id;
        return <article className="sku-review quick-sku-card" key={product.id}>
          <div className="quick-step">PRÓXIMO SKU · {withImage + 1} DE {products.length}</div>

          <div className="sku-review-head">
            <div>
              <p className="eyebrow">SKU</p>
              <h3>{product.sku}</h3>
              <small><strong>Variação:</strong> {product.variacao || '—'}</small>
              <small><strong>Nome:</strong> {product.nome || '—'}</small>
              <small><strong>Capa:</strong> {product.capa_code}</small>
            </div>
            <span>{product.platform || 'SEM PLATAFORMA'}</span>
          </div>

          <div className="sku-actions-top">
            {product.link
              ? <a className="open-listing" href={product.link} target="_blank" rel="noreferrer">1. Abrir anúncio</a>
              : <span className="no-link">Sem link de anúncio</span>}
            <button type="button" className="secondary" disabled={isBusy} onClick={() => skipSku(product)}>Pular este SKU</button>
          </div>

          <div
            className={`sku-dropzone ${preview ? 'has-preview' : ''}`}
            tabIndex={0}
            onPaste={event => pasteSkuImage(product, event)}
            onDragOver={event => event.preventDefault()}
            onDrop={event => dropSkuImage(product, event)}
          >
            {preview
              ? <><img src={preview} alt={`Imagem selecionada para ${product.sku}`}/><strong className="preview-ok">2. Confira: esta é a imagem correta?</strong></>
              : <div>
                  <strong>2. Cole a imagem aqui</strong>
                  <span>Depois de copiar a foto correta do anúncio, clique nesta área e pressione Ctrl+V.</span>
                </div>}
          </div>

          <div className="sku-actions-bottom">
            <label className="file-button">
              Selecionar arquivo
              <input type="file" accept="image/*" disabled={isBusy} onChange={e => chooseSkuImage(product, e.target.files?.[0] || null)} />
            </label>
            {preview && <button type="button" className="secondary" disabled={isBusy} onClick={() => clearSkuDraft(product.id)}>Trocar imagem</button>}
            <button type="button" className="save-next" disabled={isBusy || !skuFiles[product.id]} onClick={() => saveSkuImage(product)}>
              {isBusy ? 'Salvando...' : '3. Salvar e ir para o próximo'}
            </button>
          </div>
        </article>;
      })()}
    </div>

    <div className="form">
      <div className="panel-head">
        <div>
          <strong>Importação em massa</strong>
          <small>CSV exportado da aba ANÚNCIOS da planilha ANUNCIOS NOVOS</small>
        </div>
      </div>
      <div className="parsed">
        <Badge label="Produtos" value={products.length}/>
        <Badge label="Sem imagem" value={withoutImage}/>
      </div>
      <label>Arquivo CSV<input type="file" accept=".csv,text/csv" disabled={bulkBusy} onChange={e => importCatalogCsv(e.target.files?.[0] || null)} /></label>
      {bulkBusy && <p className="message">Importando catálogo em lotes...</p>}
      {bulkMessage && <p className="message">{bulkMessage}</p>}
    </div>

    <div className="form">
      <div className="panel-head">
        <div><strong>Índice visual das capas</strong><small>Busca Top-K antes da confirmação pelo Gemini</small></div>
        {indexInfo && <span>{indexInfo.indexed_covers}/{indexInfo.reference_covers}</span>}
      </div>
      {indexInfo && <div className="parsed">
        <Badge label="Referências" value={indexInfo.reference_covers}/>
        <Badge label="Indexadas" value={indexInfo.indexed_covers}/>
        <Badge label="Pendentes" value={indexInfo.pending_covers}/>
        <Badge label="Top-K" value={indexInfo.top_k}/>
      </div>}
      <button type="button" disabled={indexBusy || !indexInfo || indexInfo.pending_covers === 0} onClick={indexPendingCovers}>
        {indexBusy ? 'Indexando capas...' : indexInfo?.pending_covers ? `Indexar ${indexInfo.pending_covers} capa(s) pendente(s)` : 'Índice visual atualizado'}
      </button>
      {indexMessage && <p className="message">{indexMessage}</p>}
    </div>

    <form className="form" onSubmit={submit}>
      <div className="panel-head"><div><strong>Cadastro manual de produto</strong><small>Use apenas quando precisar cadastrar um SKU fora da importação em massa.</small></div></div>
      <label>SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="VACMNO_LIN1_BBB" required /></label>
      <div className="grid2">
        <label>Nome<input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
        <label>Variação<input value={form.variacao} onChange={e => setForm({ ...form, variacao: e.target.value })} /></label>
      </div>
      <div className="grid2">
        <label>Plataforma<input value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} placeholder="SHOPEE" /></label>
        <label>Link do anúncio<input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="https://..." /></label>
      </div>
      <label>Imagem de referência da capa<input type="file" accept="image/*" onChange={e => setImage(e.target.files?.[0] || null)} /></label>
      {parsed && <div className="parsed">
        <Badge label="Miolo" value={parsed.mioloCode}/>
        <Badge label="Capa" value={parsed.capaCode}/>
        <Badge label="Wire-O" value={parsed.wireo}/>
        <Badge label="Tassel" value={parsed.tassel}/>
        <Badge label="Elástico" value={parsed.elastico}/>
      </div>}
      <button disabled={busy || !parsed}>{busy ? 'Salvando...' : 'Cadastrar produto'}</button>
      {message && <p className="message">{message}</p>}
    </form>

    <details className="catalog-details">
      <summary>Ver catálogo completo ({products.length} SKUs)</summary>
      <div className="list">
        {products.map(product => <article className="product" key={product.id}>
          {product.image_url
            ? <img src={product.image_url} alt={`Imagem do SKU ${product.sku}`}/>
            : <div className="image-placeholder">SEM FOTO</div>}
          <div>
            <strong>{product.sku}</strong>
            <span>{product.nome || product.variacao || product.capa_code}</span>
            <small>{product.wireo_code}/{product.tassel_code}/{product.elastico_code}{product.platform ? ` · ${product.platform}` : ''}</small>
          </div>
        </article>)}
      </div>
    </details>
  </section>;
}

function Expedition() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = (file) => {
    setPhoto(file || null);
    setResult(null);
    setError('');
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : '');
  };

  const identify = async () => {
    if (!photo) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('image', photo);
      const data = await api('/api/identify', { method: 'POST', body: fd });
      setResult(data.product);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel expedition">
    <p className="eyebrow">EXPEDIÇÃO</p>
    <h2>Identificar produto pela capa</h2>
    <p>Fotografe a arte da capa de frente. A capa pode estar solta: não precisa ter Wire-O, tassel ou elástico.</p>
    <label className="camera">
      {preview
        ? <img src={preview} alt="Foto da capa capturada"/>
        : <><span className="camera-icon">◎</span><strong>Tirar foto da capa</strong><small>Toque para abrir a câmera</small></>}
      <input type="file" accept="image/*" capture="environment" onChange={e => choose(e.target.files?.[0])}/>
    </label>
    <button disabled={!photo || busy} onClick={identify}>{busy ? 'Analisando capa...' : 'Identificar produto'}</button>
    {error && <div className="not-found"><strong>Produto não identificado</strong><span>{error}</span></div>}
    {result && <div className="result">
      <p className="eyebrow">PRODUTO IDENTIFICADO PELA CAPA</p>
      <h3>{result.sku}</h3>
      {result.image_url && <img className="result-image" src={result.image_url} alt="Capa de referência"/>}
      <div className="parsed">
        <Badge label="Capa" value={result.capa_code}/>
        <Badge label="Wire-O" value={result.wireo}/>
        <Badge label="Tassel" value={result.tassel}/>
        <Badge label="Elástico" value={result.elastico}/>
      </div>
      {result.platform && <p><strong>Plataforma:</strong> {result.platform}</p>}
    </div>}
  </section>;
}

function App() {
  const [mode, setMode] = useState('expedition');
  return <main className="shell">
    <header>
      <div><p className="eyebrow">NISTI PRINT</p><h1>Identificação Visual</h1></div>
      <nav>
        <button className={mode === 'expedition' ? 'active' : ''} onClick={() => setMode('expedition')}>Expedição</button>
        <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>ADM</button>
      </nav>
    </header>
    {mode === 'expedition' ? <Expedition/> : <Admin/>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
