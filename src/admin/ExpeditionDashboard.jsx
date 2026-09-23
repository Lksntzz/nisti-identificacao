import React, { useState, useEffect } from 'react';

export function ExpeditionDashboard({ gtinDashboard, productsCount, onNavigate, onShowProductsWithoutGtin }) {
  const activeGtins = Number(gtinDashboard?.active_gtins || 0);
  const productsWithGtin = Number(gtinDashboard?.products_with_gtin || 0);
  const todayTotal = Number(gtinDashboard?.today?.total || 0);
  const todayIdentified = Number(gtinDashboard?.today?.identified || 0);
  const todayNotFound = Number(gtinDashboard?.today?.not_found || 0);
  const todayErrors = Number(gtinDashboard?.today?.system_errors || 0);

  const successRate = todayTotal > 0 ? Math.round((todayIdentified / todayTotal) * 100) : 100;
  const coverageRate = productsCount > 0 ? Math.round((productsWithGtin / productsCount) * 100) : 0;
  const productsWithoutGtin = Number(gtinDashboard?.products_without_gtin_count ?? Math.max(0, productsCount - productsWithGtin));

  return (
    <div className="expedition-dashboard-container" style={{ marginBottom: '24px' }}>
      {/* 4 KPIs Principais */}
      <div className="kpis-row">
        <div className="kpi-box kpi-blue">
          <div className="kpi-icon-circle blue">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7.5 4.27 9 5.15" />
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </div>
          <div className="kpi-body">
            <span className="kpi-title">Total de Produtos</span>
            <strong className="kpi-num">{productsCount.toLocaleString('pt-BR')}</strong>
            <span className="kpi-tag green">{coverageRate}% com EAN cadastrado</span>
          </div>
        </div>

        <div className="kpi-box kpi-green">
          <div className="kpi-icon-circle green">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="kpi-body">
            <span className="kpi-title">EANs Ativos</span>
            <strong className="kpi-num">{activeGtins.toLocaleString('pt-BR')}</strong>
            <span className="kpi-tag green">Vinculados ao catálogo</span>
          </div>
        </div>

        <div className="kpi-box kpi-yellow">
          <div className="kpi-icon-circle yellow">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="kpi-body">
            <span className="kpi-title">Leituras Hoje</span>
            <strong className="kpi-num">{todayTotal.toLocaleString('pt-BR')}</strong>
            <span className="kpi-tag green">{successRate}% de acerto</span>
          </div>
        </div>

        {todayNotFound > 0 && (
          <button
            type="button"
            className="kpi-box kpi-purple kpi-action"
            onClick={() => onNavigate?.('ean-nao-cadastrados')}
            title="Ver os EANs não cadastrados"
          >
            <div className="kpi-icon-circle purple">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#9333ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div className="kpi-body">
              <span className="kpi-title">EAN não Cadastrados</span>
              <strong className="kpi-num">{todayNotFound.toLocaleString('pt-BR')}</strong>
              <span className="kpi-tag orange">Aguardando vínculo</span>
            </div>
          </button>
        )}
      </div>

      {/* Painel de Produtividade da Expedição & Cobertura */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '16px',
        marginTop: '16px'
      }}>
        {/* Card 1: Eficiência Operacional Hoje */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '20px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>⚡</span>
              <strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: 800 }}>Produtividade da Expedição Hoje</strong>
            </div>
            <span className="status-pill active" style={{ fontSize: '11px', fontWeight: 800 }}>
              {todayTotal} itens bipados
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Barra de Progresso de Acerto */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>Taxa de Sucesso na Bipagem</span>
                <strong style={{ color: successRate >= 95 ? '#16a34a' : '#d97706' }}>{successRate}%</strong>
              </div>
              <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{
                  width: `${todayTotal > 0 ? Math.min(100, Math.max(0, successRate)) : 100}%`,
                  height: '100%',
                  background: successRate >= 95 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : 'linear-gradient(90deg, #f59e0b, #d97706)',
                  borderRadius: '999px',
                  transition: 'width 0.4s ease'
                }} />
              </div>
            </div>

            {/* Sub-métricas em 3 colunas */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              background: '#f8fafc',
              padding: '10px 12px',
              borderRadius: '12px',
              border: '1px solid #edf2f7',
              marginTop: '4px'
            }}>
              <div>
                <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block', fontWeight: 600 }}>Identificados</span>
                <strong style={{ fontSize: '16px', color: '#16a34a', fontWeight: 800 }}>{todayIdentified}</strong>
              </div>
              <div>
                <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block', fontWeight: 600 }}>Não Cadastrados</span>
                <strong style={{ fontSize: '16px', color: todayNotFound > 0 ? '#d97706' : '#64748b', fontWeight: 800 }}>{todayNotFound}</strong>
              </div>
              <div>
                <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block', fontWeight: 600 }}>Erros Técnicos</span>
                <strong style={{ fontSize: '16px', color: todayErrors > 0 ? '#dc2626' : '#64748b', fontWeight: 800 }}>{todayErrors}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Cobertura do Catálogo EAN */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '20px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🏷️</span>
              <strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: 800 }}>Cobertura EAN do Catálogo</strong>
            </div>
            <span className="status-pill" style={{ fontSize: '11px', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8' }}>
              {coverageRate}% coberto
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Barra de Progresso de Cobertura */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: '#475569', fontWeight: 600 }}>Produtos com Código de Barras</span>
                <strong style={{ color: '#2563eb' }}>{productsWithGtin} de {productsCount}</strong>
              </div>
              <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, Math.max(0, coverageRate))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                  borderRadius: '999px',
                  transition: 'width 0.4s ease'
                }} />
              </div>
            </div>

            {/* Alerta de Produtos sem EAN ou Ação Rápida */}
            {productsWithoutGtin > 0 && (
              <button
                type="button"
                className="missing-gtin-alert"
                onClick={onShowProductsWithoutGtin}
              >
                <span>⚠️ <strong>{productsWithoutGtin}</strong> produto{productsWithoutGtin === 1 ? '' : 's'} sem EAN vinculado</span>
                <span>Ver produtos →</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExpeditionDashboard;
