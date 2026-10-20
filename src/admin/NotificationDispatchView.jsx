import React,{useCallback,useEffect,useRef,useState} from 'react';
import '../notification-dispatch.css';
import DispatchIcon from '../notification-ui/DispatchIcon.jsx';
import PlatformLogo from '../notification-ui/PlatformLogo.jsx';

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
  admin:{status:'/api/admin/dispatch',options:'/api/admin/dispatch/options',batch:'/api/admin/dispatch/batch',monitorKey:'/api/admin/dispatch/monitor-key'},
  sender:{status:'/api/expedition-panel',options:'/api/expedition-panel/options',batch:'/api/expedition-panel/batch'}
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
  const [pairing,setPairing]=useState(false);
  const [pendingMonitors,setPendingMonitors]=useState([]);
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
    if(senderMode||savingOptions)return;
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
      const [response,monitors]=await Promise.all([
        request(endpoints.status),
        senderMode?Promise.resolve(null):request('/api/admin/dispatch/pair/pending')
      ]);
      setState(response);
      if(monitors)setPendingMonitors(monitors.requests||[]);
      setError('');
    }catch(e){setError(e.message)}
  },[senderMode]);
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
      const data=await request(endpoints.batch,{
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
  async function approvePair(id,code){
    if(senderMode||pairing)return;
    if(!window.confirm('Confirma que o código '+code+' aparece no notebook da expedição?'
      +(state?.monitor_paired?' O monitor anterior será desconectado.':'')))return;
    setPairing(true);setError('');setSuccess('');
    try {
      await request('/api/admin/dispatch/pair/approve',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({id})
      });
      setSuccess('Monitor '+code+' autorizado. Aguarde a conexão no notebook.');
      await refresh();
    }catch(error){setError(error.message)}
    finally{setPairing(false)}
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
        ...(!senderMode?[{id:'settings',label:'Personalizar informações',icon:'settings-2'}]:[])
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
              <strong>{monitorOnline?'Monitor conectado':state?.monitor_paired?'Monitor offline':'Monitor não ativado'}</strong>
              <small>{monitorOnline?'Recebendo notificações':'As chamadas ficam na fila enquanto o monitor está ausente.'}</small>
            </div>
          </div>
          <p className="nid-muted">O painel permanece ativo na tela dedicada. Som e exibição são controlados pelo monitor.</p>
          {!senderMode&&<button type="button" className="nid-secondary nid-pair-link" onClick={()=>setTab('settings')}>
            <DispatchIcon name="settings-2" size={17}/> Configurar monitor
          </button>}
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
    {!senderMode&&tab==='settings'&&<div className="nid-settings-grid">
      {editor}
      <div className="nid-panel nid-monitor-setup-panel">
        <span className="nid-section-eyebrow">MONITOR DA EXPEDIÇÃO</span>
        <h3>Conexão e ativação</h3>
        <div className="nid-monitor-inline-status">
          <span className={'nid-live-dot '+(monitorOnline?'online':'')}/>
          <strong>{monitorOnline?'Monitor conectado':state?.monitor_paired?'Monitor offline':'Monitor não ativado'}</strong>
        </div>
        <p className="nid-muted">Abra o monitor no notebook e aguarde aparecer o código de autorização. Confira o mesmo código abaixo antes de aprovar. Nenhuma chave precisa ser digitada no notebook.</p>
        <div className="nid-panel-title-row">
          <strong>Notebooks aguardando autorização</strong>
          <button type="button" className="nid-secondary" onClick={refresh}>
            <DispatchIcon name="clock-3" size={16}/> Atualizar
          </button>
        </div>
        {pendingMonitors.length===0?<p className="nid-muted" role="status">Nenhuma solicitação pendente. Abra a tela de notificações no notebook e aguarde alguns segundos.</p>
          :<div className="nid-pending-monitor-list">{pendingMonitors.map(item=>
            <div className="nid-pending-monitor" key={item.id}>
              <div><small>CÓDIGO EXIBIDO NO NOTEBOOK</small><strong>{item.code}</strong>
                <small>Expira em {new Date(item.expires_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small>
              </div>
              <button type="button" className="nid-send" disabled={pairing}
                onClick={()=>approvePair(item.id,item.code)}>
                <DispatchIcon name="check" size={17}/>
                {pairing?'Aguarde…':'Ativar monitor'}
              </button>
            </div>)}</div>}
        <a href="/monitor-notificacoes" target="_blank" rel="noopener noreferrer" className="nid-outline-link">
          <DispatchIcon name="monitor" size={17}/> Abrir monitor <DispatchIcon name="external-link" size={14}/>
        </a>
      </div>
    </div>}
  </section>;
}