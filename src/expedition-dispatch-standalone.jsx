import React,{useEffect,useState} from 'react';
import NotificationDispatchView from './admin/NotificationDispatchView.jsx';
import './expedition-dispatch-standalone.css';

// O link tem a chave no fragmento (#acesso=...), que nao e enviada em requests
// nem em logs do servidor. O servidor grava uma sessao HttpOnly e o token sai
// imediatamente da barra de endereco. So entao a central e carregada.
export default function ExpeditionDispatchStandalone(){
  const [access,setAccess]=useState('loading');
  const [error,setError]=useState('');
  useEffect(()=>{
    let canceled=false;
    const init=async()=>{
      try{
        const raw=window.location.hash.slice(1);
        const token=raw.startsWith('acesso=')?raw.slice(7):'';
        if(raw)window.history.replaceState(null,'',window.location.pathname+window.location.search);
        if(token){
          if(!/^[a-f0-9]{64}$/i.test(token))throw Error('Link privado inválido.');
          const response=await fetch('/api/expedition-panel/activate',{
            method:'POST',credentials:'same-origin',cache:'no-store',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({token})
          });
          if(!response.ok)throw Error('Link privado inválido ou revogado.');
        }
        const response=await fetch('/api/expedition-panel/session',{cache:'no-store',credentials:'same-origin'});
        const body=await response.json().catch(()=>({}));
        if(!canceled)setAccess(response.ok&&body.authorized===true?'allowed':'denied');
      }catch(e){
        if(!canceled){setError(e.message);setAccess('denied')}
      }
    };
    init();
    return()=>{canceled=true};
  },[]);
  async function logout(){
    const result=await fetch('/api/expedition-panel/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});
    if(result.ok)setAccess('denied');
  }
  return <div className="nid-expedition-standalone">
    <header className="nid-expedition-topbar">
      <div className="nid-expedition-brand">
        <span className="nid-expedition-brandmark" aria-hidden="true">N</span>
        <div><strong>NISTI PRINT</strong><small>CENTRAL DE NOTIFICAÇÕES DA EXPEDIÇÃO</small></div>
      </div>
      {access==='allowed'&&<button type="button" className="nid-expedition-signout" onClick={logout}>Encerrar acesso</button>}
    </header>
    <main className="nid-expedition-main">
      {access==='loading'&&<div className="nid-expedition-access">Preparando a central da expedição…</div>}
      {access==='denied'&&<div className="nid-expedition-access" role="alert">
        <h1>Acesso restrito</h1>
        <p>{error||'Abra o link privado fornecido pelo responsável pela expedição.'}</p>
      </div>}
      {access==='allowed'&&<NotificationDispatchView senderMode/>}
    </main>
  </div>;
}
