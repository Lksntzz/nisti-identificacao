import React, { useEffect, useMemo, useState } from 'react';

const api = async (path, options = {}) => {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na operação');
  return data;
};

function normalizeVariation(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function Stat({ label, value }) {
  return <div className="badge"><span>{label}</span><strong>{value}</strong></div>;
}

function groupPendingMercadoLivre(products) {
  const grouped = new Map();

  for (const product of products || []) {
    if (product.image_url) continue;
    const platform = String(product.platform || '').trim().toUpperCase();
    if (!platform.includes('MERCADO LIVRE')) continue;
    const link = String(product.link || '').trim();
    if (!link) continue;

    if (!grouped.has(link)) {
      grouped.set(link, { link, products: [], name: product.nome || '', platform: product.platform || 'MERCADO LIVRE' });
    }
    grouped.get(link).products.push(product);
  }

  return [...grouped.values()].sort((a, b) => {
    if (b.products.length !== a.products.length) return b.products.length - a.products.length;
    return a.link.localeCompare(b.link);
  });
}

function exactVariation(product, variations) {
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

export default function MercadoLivreBatch({ products, onRefresh, onRefreshIndex }) {
  const groups = useMemo(() => groupPendingMercadoLivre(products), [products]);
  const currentGroup = groups[0] || null;
  const pendingSkuCount = groups.reduce((sum, group) => sum + group.products.length, 0);

  const [analysis, setAnalysis] = useState(null);
  const [selections, setSelections] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setAnalysis(null);
    setSelections({});
    setMessage('');
  }, [currentGroup?.link]);

  const selectedCount = currentGroup
    ? currentGroup.products.filter(product => Boolean(selections[product.id])).length
    : 0;

  const analyze = async () => {
    if (!currentGroup) return;
    setBusy(true);
    setMessage('');
    setAnalysis(null);
    setSelections({});

    try {
      const result = await api('/api/admin/mercadolivre-analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: currentGroup.link })
      });

      const nextSelections = {};
      let automatic = 0;
      for (const product of currentGroup.products) {
        const match = exactVariation(product, result.variations || []);
        if (match) {
          nextSelections[product.id] = match.key;
          automatic += 1;
        }
      }

      setAnalysis(result);
      setSelections(nextSelections);
      setMessage(
        `${result.variation_count || result.variations?.length || 0} opção(ões) encontrada(s) no Mercado Livre. ` +
        `${automatic} SKU(s) foram associados automaticamente por nome exato. Confira as imagens antes de salvar.`
      );
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!currentGroup || !analysis) return;

    const selectedRows = currentGroup.products
      .map(product => ({
        product,
        variation: (analysis.variations || []).find(variation => variation.key === selections[product.id])
      }))
      .filter(row => row.variation?.image_source_url);

    if (!selectedRows.length) {
      setMessage('Selecione pelo menos uma correspondência antes de salvar.');
      return;
    }

    setSaveBusy(true);
    setMessage('');
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

      await Promise.all([
        onRefresh?.(),
        onRefreshIndex?.().catch?.(() => null)
      ]);

      setMessage(
        errors.length
          ? `${saved} SKU(s) salvos. ${errors.length} falharam: ${errors[0]}`
          : `${saved} SKU(s) salvos neste anúncio. ${saved === currentGroup.products.length ? 'Próximo anúncio carregado.' : 'Revise os SKUs que ficaram sem correspondência.'}`
      );

      if (!errors.length && saved === currentGroup.products.length) {
        setAnalysis(null);
        setSelections({});
      }
    } finally {
      setSaveBusy(false);
    }
  };

  return <div className="form mercadolivre-batch">
    <div className="panel-head">
      <div>
        <strong>Mercado Livre em lote — 1 anúncio por vez</strong>
        <small>Lê os pickers da página MLBU, cruza as opções com a variação do catálogo e permite salvar vários SKUs de uma vez.</small>
      </div>
      <span>{groups.length} anúncio(s) pendente(s)</span>
    </div>

    <div className="parsed quick-stats">
      <Stat label="Anúncios ML" value={groups.length}/>
      <Stat label="SKUs ML" value={pendingSkuCount}/>
      <Stat label="Neste anúncio" value={currentGroup?.products.length || 0}/>
      <Stat label="Selecionados" value={selectedCount}/>
    </div>

    {!currentGroup && <div className="quick-done">
      <strong>Nenhum anúncio do Mercado Livre pendente.</strong>
      <span>Os SKUs restantes podem ser tratados no modo manual de fallback.</span>
    </div>}

    {currentGroup && <div className="listing-batch-card ml-card">
      <div className="listing-batch-head">
        <div>
          <p className="eyebrow">PRÓXIMO ANÚNCIO MERCADO LIVRE</p>
          <h3>{currentGroup.name || 'Anúncio do Mercado Livre'}</h3>
          <small>{currentGroup.products.length} SKU(s) sem imagem neste anúncio · {currentGroup.platform}</small>
        </div>
        <a className="open-listing" href={currentGroup.link} target="_blank" rel="noreferrer">Abrir anúncio</a>
      </div>

      <div className="listing-sku-chips">
        {currentGroup.products.map(product =>
          <span key={product.id}>{product.variacao || product.sku}</span>
        )}
      </div>

      <button type="button" disabled={busy || saveBusy} onClick={analyze}>
        {busy ? 'Analisando opções do Mercado Livre...' : analysis ? 'Analisar novamente' : 'Analisar variações deste anúncio'}
      </button>

      {message && <p className="message quick-message">{message}</p>}

      {analysis && <div className="variation-mapping">
        <div className="variation-source">
          <strong>{analysis.variation_count} opção(ões) encontradas</strong>
          <span>
            Fonte: página MLBU · {analysis.diagnostics?.picker_links || 0} picker(s) HTML · {analysis.diagnostics?.json_scripts || 0} script(s) JSON. Confira cada miniatura antes de salvar.
          </span>
        </div>

        {currentGroup.products.map(product => {
          const selectedKey = selections[product.id] || '';
          const selectedVariation = (analysis.variations || []).find(variation => variation.key === selectedKey);

          return <div className={`variation-map-row ${selectedVariation ? 'matched' : 'unmatched'}`} key={product.id}>
            <div className="variation-product">
              <strong>{product.sku}</strong>
              <span>Catálogo: {product.variacao || '—'}</span>
            </div>

            <select
              value={selectedKey}
              disabled={saveBusy}
              onChange={event => setSelections(current => ({ ...current, [product.id]: event.target.value }))}
            >
              <option value="">Selecionar opção do Mercado Livre...</option>
              {(analysis.variations || []).map(variation =>
                <option value={variation.key} key={variation.key}>
                  {variation.name}{variation.user_product_id ? ` · ${variation.user_product_id}` : ''}
                </option>
              )}
            </select>

            <div className="variation-preview">
              {selectedVariation
                ? <><img src={selectedVariation.image_url} alt={`Opção ${selectedVariation.name}`}/><span>{selectedVariation.name}</span></>
                : <span>SEM CORRESPONDÊNCIA</span>}
            </div>
          </div>;
        })}

        <button
          type="button"
          className="save-next"
          disabled={saveBusy || selectedCount === 0}
          onClick={save}
        >
          {saveBusy ? 'Salvando SKUs deste anúncio...' : `Salvar ${selectedCount} correspondência(s) selecionada(s)`}
        </button>
      </div>}
    </div>}
  </div>;
}
