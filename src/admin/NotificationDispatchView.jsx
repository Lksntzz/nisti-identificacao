import React,{useCallback,useEffect,useRef,useState} from 'react';
import '../notification-dispatch.css';

import { DISPATCH_PLATFORMS,dispatchOptionGroups,dispatchOptionValid,formatDispatchText,platformColor } from '../notification-dispatch-options.js';
const PLATFORMS=DISPATCH_PLATFORMS;
const NAMES={'PENDING':'Na fila','SHOWING':'Em exibição','EXPIRED':'Exibida'};
async function request(path,options={}) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Falha de comunicação com o servidor');
  return data;
}
export default function NotificationDispatchView() {
  const [selected,setSelected]=useState({});
  const [messages,setMessages]=useState({});
  const [config,setConfig]=useState(null);
  const [customOpen,setCustomOpen]=useState(false);
  const [editPlatform,setEditPlatform]=useState('SHOPEE');
  const [draftOptions,setDraftOptions]=useState([]);
  const [newOption,setNewOption]=useState('');
  const [savingOptions,setSavingOptions]=useState(false);
  const selectedOption=name=>messages[name]||'RETIRAR CAPA';
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
  useEffect(()=>{
    let canceled=false;
    request('/api/admin/dispatch/options').then(result=>{
      if(!canceled)setConfig(result.options||{});
    }).catch(error=>{if(!canceled)setError(error.message)});
    return ()=>{canceled=true};
  },[]);
  useEffect(()=>{
    if(config){
      setDraftOptions([...(config[editPlatform]||[])]);
      setNewOption('');
    }
  },[config,editPlatform]);
  function addOption(){
    const label=newOption.trim();
    if(!label||label.length>60||/[\x00-\x1f\x7f]/.test(label)||label.toUpperCase()==='RETIRAR CAPA'
      ||draftOptions.length>=16||draftOptions.some(x=>x.toLowerCase()===label.toLowerCase())){
      setError('Digite uma opção diferente das existentes, com até 60 caracteres (máximo 16).');
      return;
    }
    setDraftOptions(current=>[...current,label]);
    setNewOption('');setError('');
  }
  async function saveOptions(){
    if(savingOptions)return;
    setSavingOptions(true);setError('');setSuccess('');
    try{
      const data=await request('/api/admin/dispatch/options',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({platform:editPlatform,options:draftOptions})
      });
      const next={...(config||{}),[editPlatform]:data.options};
      setConfig(next);
      if(!dispatchOptionValid(editPlatform,selectedOption(editPlatform),next)){
        setMessages(old=>({...old,[editPlatform]:'RETIRAR CAPA'}));
      }
      pendingBatch.current=null;
      setSuccess('Modalidades de '+editPlatform+' salvas no NISTI.');
    }catch(error){setError(error.message)}
    finally{setSavingOptions(false)}
  }

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
    if(!config||platforms.some(name=>!dispatchOptionValid(name,selectedOption(name),config))){
      setError('Selecione uma opção para cada plataforma marcada.');return;
    }
    setSending(true);
    try{
      if(!pendingBatch.current)pendingBatch.current=platforms.map(name=>({
        platform:name,option:selectedOption(name),request_key:crypto.randomUUID()
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
        <h3>1. Selecione as plataformas</h3>
        <p className="nid-muted">Marque as plataformas. A opção universal é <strong>RETIRAR CAPA</strong>; modalidades adicionais são individuais por plataforma.</p>
        <div className="nid-platform-picker" role="group" aria-label="Selecionar plataformas">
          {PLATFORMS.map(name=><label key={name}
            className={'nid-platform-chip '+(selected[name]?'selected ':'')+platformColor(name)}>
            <input type="checkbox" checked={!!selected[name]} onChange={()=>togglePlatform(name)}/>
            <span className="nid-platform-indicator" aria-hidden="true"/>
            <span>{name.toLowerCase().replace(/\b\w/g,letter=>letter.toUpperCase())}</span>
            <span className="nid-chip-tick" aria-hidden="true">{selected[name]?'✓':'+'}</span>
          </label>)}
        </div>
        <div className="nid-selected-modes">
          <div className="nid-selected-heading">
            <strong>2. Escolha a informação para cada plataforma</strong>
            <small>{selectedPlatforms.length} selecionada(s)</small>
          </div>
          {selectedPlatforms.length===0
            ? <div className="nid-modes-empty">Selecione uma plataforma acima para visualizar as modalidades disponíveis.</div>
            :selectedPlatforms.map(platform=><div key={platform} className="nid-mode-item">
              <label htmlFor={'nid-mode-'+platform}>{platform.toLowerCase().replace(/\b\w/g,letter=>letter.toUpperCase())}</label>
              <div className="nid-option-with-preview">
                <select id={'nid-mode-'+platform} value={selectedOption(platform)}
                  onChange={event=>changeMessage(platform,event.target.value)} required>
                  {dispatchOptionGroups(platform,config||{}).map(group=><optgroup key={group.label} label={group.label}>
                    {group.options.map(option=><option key={option} value={option}>{option}</option>)}
                  </optgroup>)}
                </select>
                <small className="nid-preview-line">{formatDispatchText(platform,selectedOption(platform))}</small>
              </div>
            </div>)}
        </div>
        <div className="nid-request-summary">
          <span>Resumo do envio</span><strong>{selectedPlatforms.length} plataforma(s) • 15s cada</strong>
        </div>
        <button type="submit" className="nid-send" disabled={sending||!config||selectedPlatforms.length===0||
          selectedPlatforms.some(name=>!dispatchOptionValid(name,selectedOption(name),config))}>
          {sending?'Enviando…':selectedPlatforms.length>1?'Enviar '+selectedPlatforms.length+' notificações':'Enviar notificação'}
          <span aria-hidden="true">→</span>
        </button>
        <small>Cada plataforma entra separadamente na fila, com som e 15 segundos de exibição.</small>
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
        <div className="nid-settings-section">
          <div className="nid-settings-title">
            <div>
              <span className="nid-section-eyebrow">MODALIDADES POR PLATAFORMA</span>
              <h3>Personalizar informações</h3>
            </div>
            <button type="button" className="nid-secondary" onClick={()=>setCustomOpen(v=>!v)}>
              {customOpen?'Fechar':'Configurar'}
            </button>
          </div>
          <p className="nid-muted">Full não fica disponível em todas as plataformas. Você pode acrescentar ou retirar modalidades próprias de cada canal.</p>
          {customOpen&&<div className="nid-options-editor">
            <label htmlFor="nid-edit-platform">Plataforma a configurar</label>
            <select id="nid-edit-platform" value={editPlatform}
              onChange={event=>setEditPlatform(event.target.value)}>
              {PLATFORMS.map(name=><option key={name} value={name}>{name}</option>)}
            </select>
            <div className="nid-universal-fixed">RETIRAR CAPA <small>Universal · sempre disponível</small></div>
            <div className="nid-edit-chips">
              {draftOptions.length===0?<small>Nenhuma modalidade adicional.</small>
                :draftOptions.map(option=><div className="nid-edit-chip" key={option}>
                  <span>{option}</span>
                  <button type="button" title={'Remover '+option} aria-label={'Remover '+option}
                    onClick={()=>setDraftOptions(xs=>xs.filter(x=>x!==option))}>×</button>
                </div>)}
            </div>
            <div className="nid-add-mode">
              <input value={newOption} maxLength={60}
                onChange={e=>setNewOption(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addOption()}}}
                placeholder="Nova modalidade, ex.: Coleta especial"/>
              <button className="nid-secondary" type="button" onClick={addOption}>Adicionar</button>
            </div>
            <button className="nid-send" type="button" onClick={saveOptions}
              disabled={savingOptions||!config}>
              {savingOptions?'Salvando…':'Salvar modalidades da plataforma'}
            </button>
          </div>}
        </div>
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
          <span className={'nid-history-tag '+platformColor(item.platform)}>{item.platform}</span>
          <strong>{item.message||'RETIRAR CAPA'}</strong>
          <span className="nid-muted">{new Date(item.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
          <span className="nid-status">{NAMES[item.status]||item.status}</span>
        </div>)}
      </div>:<p className="nid-muted">Nenhuma chamada enviada ainda.</p>}
      <small className="nid-muted">“Exibida” significa que os 15 segundos terminaram, não que a solicitação foi atendida.</small>
    </div>
  </section>;
}