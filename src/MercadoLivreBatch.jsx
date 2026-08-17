import React, { useEffect, useMemo, useState } from 'react';

const CAPTURE_KEY = 'nisti_ml_capture';

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

function mlbuFromUrl(value) {
  return String(value || '').match(/\/up\/(MLBU\d+)/i)?.[1]?.toUpperCase() || null;
}

function sameListing(a, b) {
  const aMlbu = mlbuFromUrl(a);
  const bMlbu = mlbuFromUrl(b);
  if (aMlbu && bMlbu) return aMlbu === bMlbu;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname === ub.hostname && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function captureAnalysis(capture) {
  const seen = new Set();
  const variations = [];
  for (const row of capture?.images || []) {
    const source = String(row?.url || '').trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    const text = String(row?.text || '').replace(/\s+/g, ' ').trim();
    variations.push({
      key: `browser-${variations.length}-${source}`,
      user_product_id: null,
      name: text || `Imagem capturada ${variations.length + 1}`,
      labels: text ? [text] : [`Imagem capturada ${variations.length + 1}`],
      image_source_url: source,
      image_url: `/api/admin/listing-image?src=${encodeURIComponent(source)}`,
      width: row?.width || null,
      height: row?.height || null
    });
  }
  return {
    ok: true,
    platform: 'MERCADO LIVRE',
    listing_url: capture?.source_url || '',
    title: capture?.page_title || null,
    source: 'navegador-do-usuario',
    variation_count: variations.length,
    variations
  };
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
  const [captureReady, setCaptureReady] = useState(false);

  const bookmarklet = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const endpoint = `${window.location.origin}/api/admin/ml-browser-capture`;
    const code = `(()=>{const E=${JSON.stringify(endpoint)},M=new Map(),A=(u,t,w,h)=>{if(!u)return;try{u=new URL(u,location.href).href}catch{return}if(!/^https:\/\/[^/]*mlstatic\.com\/D_NQ_/i.test(u))return;if(!M.has(u))M.set(u,{url:u,text:String(t||'').replace(/\\s+/g,' ').trim().slice(0,160),width:Math.round(w||0),height:Math.round(h||0)})};for(const i of document.images){const r=i.getBoundingClientRect(),c=i.closest('button,a,label,li,[role="button"],[role="option"],[role="radio"]'),t=[i.alt,i.title,c?.innerText,c?.getAttribute('aria-label')].filter(Boolean).join(' ');if(r.width>=20&&r.height>=20){A(i.currentSrc||i.src,t,r.width,r.height);for(const p of String(i.srcset||'').split(','))A(p.trim().split(/\\s+/)[0],t,r.width,r.height)}}for(const e of document.querySelectorAll('button,a,label,li,[role="button"],[role="option"],[role="radio"]')){const r=e.getBoundingClientRect();if(r.width<20||r.height<20)continue;const b=getComputedStyle(e).backgroundImage||'';for(const m of b.matchAll(/url\\(["']?([^"')]+)["']?\\)/g))A(m[1],[e.innerText,e.getAttribute('aria-label'),e.getAttribute('title')].filter(Boolean).join(' '),r.width,r.height)}const R=[...M.values()].slice(0,160);if(!R.length){alert('NISTI: nenhuma imagem do Mercado Livre encontrada. Abra o seletor de variacoes e deixe as opcoes visiveis antes de executar novamente.');return}const F=document.createElement('form');F.method='POST';F.action=E;F.target='_blank';for(const [n,v] of Object.entries({source_url:location.href,page_title:document.title,payload:JSON.stringify(R)})){const I=document.createElement('input');I.type='hidden';I.name=n;I.value=v;F.appendChild(I)}document.body.appendChild(F);F.submit();F.remove()})()`;
    return `javascript:${code}`;
  }, []);

  const applyStoredCapture = (quiet = false) => {
    if (!currentGroup || typeof window === 'undefined') return false;
    let capture;
    try {
      capture = JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || 'null');
    } catch {
      capture = null;
    }
    if (!capture?.images?.length) {
      setCaptureReady(false);
      if (!quiet) setMessage('Ainda não há uma captura do navegador nesta aba.');
      return false;
    }
    setCaptureReady(true);
    if (!sameListing(capture.source_url, currentGroup.link)) {
      if (!quiet) setMessage('A captura recebida pertence a outro anúncio. Abra o anúncio atual e execute o capturador nele.');
      return false;
    }

    const result = captureAnalysis(capture);
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
      `${result.variation_count} imagem(ns) capturada(s) diretamente do seu navegador. ` +
      `${automatic} SKU(s) tiveram correspondência exata por texto; confira todas as miniaturas antes de salvar.`
    );
    return true;
  };

  useEffect(() => {
    setAnalysis(null);
    setSelections({});
    setMessage('');
    setCaptureReady(false);
    setTimeout(() => applyStoredCapture(true), 0);
  }, [currentGroup?.link]);

  const selectedCount = currentGroup
    ? currentGroup.products.filter(product => Boolean(selections[product.id])).length
    : 0;

  const copyCapturer = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setMessage('Capturador copiado. Salve-o uma vez como favorito chamado “NISTI Capturar ML”. Depois abra o anúncio, deixe as variações visíveis e execute esse favorito.');
    } catch {
      window.prompt('Copie este endereço e salve como URL de um favorito chamado “NISTI Capturar ML”:', bookmarklet);
    }
  };

  const analyze = async () => {
    if (!currentGroup) return;
    setBusy(true);
    setMessage('');
    setAnalysis(null);
    setSelections({});

    try {
      const expectedVariations = [...new Set(
        currentGroup.products
          .map(product => String(product.variacao || '').trim())
          .filter(Boolean)
      )];

      const result = await api('/api/admin/mercadolivre-analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: currentGroup.link,
          expected_variations: expectedVariations
        })
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
      setMessage(`${err.message} Para esses anúncios, use o capturador do seu próprio navegador logo acima.`);
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

      if (onRefresh) await onRefresh();
      if (onRefreshIndex) {
        try { await onRefreshIndex(); } catch {}
      }

      setMessage(
        errors.length
          ? `${saved} SKU(s) salvos. ${errors.length} falharam: ${errors[0]}`
          : `${saved} SKU(s) salvos neste anúncio. ${saved === currentGroup.products.length ? 'Próximo anúncio carregado.' : 'Revise os SKUs que ficaram sem correspondência.'}`
      );

      if (!errors.length && saved === currentGroup.products.length) {
        if (analysis.source === 'navegador-do-usuario') sessionStorage.removeItem(CAPTURE_KEY);
        setAnalysis(null);
        setSelections({});
        setCaptureReady(false);
      }
    } finally {
      setSaveBusy(false);
    }
  };

  return <div className="form mercadolivre-batch">
    <div className="panel-head">
      <div>
        <strong>Mercado Livre em lote — 1 anúncio por vez</strong>
        <small>Associa as imagens de um anúncio aos SKUs corretos e salva vários de uma vez.</small>
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

      <div className="variation-source">
        <strong>Método recomendado: capturar do seu navegador</strong>
        <span>
          Faça a instalação uma única vez: copie o capturador e salve como favorito “NISTI Capturar ML”. Em cada anúncio, abra o seletor de variações, deixe as opções visíveis e execute o favorito. O NISTI recebe as imagens sem API e sem Browser Run.
        </span>
        <button type="button" className="secondary" onClick={copyCapturer}>Copiar capturador ML</button>
        {captureReady && <button type="button" className="secondary" onClick={() => applyStoredCapture(false)}>Usar captura recebida</button>}
      </div>

      <button type="button" disabled={busy || saveBusy} onClick={analyze}>
        {busy ? 'Tentando análise automática...' : analysis ? 'Tentar análise automática novamente' : 'Tentar análise automática'}
      </button>

      {message && <p className="message quick-message">{message}</p>}

      {analysis && <div className="variation-mapping">
        <div className="variation-source">
          <strong>{analysis.variation_count} opção(ões) encontradas</strong>
          <span>
            Fonte: {analysis.source || 'Mercado Livre'} · confira cada miniatura antes de salvar.
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
              <option value="">Selecionar imagem correta...</option>
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
