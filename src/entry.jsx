import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function registerNistiServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => {}))
      .catch(error => console.warn('[PWA] Falha ao registrar Service Worker', error));
  }, { once: true });
}

registerNistiServiceWorker();

function getInitialRoute() {
  const hash = window.location.hash;
  if (window.location.pathname === '/admin-commerce') {
    return 'commerce';
  }
  if (
    window.location.pathname.startsWith('/admin') ||
    hash === '#admin' ||
    hash.startsWith('#/admin') ||
    hash === '#mural-admin' ||
    hash.startsWith('#/mural-admin')
  ) {
    return 'admin';
  }
  return 'public';
}

function RootApp() {
  const [route, setRoute] = useState(getInitialRoute);
  const [AdminComponent, setAdminComponent] = useState(null);
  const [CommerceComponent, setCommerceComponent] = useState(null);
  const [PublicComponent, setPublicComponent] = useState(null);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getInitialRoute());
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (route === 'commerce' && !CommerceComponent) {
      import('./commerce-admin-app-v2.jsx').then(mod => {
        setCommerceComponent(() => mod.default || mod.CommerceAdminAppV2);
      });
    } else if (route === 'admin' && !AdminComponent) {
      import('./main.jsx').then(mod => {
        setAdminComponent(() => mod.default || mod.AdminApp);
      });
    } else if (route === 'public' && !PublicComponent) {
      import('./public-main.jsx').then(publicMod => {
        setPublicComponent(() => publicMod.default || publicMod.PublicIdentificationApp);
      });
    }
  }, [route, AdminComponent, CommerceComponent, PublicComponent]);

  if (route === 'commerce') {
    if (!CommerceComponent) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
          <span>Carregando catálogo comercial…</span>
        </div>
      );
    }
    const Comp = CommerceComponent;
    return <Comp />;
  }

  if (route === 'admin') {
    if (!AdminComponent) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
          <span>Carregando painel administrativo…</span>
        </div>
      );
    }
    const Comp = AdminComponent;
    return <Comp />;
  }

  if (!PublicComponent) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <span>Carregando aplicação…</span>
      </div>
    );
  }

  const PubComp = PublicComponent;
  return <PubComp />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<RootApp />);
}
