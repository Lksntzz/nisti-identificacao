import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { matchLocalCandidates, warmLocalVision } from './local-vision.js';
import './app.css';

const LOGO = '/nisti-logo-transparent.webp';
const LOGO_FALLBACK = '/nisti-app-icon.svg';

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
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

  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
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
    {product.image_url && <img className="result-image" src={product.image_url} alt={`Mockup ${product.sku}`} />}
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
        {product.image_url ? <img src={product.image_url} alt={product.sku}/> : <div/>}
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

function PublicIdentificationApp() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [choices, setChoices] = useState(null);
  const [performance, setPerformance] = useState(null);
  const runId = useRef(0);

  useEffect(() => { warmLocalVision(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const applyData = data => {
    setPerformance(data.performance || null);
    if (data.needs_selection) {
      setChoices({ capaCode: data.capa_code, products: data.products || [] });
      setResult(null);
    } else {
      setChoices(null);
      setResult(data.product || null);
    }
  };

  const identifyFile = async file => {
    if (!file || busy) return;
    const id = ++runId.current;
    setBusy(true);
    setError('');
    setResult(null);
    setChoices(null);
    setPerformance(null);

    try {
      const optimized = await compressPhoto(file);

      const candidateForm = new FormData();
      candidateForm.append('image', optimized);
      const candidateData = await api('/api/identify-candidates', {
        method: 'POST',
        body: candidateForm
      });
      if (id !== runId.current) return;

      let localMatch = null;
      try {
        localMatch = await matchLocalCandidates(
          optimized,
          candidateData.candidates || [],
          { deadlineMs: 2800 }
        );
      } catch (localError) {
        localMatch = localError?.local_match || null;
      }

      // A geometria local é evidência auxiliar, nunca autorização final.
      // Toda foto passa pelo verificador estrutural no Worker antes de liberar SKU.
      const verificationForm = new FormData();
      verificationForm.append('image', optimized);
      if (localMatch) verificationForm.append('local_match', JSON.stringify(localMatch));

      const data = await api('/api/identify', {
        method: 'POST',
        body: verificationForm
      });
      if (id !== runId.current) return;
      applyData(data);
    } catch (err) {
      if (id === runId.current) setError(err.message);
    } finally {
      if (id === runId.current) setBusy(false);
    }
  };

  const choose = file => {
    if (!file) return;
    setPhoto(file);
    setError('');
    setResult(null);
    setChoices(null);
    setPerformance(null);
    setPreview(current => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setTimeout(() => identifyFile(file), 160);
  };

  return <main className="app general">
    <BrandHeader />
    <section className="panel">
      <p className="eyebrow">PAINEL GERAL</p>
      <h2>Identificação de produto</h2>
      <p className="lead">Fotografe a capa do produto de frente. O sistema localiza a referência visual e retorna o SKU correspondente.</p>
      <label className="camera">
        <span className="camera-label">CAPA DO PRODUTO</span>
        {preview
          ? <><img className="photo-preview" src={preview} alt="Foto da capa"/><span className="photo-ready">Foto pronta</span></>
          : <div className="camera-empty"><span className="camera-icon">◎</span><strong>Fotografar ou enviar capa</strong><span>Use uma imagem frontal, nítida e com boa iluminação.</span></div>}
        <input type="file" accept="image/*" capture="environment" onChange={event => choose(event.target.files?.[0])}/>
      </label>
      <button className="primary" disabled={!photo || busy} onClick={() => identifyFile(photo)}>
        {busy ? 'Comparando capa…' : 'Identificar produto'}
      </button>
      {error && <div className="status error"><h3>Produto não identificado</h3><p>{error}</p></div>}
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
