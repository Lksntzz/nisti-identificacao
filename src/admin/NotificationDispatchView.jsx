import React,{useCallback,useEffect,useRef,useState} from 'react';
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
  const [selected,setSelected]=useState({'SHOPEE':true,'MERCADO LIVRE':false,'AMAZON':false});
  const [messages,setMessages]=useState({'SHOPEE':'RETIRAR CAPA','MERCADO LIVRE':'RETIRAR CAPA','AMAZON':'RETIRAR CAPA'});
  const pendingBatch=useRef(null);
  const selectedPlatforms=PLATFORMS.filter(name=>selected[name]);
  function togglePlatform(name){
    pendingBatch.current=null;
    setSelected(current=>({...current,[name]:!current[name]}));
    setSuccess('');
  }
  function changeMessage(name,value){
    pendingBatch.current=null;
    setMessages(current=>({...current,[name]:value}));
    setSuccess('');
  }
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
    setSuccess('');setError('');
    const platforms=PLATFORMS.filter(name=>selected[name]);
    if(!platforms.length){setError('Selecione pelo menos uma plataforma.');return;}
    if(platforms.some(name=>!(messages[name]||'').trim())){
      setError('Escreva uma informação para cada plataforma selecionada.');return;
    }
    if(platforms.some(name=>messages[name].trim().length>120)){
      setError('Cada mensagem pode ter no máximo 120 caracteres.');return;
    }
    setSending(true);
    try{
      if(!pendingBatch.current)pendingBatch.current=platforms.map(name=>({
        platform:name,message:messages[name].trim(),request_key:crypto.randomUUID()
      }));
      const data=await request('/api/admin/dispatch/batch',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({calls:pendingBatch.current})
      });
      pendingBatch.current=null;
      setSuccess((data.items?.length||platforms.length)+
        ' notificação(ões) enviada(s). Cada plataforma terá 15 segundos de exibição, uma após a outra.');
      await refresh();
    }catch(e){setError(e.message+' Você pode reenviar sem duplicar a solicitação.');}
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
        <p>Chame a retirada de capas sem rádio. As solicitações passam pelo monitor em ordem de chegada, por 15 segundos cada.</p>
      </div>
      <a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer" className="nid-outline-link">Abrir monitor ↗</a>
    </header>
    {error&&<div className="nid-message nid-error" role="alert">{error}</div>}
    {success&&<div className="nid-message nid-success" role="status">{success}</div>}

    <div className="nid-admin-grid">
      <form className="nid-panel" onSubmit={send}>
        <span className="nid-section-eyebrow">NOVA CHAMADA</span>
        <h3>Selecione uma ou mais plataformas</h3>
        <p className="nid-muted">Marque as plataformas e escreva a informação de cada uma. O monitor exibirá uma de cada vez.</p>
        <div className="nid-platform-list">
          {PLATFORMS.map(name=><div key={name}
            className={'nid-platform-group '+(selected[name]?'active ':'')+
              (name==='SHOPEE'?'shopee':name==='AMAZON'?'amazon':'ml')}>
            <label className="nid-platform-option">
              <input type="checkbox" checked={!!selected[name]} onChange={()=>togglePlatform(name)}/>
              <span className="nid-platform-indicator" aria-hidden="true"/>
              <strong>{name}</strong>
              <span className="nid-check">{selected[name]?'✓':''}</span>
            </label>
            {selected[name]&&<div className="nid-platform-detail">
              <label htmlFor={'nid-message-'+name}>Informação para {name}</label>
              <textarea id={'nid-message-'+name} maxLength={120} rows={2}
                value={messages[name]} onChange={event=>changeMessage(name,event.target.value)}
                placeholder="Ex.: Retirar capa, material pronto, buscar pacote…"/>
              <small>{messages[name].length}/120 caracteres</small>
            </div>}
          </div>)}
        </div>
        <div className="nid-request-summary">
          <span>Resumo do envio</span><strong>{selectedPlatforms.length} plataforma(s) • 15s cada</strong>
        </div>
        <button type="submit" className="nid-send" disabled={sending||selectedPlatforms.length===0||
          selectedPlatforms.some(name=>!(messages[name]||'').trim())}>
          {sending?'Enviando…':selectedPlatforms.length>1?'Enviar '+selectedPlatforms.length+' notificações':'Enviar notificação'}
          <span aria-hidden="true">→</span>
        </button>
        <small>As mensagens entram na fila juntas, mas aparecem individualmente, sem confirmação manual.</small>
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
          <strong>{item.message||'RETIRAR CAPA'}</strong>
          <span className="nid-muted">{new Date(item.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
          <span className="nid-status">{NAMES[item.status]||item.status}</span>
        </div>)}
      </div>:<p className="nid-muted">Nenhuma chamada enviada ainda.</p>}
      <small className="nid-muted">“Exibida” significa que os 15 segundos terminaram, não que a solicitação foi atendida.</small>
    </div>
  </section>;
}