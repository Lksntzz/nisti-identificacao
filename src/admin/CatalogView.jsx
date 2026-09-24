import React, { useState, useEffect, useMemo } from 'react';
import { organizedCatalogCsv, legacyCatalogCsv } from './catalog-export.js';
import { createCatalogXlsx } from './catalog-xlsx.js';

const PAGE_SIZE = 10;

function formatProductDate(dateVal) {
  if (!dateVal) return { date: '—', time: '' };
  try {
    const d = new Date(dateVal);
    const date = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(d);
    const time = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
    return { date, time };
  } catch {
    return { date: '—', time: '' };
  }
}

function productImage(product) {
  if (!product?.image_url) return '';
  const version = String(product.image_key || '').split('/').pop();
  const join = product.image_url.includes('?') ? '&' : '?';
  return version ? `${product.image_url}${join}v=${encodeURIComponent(version)}` : product.image_url;
}

function pageItems(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const values = new Set([1, pages, page - 1, page, page + 1].filter(value => value >= 1 && value <= pages));
  const sorted = [...values].sort((a, b) => a - b);
  const result = [];
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push('…');
    result.push(value);
  });
  return result;
}

function PlatformTag({ platform }) {
  const p = String(platform || '').toUpperCase();
  let className = 'platform-pill-default';
  let label = platform || 'Geral';

  if (p.includes('MERCADO') || p.includes('ML')) {
    className = 'platform-pill-ml';
    label = 'Mercado Livre';
  } else if (p.includes('SHOPEE')) {
    className = 'platform-pill-shopee';
    label = 'Shopee';
  } else if (p.includes('AMAZON')) {
    className = 'platform-pill-amazon';
    label = 'Amazon';
  } else if (p.includes('MAGALU')) {
    className = 'platform-pill-magalu';
    label = 'Magalu';
  }

  return <span className={`platform-pill ${className}`}>{label}</span>;
}

