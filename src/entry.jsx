import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function getInitialRoute() {
  const pathname = window.location.pathname;
  const hash = window.location.hash;
  if (pathname.startsWith('/admin') || hash === '#admin' || hash.startsWith('#/admin')) {
    return 'admin';
  }
  return 'public';
}

function RootApp() {
  const [route, setRoute] = useState(getInitialRoute);
  const [AdminComponent, setAdminComponent] = useState(null);
  const [PublicComponent, setPublicComponent] = useState(null);
  const [ShadowPromptComponent, setShadowPromptComponent] = useState(null);

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
    if (route === 'admin' && !AdminComponent) {
      import('./main.jsx').then(mod => {
        setAdminComponent(() => mod.default || mod.AdminApp);
      });
    } else if (route === 'public' && (!PublicComponent || !ShadowPromptComponent)) {
      Promise.all([
        import('./public-main.jsx'),
        import('./shadow-confirmation-client.js'),
        import('./shadow-confirmation-prompt.jsx')
      ]).then(([publicMod, _clientMod, promptMod]) => {
        setPublicComponent(() => publicMod.default || publicMod.PublicIdentificationApp);
        setShadowPromptComponent(() => promptMod.default);
      });
    }
  }, [route, AdminComponent, PublicComponent, ShadowPromptComponent]);

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

  if (!PublicComponent || !ShadowPromptComponent) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <span>Carregando aplicação…</span>
      </div>
    );
  }

  const PubComp = PublicComponent;
  const PromptComp = ShadowPromptComponent;

  return (
    <>
      <PubComp />
      <PromptComp />
    </>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<RootApp />);
}
