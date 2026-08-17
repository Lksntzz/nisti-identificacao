import React, { useEffect, useMemo, useState } from 'react';
import './quick-registration.css';

const CAPTURE_KEY = 'nisti_ml_capture';
const DRAFT_KEY = 'nisti_quick_registration_draft';

const api = async (path, options = {}) => {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`);
  return payload;
};

const normalizeCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9&]/g, '').slice(0, 24);
const normalizeMiolo = value => String(value || '').toUpperCase().replace(/[^A-Z0-9&]/g, '').slice(0, 24);

function detectPlatform(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    if (host === 'shopee.com.br' || host.endsWith('.shopee.com.br')) return 'SHOPEE';
    if (host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br')) return 'MERCADO LIVRE';
    return null;
  } catch {
    return null;
  }
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

function captureToAnalysis(capture) {
  const seen = new Set();
  const variations = [];
  for (const row of capture?.images || []) {
    const source = String(row?.url || '').trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    const text = String(row?.text || '').replace(/\s+/g, ' ').trim();
    variations.push({
      key: `capture-${variations.length}-${source}`,
      name: text || `Imagem capturada ${variations.length + 1}`,
      labels: text ? [text] : [],
      image_source_url: source,
      image_url: `/api/admin/listing-image?src=${encodeURIComponent(source)}`
    });
  }
  return {
    ok: true,
    platform: 'MERCADO LIVRE',
    listing_url: capture?.source_url || '',
    title: capture?.page_title || '',
    source: 'navegador-do-usuario',
    variation_count: variations.length,
    variations
  };
}

function buildRows(analysis) {
  const variations = Array.isArray(analysis?.variations) ? analysis.variations : [];
  if (variations.length) {
    return variations.map((variation, index) => ({
      key: variation.key || `row-${index}`,
      included: true,
      variation: variation.name || `Variação ${index + 1}`,
      capaCode: '',
      imageSource: variation.image_source_url || '',
      imageUrl: variation.image_url || '',
      sourceLabel: variation.user_product_id || variation.name || `Variação ${index + 1}`
    }));
  }

  return [{
    key: `manual-${crypto.randomUUID()}`,
    included: true,
    variation: 'Produto único',
    capaCode: '',
    imageSource: '',
    imageUrl: '',
    sourceLabel: 'Produto único'
  }];
}

function humanPlatform(platform) {
  return platform === 'SHOPEE' ? 'Shopee' : platform === 'MERCADO LIVRE' ? 'Mercado Livre' : '—';
}

function FieldHint({ children }) {
  return <small className="qr-hint">{children}</small>;
}

export default function QuickRegistration() {
  const [products, setProducts] = useState([]);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [rows, setRows] = useState([]);
  const [common, setCommon] = useState({ miolo: '', wireo: '', tassel: '', elastico: '' });
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');

  const platform = useMemo(() => detectPlatform(link), [link]);
  const existingSkus = useMemo(() => new Set(products.map(product => String(product.sku || '').toUpperCase())), [products]);
  const existingCapas = useMemo(() => new Set(products.map(product => String(product.capa_code || '').toUpperCase())), [products]);
  const knownMiolos = useMemo(() => [...new Set(products.map(product => product.miolo_code).filter(Boolean))].sort(), [products]);

  const finish = common.wireo && common.tassel && common.elastico
    ? `${common.wireo}${common.tassel}${common.elastico}`
    : '';

  const skuFor = row => {
    if (!common.miolo || !row.capaCode || !finish) return '';
    return `${normalizeMiolo(common.miolo)}_${normalizeCode(row.capaCode)}_${finish}`;
  };

  const selectedRows = rows.filter(row => row.included);
  const duplicateSkuRows = selectedRows.filter(row => existingSkus.has(skuFor(row)));
  const repeatedSkuValues = (() => {
    const counts = new Map();
    for (const row of selectedRows) {
      const sku = skuFor(row);
      if (!sku) continue;
      counts.set(sku, (counts.get(sku) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([sku]) => sku));
  })();
  const repeatedCapaValues = (() => {
    const counts = new Map();
    for (const row of selectedRows) {
      const code = normalizeCode(row.capaCode);
      if (!code) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code));
  })();

  const canSave = selectedRows.length > 0 &&
    Boolean(common.miolo && finish && title.trim()) &&
    selectedRows.every(row => normalizeCode(row.capaCode) && row.imageSource) &&
    duplicateSkuRows.length === 0 &&
    repeatedSkuValues.size === 0;

  const bookmarklet = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const endpoint = `${window.location.origin}/api/admin/ml-browser-capture`;
    const code = `(()=>{const E=${JSON.stringify(endpoint)},M=new Map(),A=(u,t,w,h)=>{if(!u)return;try{u=new URL(u,location.href).href}catch{return}if(!/^https:\/\/[^/]*mlstatic\\.com\/D_NQ_/i.test(u))return;if(!M.has(u))M.set(u,{url:u,text:String(t||'').replace(/\\s+/g,' ').trim().slice(0,160),width:Math.round(w||0),height:Math.round(h||0)})};for(const i of document.images){const r=i.getBoundingClientRect(),c=i.closest('button,a,label,li,[role="button"],[role="option"],[role="radio"]'),t=[i.alt,i.title,c?.innerText,c?.getAttribute('aria-label')].filter(Boolean).join(' ');if(r.width>=20&&r.height>=20){A(i.currentSrc||i.src,t,r.width,r.height);for(const p of String(i.srcset||'').split(','))A(p.trim().split(/\\s+/)[0],t,r.width,r.height)}}for(const e of document.querySelectorAll('button,a,label,li,[role="button"],[role="option"],[role="radio"]')){const r=e.getBoundingClientRect();if(r.width<20||r.height<20)continue;const b=getComputedStyle(e).backgroundImage||'';for(const m of b.matchAll(/url\\(["']?([^"')]+)["']?\\)/g))A(m[1],[e.innerText,e.getAttribute('aria-label'),e.getAttribute('title')].filter(Boolean).join(' '),r.width,r.height)}const R=[...M.values()].slice(0,160);if(!R.length){alert('NISTI: nenhuma imagem encontrada. Abra as variacoes e deixe as opcoes visiveis.');return}const F=document.createElement('form');F.method='POST';F.action=E;F.target='_blank';for(const [n,v] of Object.entries({source_url:location.href,page_title:document.title,payload:JSON.stringify(R)})){const I=document.createElement('input');I.type='hidden';I.name=n;I.value=v;F.appendChild(I)}document.body.appendChild(F);F.submit();F.remove()})()`;
    return `javascript:${code}`;
  }, []);

  const refreshProducts = async () => {
    const data = await api('/api/products');
    setProducts(data.products || []);
  };

  useEffect(() => {
    refreshProducts().catch(() => {});
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (draft?.link) setLink(draft.link);
      if (draft?.title) setTitle(draft.title);
      if (draft?.common) setCommon(current => ({ ...current, ...draft.common }));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ link, title, common }));
    } catch {}
  }, [link, title, common]);

  useEffect(() => {
    if (!link || detectPlatform(link) !== 'MERCADO LIVRE') return;
    try {
      const capture = JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || 'null');
      if (!capture?.images?.length || !sameListing(capture.source_url, link)) return;
      const result = captureToAnalysis(capture);
      setAnalysis(result);
      setRows(buildRows(result));
      setTitle(current => current || result.title || '');
      setMessage(`${result.variation_count} imagem(ns) recebida(s) do seu navegador. Agora informe os códigos de capa e confira antes de cadastrar.`);
      setMessageType('success');
    } catch {}
  }, [link]);

  const analyzeLink = async () => {
    const detected = detectPlatform(link);
    if (!detected) {
      setMessage('Cole um link válido da Shopee ou Mercado Livre Brasil.');
      setMessageType('error');
      return;
    }

    setBusy(true);
    setMessage('');
    setRows([]);
    setAnalysis(null);

    try {
      if (detected === 'MERCADO LIVRE') {
        try {
          const capture = JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || 'null');
          if (capture?.images?.length && sameListing(capture.source_url, link)) {
            const result = captureToAnalysis(capture);
            setAnalysis(result);
            setRows(buildRows(result));
            setTitle(result.title || '');
            setMessage(`${result.variation_count} imagem(ns) carregada(s) da captura do navegador.`);
            setMessageType('success');
            return;
          }
        } catch {}
      }

      const endpoint = detected === 'SHOPEE'
        ? '/api/admin/shopee-analyze'
        : '/api/admin/mercadolivre-analyze';
      const result = await api(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: link, expected_variations: [] })
      });

      setAnalysis(result);
      setTitle(result.title || '');
      setRows(buildRows(result));
      setMessage(`${result.variation_count || result.variations?.length || 0} opção(ões) encontrada(s). Confira as imagens e complete os códigos internos.`);
      setMessageType('success');
    } catch (error) {
      if (detected === 'MERCADO LIVRE') {
        setMessage(`O Mercado Livre não liberou as variações automaticamente. Use “Preparar captura ML”, abra o anúncio, deixe as variações visíveis e execute o favorito NISTI.`);
        setMessageType('warning');
      } else {
        setMessage(error.message);
        setMessageType('error');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyMlCapturer = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setMessage('Capturador copiado. Salve como favorito “NISTI Capturar ML”. Depois abra o anúncio, deixe as variações visíveis e execute o favorito.');
      setMessageType('info');
    } catch {
      window.prompt('Copie este endereço e salve como URL de um favorito chamado “NISTI Capturar ML”:', bookmarklet);
    }
  };

  const updateRow = (key, patch) => {
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  };

  const addManualRow = () => {
    setRows(current => [...current, {
      key: `manual-${crypto.randomUUID()}`,
      included: true,
      variation: `Variação ${current.length + 1}`,
      capaCode: '',
      imageSource: '',
      imageUrl: '',
      sourceLabel: 'Manual'
    }]);
  };

  const saveAll = async () => {
    if (!canSave) {
      setMessage('Preencha miolo, acabamento, nome, código de capa e imagem de todas as linhas selecionadas. SKUs duplicados não podem ser cadastrados.');
      setMessageType('error');
      return;
    }

    setSaveBusy(true);
    setMessage('');

    try {
      const payloadRows = selectedRows.map(row => ({
        sku: skuFor(row),
        nome: title.trim(),
        variacao: String(row.variation || '').trim() || null,
        platform,
        link: link.trim()
      }));

      const result = await api('/api/admin/bulk-products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: payloadRows })
      });

      if (result.errors?.length) {
        throw new Error(`${result.errors.length} produto(s) falharam. ${result.errors[0]?.sku || ''}: ${result.errors[0]?.error || 'erro desconhecido'}`);
      }

      const imageErrors = [];
      let imageSaved = 0;
      for (const imported of result.imported || []) {
        const sourceRow = selectedRows[Number(imported.row || 1) - 1];
        if (!sourceRow?.imageSource) continue;
        try {
          await api(`/api/products/${imported.id}/image-from-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ image_url: sourceRow.imageSource })
          });
          imageSaved += 1;
        } catch (error) {
          imageErrors.push(`${imported.sku}: ${error.message}`);
        }
      }

      await refreshProducts();

      if (imageErrors.length) {
        setMessage(`${result.created} produto(s) cadastrados e ${imageSaved} imagem(ns) salvas. ${imageErrors.length} imagem(ns) falharam: ${imageErrors[0]}`);
        setMessageType('warning');
      } else {
        setMessage(`${result.created} produto(s) cadastrados com imagem e índice visual. Cadastro concluído.`);
        setMessageType('success');
        setRows([]);
        setAnalysis(null);
        setLink('');
        setTitle('');
        try {
          sessionStorage.removeItem(CAPTURE_KEY);
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
      }
    } catch (error) {
      setMessage(error.message);
      setMessageType('error');
    } finally {
      setSaveBusy(false);
    }
  };

  return <section className="quick-registration-card">
    <div className="qr-head">
      <div>
        <p className="eyebrow">CADASTRO NOVO</p>
        <h3>Cadastro rápido por anúncio</h3>
        <p>Cole o link, traga as variações e configure os códigos internos uma única vez.</p>
      </div>
      <span className="qr-platform">{humanPlatform(platform)}</span>
    </div>

    <div className="qr-link-row">
      <label>
        Link do anúncio
        <input
          value={link}
          onChange={event => setLink(event.target.value)}
          placeholder="https://shopee.com.br/... ou https://www.mercadolivre.com.br/..."
        />
      </label>
      <button type="button" disabled={busy || !link.trim()} onClick={analyzeLink}>
        {busy ? 'Analisando anúncio...' : 'Analisar anúncio'}
      </button>
    </div>

    {platform === 'MERCADO LIVRE' && <div className="qr-ml-tools">
      <div>
        <strong>Mercado Livre</strong>
        <span>Se a leitura automática falhar, use a captura pelo seu navegador.</span>
      </div>
      <a href={link || '#'} target="_blank" rel="noreferrer" className={!link ? 'disabled' : ''}>Abrir anúncio</a>
      <button type="button" className="secondary" onClick={copyMlCapturer}>Preparar captura ML</button>
    </div>}

    {message && <div className={`qr-message ${messageType}`}>{message}</div>}

    {(analysis || rows.length > 0) && <>
      <div className="qr-common">
        <div className="qr-section-title">
          <strong>1. Configuração comum</strong>
          <span>Esses dados serão aplicados a todas as variações selecionadas.</span>
        </div>

        <div className="qr-grid qr-grid-4">
          <label>
            Código do miolo
            <input
              list="qr-miolos"
              value={common.miolo}
              onChange={event => setCommon(current => ({ ...current, miolo: normalizeMiolo(event.target.value) }))}
              placeholder="VACMNO"
            />
            <datalist id="qr-miolos">
              {knownMiolos.map(miolo => <option key={miolo} value={miolo}/>) }
            </datalist>
          </label>

          <label>
            Wire-O
            <select value={common.wireo} onChange={event => setCommon(current => ({ ...current, wireo: event.target.value }))}>
              <option value="">Escolher...</option>
              <option value="P">P · Preto</option>
              <option value="B">B · Branco</option>
              <option value="R">R · Rose Gold</option>
            </select>
          </label>

          <label>
            Tassel
            <select value={common.tassel} onChange={event => setCommon(current => ({ ...current, tassel: event.target.value }))}>
              <option value="">Escolher...</option>
              <option value="X">X · Sem tassel</option>
              <option value="P">P · Preto</option>
              <option value="B">B · Branco</option>
              <option value="A">A · Azul</option>
              <option value="R">R · Rosa</option>
              <option value="V">V · Verde</option>
              <option value="L">L · Laranja</option>
            </select>
          </label>

          <label>
            Elástico
            <select value={common.elastico} onChange={event => setCommon(current => ({ ...current, elastico: event.target.value }))}>
              <option value="">Escolher...</option>
              <option value="P">P · Preto</option>
              <option value="B">B · Branco</option>
              <option value="A">A · Azul</option>
              <option value="R">R · Rosa</option>
              <option value="V">V · Verde</option>
              <option value="L">L · Laranja</option>
            </select>
          </label>
        </div>

        <label>
          Nome do produto
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Nome comercial do produto" />
          <FieldHint>O título do anúncio é preenchido automaticamente quando a plataforma disponibiliza.</FieldHint>
        </label>

        <div className="qr-code-preview">
          <span>Acabamento</span>
          <strong>{finish || '— — —'}</strong>
        </div>
      </div>

      <div className="qr-variations">
        <div className="qr-section-title qr-row-title">
          <div>
            <strong>2. Variações e capas</strong>
            <span>Informe somente o CAPA_CODE interno. O SKU é montado automaticamente.</span>
          </div>
          <button type="button" className="secondary" onClick={addManualRow}>+ Adicionar linha</button>
        </div>

        <div className="qr-table">
          {rows.map((row, index) => {
            const sku = skuFor(row);
            const existingSku = sku && existingSkus.has(sku);
            const repeatedSku = sku && repeatedSkuValues.has(sku);
            const capa = normalizeCode(row.capaCode);
            const capaExists = capa && existingCapas.has(capa);
            const capaRepeated = capa && repeatedCapaValues.has(capa);

            return <article className={`qr-row ${row.included ? '' : 'disabled'}`} key={row.key}>
              <label className="qr-check">
                <input type="checkbox" checked={row.included} onChange={event => updateRow(row.key, { included: event.target.checked })}/>
                <span>{index + 1}</span>
              </label>

              <div className="qr-thumb">
                {row.imageUrl
                  ? <img src={row.imageUrl} alt={row.variation}/>
                  : <div>SEM IMAGEM</div>}
              </div>

              <label>
                Variação
                <input value={row.variation} onChange={event => updateRow(row.key, { variation: event.target.value })}/>
              </label>

              <label>
                CAPA_CODE
                <input
                  value={row.capaCode}
                  onChange={event => updateRow(row.key, { capaCode: normalizeCode(event.target.value) })}
                  placeholder="LIN1"
                />
                {capaExists && <small className="qr-warn">Capa já existe no catálogo</small>}
                {capaRepeated && <small className="qr-warn">Mesma capa em mais de um SKU</small>}
              </label>

              <div className="qr-sku-preview">
                <span>SKU</span>
                <strong>{sku || 'Preencha os códigos'}</strong>
                {existingSku && <small className="qr-error-text">Este SKU já existe</small>}
                {repeatedSku && <small className="qr-error-text">SKU repetido neste cadastro</small>}
              </div>
            </article>;
          })}
        </div>

        {repeatedCapaValues.size > 0 && <div className="qr-message warning">
          Atenção: a mesma CAPA_CODE está sendo usada em mais de um SKU. Isso é permitido, mas a identificação visual da capa não conseguirá distinguir qual SKU exato é o correto entre esses itens.
        </div>}
      </div>

      <div className="qr-savebar">
        <div>
          <strong>{selectedRows.length} produto(s) selecionado(s)</strong>
          <span>{duplicateSkuRows.length ? `${duplicateSkuRows.length} SKU(s) já existem e precisam ser corrigidos.` : 'O sistema salva produto, imagem e índice visual na mesma sequência.'}</span>
        </div>
        <button type="button" disabled={!canSave || saveBusy} onClick={saveAll}>
          {saveBusy ? 'Cadastrando produtos...' : `Cadastrar ${selectedRows.length} produto(s)`}
        </button>
      </div>
    </>}
  </section>;
}
