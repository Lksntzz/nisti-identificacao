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
      setForm({ sku: '', nome: '', variacao: '', platform: '', link: '' }); setImage(null); setParsed(null);
      setMessage('Produto cadastrado.');
      await Promise.all([refresh(), refreshIndex().catch(() => null)]);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const importCatalogCsv = async (file) => {
    if (!file) return;
    setBulkBusy(true); setBulkMessage('');
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
        if (result.errors?.length) errors.push(...result.errors.map(error => ({ ...error, batch_start: i + 1 })));
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
    setIndexBusy(true); setIndexMessage('');
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
      if (info.pending_covers === 0) setIndexMessage(`Índice visual atualizado. ${info.indexed_covers} capa(s) indexadas.`);
      else setIndexMessage(`Ainda faltam ${info.pending_covers} capa(s) para indexar.`);
    } catch (err) { setIndexMessage(err.message); }
    finally { setIndexBusy(false); }
  };

  const withoutImage = products.filter(product => !product.image_url).length;

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">ADMIN</p><h2>Produtos</h2></div><span>{products.length} cadastrados</span></div>

    <div className="form">
      <div className="panel-head"><div><strong>Importação em massa</strong><small>CSV exportado da aba ANÚNCIOS da planilha ANUNCIOS NOVOS</small></div></div>
      <div className="parsed"><Badge label="Produtos" value={products.length}/><Badge label="Sem imagem" value={withoutImage}/></div>
      <label>Arquivo CSV<input type="file" accept=".csv,text/csv" disabled={bulkBusy} onChange={e => importCatalogCsv(e.target.files?.[0] || null)} /></label>
      {bulkBusy && <p className="message">Importando catálogo em lotes...</p>}
      {bulkMessage && <p className="message">{bulkMessage}</p>}
    </div>

    <div className="form">
      <div className="panel-head"><div><strong>Índice visual das capas</strong><small>Busca Top-K antes da confirmação pelo Gemini</small></div>{indexInfo && <span>{indexInfo.indexed_covers}/{indexInfo.reference_covers}</span>}</div>
      {indexInfo && <div className="parsed"><Badge label="Referências" value={indexInfo.reference_covers}/><Badge label="Indexadas" value={indexInfo.indexed_covers}/><Badge label="Pendentes" value={indexInfo.pending_covers}/><Badge label="Top-K" value={indexInfo.top_k}/></div>}
      <button type="button" disabled={indexBusy || !indexInfo || indexInfo.pending_covers === 0} onClick={indexPendingCovers}>{indexBusy ? 'Indexando capas...' : indexInfo?.pending_covers ? `Indexar ${indexInfo.pending_covers} capa(s) pendente(s)` : 'Índice visual atualizado'}</button>
      {indexMessage && <p className="message">{indexMessage}</p>}
    </div>

    <form className="form" onSubmit={submit}>
      <label>SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="VACMNO_LIN1_BBB" required /></label>
      <div className="grid2"><label>Nome<input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label><label>Variação<input value={form.variacao} onChange={e => setForm({ ...form, variacao: e.target.value })} /></label></div>
      <div className="grid2"><label>Plataforma<input value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} placeholder="SHOPEE" /></label><label>Link do anúncio<input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="https://..." /></label></div>
      <label>Imagem de referência da capa<input type="file" accept="image/*" onChange={e => setImage(e.target.files?.[0] || null)} /></label>
      {parsed && <div className="parsed"><Badge label="Miolo" value={parsed.mioloCode}/><Badge label="Capa" value={parsed.capaCode}/><Badge label="Wire-O" value={parsed.wireo}/><Badge label="Tassel" value={parsed.tassel}/><Badge label="Elástico" value={parsed.elastico}/></div>}
      <button disabled={busy || !parsed}>{busy ? 'Salvando...' : 'Cadastrar produto'}</button>
      {message && <p className="message">{message}</p>}
    </form>
    <div className="list">{products.map(p => <article className="product" key={p.id}>{p.image_url ? <img src={p.image_url} alt="Capa de referência"/> : <div className="image-placeholder">SEM FOTO</div>}<div><strong>{p.sku}</strong><span>{p.nome || p.variacao || p.capa_code}</span><small>{p.wireo_code}/{p.tassel_code}/{p.elastico_code}{p.platform ? ` · ${p.platform}` : ''}</small></div></article>)}</div>
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
    <p className="eyebrow">EXPEDIÇÃO</p><h2>Identificar produto pela capa</h2><p>Fotografe a arte da capa de frente. A capa pode estar solta: não precisa ter Wire-O, tassel ou elástico.</p>
    <label className="camera">{preview ? <img src={preview} alt="Foto da capa capturada"/> : <><span className="camera-icon">◎</span><strong>Tirar foto da capa</strong><small>Toque para abrir a câmera</small></>}<input type="file" accept="image/*" capture="environment" onChange={e => choose(e.target.files?.[0])}/></label>
    <button disabled={!photo || busy} onClick={identify}>{busy ? 'Analisando capa...' : 'Identificar produto'}</button>
    {error && <div className="not-found"><strong>Produto não identificado</strong><span>{error}</span></div>}
    {result && <div className="result"><p className="eyebrow">PRODUTO IDENTIFICADO PELA CAPA</p><h3>{result.sku}</h3>{result.image_url && <img className="result-image" src={result.image_url} alt="Capa de referência"/>}<div className="parsed"><Badge label="Capa" value={result.capa_code}/><Badge label="Wire-O" value={result.wireo}/><Badge label="Tassel" value={result.tassel}/><Badge label="Elástico" value={result.elastico}/></div>{result.platform && <p><strong>Plataforma:</strong> {result.platform}</p>}</div>}
  </section>;
}

function App() {
  const [mode, setMode] = useState('expedition');
  return <main className="shell"><header><div><p className="eyebrow">NISTI PRINT</p><h1>Identificação Visual</h1></div><nav><button className={mode === 'expedition' ? 'active' : ''} onClick={() => setMode('expedition')}>Expedição</button><button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>ADM</button></nav></header>{mode === 'expedition' ? <Expedition/> : <Admin/>}</main>;
}

createRoot(document.getElementById('root')).render(<App />);
