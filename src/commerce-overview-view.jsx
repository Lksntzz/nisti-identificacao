import React from 'react';
import {
  COMMERCE_MARKETPLACES,
  CommerceMetricCard,
  commerceFormatNumber
} from './commerce-admin-shared.jsx';

export default function CommerceOverviewView({ dashboard, onNavigate }) {
  const byMarketplace = dashboard?.by_marketplace || {};
  return (
    <>
      <section className="commerce-metrics-grid">
        <CommerceMetricCard label="Produtos Mestre" value={dashboard?.products} helper="Produtos comerciais cadastrados" />
        <CommerceMetricCard label="Anúncios" value={dashboard?.listings} helper="Em todos os marketplaces" />
        <CommerceMetricCard label="Multiplataforma" value={dashboard?.multi_platform_products} helper="Presentes em 2 ou mais plataformas" />
        <CommerceMetricCard label="Exclusivos" value={dashboard?.single_platform_products} helper="Presentes em apenas uma plataforma" />
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Distribuição por plataforma</h2>
            <p>Quantidade de produtos e anúncios registrados no catálogo comercial.</p>
          </div>
          <button type="button" className="commerce-secondary-button" onClick={() => onNavigate('listings')}>Abrir anúncios</button>
        </div>
        <div className="commerce-marketplace-grid">
          {COMMERCE_MARKETPLACES.filter(([code]) => code).map(([code, name]) => {
            const stats = byMarketplace[code] || {};
            return (
              <article key={code}>
                <span>{name}</span>
                <strong>{commerceFormatNumber(stats.products || 0)} produtos</strong>
                <small>{commerceFormatNumber(stats.listings || 0)} anúncios</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="commerce-panel">
        <div className="commerce-panel-header">
          <div>
            <h2>Pendências operacionais</h2>
            <p>Itens que precisam de tratamento antes do catálogo se tornar a fonte operacional diária.</p>
          </div>
        </div>
        <div className="commerce-task-grid">
          <button type="button" onClick={() => onNavigate('imports')}>
            <span>Importações em revisão</span>
            <strong>{commerceFormatNumber(dashboard?.imports_pending || 0)}</strong>
          </button>
          <button type="button" onClick={() => onNavigate('updates')}>
            <span>Atualizações anuais pendentes</span>
            <strong>{commerceFormatNumber(dashboard?.update_items_pending || 0)}</strong>
          </button>
          <button type="button" onClick={() => onNavigate('products')}>
            <span>Produtos sem anúncio</span>
            <strong>{commerceFormatNumber(dashboard?.products_without_listing || 0)}</strong>
          </button>
        </div>
      </section>
    </>
  );
}
