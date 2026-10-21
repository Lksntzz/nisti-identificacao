import React from 'react';

// A barra superior mantém sua interface original; estado e chamadas permanecem no AdminApp.
export default function AdminTopbar({ onToggleSidebar, unreadCount, activeView, activeCommerceSection = 'catalog', onOpenNotifications, desktopPreview, onToggleDesktopPreview }) {
  const commerceTitle = ({
    catalog: 'Painel Comercial',
    sales: 'Painel Comercial',
    pending: 'Pendências'
  })[activeCommerceSection] || 'Painel Comercial';
  const pageTitle = activeView === 'catalogo' ? 'Produtos NISTI'
    : activeView === 'mural-nisti' ? 'Mural NISTI'
    : activeView === 'commerce' ? commerceTitle
    : activeView === 'gerador-barras' ? 'Gerador de Barras'
    : activeView === 'historico-ean' ? 'Histórico de Bipagens'
    : activeView === 'ean-nao-cadastrados' ? 'EAN não Cadastrados'
    : activeView === 'produtos-sem-ean' ? 'Produtos sem EAN'
    : activeView === 'nisti-dispatch' ? 'Notificações da Expedição'
    : activeView === 'operadores-pin' ? 'PIN dos Operadores'
    : activeView === 'logs' ? 'Saúde & Logs'
    : 'Painel Administrativo';

  return (
    <header className="admin-topbar-header">
      <div className="topbar-left">
        <button
          type="button"
          className="hamburger-btn"
          onClick={onToggleSidebar}
          aria-label="Alternar menu lateral"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="admin-page-title">
          <span key={activeView} className="admin-page-title-motion">{pageTitle}</span>
        </h1>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className={`topbar-desktop-preview-btn ${desktopPreview ? 'active' : ''}`}
          onClick={onToggleDesktopPreview}
          title={desktopPreview ? 'Voltar para visualização do celular' : 'Visualizar como computador'}
          aria-label={desktopPreview ? 'Voltar para visualização do celular' : 'Visualizar como computador'}
          aria-pressed={desktopPreview}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
          <span>{desktopPreview ? 'Modo celular' : 'Modo PC'}</span>
        </button>
        <button
          type="button"
          className={`topbar-bell-btn ${unreadCount > 0 ? 'has-unread' : ''}`}
          title="Atividades do sistema"
          aria-label={`Atividades do sistema (${unreadCount} não lidas)`}
          onClick={onOpenNotifications}
        >
          {/* Um único ícone estável; não remonta SVGs ao atualizar o contador. */}
          {unreadCount > 0 && <span className="topbar-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>

        <form method="POST" action="/admin-logout" className="nim-logout-form"><button type="submit" className="topbar-logout-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Sair</span>
          </button></form>
      </div>
    </header>
  );
}