export function CatalogView({
  products,
  onRefresh,
  onOpenCreate,
  onOpenImport,
  onViewProduct,
  onEditProduct,
  onDeleteProduct
}) {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [onlyWithoutEan, setOnlyWithoutEan] = useState(false);
  const [page, setPage] = useState(1);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const platforms = useMemo(() => {
    return [...new Set(products.map(p => p.platform).filter(Boolean))].sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const matchPlatform = !platformFilter || p.platform === platformFilter;
      const matchEanFilter = !onlyWithoutEan || !p.has_active_gtin;
      const matchQuery = !q || [p.sku, p.nome, p.variacao, p.capa_code, p.platform, p.gtin].some(
        val => String(val || '').toLowerCase().includes(q)
      );
      return matchPlatform && matchEanFilter && matchQuery;
    });
  }, [products, search, platformFilter, onlyWithoutEan]);

  useEffect(() => setPage(1), [search, platformFilter, onlyWithoutEan]);

  const exportCsv = (organized = true) => {
    const csvContent = organized ? organizedCatalogCsv(filtered) : legacyCatalogCsv(filtered);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `catalogo_nisti_${organized ? 'organizado_' : ''}${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const blob = new Blob([createCatalogXlsx(filtered)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `catalogo_nisti_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="admin-table-card">
      <div className="table-card-topbar">
        <div className="table-title-group">
          <div className="table-title-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </div>
          <div>
            <h3 className="table-main-title">Catálogo de Produtos</h3>
            <span className="table-sub-title">Produtos cadastrados no sistema</span>
          </div>
        </div>

        <div className="table-actions-toolbar">
          <div className="search-pill-box">
            <input
              type="text"
              placeholder="Buscar produto, código ou plataforma..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          <div className="filter-dropdown-wrap">
            <button
              type="button"
              className={`btn-toolbar-filter ${platformFilter || onlyWithoutEan ? 'active' : ''}`}
              onClick={() => setFilterMenuOpen(prev => !prev)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>{onlyWithoutEan ? 'Sem EAN' : (platformFilter || 'Filtros')}</span>
            </button>

            {filterMenuOpen && (
              <div className="filter-dropdown-menu">
                <button
                  type="button"
                  className={!platformFilter && !onlyWithoutEan ? 'selected' : ''}
                  onClick={() => { setPlatformFilter(''); setOnlyWithoutEan(false); setFilterMenuOpen(false); }}
                >
                  Todos os produtos
                </button>
                <button
                  type="button"
                  className={onlyWithoutEan ? 'selected' : ''}
                  onClick={() => { setOnlyWithoutEan(prev => !prev); setFilterMenuOpen(false); }}
                  style={{ color: '#d97706', fontWeight: 600 }}
                >
                  Apenas sem EAN
                </button>
                <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />
                {platforms.map(p => (
                  <button
                    key={p}
                    className={platformFilter === p ? 'selected' : ''}
                    onClick={() => { setPlatformFilter(p); setOnlyWithoutEan(false); setFilterMenuOpen(false); }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="btn-toolbar-filter" title="Baixar planilha Excel com tabela e filtro por plataforma" onClick={exportExcel}>
            <span>Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            className="btn-toolbar-filter"
            title="Exportar catálogo filtrado, agrupado por plataforma e família do SKU"
            onClick={() => exportCsv(true)}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>CSV organizado</span>
          </button>

          <button
            type="button"
            className="btn-toolbar-filter"
            title="Exportar CSV original para integrações que dependem do formato anterior"
            onClick={() => exportCsv(false)}
          >
            <span>CSV original</span>
          </button>

          <button
            type="button"
            className="btn-create-product-gradient"
            onClick={onOpenCreate}
          >
            <span>+ Cadastrar Produto</span>
          </button>
        </div>
      </div>

      <div className="table-responsive-container">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th style={{ width: '130px' }}>CAPA CODE</th>
              <th>PRODUTO</th>
              <th style={{ width: '160px' }}>PLATAFORMA</th>
              <th style={{ width: '150px' }}>CADASTRADO EM</th>
              <th style={{ width: '110px' }}>STATUS</th>
              <th style={{ width: '120px', textAlign: 'right' }}>AÇÕES</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan="6" className="table-empty-row">
                  Nenhum produto encontrado com os filtros atuais.
                </td>
              </tr>
            ) : (
              slice.map(product => {
                const dateInfo = formatProductDate(product.created_at);
                return (
                  <tr key={product.id}>
                    <td>
                      <div className="capa-cell-wrap">
                        {product.image_url ? (
                          <img
                            src={productImage(product)}
                            alt={product.sku}
                            className="table-thumb-img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="table-thumb-placeholder">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#94a3b8" strokeWidth="2">
                              <rect width="18" height="18" x="3" y="3" rx="2" />
                            </svg>
                          </div>
                        )}
                        <span className="capa-code-text">{product.capa_code || '—'}</span>
                      </div>
                    </td>

                    <td>
                      <div className="product-info-cell">
                        <strong className="product-name-txt">{product.nome || product.sku}</strong>
                        <small className="product-sub-txt">{product.variacao ? `${product.variacao} · ${product.sku}` : product.sku}</small>
                      </div>
                    </td>

                    <td>
                      <PlatformTag platform={product.platform} />
                    </td>

                    <td>
                      <div className="datetime-cell">
                        <span>{dateInfo.date}</span>
                        <small>{dateInfo.time}</small>
                      </div>
                    </td>

                    <td>
                      <span className="status-pill active">• Ativo</span>
                    </td>

                    <td>
                      <div className="table-action-btns">
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Visualizar detalhes"
                          onClick={() => onViewProduct(product)}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="Editar produto"
                          onClick={() => onEditProduct(product)}
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn delete"
                          title="Excluir produto"
                          onClick={() => onDeleteProduct(product.id, product.sku)}
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="table-card-footer">
        <span className="showing-entries-txt">
          Mostrando {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length} produtos
        </span>

        <div className="table-pagination-nav">
          <button
            type="button"
            className="pag-btn"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ‹
          </button>
          {pageItems(page, pages).map((item, idx) => (
            item === '…' ? (
              <span key={`ell-${idx}`} className="pag-ellipsis">…</span>
            ) : (
              <button
                key={item}
                type="button"
                className={`pag-num ${page === item ? 'active' : ''}`}
                onClick={() => setPage(item)}
              >
                {item}
              </button>
            )
          ))}
          <button
            type="button"
            className="pag-btn"
            disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

export default CatalogView;
