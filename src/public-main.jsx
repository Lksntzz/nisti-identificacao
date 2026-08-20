import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

const LOGO = '/nisti-logo-transparent.webp';
const LOGO_FALLBACK = '/nisti-app-icon.svg';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(data?.error || `Erro ${response.status}`, response.status, data);
  }
  return data;
}

async function compressPhoto(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  return blob ? new File([blob], 'capa.jpg', { type: 'image/jpeg' }) : file;
}

function BrandHeader() {
  const [logoFailed, setLogoFailed] = useState(false);
  return <header className="topbar">
    <div className="brand-block">
      <img
        className="brand-logo"
        src={logoFailed ? LOGO_FALLBACK : LOGO}
        alt="NISTI PRINT"
        onError={() => setLogoFailed(true)}
      />
      <div className="top-title"><small>NISTI PRINT</small><h1>Identificação Visual</h1></div>
    </div>
  </header>;
}

function Badge({ label, value }) {
  return <div className="badge"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

function ProductImage({ product, className = '', alt }) {
  const sources = [...new Set([
    product?.image_url,
    product?.product_image_url
  ].filter(Boolean))];
  const sourceKey = sources.join('|');
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [sourceKey]);

  const src = sources[index];
  if (!src) {
    return <div className={className || undefined} aria-label="Imagem indisponível">Imagem indisponível</div>;
  }

  return <img
    className={className || undefined}
    src={src}
    alt={alt || product?.sku || 'Produto'}
    loading="lazy"
    decoding="async"
    onError={() => setIndex(current => current + 1)}
  />;
}

function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [help, setHelp] = useState(false);
  const [standalone, setStandalone] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  );
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const before = event => { event.preventDefault(); setPrompt(event); };
    const installed = () => setStandalone(true);
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    return () => {
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (standalone) return null;

  const install = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      setPrompt(null);
      return;
    }
    if (ios) setHelp(true);
    else alert('Abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.');
  };

  return <>
    <button className="install-button" type="button" onClick={install}>↓ Instalar app</button>
    {help && <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && setHelp(false)}>
      <div className="modal">
        <h3>Instalar no iPhone</h3>
        <p>No Safari:</p>
        <ol><li>Toque em Compartilhar.</li><li>Escolha Adicionar à Tela de Início.</li><li>Confirme em Adicionar.</li></ol>
        <button type="button" onClick={() => setHelp(false)}>Entendi</button>
      </div>
    </div>}
  </>;
}

function ProductResult({ product, performance }) {
  return <div className="result">
    <p className="eyebrow">PRODUTO IDENTIFICADO PELA CAPA</p>
    <h3>{product.sku}</h3>
    <ProductImage product={product} className="result-image" alt={`Mockup ${product.sku}`} />
    <div className="badges">
      <Badge label="Capa" value={product.capa_code}/>
      <Badge label="Wire-O" value={product.wireo}/>
      <Badge label="Tassel" value={product.tassel}/>
      <Badge label="Elástico" value={product.elastico}/>
    </div>
    {product.platform && <p className="platform"><strong>Plataforma:</strong> {product.platform}</p>}
    {performance?.total_ms && <small className="perf">Identificado em {(performance.total_ms / 1000).toFixed(1)} s</small>}
  </div>;
}

function ProductChoices({ capaCode, products, onSelect, performance }) {
  return <div className="result">
    <p className="eyebrow">CAPA IDENTIFICADA</p>
    <h3 className="choice-title">{capaCode} · escolha o SKU</h3>
    <div className="choices">
      {products.map(product => <article className="choice-card" key={product.id}>
        <ProductImage product={product} alt={product.sku}/>
        <div>
          <h4>{product.sku}</h4>
          <p>{product.nome || product.variacao || product.capa_code}</p>
          <p>Miolo: {product.miolo_code} · Acabamento: {product.acabamento_code}</p>
        </div>
        <button type="button" onClick={() => onSelect(product)}>Selecionar este SKU</button>
      </article>)}
    </div>
    {performance?.total_ms && <small className="perf">Capa reconhecida em {(performance.total_ms / 1000).toFixed(1)} s</small>}
  </div>;
}

function PossibleMatches({ suggestions, onSelect }) {
  if (!suggestions?.length) return null;
  return <section className="possible-matches">
    <p className="eyebrow">POSSÍVEIS CORRESPONDÊNCIAS</p>
    <h3>Confira antes de confirmar</h3>
    <p className="possible-note">O sistema não encontrou identidade visual suficiente para confirmar automaticamente. As opções abaixo pertencem à plataforma selecionada e nunca são tratadas como identificação automática.</p>
    <div className="choices">
      {suggestions.flatMap(group => (group.products || []).map(product => (
        <article className="choice-card possible-card" key={`${group.capa_code}-${product.id}`}>
          <ProductImage product={product} alt={product.sku}/>
          <div>
            <h4>{product.sku}</h4>
            <p>Capa: {group.capa_code}</p>
            <p>{product.nome || product.variacao || product.platform}</p>
            <small>
              {group.verification_source === 'catalog-visual-comparison' || group.verification_source === 'gemini-verified'
                ? 'Verificação visual'
                : 'Similaridade do índice'}: {Math.round(Number(group.confidence || 0) * 100)}%
            </small>
          </div>
          <button type="button" onClick={() => onSelect(product)}>É este produto</button>
        </article>
      )))}
    </div>
  </section>;
}

