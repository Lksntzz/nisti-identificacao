const STYLE_ID = 'nisti-admin-import-workspace-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html[data-nisti-access="admin"] .admin-import-workspace {
      display: none;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace {
      display: grid !important;
      grid-template-columns: minmax(320px, .72fr) minmax(560px, 1.4fr) !important;
      gap: 16px !important;
      align-items: start !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > .admin-tool-panel {
      display: grid !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      align-self: start !important;
      box-sizing: border-box !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > [data-tool-panel="importacao"] {
      padding: 20px !important;
      border: 1px solid #eadfce !important;
      border-left: 4px solid #ef8b19 !important;
      border-radius: 16px !important;
      background: linear-gradient(180deg,#fff 0%,#fffaf4 100%) !important;
      box-shadow: 0 5px 18px rgba(25,38,58,.045) !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > [data-tool-panel="cadastro"] {
      padding: 20px !important;
      border: 1px solid #dbe5f3 !important;
      border-left: 4px solid #2563eb !important;
      border-radius: 16px !important;
      background: linear-gradient(180deg,#fff 0%,#f9fbff 100%) !important;
      box-shadow: 0 5px 18px rgba(25,38,58,.045) !important;
      gap: 10px !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace .panel-head {
      margin: 0 0 14px !important;
      padding: 0 0 12px !important;
      border-bottom: 1px solid #e9edf2 !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace .panel-head strong {
      font-size: 18px !important;
      color: #15243b !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace .panel-head small {
      margin-top: 4px !important;
      font-size: 10px !important;
      color: #7d899a !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > [data-tool-panel="importacao"] .parsed {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 9px !important;
      margin: 0 0 14px !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace .badge {
      min-height: 64px !important;
      padding: 11px !important;
      border-radius: 10px !important;
      background: #fff !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace label {
      gap: 6px !important;
      font-size: 11px !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace input:not([type="file"]),
    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace select {
      min-height: 42px !important;
      height: 42px !important;
      padding: 9px 11px !important;
      border-radius: 9px !important;
      background: #fff !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace input[type="file"] {
      min-height: 48px !important;
      padding: 8px 10px !important;
      border: 1px dashed #cbd6e5 !important;
      border-radius: 10px !important;
      background: #fff !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace .grid2 {
      gap: 10px !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > [data-tool-panel="cadastro"] > button {
      min-height: 44px !important;
      margin-top: 2px !important;
      border-radius: 10px !important;
      background: #0b2650 !important;
      color: #fff !important;
      font-weight: 800 !important;
    }

    html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > [data-tool-panel="cadastro"] > button:disabled {
      background: #a4aab3 !important;
    }

    @media (max-width: 1150px) {
      html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace {
        grid-template-columns: 1fr !important;
      }
    }

    @media (max-width: 680px) {
      html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > .admin-tool-panel {
        padding: 15px !important;
      }
      html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace > [data-tool-panel="importacao"] .parsed,
      html[data-nisti-access="admin"][data-admin-view="importacao"] .admin-import-workspace .grid2 {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureWorkspace() {
  if (document.documentElement.dataset.nistiAccess !== 'admin') return;
  ensureStyle();

  const dashboard = document.querySelector('.admin-dashboard-panel');
  const importPanel = document.querySelector('.admin-tool-panel[data-tool-panel="importacao"]');
  const cadastroPanel = document.querySelector('.admin-tool-panel[data-tool-panel="cadastro"]');
  if (!dashboard || !importPanel || !cadastroPanel) return;

  let workspace = dashboard.querySelector(':scope > .admin-import-workspace');
  if (!workspace) {
    workspace = document.createElement('section');
    workspace.className = 'admin-import-workspace';
    const anchor = importPanel.parentElement === dashboard ? importPanel : dashboard.querySelector('.admin-tool-panel');
    if (anchor && anchor.parentElement === dashboard) dashboard.insertBefore(workspace, anchor);
    else dashboard.appendChild(workspace);
  }

  if (importPanel.parentElement !== workspace) workspace.appendChild(importPanel);
  if (cadastroPanel.parentElement !== workspace) workspace.appendChild(cadastroPanel);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensureWorkspace();
  });
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['data-nisti-access', 'data-admin-view']
});

schedule();
