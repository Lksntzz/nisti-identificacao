import React, { useState } from 'react';
import CommerceImportView from './commerce-import-view.jsx';
import CommerceSalesImportPanel from './commerce-sales-import-panel.jsx';
import './commerce-import.css';

export default function CommerceUnifiedImportView() {
  const [mode, setMode] = useState('catalog');

  return (
    <div className="commerce-unified-import">
      <div className="commerce-import-mode-switch" role="tablist" aria-label="Tipo de importação">
        <button
          type="button"
          className={mode === 'catalog' ? 'active' : ''}
          onClick={() => setMode('catalog')}
        >
          Catálogo
          <small>Produtos, SKUs, anúncios e links</small>
        </button>
        <button
          type="button"
          className={mode === 'sales' ? 'active' : ''}
          onClick={() => setMode('sales')}
        >
          Vendas
          <small>Pedidos, unidades e faturamento</small>
        </button>
      </div>

      {mode === 'catalog'
        ? <CommerceImportView />
        : <CommerceSalesImportPanel />}
    </div>
  );
}