function PublicIdentificationApp() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [platforms, setPlatforms] = useState([]);
  const [platform, setPlatform] = useState('');
  const [platformError, setPlatformError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [choices, setChoices] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [performance, setPerformance] = useState(null);
  const runId = useRef(0);

  useEffect(() => {
    let active = true;
    api('/api/platforms')
      .then(data => {
        if (!active) return;
        setPlatforms(data.platforms || []);
        setPlatformError('');
      })
      .catch(err => {
        if (!active) return;
        setPlatformError(err.message || 'Não foi possível carregar as plataformas.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const clearDecision = () => {
    setError('');
    setResult(null);
    setChoices(null);
    setSuggestions([]);
    setPerformance(null);
  };

  const applyData = data => {
    setPerformance(data.performance || null);
    setSuggestions([]);
    if (data.needs_selection) {
      setChoices({ capaCode: data.capa_code, products: data.products || [] });
      setResult(null);
    } else {
      setChoices(null);
      setResult(data.product || null);
    }
  };

  const identifyFile = async file => {
    if (!file || !platform || busy) return;
    const id = ++runId.current;
    setBusy(true);
    clearDecision();

    try {
      const optimized = await compressPhoto(file);

      const candidateForm = new FormData();
      candidateForm.append('image', optimized);
      candidateForm.append('platform', platform);
      const candidateData = await api('/api/identify-candidates', {
        method: 'POST',
        body: candidateForm
      });
      if (id !== runId.current) return;

      const verificationForm = new FormData();
      verificationForm.append('image', optimized);
      verificationForm.append('platform', platform);
      if (candidateData?.ticket) {
        verificationForm.append('ticket', candidateData.ticket);
      }

      const data = await api('/api/identify', {
        method: 'POST',
        body: verificationForm
      });
      if (id !== runId.current) return;
      applyData(data);
    } catch (err) {
      if (id !== runId.current) return;
      const data = err?.data || null;
      setPerformance(data?.performance || null);
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setError(err.message || 'Não foi possível identificar o produto.');
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const choose = file => {
    if (!file) return;
    setPhoto(file);
    clearDecision();
    setPreview(current => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  };

  const changePlatform = event => {
    setPlatform(event.target.value);
    clearDecision();
  };

  return <main className="app general">
    <BrandHeader />
    <section className="panel">
      <p className="eyebrow">PAINEL GERAL</p>
      <h2>Identificação de produto</h2>
      <p className="lead">Selecione a plataforma e fotografe a capa de frente. A busca visual será feita somente dentro do catálogo dessa plataforma.</p>

      <div className="platform-selector">
        <label htmlFor="recognition-platform">PLATAFORMA</label>
        <select id="recognition-platform" value={platform} onChange={changePlatform} disabled={busy}>
          <option value="">Selecione a plataforma</option>
          {platforms.map(item => <option key={item.platform_key} value={item.platform}>
            {item.platform} ({item.product_count})
          </option>)}
        </select>
        {platform && <small>Busca restrita a {platform}.</small>}
      </div>

      {platformError && <div className="status error"><h3>Plataformas indisponíveis</h3><p>{platformError}</p></div>}

      <label className="camera">
        <span className="camera-label">CAPA DO PRODUTO</span>
        {preview
          ? <><img className="photo-preview" src={preview} alt="Foto da capa"/><span className="photo-ready">Foto pronta</span></>
          : <div className="camera-empty"><span className="camera-icon">◎</span><strong>Fotografar ou enviar capa</strong><span>Use uma imagem frontal, nítida e com boa iluminação.</span></div>}
        <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])}/>
      </label>

      <button className="primary" disabled={!photo || !platform || busy} onClick={() => identifyFile(photo)}>
        {busy ? 'Comparando capa…' : 'Identificar produto'}
      </button>

      {error && <div className="status error"><h3>Produto não identificado</h3><p>{error}</p></div>}
      <PossibleMatches suggestions={suggestions} onSelect={product => {
        setResult(product);
        setChoices(null);
        setSuggestions([]);
        setError('');
      }}/>
      {choices && <ProductChoices
        capaCode={choices.capaCode}
        products={choices.products}
        performance={performance}
        onSelect={product => { setResult(product); setChoices(null); }}
      />}
      {result && <ProductResult product={result} performance={performance}/>} 
    </section>
    <InstallApp />
  </main>;
}

createRoot(document.getElementById('root')).render(<PublicIdentificationApp/>);
