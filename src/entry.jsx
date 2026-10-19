import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import OperatorPinGate from './operator-pin-gate.jsx';

function registerNistiServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => {}))
      .catch(error => console.warn('[PWA] Falha ao registrar Service Worker', error));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

registerNistiServiceWorker();

function getInitialRoute() {
  // Dedicated URL: never load the Scanner or admin bundles on the Mural host.
  if (window.location.hostname === 'mural.sistemanistiid.online'
    || window.location.pathname === '/mural') {
    return 'mural';
  }
  if (window.location.pathname === '/admin-commerce') {
    return 'commerce';
  }
  if (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')) {
    return 'admin';
  }
  return 'public';
}

function RootApp() {
  const [route, setRoute] = useState(getInitialRoute);
  const [AdminComponent, setAdminComponent] = useState(null);
  const [CommerceComponent, setCommerceComponent] = useState(null);
  const [PublicComponent, setPublicComponent] = useState(null);
  const [MuralComponent, setMuralComponent] = useState(null);

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
    } else if (route === 'mural' && !MuralComponent) {
      import('./mural-standalone.jsx').then(mod => {
        setMuralComponent(() => mod.default);
      });
    } else if (route === 'public' && !PublicComponent) {
      import('./public-main.jsx').then(publicMod => {
        setPublicComponent(() => publicMod.default || publicMod.PublicIdentificationApp);
      });
    }
  }, [route, AdminComponent, CommerceComponent, PublicComponent, MuralComponent]);

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

  if (route === 'mural') {
    if (!MuralComponent) {
      return (
        <div style={{ display:'grid', placeItems:'center', minHeight:'100dvh', fontFamily:'sans-serif' }}>
          <span>Carregando Mural NISTI…</span>
        </div>
      );
    }
    return <OperatorPinGate><MuralComponent /></OperatorPinGate>;
  }

  if (!PublicComponent) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <span>Carregando aplicação…</span>
      </div>
    );
  }

  const PubComp = PublicComponent;
  return <OperatorPinGate><PubComp /></OperatorPinGate>;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<RootApp />);
}
