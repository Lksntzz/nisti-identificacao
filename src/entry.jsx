import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const IS_GA_HOST = window.location.hostname === 'ga.sistemanistiid.online';

function registerNistiServiceWorker() {
  if (IS_GA_HOST || !('serviceWorker' in navigator)) return;
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

// Remove a margem padrao do navegador antes de montar a tela isolada do monitor.
if (window.location.pathname === '/monitor-notificacoes') {
  document.documentElement.classList.add('nid-monitor-document');
}

function getInitialRoute() {
  // GA - Gestor de Anúncio: este endereço só monta o Painel Comercial.
  if (IS_GA_HOST) return 'commerce';
  // Dedicated URL: never load the Scanner or admin bundles on the Mural host.
  if (window.location.hostname === 'mural.sistemanistiid.online'
    || window.location.pathname === '/mural') {
    return 'mural';
  }
  if (window.location.pathname === '/monitor-notificacoes') {
    return 'dispatch';
  }
  if (window.location.pathname === '/painel-expedicao'
    || window.location.pathname === '/convite-expedicao'
    || window.location.pathname.startsWith('/convite-expedicao/')) {
    // Even if an offline shell is shown by the browser, do not mount Scanner.
    return 'dispatch-admin';
  }
  if (window.location.pathname === '/admin-commerce') {
    return 'commerce';
  }
  if (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')) {
    return 'admin';
  }
  return 'public';
}

// When a live notification triggers a render failure, kiosk operators may not
// have a mouse/keyboard. Retry automatically with bounded backoff.
export function monitorRecoveryDelay(now=Date.now(),storage=window.sessionStorage){
  const key='nisti_monitor_recovery_v1';
  try{
    const prior=JSON.parse(storage.getItem(key)||'{}');
    const count=Number.isSafeInteger(prior.count)&&now-Number(prior.last)<120000
      ?Math.min(prior.count+1,6):1;
    storage.setItem(key,JSON.stringify({count,last:now}));
    return Math.min(5000*(2**(count-1)),60000);
  }catch{return 15000}
}
class MonitorErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={failed:false};this.retryTimer=null}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(error){
    console.error('[Monitor NISTI] Erro ao exibir a tela',error?.name||'render_error',String(error?.message||'').slice(0,160));
    const delay=monitorRecoveryDelay();
    this.retryTimer=window.setTimeout(()=>window.location.reload(),delay);
  }
  componentWillUnmount(){if(this.retryTimer!==null)window.clearTimeout(this.retryTimer)}
  render(){
    if(this.state.failed)return <main role="alert" style={{minHeight:'100dvh',background:'#0b1326',color:'white',display:'grid',placeItems:'center',fontFamily:'system-ui',padding:32,textAlign:'center'}}>
      <div><h1>Monitor NISTI em recuperação</h1><p>Uma notificação causou uma falha de exibição. A tela será reiniciada automaticamente.</p>
        <button onClick={()=>window.location.reload()} style={{padding:12,borderRadius:8}}>Recarregar agora</button></div>
    </main>;
    return this.props.children;
  }
}

function RootApp() {
  const [route, setRoute] = useState(getInitialRoute);
  useEffect(() => {
    document.documentElement.classList.toggle('nid-monitor-document',route === 'dispatch');
    return () => document.documentElement.classList.remove('nid-monitor-document');
  }, [route]);
  const [AdminComponent, setAdminComponent] = useState(null);
  const [CommerceComponent, setCommerceComponent] = useState(null);
  const [PublicComponent, setPublicComponent] = useState(null);
  const [MuralComponent, setMuralComponent] = useState(null);
  const [DispatchComponent,setDispatchComponent] = useState(null);
  const [dispatchLoadError,setDispatchLoadError] = useState(false);
  const [DispatchAdminComponent,setDispatchAdminComponent] = useState(null);

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
    } else if (route === 'dispatch' && !DispatchComponent) {
      import('./notification-monitor.jsx').then(mod=>setDispatchComponent(()=>mod.default))
        .catch(error=>{console.error('[Monitor NISTI] Falha no carregamento',error?.name||'module_error');setDispatchLoadError(true)});
    } else if (route === 'dispatch-admin' && !DispatchAdminComponent) {
      import('./expedition-dispatch-standalone.jsx').then(mod=>setDispatchAdminComponent(()=>mod.default));
    } else if (route === 'public' && !PublicComponent) {
      import('./public-main.jsx').then(publicMod => {
        setPublicComponent(() => publicMod.default || publicMod.PublicIdentificationApp);
      });
    }
  }, [route, AdminComponent, CommerceComponent, PublicComponent, MuralComponent, DispatchComponent, DispatchAdminComponent]);

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

  if (route === 'dispatch') {
    if(dispatchLoadError)return <main style={{minHeight:'100dvh',background:'#0b1326',color:'white',display:'grid',placeItems:'center',fontFamily:'system-ui',padding:32,textAlign:'center'}}>
      <div><h1>Falha ao carregar o monitor NISTI</h1><p>Verifique a conexão e tente novamente.</p><button onClick={()=>window.location.reload()} style={{padding:12,borderRadius:8}}>Recarregar monitor</button></div>
    </main>;
    if (!DispatchComponent) return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',background:'#0b1326',color:'#fff'}}>Carregando monitor NISTI…</main>;
    return <MonitorErrorBoundary><DispatchComponent /></MonitorErrorBoundary>;
  }

  if (route === 'dispatch-admin') {
    if (!DispatchAdminComponent) return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',fontFamily:'system-ui'}}>Carregando painel de expedição…</main>;
    return <DispatchAdminComponent />;
  }

  if (route === 'mural') {
    if (!MuralComponent) {
      return (
        <div style={{ display:'grid', placeItems:'center', minHeight:'100dvh', fontFamily:'sans-serif' }}>
          <span>Carregando Mural NISTI…</span>
        </div>
      );
    }
    return <MuralComponent />;
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
