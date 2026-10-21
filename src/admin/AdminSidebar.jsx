import React, { useEffect, useState } from 'react';
import LOGO from '../assets/logo.png';
import { ADMIN_MENU_SECTIONS } from '../admin-navigation.js';

export default function AdminSidebar({
  activeView,
  onViewChange,
  sidebarOpen,
  onCloseSidebar,
  activeMuralSection = 'dashboard',
  onMuralSectionChange,
  activeCommerceSection = 'catalog',
  onCommerceSectionChange
}) {
  const [expandedItems,setExpandedItems]=useState(()=>new Set(
    activeView==='mural-nisti' ? ['mural-nisti'] : activeView==='commerce' ? ['commerce'] : []
  ));

  useEffect(()=>{
    if(!['mural-nisti','commerce'].includes(activeView)) return;
    setExpandedItems(previous=>{
      if(previous.has(activeView)) return previous;
      const next=new Set(previous);
      next.add(activeView);
      return next;
    });
  },[activeView]);

  const toggleExpanded = itemId => {
    setExpandedItems(previous=>{
      const next=new Set(previous);
      if(next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  return (
    <>
      {sidebarOpen && <div className="sidebar-mobile-backdrop" onClick={onCloseSidebar} />}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src={LOGO} alt="NISTI ID" className="sidebar-brand-logo" />
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-title">NISTI ID</span>
              <span className="sidebar-brand-subtitle">PAINEL ADM</span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {ADMIN_MENU_SECTIONS.map(section => (
            <div key={section.title} className="sidebar-section">
              <span className="sidebar-section-title">{section.title}</span>
              <ul className="sidebar-section-list">
                {section.items.map(item => {
                  const isActive = activeView === item.id;
                  const hasChildren = Array.isArray(item.children) && item.children.length > 0;
                  const isExpanded = hasChildren && expandedItems.has(item.id);

                  if (hasChildren) {
                    return (
                      <li key={item.id} className={`sidebar-nav-tree ${isExpanded ? 'expanded' : ''}`}>
                        <div className={`sidebar-nav-tree-parent ${isActive ? 'active' : ''}`}>
                          <button
                            type="button"
                            className={`sidebar-nav-item sidebar-nav-parent-main ${isActive ? 'active' : ''}`}
                            onClick={() => {
                              if (item.id === 'commerce') {
                                toggleExpanded(item.id);
                                return;
                              }
                              onViewChange(item.id);
                              if (item.id === 'mural-nisti') onMuralSectionChange?.('dashboard');
                              setExpandedItems(previous => {
                                const next = new Set(previous);
                                next.add(item.id);
                                return next;
                              });
                            }}
                          >
                            <SidebarIcon name={item.icon} />
                            <span className="sidebar-item-label">{item.label}</span>
                          </button>
                          <button
                            type="button"
                            className={`sidebar-nav-chevron ${isExpanded ? 'expanded' : ''}`}
                            aria-label={isExpanded ? `Recolher ${item.label}` : `Expandir ${item.label}`}
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpanded(item.id)}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </button>
                        </div>
                        {isExpanded && (
                          <ul className="sidebar-submenu">
                            {item.children.map(child => {
                              const activeChildSection = item.id === 'commerce' ? activeCommerceSection : activeMuralSection;
                              const childActive = isActive && activeChildSection === child.id;
                              return (
                                <li key={child.id}>
                                  <button
                                    type="button"
                                    className={`sidebar-submenu-item ${childActive ? 'active' : ''}`}
                                    onClick={() => {
                                      onViewChange(item.id);
                                      if (item.id === 'commerce') onCommerceSectionChange?.(child.id);
                                      else onMuralSectionChange?.(child.id);
                                      onCloseSidebar();
                                    }}
                                  >
                                    <span className="sidebar-submenu-rail" aria-hidden="true" />
                                    <span>{child.label}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  }

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          onViewChange(item.id);
                          onCloseSidebar();
                        }}
                      >
                        <SidebarIcon name={item.icon} />
                        <span className="sidebar-item-label">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <form method="POST" action="/admin-logout" className="nim-logout-form"><button type="submit" className="sidebar-logout-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Encerrar Sessão</span>
          </button></form>
        </div>
      </aside>
    </>
  );
}

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
    case 'grid':
      return <svg {...props}><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>;
    case 'alert':
      return <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'history':
      return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    case 'terminal':
      return <svg {...props}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
    case 'barcode':
      return <svg {...props}><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" /><path d="M8 5v14M15 5v14M19 5v14" strokeWidth="1" /></svg>;
    case 'mural':
      return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h7M7 16h5" /></svg>;
    case 'bell':
      return <svg {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10 21h4" /></svg>;
    case 'security':
      return <svg {...props}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg>;
    default:
      return null;
  }
}
