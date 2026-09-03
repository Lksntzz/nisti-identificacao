import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/main.jsx');
let source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

function assertFound(condition, label) {
  if (!condition) throw new Error(`Refatoração abortada: ${label}.`);
}

function replaceOnceRegex(regex, replacement, label) {
  const matches = source.match(regex);
  assertFound(matches, `marcador não encontrado (${label})`);
  source = source.replace(regex, replacement);
}

function replaceBetween(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  assertFound(start >= 0, `início não encontrado (${label})`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assertFound(end >= 0, `fim não encontrado (${label})`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

// Imports: remove createRoot morto e centraliza definição do menu.
replaceOnceRegex(
  /import React, \{ useEffect, useMemo, useRef, useState \} from 'react';\nimport \{ createRoot \} from 'react-dom\/client';\nimport '\.\/app\.css';\nimport LOGO from '\.\/assets\/logo\.png';/,
  "import React, { useEffect, useMemo, useRef, useState } from 'react';\nimport './app.css';\nimport LOGO from './assets/logo.png';\nimport { ADMIN_MENU_SECTIONS } from './admin-navigation.js';",
  'imports do painel ADM'
);

const adminSidebar = `function AdminSidebar({ activeView, onViewChange, sidebarOpen, onCloseSidebar }) {
  return (
    <>
      {sidebarOpen && <div className="sidebar-mobile-backdrop" onClick={onCloseSidebar} />}
      <aside className={\`admin-sidebar \${sidebarOpen ? 'open' : ''}\`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src={LOGO} alt="NISTI ID" className="sidebar-brand-logo" />
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-title">NISTI ID</span>
              <span className="sidebar-brand-subtitle">PAINEL ADM</span>
            </div>
          </div>
        </div>

        <div className="sidebar-highlight-wrap">
          <a
            href="/"
            className="sidebar-highlight-btn"
            target="_blank"
            rel="noreferrer"
            title="Abrir o painel operacional em uma nova aba"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3h7v7" />
              <path d="M10 14 21 3" />
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
            <span>Abrir NISTI ID</span>
          </a>
        </div>

        <nav className="sidebar-nav">
          {ADMIN_MENU_SECTIONS.map(section => (
            <div key={section.title} className="sidebar-section">
              <span className="sidebar-section-title">{section.title}</span>
              <ul className="sidebar-section-list">
                {section.items.map(item => {
                  const isActive = activeView === item.id;
                  if (item.href) {
                    return (
                      <li key={item.id}>
                        <a href={item.href} className="sidebar-nav-item">
                          <SidebarIcon name={item.icon} />
                          <span>{item.label}</span>
                        </a>
                      </li>
                    );
                  }
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={\`sidebar-nav-item \${isActive ? 'active' : ''}\`}
                        onClick={() => {
                          onViewChange(item.id);
                          onCloseSidebar();
                        }}
                      >
                        <SidebarIcon name={item.icon} />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="sidebar-avatar">AD</div>
            <div className="sidebar-user-info">
              <strong>Administrador</strong>
              <small>admin@nisti.print</small>
            </div>
            <a href="/admin-logout" className="sidebar-logout-link" title="Sair do painel">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}

`;
replaceBetween('function AdminSidebar(', 'function SidebarIcon(', adminSidebar, 'AdminSidebar');

const sidebarIcon = `function SidebarIcon({ name }) {
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
    case 'brain':
      return <svg {...props}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04ZM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/></svg>;
    case 'grid':
      return <svg {...props}><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>;
    case 'alert':
      return <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'shield-check':
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>;
    case 'history':
      return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    case 'terminal':
      return <svg {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    case 'users':
      return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    default:
      return null;
  }
}

`;
replaceBetween(
  'function SidebarIcon(',
  '/* =========================================================================\n   TOPBAR COMPONENT',
  sidebarIcon,
  'SidebarIcon'
);

// PlatformsView era uma página isolada sem gestão real; remove implementação morta.
replaceBetween(
  '/* =========================================================================\n   PLATFORMS MANAGEMENT VIEW',
  '/* =========================================================================\n   TEST COVER VERIFIER VIEW',
  '',
  'PlatformsView morto'
);

replaceOnceRegex(
  /  const handleNavChange = viewId => \{\n    if \(viewId === 'cadastrar'\) \{\n      setCreateModalOpen\(true\);\n      return;\n    \}\n    if \(viewId === 'importar'\) \{\n      setImportModalOpen\(true\);\n      return;\n    \}\n    setActiveView\(viewId\);\n  \};/,
  "  const handleNavChange = viewId => setActiveView(viewId);",
  'handleNavChange legado'
);

// Retira apenas a prop do AdminSidebar; AdminTopbar ainda usa unreadCount.
replaceOnceRegex(
  /(\s*<AdminSidebar\n\s*activeView=\{activeView\}\n\s*onViewChange=\{handleNavChange\}\n)\s*unreadCount=\{unreadCount\}\n/,
  '$1',
  'prop unreadCount do AdminSidebar'
);

for (const block of [
  /\n\s*\{activeView === 'similares' && \([\s\S]*?\n\s*\)\}\n/,
  /\n\s*\{activeView === 'plataformas' && \([\s\S]*?\n\s*\)\}\n/,
  /\n\s*\{activeView === 'configuracoes' && \([\s\S]*?\n\s*\)\}\n/
]) {
  assertFound(block.test(source), `render legado não encontrado (${block})`);
  source = source.replace(block, '\n');
}

for (const forbidden of [
  "id: 'identificacao'",
  "id: 'similares'",
  "id: 'cadastrar'",
  "id: 'importar'",
  "id: 'plataformas'",
  "id: 'configuracoes'",
  'function PlatformsView',
  "activeView === 'similares'",
  "activeView === 'plataformas'",
  "activeView === 'configuracoes'",
  "import { createRoot } from 'react-dom/client';"
]) {
  assertFound(!source.includes(forbidden), `código legado ainda presente: ${forbidden}`);
}

for (const required of [
  "import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';",
  'Abrir NISTI ID',
  'ADMIN_MENU_SECTIONS.map',
  "activeView === 'catalogo'",
  "activeView === 'usuarios'",
  "activeView === 'historico'",
  "activeView === 'nao-identificados'",
  "activeView === 'verificar'",
  "activeView === 'logs'"
]) {
  assertFound(source.includes(required), `conteúdo obrigatório ausente: ${required}`);
}

fs.writeFileSync(filePath, source, 'utf8');
console.log('✓ src/main.jsx refatorado para a navegação ADM v8.21.');
console.log('✓ Duplicações e PlatformsView removidos sem tocar no reconhecimento.');
console.log('✓ Cadastrar/Importar permanecem como ações dentro do Catálogo.');
console.log('✓ NISTI ID operacional virou utilitário externo do ADM.');
