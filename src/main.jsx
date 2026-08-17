import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = async (path, options = {}) => {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na operação');
  return data;
};

function Badge({ label, value }) {
  return <div className="badge"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

function Admin() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ sku: '', nome: '', variacao: '', platform: '' });
  const [parsed, setParsed] = useState(null);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const data = await api('/api/products');
    setProducts(data.products || []);
  };

  useEffect(() => { refresh().catch(() => {}); }, []);

  useEffect(() => {
    const sku = form.sku.trim();
    if (!sku) return setParsed(null);
    const timer = setTimeout(() => {
      api('/api/sku/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku }) })
        .then(setParsed).catch(() => setParsed(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.sku]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMessage('');
    try {
      const created = await api('/api/products', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form }),
      });
      if (image) {
        const fd = new FormData(); fd.append('image', image);
        await api(`/api/products/${created.id}/image`, { method: 'POST', body: fd });
      }
      setForm({ sku: '', nome: '', variacao: '', platform: '' }); setImage(null); setParsed(null);
      setMessage('Produto cadastrado.'); await refresh();
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">ADMIN</p><h2>Produtos</h2></div><span>{products.length} cadastrados</span></div>
    <form className="form" onSubmit={submit}>
      <label>SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="VACMNO_LIN1_BBB" required /></label>
      <div className="grid2"><label>Nome<input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label><label>Variação<input value={form.variacao} onChange={e => setForm({ ...form, variacao: e.target.value })} /></label></div>
      <label>Plataforma<input value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} placeholder="SHOPEE" /></label>
      <label>Imagem frontal<input type="file" accept="image/*" onChange={e => setImage(e.target.files?.[0] || null)} /></label>
      {parsed && <div className="parsed"><Badge label="Miolo" value={parsed.mioloCode}/><Badge label="Capa" value={parsed.capaCode}/><Badge label="Wire-O" value={parsed.wireo}/><Badge label="Tassel" value={parsed.tassel}/><Badge label="Elástico" value={parsed.elastico}/></div>}
      <button disabled={busy || !parsed}>{busy ? 'Salvando...' : 'Cadastrar produto'}</button>
      {message && <p className="message">{message}</p>}
    </form>
    <div className="list">{products.map(p => <article className="product" key={p.id}>{p.image_url ? <img src={p.image_url} alt=""/> : <div className="image-placeholder">SEM FOTO</div>}<div><strong>{p.sku}</strong><span>{p.nome || p.variacao || p.capa_code}</span><small>{p.wireo_code}/{p.tassel_code}/{p.elastico_code}</small></div></article>)}</div>
  </section>;
}

function Expedition() {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = (file) => {
    setPhoto(file || null); setResult(null); setError('');
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : '');
  };

  const identify = async () => {
    if (!photo) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const fd = new FormData(); fd.append('image', photo);
      const data = await api('/api/identify', { method: 'POST', body: fd });
      setResult(data.product);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <section className="panel expedition">
    <p className="eyebrow">EXPEDIÇÃO</p><h2>Identificar produto</h2><p>Fotografe a frente inteira do produto, com Wire-O, tassel e elástico visíveis.</p>
    <label className="camera">{preview ? <img src={preview} alt="Foto capturada"/> : <><span className="camera-icon">◎</span><strong>Tirar foto</strong><small>Toque para abrir a câmera</small></>}<input type="file" accept="image/*" capture="environment" onChange={e => choose(e.target.files?.[0])}/></label>
    <button disabled={!photo || busy} onClick={identify}>{busy ? 'Analisando...' : 'Identificar produto'}</button>
    {error && <div className="not-found"><strong>Produto não identificado</strong><span>{error}</span></div>}
    {result && <div className="result"><p className="eyebrow">PRODUTO IDENTIFICADO</p><h3>{result.sku}</h3>{result.image_url && <img className="result-image" src={result.image_url} alt="Referência"/>}<div className="parsed"><Badge label="Capa" value={result.capa_code}/><Badge label="Wire-O" value={result.wireo}/><Badge label="Tassel" value={result.tassel}/><Badge label="Elástico" value={result.elastico}/></div>{result.platform && <p><strong>Plataforma:</strong> {result.platform}</p>}</div>}
  </section>;
}

function App() {
  const [mode, setMode] = useState('expedition');
  return <main className="shell"><header><div><p className="eyebrow">NISTI PRINT</p><h1>Identificação Visual</h1></div><nav><button className={mode === 'expedition' ? 'active' : ''} onClick={() => setMode('expedition')}>Expedição</button><button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>ADM</button></nav></header>{mode === 'expedition' ? <Expedition/> : <Admin/>}</main>;
}

createRoot(document.getElementById('root')).render(<App />);
