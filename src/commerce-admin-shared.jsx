import React from 'react';

export const COMMERCE_PAGE_SIZE = 25;

export const COMMERCE_MARKETPLACES = Object.freeze([
  ['', 'Todas as plataformas'],
  ['SHOPEE', 'Shopee'],
  ['MERCADO_LIVRE', 'Mercado Livre'],
  ['AMAZON', 'Amazon']
]);

export function commerceFormatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

export function commerceStatusLabel(value) {
  const labels = {
    ACTIVE: 'Ativo',
    PAUSED: 'Pausado',
    INACTIVE: 'Inativo',
    REMOVED: 'Removido',
    UNKNOWN: 'Não verificado',
    DRAFT: 'Rascunho',
    DISCONTINUED: 'Descontinuado',
    SELLING: 'Vendendo',
    NO_SALES: 'Sem vendas',
    ANNUAL: 'Anual',
    PERMANENT: 'Permanente',
    UNCLASSIFIED: 'Não classificado'
  };
  return labels[value] || value || '—';
}

export function CommerceStatusPill({ value }) {
  const normalized = String(value || 'UNKNOWN').toUpperCase();
  const className = ['ACTIVE', 'SELLING'].includes(normalized)
    ? 'ok'
    : ['PAUSED', 'DRAFT', 'UNKNOWN', 'UNCLASSIFIED'].includes(normalized)
      ? 'warn'
      : ['INACTIVE', 'REMOVED', 'DISCONTINUED', 'NO_SALES'].includes(normalized)
        ? 'muted'
        : '';
  return <span className={`commerce-status-pill ${className}`}>{commerceStatusLabel(normalized)}</span>;
}

export function CommerceMetricCard({ label, value, helper }) {
  return (
    <article className="commerce-metric-card">
      <span>{label}</span>
      <strong>{commerceFormatNumber(value)}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function CommerceEmptyState({ title, detail }) {
  return (
    <div className="commerce-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function CommerceLoadingBlock({ label = 'Carregando dados comerciais…' }) {
  return (
    <div className="commerce-loading-block">
      <div className="admin-loading-spinner" />
      <span>{label}</span>
    </div>
  );
}
