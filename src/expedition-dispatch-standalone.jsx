import React from 'react';
import NotificationDispatchView from './admin/NotificationDispatchView.jsx';
import './expedition-dispatch-standalone.css';

// Entrada administrativa independente: nenhuma ferramenta do scanner, mural
// ou catálogo é importada nesta rota. A sessão já é validada pelo Worker.
export default function ExpeditionDispatchStandalone(){
  return <div className="nid-expedition-standalone">
    <header className="nid-expedition-topbar">
      <div className="nid-expedition-brand">
        <span className="nid-expedition-brandmark" aria-hidden="true">N</span>
        <div><strong>NISTI PRINT</strong><small>PAINEL DA EXPEDIÇÃO</small></div>
      </div>
      <nav className="nid-expedition-links" aria-label="Acesso da expedição">
        <a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer">Tela do monitor</a>
        <a href="/admin">Painel ADM</a>
        <form method="post" action="/admin-logout"><button type="submit">Sair</button></form>
      </nav>
    </header>
    <main className="nid-expedition-main">
      <NotificationDispatchView/>
    </main>
  </div>;
}
