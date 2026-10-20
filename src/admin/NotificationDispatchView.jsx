import React,{useCallback,useEffect,useState} from 'react';
import '../notification-dispatch.css';

const PLATFORMS=['SHOPEE','MERCADO LIVRE','AMAZON'];
const NAMES={'PENDING':'Na fila','SHOWING':'Em exibição','EXPIRED':'Exibida'};
async function request(path,options={}) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Falha de comunicação com o servidor');
  return data;
}
export default function NotificationDispatchView() {
  const [platform,setPlatform]=useState('SHOPEE');
  const [state,setState]=useState(null);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [sending,setSending]=useState(false);
  const [pairing,setPairing]=useState(false);
  const [monitorKey,setMonitorKey]=useState('');
  const [copyMessage,setCopyMessage]=useState('');

  const refresh=useCallback(async()=>{
    try {
      const response=await request('/api/admin/dispatch');
      setState(response);setError('');
    }catch(e){setError(e.message)}
  },[]);
  useEffect(()=>{
    refresh();
    const timer=setInterval(refresh,8000);
    return ()=>clearInterval(timer);
  },[refresh]);

  async function send(event){
    event.preventDefault();
    if(sending)return;
    setSending(true);setSuccess('');setError('');
    try {
      await request('/api/admin/dispatch',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({platform,action:'RETIRAR_CAPA',request_key:crypto.randomUUID()})
      });
      setSuccess('Solicitação enviada. Será exibida por 10 segundos quando chegar sua vez.');
      await refresh();
    }catch(e){setError(e.message)}
    finally{setSending(false)}
  }
  async function pair(){
    if(pairing)return;
    if(state?.monitor_paired&&!window.confirm(
      'Gerar uma nova chave desconectará o monitor anterior até que a nova chave seja digitada. Continuar?'
    ))return;
    setPairing(true);setMonitorKey('');setCopyMessage('');setError('');
    try {
      const result=await request('/api/admin/dispatch/monitor-key',{method:'POST'});
      setMonitorKey(result.key);await refresh();
    }catch(e){setError(e.message)}
    finally{setPairing(false)}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(monitorKey);setCopyMessage('Chave copiada.');}
    catch{setCopyMessage('Selecione a chave acima e copie manualmente.')}
  }
  const monitorOnline=state?.monitor_last_seen
    && Date.now()-Date.parse(state.monitor_last_seen)<15000;

  return <section className="nid-admin" aria-label="Central de Notificações da Expedição">
    <header className="nid-admin-heading">
      <div><span className="nid-eyebrow">NISTI PRINT • COMUNICAÇÃO</span>
        <h2>Notificações da Expedição</h2>
        <p>Chame a retirada de capas sem rádio. As solicitações passam pelo monitor em ordem de chegada, por 10 segundos cada.</p>
      </div>
      <a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer" className="nid-outline-link">Abrir monitor ↗</a>
    </header>
    {error&&<div className="nid-message nid-error" role="alert">{error}</div>}
    {success&&<div className="nid-message nid-success" role="status">{success}</div>}

    <div className="nid-admin-grid">
      <form className="nid-panel" onSubmit={send}>
        <span className="nid-section-eyebrow">NOVA CHAMADA</span>
        <h3>Selecione a plataforma</h3>
        <div className="nid-platform-list">
          {PLATFORMS.map(name=><button type="button" key={name}
            onClick={()=>setPlatform(name)}
            aria-pressed={platform===name}
            className={'nid-platform-option '+(platform===name?'selected ':'')+
              (name==='SHOPEE'?'shopee':name==='AMAZON'?'amazon':'ml')}>
            <span className="nid-platform-indicator" aria-hidden="true"/>
            {name}<span className="nid-check">{platform===name?'✓':''}</span>
          </button>)}
        </div>
        <div className="nid-request-summary"><span>Solicitação</span><strong>RETIRAR CAPA</strong></div>
        <button type="submit" className="nid-send" disabled={sending}>
          {sending?'Enviando…':'Enviar notificação'} <span aria-hidden="true">→</span>
        </button>
        <small>Uma chamada por envio. Não há confirmação manual.</small>
      </form>
      <div className="nid-panel nid-operations">
        <span className="nid-section-eyebrow">MONITOR DA EXPEDIÇÃO</span>
        <h3>Situação da transmissão</h3>
        <div className="nid-stats">
          <div><strong>{state?.pending??'—'}</strong><span>Aguardando</span></div>
          <div><strong>{state?.showing??'—'}</strong><span>Na tela</span></div>
          <div><strong>{state?.today??'—'}</strong><span>Hoje</span></div>
        </div>
        <div className="nid-monitor-status">
          <span className={'nid-live-dot '+(monitorOnline?'online':'offline')}/>
          <div><strong>{monitorOnline?'Monitor conectado':state?.monitor_paired?'Monitor offline':'Monitor não ativado'}</strong>
            <small>{monitorOnline?'Recebendo chamadas em tempo real.':'As chamadas ficam na fila enquanto o monitor está ausente.'}</small></div>
        </div>
        <p className="nid-muted">Instale o monitor na expedição e abra a URL exclusiva. Para usar pela primeira vez, gere uma chave de ativação.</p>
        <button type="button" onClick={pair} disabled={pairing} className="nid-secondary">
          {pairing?'Gerando…':state?.monitor_paired?'Substituir chave do monitor':'Gerar chave de ativação'}
        </button>
        {monitorKey&&<div className="nid-key-view" role="status">
          <strong>Chave de ativação — exibida apenas agora</strong>
          <code>{monitorKey}</code>
          <button type="button" onClick={copy} className="nid-secondary">Copiar chave</button>
          <small>{copyMessage||'Cole esta chave na tela do monitor. Uma nova chave invalida a anterior.'}</small>
        </div>}
      </div>
    </div>
    <div className="nid-panel nid-history">
      <div><span className="nid-section-eyebrow">ÚLTIMOS ENVIOS</span><h3>Histórico de chamadas</h3></div>
      {state?.recent?.length?<div className="nid-history-list">
        {state.recent.map(item=><div key={item.id} className="nid-history-row">
          <span className={'nid-history-tag '+(item.platform==='SHOPEE'?'shopee':item.platform==='AMAZON'?'amazon':'ml')}>{item.platform}</span>
          <strong>Retirar capa</strong>
          <span className="nid-muted">{new Date(item.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
          <span className="nid-status">{NAMES[item.status]||item.status}</span>
        </div>)}
      </div>:<p className="nid-muted">Nenhuma chamada enviada ainda.</p>}
      <small className="nid-muted">“Exibida” significa que os 10 segundos terminaram, não que a capa foi retirada.</small>
    </div>
  </section>;
}