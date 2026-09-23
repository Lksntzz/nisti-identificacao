import React, { useState, useEffect, useMemo } from 'react';
import { createEan13Svg, downloadBarcodePng, downloadBarcodeZip } from '../ean-barcode.js';
import { buildEanCollections, collectionZipFilename } from '../ean-collections.js';

function SidebarIcon({ name }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  switch (name) {
    case 'barcode':
      return <svg {...props}><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" /><path d="M8 5v14M15 5v14M19 5v14" strokeWidth="1" /></svg>;
    default:
      return null;
  }
}

export function BarcodeGeneratorView({ api }) {
  const [data, setData] = useState({ gtins: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all');
  const [selected, setSelected] = useState([]);
  const [previewId, setPreviewId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generatingCollection, setGeneratingCollection] = useState('');
  const [viewMode, setViewMode] = useState('products');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api('/api/admin/gtins'));
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar os códigos EAN.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const activeRows = useMemo(() => (data.gtins || []).filter(item => item.active), [data.gtins]);
  const platforms = useMemo(() => Array.from(new Set(activeRows.flatMap(item => item.platforms || []))).sort(), [activeRows]);
  const collections = useMemo(() => buildEanCollections(activeRows).map(collection => {
    const items = collection.items.filter(item => platform === 'all' || (item.platforms || []).includes(platform));
    const filteredPlatforms = Array.from(new Set(items.flatMap(item => item.platforms || []))).sort();
    return { ...collection, items, platforms: filteredPlatforms, coverCount: new Set(items.map(item => item.capa_code)).size };
  }).filter(collection => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [collection.name, collection.family, ...collection.items.flatMap(item => [item.sku, item.capa_code, item.gtin])]
      .some(value => String(value || '').toLowerCase().includes(query));
    return collection.items.length >= 2 && collection.coverCount >= 2 && matchesSearch;
  }), [activeRows, platform, search]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeRows.filter(item => {
      const matchesPlatform = platform === 'all' || (item.platforms || []).includes(platform);
      const matchesSearch = !query || [item.gtin, item.sku, item.nome, item.variacao, item.capa_code]
        .some(value => String(value || '').toLowerCase().includes(query));
      return matchesPlatform && matchesSearch;
    });
  }, [activeRows, platform, search]);

  const selectedRows = useMemo(() => activeRows.filter(item => selected.includes(item.id)), [activeRows, selected]);
  const preview = activeRows.find(item => item.id === previewId) || selectedRows[0] || rows[0] || null;
  const allVisibleSelected = rows.length > 0 && rows.every(item => selected.includes(item.id));

  const toggleAllVisible = () => {
    const visibleIds = rows.map(item => item.id);
    setSelected(current => allVisibleSelected
      ? current.filter(id => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])));
  };

  const toggleOne = id => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const selectedPlatform = platform === 'all' ? '' : platform;

  const downloadMass = async () => {
    setGenerating(true);
    setError('');
    try { await downloadBarcodeZip(selectedRows, selectedPlatform); }
    catch (downloadError) { setError(downloadError?.message || 'Não foi possível gerar o pacote.'); }
    finally { setGenerating(false); }
  };

  const downloadCollection = async collection => {
    setGeneratingCollection(collection.id);
    setError('');
    try {
      await downloadBarcodeZip(collection.items, selectedPlatform, collectionZipFilename(collection));
    } catch (downloadError) {
      setError(downloadError?.message || 'Não foi possível gerar as etiquetas da coleção.');
    } finally {
      setGeneratingCollection('');
    }
  };

  return (
    <div className="barcode-generator-page">
      <section className="barcode-generator-hero">
        <div>
          <span className="barcode-generator-eyebrow">FERRAMENTA GS1</span>
          <h2>Gerador de Códigos de Barras</h2>
          <p>Crie etiquetas EAN-13 oficiais em PNG, com 543 × 189 px e 300 DPI, a partir dos códigos já vinculados ao catálogo. A ferramenta não cria números novos.</p>
        </div>
        <div className="barcode-generator-stats">
          <strong>{activeRows.length}</strong><span>EANs disponíveis</span>
          <strong>{viewMode === 'collections' ? collections.length : selected.length}</strong><span>{viewMode === 'collections' ? 'coleções encontradas' : 'selecionados'}</span>
        </div>
      </section>

      {error && <div className="barcode-generator-error">{error} <button type="button" onClick={load}>Tentar novamente</button></div>}

      <section className={`barcode-generator-workspace ${viewMode === 'collections' ? 'collection-mode' : ''}`}>
        {viewMode === 'products' && <div className="barcode-generator-preview">
          <div className="barcode-preview-head"><span>Pré-visualização</span><small>{preview ? preview.gtin : 'Selecione um produto'}</small></div>
          {preview ? (
            <>
              <div className="barcode-preview-canvas" dangerouslySetInnerHTML={{ __html: createEan13Svg(preview) }} />
              <div className="barcode-preview-actions">
                <button type="button" className="primary" onClick={() => downloadBarcodePng(preview).catch(err => setError(err.message))}>Baixar PNG oficial</button>
              </div>
            </>
          ) : <div className="barcode-preview-empty">Nenhum EAN disponível neste filtro.</div>}
        </div>}

        <div className="barcode-generator-controls">
          <div className="barcode-mode-filter">
            <span>Modo de download</span>
            <div className="barcode-mode-switch" role="group" aria-label="Modo de download">
              <button type="button" className={viewMode === 'products' ? 'active' : ''} onClick={() => setViewMode('products')}>Produtos individuais</button>
              <button type="button" className={viewMode === 'collections' ? 'active' : ''} onClick={() => setViewMode('collections')}>Download por coleção</button>
            </div>
          </div>
          <label><span>Plataforma</span><select value={platform} onChange={event => { setPlatform(event.target.value); setSelected([]); }}>
            <option value="all">Todas as plataformas</option>
            {platforms.map(item => <option value={item} key={item}>{item}</option>)}
          </select></label>
          <label><span>{viewMode === 'collections' ? 'Buscar coleção' : 'Buscar produto'}</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder={viewMode === 'collections' ? 'Nome, família ou código da capa' : 'EAN, SKU, nome ou capa'} /></label>
          {viewMode === 'products' ? <>
            <div className="barcode-selection-summary"><strong>{selectedRows.length}</strong><span>etiqueta{selectedRows.length === 1 ? '' : 's'} pronta{selectedRows.length === 1 ? '' : 's'} para baixar</span></div>
            <button type="button" className="barcode-download-mass" disabled={!selectedRows.length || generating} onClick={downloadMass}>{generating ? 'Gerando PNGs…' : 'Baixar PNGs em massa (.ZIP)'}</button>
            <small>O pacote contém um PNG oficial de 543 × 189 px e 300 DPI para cada EAN selecionado.</small>
          </> : <div className="barcode-collection-filter-help"><strong>{collections.length}</strong><span>Escolha uma coleção abaixo para gerar todas as etiquetas das capas em um único ZIP.</span></div>}
        </div>
      </section>

      {viewMode === 'collections' && <section className="barcode-collections-section">
        <div className="barcode-collections-heading">
          <div>
            <span className="barcode-generator-eyebrow">DOWNLOAD POR COLEÇÃO</span>
            <h3>Coleções identificadas</h3>
            <p>Produtos com o mesmo título e a mesma família de SKU são agrupados com segurança.</p>
          </div>
          <strong>{collections.length}</strong>
        </div>
        {collections.length > 0 ? (
          <div className="barcode-collection-grid">
            {collections.map(collection => (
              <article className="barcode-collection-card" key={collection.id}>
                <div className="barcode-collection-cover-stack" aria-hidden="true">
                  {collection.items.slice(0, 4).map((item, index) => item.image_url ? (
                    <img key={item.id} src={item.image_url} alt="" style={{ '--cover-index': index }} />
                  ) : <span key={item.id} style={{ '--cover-index': index }}>▥</span>)}
                </div>
                <div className="barcode-collection-copy">
                  <small>{collection.family || 'COLEÇÃO'}</small>
                  <h4>{collection.name}</h4>
                  <div className="barcode-collection-meta">
                    <span>{collection.items.length} etiquetas</span>
                    <span>{collection.coverCount} capas</span>
                  </div>
                  <div className="barcode-collection-platforms">
                    {collection.platforms.map(value => <span key={value}>{value}</span>)}
                  </div>
                  <div className="barcode-collection-codes">
                    {collection.items.slice(0, 6).map(item => <span key={item.id}>{item.capa_code}</span>)}
                    {collection.items.length > 6 && <span>+{collection.items.length - 6}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadCollection(collection)}
                  disabled={Boolean(generatingCollection)}
                >
                  {generatingCollection === collection.id ? 'Gerando ZIP…' : `Baixar coleção em ZIP (${collection.items.length})`}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="barcode-collections-empty">Nenhuma coleção com duas ou mais capas foi encontrada neste filtro.</div>
        )}
      </section>}

      {viewMode === 'products' && <section className="admin-table-card barcode-generator-table">
        <div className="table-card-topbar">
          <div className="table-title-group"><div className="table-title-icon"><SidebarIcon name="barcode" /></div><div><h3 className="table-main-title">Produtos com EAN</h3><span className="table-sub-title">{rows.length} produto{rows.length === 1 ? '' : 's'} no filtro atual</span></div></div>
          <div className="table-actions-toolbar"><button type="button" className="btn-toolbar-filter" onClick={toggleAllVisible}>{allVisibleSelected ? 'Desmarcar exibidos' : 'Selecionar exibidos'}</button><button type="button" className="btn-toolbar-filter" disabled={!selected.length} onClick={() => setSelected([])}>Limpar seleção</button></div>
        </div>
        <div className="table-responsive-container">
          <table className="admin-data-table">
            <thead><tr><th className="barcode-check-column">✓</th><th>EAN</th><th>PRODUTO</th><th>PLATAFORMA</th><th>ARQUIVOS</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="5" className="table-empty-row">Carregando códigos…</td></tr> : rows.length === 0 ? <tr><td colSpan="5" className="table-empty-row">Nenhum EAN encontrado.</td></tr> : rows.map(item => (
                <tr key={item.id} className={preview?.id === item.id ? 'barcode-row-previewing' : ''}>
                  <td><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleOne(item.id)} aria-label={`Selecionar ${item.gtin}`} /></td>
                  <td><button type="button" className="barcode-preview-link" onClick={() => setPreviewId(item.id)}>{item.gtin}</button></td>
                  <td><div className="product-info-cell"><strong>{item.nome || item.sku}</strong><small>{item.sku} · {item.variacao || 'Sem variação'}</small></div></td>
                  <td><div className="barcode-platform-pills">{(item.platforms || []).length ? item.platforms.map(value => <span key={value}>{value}</span>) : <span>Sem plataforma</span>}</div></td>
                  <td><div className="barcode-row-actions"><button type="button" onClick={() => downloadBarcodePng(item).catch(err => setError(err.message))}>Baixar PNG</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}

export default BarcodeGeneratorView;
