import React,{useCallback,useEffect,useRef,useState} from 'react';
import '../notification-dispatch.css';
import DispatchIcon from '../notification-ui/DispatchIcon.jsx';
import PlatformLogo from '../notification-ui/PlatformLogo.jsx';
import { submitDispatchNotifications } from '../notification-dispatch-send.js';

import { DISPATCH_PLATFORMS,dispatchOptionGroups,dispatchOptionValid,formatDispatchText,platformColor } from '../notification-dispatch-options.js';
const PLATFORMS=DISPATCH_PLATFORMS;
const NAMES={'PENDING':'Na fila','SHOWING':'Em exibição','EXPIRED':'Exibida'};
const titleCase=name=>name.toLowerCase().replace(/\b\w/g,x=>x.toUpperCase());
function ChannelMark({platform}){return <PlatformLogo platform={platform} className="nid-channel-mark"/>}

async function request(path,options={}) {
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Falha de comunicação com o servidor');
  return data;
}
const API_ENDPOINTS={
  admin:{status:'/api/admin/dispatch',options:'/api/admin/dispatch/options',batch:'/api/admin/dispatch/batch',connect:'/api/admin/dispatch/connect'},
  sender:{status:'/api/expedition-panel',options:'/api/expedition-panel/options',batch:'/api/expedition-panel/batch',connect:'/api/expedition-panel/connect'}
};
export default function NotificationDispatchView({senderMode=false}) {
  const endpoints=senderMode?API_ENDPOINTS.sender:API_ENDPOINTS.admin;
  const [selected,setSelected]=useState({});
  const [messages,setMessages]=useState({});
  const [config,setConfig]=useState(null);
  const [customOpen,setCustomOpen]=useState(false);
  const [tab,setTab]=useState('send');
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
  const [connecting,setConnecting]=useState(false);
  const [monitorUrlCopied,setMonitorUrlCopied]=useState(false);
  useEffect(()=>{
    let canceled=false;
    request(endpoints.options).then(result=>{
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
      const data=await request(endpoints.options,{
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

  const refresh=useCallback(async({silent=false}={})=>{
    try {
      const response=await request(endpoints.status);
      setState(response);
      if(!silent)setError('');
    }catch(e){if(!silent)setError(e.message)}
  },[senderMode]);
  useEffect(()=>{
    refresh();
    const timer=setInterval(refresh,8000);
    return ()=>clearInterval(timer);
  },[refresh]);

  async function connectMonitor(){
    if(connecting)return;
    setConnecting(true);setError('');setSuccess('');
    try{
      const response=await request(endpoints.connect,{method:'POST'});
      // A presença do notebook vem do último heartbeat real, não do clique.
      await refresh({silent:true});
      if(response.online){
        setSuccess('Solicitação de reconexão enviada ao monitor. A tela aberta deve atualizar em alguns segundos.');
      }else{
        setError('Solicitação registrada, mas o notebook está offline. Abra o endereço do monitor no notebook para conectar.');
      }
    }catch(e){setError('Não foi possível solicitar conexão ao monitor: '+e.message)}
    finally{setConnecting(false)}
  }
  async function copyMonitorUrl(){
    try{
      await navigator.clipboard.writeText(window.location.origin+'/monitor-notificacoes');
      setMonitorUrlCopied(true);
      setSuccess('Endereço do monitor copiado. Abra no notebook da expedição.');
    }catch{setError('Copie o endereço do monitor: '+window.location.origin+'/monitor-notificacoes')}
  }
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
      const result=await submitDispatchNotifications({
        platforms,
        optionFor:selectedOption,
        fetchOptions:()=>request(endpoints.options),
        enqueue:calls=>request(endpoints.batch,{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({calls})
        }),
        pendingBatch
      });
      setConfig(result.options);
      if(result.state==='options_changed'){
        setError('A modalidade de '+result.unavailable.map(titleCase).join(', ')+
          ' foi alterada ou removida por outra pessoa. Atualizamos as opções: escolha uma modalidade disponível e envie novamente.');
        return;
      }
      const data=result.data;
      setSuccess((data.items?.length||platforms.length)+
        ' notificação(ões) confirmada(s) e enviada(s) à fila. Cada plataforma terá 15 segundos de exibição.');
      // Atualizar os contadores é independente da operação que já foi gravada.
      // Se o histórico estiver indisponível, não anunciar falsamente erro de envio.
      await refresh({silent:true});
    }catch(e){
      if(/modalidade inválida|modalidade válida|dispatch_option_not_allowed/i.test(e.message)){
        const updated=await request(endpoints.options).catch(()=>null);
        if(updated?.options){
          setConfig(updated.options);
          if(platforms.some(name=>!dispatchOptionValid(name,selectedOption(name),updated.options))){
            pendingBatch.current=null;
          }
        }
        setError('Esta modalidade não está disponível para envio. As opções foram atualizadas; confira a seleção antes de tentar novamente.');
      }else{
        setError(e.message+' Se a confirmação falhou, confira Fila e histórico antes de tentar novamente.');
      }
    }finally{setSending(false)}
  }
  const monitorOnline=state?.monitor_last_seen
    && Date.now()-Date.parse(state.monitor_last_seen)<15000;

  const preview=selectedPlatforms.map(platform=>({platform,option:selectedOption(platform),
    message:formatDispatchText(platform,selectedOption(platform))}));
  const editor=<div className="nid-panel nid-custom-panel">
    <div className="nid-panel-title-row">
      <div>
        <span className="nid-section-eyebrow">PERSONALIZAÇÃO</span>
        <h3>Informações por plataforma</h3>
        <p className="nid-muted">Configure só as modalidades utilizadas. “RETIRAR CAPA” permanece universal em todas as plataformas.</p>
      </div>
      <DispatchIcon name="settings-2" size={23}/>
    </div>
    <div className="nid-custom-workspace">
      <div className="nid-custom-channels" role="group" aria-label="Plataforma para personalizar">
        {PLATFORMS.map(name=><button key={name} type="button"
          className={'nid-custom-channel '+(name===editPlatform?'active':'')}
          onClick={()=>setEditPlatform(name)}>
          <ChannelMark platform={name}/><span>{titleCase(name)}</span>
          {name===editPlatform&&<DispatchIcon name="check" size={17}/>}
        </button>)}
      </div>
      <div className="nid-custom-editor">
        <div className="nid-custom-editor-heading">
          <ChannelMark platform={editPlatform}/>
          <div><h4>{titleCase(editPlatform)}</h4>
            <span>{draftOptions.length} modalidade(s) personalizadas</span>
          </div>
        </div>
        <div className="nid-universal-fixed"><DispatchIcon name="check" size={18}/> RETIRAR CAPA
          <small>Universal · não pode ser removida</small></div>
        <div className="nid-custom-section-label">MODALIDADES DISPONÍVEIS</div>
        <div className="nid-edit-list">
          {draftOptions.length===0?<p className="nid-muted">Nenhuma modalidade extra. Use o campo abaixo para adicionar.</p>
            :draftOptions.map(option=><div className="nid-edit-chip" key={option}>
              <span>{option}</span>
              <button type="button" title={'Remover '+option} aria-label={'Remover '+option}
                onClick={()=>setDraftOptions(current=>current.filter(x=>x!==option))}>
                <DispatchIcon name="x" size={17}/>
              </button>
            </div>)}
        </div>
        <label className="nid-input-label" htmlFor="nid-custom-new-option">Adicionar modalidade</label>
        <div className="nid-add-mode">
          <input id="nid-custom-new-option" value={newOption} maxLength={60}
            onChange={e=>setNewOption(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addOption()}}}
            placeholder="Ex.: Coleta especial"/>
          <button className="nid-secondary" type="button" onClick={addOption}>
            <DispatchIcon name="plus" size={18}/> Adicionar
          </button>
        </div>
        <div className="nid-editor-actions">
          <button className="nid-send" type="button" onClick={saveOptions}
            disabled={savingOptions||!config}>
            <DispatchIcon name="check" size={19}/>
            {savingOptions?'Salvando…':'Salvar modalidades'}
          </button>
        </div>
      </div>
    </div>
  </div>;
  return <section className="nid-admin nid-admin-v5" aria-label="Central de Notificações da Expedição">
    <header className="nid-admin-heading nid-dashboard-header">
      <div className="nid-heading-copy">
        <span className="nid-section-eyebrow">NISTI PRINT <span className="nid-eyebrow-sep">/</span> COMUNICAÇÃO</span>
        <h2>NISTI Notificações</h2>
        <p>Central de comunicação da expedição</p>
      </div>
      <div className="nid-header-tools">
        <span className={'nid-monitor-health '+(monitorOnline?'online':'offline')}>
          <span className="nid-live-dot"/>{monitorOnline?'Monitor conectado':'Monitor desconectado'}
        </span>
        {!senderMode&&<a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer" className="nid-outline-link">
          <DispatchIcon name="monitor" size={17}/> Abrir monitor <DispatchIcon name="external-link" size={15}/>
        </a>}
      </div>
    </header>
    {error&&<div className="nid-message nid-error" role="alert">{error}</div>}
    {success&&<div className="nid-message nid-success" role="status">{success}</div>}
    <div className="nid-kpi-grid" aria-label="Indicadores da expedição">
      {[
        {icon:'list-check',count:state?.pending??'—',title:'Na fila',tone:'pink'},
        {icon:'bell-ring',count:state?.showing??'—',title:'Em exibição',tone:'blue'},
        {icon:'clock-3',count:'15s',title:'Por notificação',tone:'indigo'},
        {icon:'send',count:state?.today??'—',title:'Enviadas hoje',tone:'green'}
      ].map((item,i)=><div key={item.title} className="nid-kpi" style={{'--nid-stagger':i}}>
        <span className={'nid-kpi-icon '+item.tone}><DispatchIcon name={item.icon} size={22}/></span>
        <div><strong>{item.count}</strong><small>{item.title}</small></div>
      </div>)}
    </div>
    <nav className="nid-views" aria-label="Seções da central de notificações">
      {[
        {id:'send',label:'Enviar notificações',icon:'send'},
        {id:'history',label:'Fila e histórico',icon:'list-check'},
        {id:'settings',label:'Personalizar informações',icon:'settings-2'}
      ].map(entry=><button key={entry.id} type="button" aria-current={tab===entry.id?'page':undefined}
        className={'nid-tab '+(tab===entry.id?'active':'')} onClick={()=>setTab(entry.id)}>
        <DispatchIcon name={entry.icon} size={17}/>{entry.label}
      </button>)}
    </nav>
    {tab==='send'&&<div className="nid-admin-grid nid-main-grid">
      <form className="nid-panel nid-send-panel" onSubmit={send}>
        <div className="nid-step-head"><span className="nid-step-number">1</span><div>
          <h3>Selecionar plataformas</h3>
          <p className="nid-muted">Escolha uma ou mais plataformas para enviar notificações.</p>
        </div></div>
        <div className="nid-platform-picker" role="group" aria-label="Selecionar plataformas">
          {PLATFORMS.map(name=><label key={name}
            className={'nid-platform-chip '+(selected[name]?'selected ':'')+platformColor(name)}>
            <input type="checkbox" checked={!!selected[name]} onChange={()=>togglePlatform(name)}/>
            <ChannelMark platform={name}/>
            <span className="nid-platform-name">{titleCase(name)}</span>
            <span className="nid-chip-tick" aria-hidden="true">
              {selected[name]&&<DispatchIcon name="check" size={14}/>}
            </span>
          </label>)}
        </div>
        <div className="nid-selected-modes">
          <div className="nid-step-head"><span className="nid-step-number">2</span><div>
            <h3>Definir as informações</h3>
            <p className="nid-muted">Cada plataforma pode receber uma modalidade diferente.</p>
          </div></div>
          {selectedPlatforms.length===0?<div className="nid-modes-empty">
            <DispatchIcon name="bell-ring" size={22}/>
            Selecione ao menos uma plataforma acima.
          </div>:selectedPlatforms.map(platform=><div key={platform} className="nid-mode-item">
            <div className="nid-mode-channel"><ChannelMark platform={platform}/>
              <label htmlFor={'nid-mode-'+platform}>{titleCase(platform)}</label>
            </div>
            <div className="nid-option-with-preview">
              <select id={'nid-mode-'+platform} value={selectedOption(platform)}
                onChange={event=>changeMessage(platform,event.target.value)} required>
                {dispatchOptionGroups(platform,config||{}).map(group=><optgroup key={group.label} label={group.label}>
                  {group.options.map(option=><option key={option} value={option}>{option}</option>)}
                </optgroup>)}
              </select>
              <div className="nid-preview-line"><small>Como aparecerá no monitor:</small>
                <strong>{formatDispatchText(platform,selectedOption(platform))}</strong></div>
            </div>
          </div>)}
        </div>
        <div className="nid-send-footer">
          <div><strong>{selectedPlatforms.length} plataforma(s) selecionada(s)</strong>
            <small>Uma notificação a cada 15 segundos, em ordem de envio.</small>
          </div>
          <button type="submit" className="nid-send"
            disabled={sending||!config||selectedPlatforms.length===0||
              selectedPlatforms.some(name=>!dispatchOptionValid(name,selectedOption(name),config))}>
            <DispatchIcon name="send" size={18}/>
            {sending?'Enviando…':selectedPlatforms.length>1?'Enviar '+selectedPlatforms.length+' notificações':'Enviar notificação'}
          </button>
        </div>
      </form>
      <aside className="nid-side-column">
        <div className="nid-panel nid-preview-panel">
          <div className="nid-panel-title-row"><div>
            <span className="nid-section-eyebrow">PRÉVIA DE ENVIO</span>
            <h3>Ordem de exibição</h3>
          </div><DispatchIcon name="list-check" size={22}/></div>
          {preview.length===0?<div className="nid-preview-empty">Nenhuma chamada selecionada.</div>
            :<div className="nid-preview-queue">{preview.map((item,i)=><div className="nid-preview-queue-row" key={item.platform}>
              <span className="nid-queue-index">{i+1}</span><ChannelMark platform={item.platform}/>
              <div><strong>{titleCase(item.platform)}</strong><small>{item.message}</small></div>
            </div>)}</div>}
        </div>
        <div className="nid-panel nid-monitor-sidepanel">
          <div className="nid-panel-title-row"><div>
            <span className="nid-section-eyebrow">MONITOR DA EXPEDIÇÃO</span>
            <h3>Status da transmissão</h3>
          </div><DispatchIcon name="monitor" size={21}/></div>
          <div className={'nid-monitor-inline-status '+(monitorOnline?'online':'offline')}>
            <span className="nid-live-dot"/><div>
              <strong>{monitorOnline?'Monitor conectado':'Monitor desconectado'}</strong>
              <small>{monitorOnline?'Recebendo notificações':'As chamadas ficam na fila enquanto o monitor está ausente.'}</small>
            </div>
          </div>
          <p className="nid-muted">O monitor precisa estar aberto no notebook. A conexão é verificada automaticamente.</p>
          <div className="nid-monitor-connect-actions">
            <button type="button" className="nid-secondary nid-connect-monitor" onClick={connectMonitor} disabled={connecting}>
              <DispatchIcon name="wifi" size={17}/>{connecting?'Conectando…':'Conectar'}
            </button>
            {senderMode&&<button type="button" className="nid-secondary nid-monitor-copy-url" onClick={copyMonitorUrl}>
              <DispatchIcon name="copy" size={15}/>{monitorUrlCopied?'Link copiado':'Copiar link do monitor'}
            </button>}
          </div>
          {!senderMode&&<a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer" className="nid-outline-link">
            <DispatchIcon name="monitor" size={17}/> Abrir monitor
          </a>}
        </div>
      </aside>
    </div>}
    {tab==='history'&&<div className="nid-panel nid-history nid-history-v5">
      <div className="nid-panel-title-row"><div>
        <span className="nid-section-eyebrow">CHAMADAS DA EXPEDIÇÃO</span>
        <h3>Fila e histórico</h3>
        <p className="nid-muted">A exibição termina após 15 segundos; isso não confirma a retirada.</p>
      </div><button type="button" className="nid-secondary" onClick={refresh}>
        <DispatchIcon name="clock-3" size={17}/> Atualizar
      </button></div>
      <div className="nid-history-list">
        {state?.recent?.length?state.recent.map(item=><div key={item.id} className="nid-history-row">
          <ChannelMark platform={item.platform}/>
          <div className="nid-history-details"><strong>{titleCase(item.platform)}</strong>
            <span>{item.message||'RETIRAR CAPA'}</span></div>
          <span className="nid-history-clock">{new Date(item.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
          <span className={'nid-status nid-status-'+String(item.status||'').toLowerCase()}>{NAMES[item.status]||item.status}</span>
        </div>):<p className="nid-muted">Nenhuma chamada registrada ainda.</p>}
      </div>
    </div>}
    {tab==='settings'&&<div className={'nid-settings-grid'+(senderMode?' nid-sender-settings':'')}>
      {editor}
      {!senderMode&&<div className="nid-panel nid-monitor-setup-panel">
        <span className="nid-section-eyebrow">MONITOR DA EXPEDIÇÃO</span>
        <h3>Acesso direto ao monitor</h3>
        <div className="nid-monitor-inline-status">
          <span className={'nid-live-dot '+(monitorOnline?'online':'')}/>
          <strong>{monitorOnline?'Monitor conectado':'Monitor desconectado'}</strong>
        </div>
        <p className="nid-muted">A tela do monitor abre sem senha, chave, código ou autorização. Configure o endereço abaixo como URL inicial do Microsoft Edge no Modo Quiosque.</p>
        <label className="nid-input-label" htmlFor="nid-monitor-public-url">URL fixa do monitor</label>
        <input id="nid-monitor-public-url" type="text" value={window.location.origin+'/monitor-notificacoes'}
          readOnly spellCheck={false} onFocus={event=>event.currentTarget.select()} />
        <p className="nid-muted">Quem tiver este endereço poderá visualizar as notificações. Enviar chamadas e alterar configurações continuam exigindo acesso autorizado.</p>
        <a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer" className="nid-outline-link">
          <DispatchIcon name="monitor" size={17}/> Abrir monitor <DispatchIcon name="external-link" size={14}/>
        </a>
      </div>}
    </div>}
  </section>;
}