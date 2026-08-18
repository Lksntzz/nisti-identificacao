const params = new URLSearchParams(window.location.search);
const compactAdminPath = window.location.pathname === '/admin';
const legacyAdminQuery = params.get('nisti_admin') === '1';

// general-access.js ainda reconhece o marcador legado durante a inicialização.
// Mantemos esse marcador apenas internamente e limpamos a barra de endereço
// assim que a sessão administrativa for confirmada.
if (compactAdminPath && !legacyAdminQuery) {
  window.history.replaceState(null, '', '/admin?nisti_admin=1');
}

function keepCompactAdminUrl() {
  if (document.documentElement.dataset.nistiAccess === 'admin') {
    if (window.location.pathname !== '/admin' || window.location.search) {
      window.history.replaceState(null, '', '/admin');
    }
    return true;
  }
  return false;
}

if (compactAdminPath || legacyAdminQuery) {
  if (!keepCompactAdminUrl()) {
    const observer = new MutationObserver(() => {
      if (keepCompactAdminUrl()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-nisti-access']
    });
  }
}
