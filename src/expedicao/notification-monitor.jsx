import React,{useCallback,useEffect,useRef,useState} from 'react';
import './notification-dispatch.css';
import { DISPATCH_PLATFORMS,platformColor } from './notification-dispatch-options.js';
import DispatchIcon from './notification-ui/DispatchIcon.jsx';
import MonitorCallBoundary from './notification-monitor-call-boundary.jsx';
import PlatformLogo from './notification-ui/PlatformLogo.jsx';
import { DISPATCH_SOUND_DURATION_SECONDS, playNotificationSound, stopNotificationSound } from './notification-platform-sounds.js';
import { fetchPublishedMonitorBuild, shouldReloadMonitor, MONITOR_BUILD_CHECK_INTERVAL_MS } from './notification-monitor-updates.js';
import { normalizeMonitorFeed } from './notification-monitor-data.js';


const LABELS=Object.fromEntries(DISPATCH_PLATFORMS.map(name=>[name,name.toLowerCase().replace(/\b\w/g,letter=>letter.toUpperCase())]));
async function post(url,body){
  const response=await fetch(url,{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body||{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Erro ao comunicar com o servidor.');error.status=response.status;throw error;}
  return data;
}
export function remainingSeconds(expiresAt,offsetMs,now=Date.now()){
  return Math.max(0,Math.ceil((Date.parse(expiresAt)-(now+offsetMs))/1000));
}
export function dispatchDisplayParts(platform,message){
  const actual=String(message||'RETIRAR CAPA');
  const prefix=platform+' RETIRAR CAPA ';
  if(actual==='RETIRAR CAPA')return {headline:'RETIRAR CAPA',detail:''};
  if(platform&&actual.startsWith(prefix))return {headline:'RETIRAR CAPA',detail:actual.slice(prefix.length)};
  return {headline:actual,detail:''};
}
export default function NotificationMonitor(){
  const [call,setCall]=useState(null);
  const [pending,setPending]=useState(0);
  const [recent,setRecent]=useState([]);
  const [duration,setDuration]=useState(15);
  const [offset,setOffset]=useState(0);
  const [now,setNow]=useState(Date.now());
  const [online,setOnline]=useState(false);
  const [error,setError]=useState('');
  const [audioOn,setAudioOn]=useState(false);
  const audioRef=useRef(null);
  const lastBeepId=useRef(null);
  const pollingRef=useRef(false);
  const audioEnabledRef=useRef(false);
  const nextCallRef=useRef(null);
  const reloadPendingRef=useRef(false);
  const reconnectMarkerRef=useRef(undefined);
  const lastDispatchActivityRef=useRef(Date.now());
  // Elimina fragmentos de links antigos. O monitor não utiliza mais credenciais.
  useEffect(()=>{
    if(/^#acesso=/i.test(window.location.hash)){
      window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
    }
  },[]);
  const play=useCallback((platform,secondsLeft)=>{
    if(!audioEnabledRef.current)return false;
    // Audio API failures must never interrupt the visual notification.
    try{return playNotificationSound(audioRef.current,platform,
      Math.min(DISPATCH_SOUND_DURATION_SECONDS,Math.max(0,secondsLeft-0.1)))}
    catch(error){
      console.warn('[Monitor NISTI] Falha não fatal no som',error?.name||'audio_error');
      audioEnabledRef.current=false;
      setAudioOn(false);
      return false;
    }
  },[]);
  const poll=useCallback(async()=>{
    if(pollingRef.current)return;
    pollingRef.current=true;
    try{
      const result=await post('/api/dispatch/view');
      const feed=normalizeMonitorFeed(result);
      // Uma solicitação do painel autorizado força somente a tela aberta a
      // renovar sua conexão. Após recarregar, a marca torna-se a linha de base.
      const marker=typeof result.reconnect_marker==='string'?result.reconnect_marker:null;
      if(reconnectMarkerRef.current!==undefined && marker!==reconnectMarkerRef.current){
        reconnectMarkerRef.current=marker;
        window.location.reload();
        return;
      }
      reconnectMarkerRef.current=marker;
      const incoming=feed.call;
      const queued=feed.pending;
      const currentTime=Date.now();
      if(incoming||queued>0)lastDispatchActivityRef.current=currentTime;
      setOffset(feed.offset);
      setCall(incoming);
      setPending(queued);
      setRecent(feed.recent);
      setDuration(feed.duration);
      setOnline(!feed.invalidCall);
      setError(feed.invalidCall?'A notificação recebida está incompleta. Aguardando os próximos dados.':'');
      // Uma nova versão somente entra quando a fila estiver vazia e a tela ociosa.
      if(shouldReloadMonitor({
        updateReady:reloadPendingRef.current,online:true,paired:true,
        activeCall:incoming,pending:queued,
        idleMs:currentTime-lastDispatchActivityRef.current
      })){
        reloadPendingRef.current=false;
        window.location.reload();
      }
     }catch(e){
      setOnline(false);setCall(null);
      setError(e.message);
    }finally{pollingRef.current=false}
  },[]);
  nextCallRef.current=poll;
  useEffect(()=>{
    nextCallRef.current?.();
    const timer=setInterval(()=>nextCallRef.current?.(),2000);
    const clock=setInterval(()=>setNow(Date.now()),250);
    const visibility=()=>{if(document.visibilityState==='visible')nextCallRef.current?.()};
    document.addEventListener('visibilitychange',visibility);
    return ()=>{clearInterval(timer);clearInterval(clock);document.removeEventListener('visibilitychange',visibility)};
  },[]);
  useEffect(()=>{
    let canceled=false;
    const check=async()=>{
      const published=await fetchPublishedMonitorBuild();
      if(!canceled&&published&&published!==__NISTI_MONITOR_BUILD_ID__){
        reloadPendingRef.current=true;
      }
    };
    const initial=setTimeout(check,10_000);
    const interval=setInterval(check,MONITOR_BUILD_CHECK_INTERVAL_MS);
    return ()=>{canceled=true;clearTimeout(initial);clearInterval(interval)};
  },[]);
  async function enableAudio(){
    try{
      const ctx=audioRef.current;
      if(!ctx)throw Error('Este navegador não oferece suporte ao áudio.');
      // Somente reserva manual: no terminal configurado, o navegador já inicia
      // o contexto de áudio automaticamente e este botão fica oculto.
      await ctx.resume();
      if(ctx.state!=='running')throw Error('O navegador bloqueou a reprodução.');
      audioEnabledRef.current=true;
      setAudioOn(true);
    }catch{
      setAudioOn(false);
    }
  }
  function toggleFullScreen(){
    if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});
    else document.exitFullscreen?.().catch(()=>{});
  }
  // Inicialização automática: navegadores com autoplay autorizado executam sem clique.
  // Em navegadores comuns que bloqueiam áudio, NÃO simulamos permissão.
  useEffect(()=>{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return undefined;
    let ctx;
    try{ctx=new Audio()}catch{return undefined}
    audioRef.current=ctx;
    let disposed=false;
    const sync=()=>{
      if(disposed)return;
      const running=ctx.state==='running';
      audioEnabledRef.current=running;
      setAudioOn(running);
    };
    ctx.addEventListener?.('statechange',sync);
    sync();
    // Alguns navegadores deixam esta Promise pendente até um gesto humano.
    // Não usamos await e não bloqueamos a fila ou a tela aguardando áudio.
    if(ctx.state==='suspended')ctx.resume().then(sync).catch(sync);
    const visible=()=>{
      if(document.visibilityState==='visible'&&ctx.state==='suspended'){
        ctx.resume().then(sync).catch(sync);
      }
    };
    document.addEventListener('visibilitychange',visible);
    return ()=>{
      disposed=true;
      document.removeEventListener('visibilitychange',visible);
      ctx.removeEventListener?.('statechange',sync);
      audioEnabledRef.current=false;
      stopNotificationSound(ctx);
      audioRef.current=null;
      ctx.close().catch(()=>{});
    };
  },[]);
  // Nunca permite que um aviso antigo siga tocando após sair da fila.
  useEffect(()=>{
    if(!call?.id)stopNotificationSound(audioRef.current);
  },[call?.id]);
  // Toca até 13s por chamada; se o monitor detectar a chamada com atraso,
  // limita o áudio ao tempo restante dos 15s de exibição.
  useEffect(()=>{
    if(!audioOn||!call?.id||lastBeepId.current===call.id)return;
    const secondsLeft=(Date.parse(call.expires_at)-(Date.now()+offset))/1000;
    if(remainingSeconds(call.expires_at,offset)>0&&play(call.platform,secondsLeft)){
      lastBeepId.current=call.id;
    }
  },[audioOn,call,offset,play]);
  const seconds=call?remainingSeconds(call.expires_at,offset,now):0;
  const current=seconds>0?call:null;
  const color=platformColor(current?.platform);


  const details=current?dispatchDisplayParts(current.platform,current.message):null;
  return <main className={'nid-monitor nid-monitor-v5 '+(current?'nid-monitor-'+color:'')} aria-label="Monitor NISTI Notificações">
    <div className="nid-stage-glow" aria-hidden="true"/>
    <header className="nid-monitor-top">
      <div className="nid-brand-block"><span className="nid-brand">NISTI <b>PRINT</b></span><small>CENTRAL DE EXPEDIÇÃO</small></div>
      <div className="nid-monitor-topright">
        <span className={'nid-monitor-connection '+(online?'is-online':'')}><span className="nid-connection-pulse"/> {online?'MONITOR CONECTADO':'SEM CONEXÃO'}</span>
        <div className="nid-clock-block"><strong>{new Date(now).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</strong>
          <small>{new Date(now).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})}</small>
        </div>
      </div>
    </header>
    <div className="nid-monitor-workspace">
      <div className="nid-monitor-stage">
    {current?<MonitorCallBoundary key={current.id} platform={current.platform} message={current.message}><section className="nid-live-request nid-live-v5" aria-live="polite">
      <div className="nid-call-kicker">NOVA SOLICITAÇÃO <span className="nid-kicker-spark">●</span> EXPEDIÇÃO</div>
      <div className={'nid-channel-emblem '+color}><PlatformLogo platform={current.platform} size="large"/></div>
      <div className="nid-call-platform">{LABELS[current.platform]||current.platform}</div>
      <div className="nid-live-message-card">
        <div className={'nid-message-main'+(details.headline.length>45?' nid-message-main-long':'')}>{details.headline}</div>
        {details.detail&&<div className="nid-message-mode"><span className="nid-monitor-mode-safe">{details.detail}</span></div>}
      </div>
      <div className="nid-display-progress" aria-label={seconds+' segundos restantes'}>
        <div className="nid-progress-rail"><span style={{width:(Math.min(100,Math.max(0,seconds/duration*100)))+'%'}}/></div>
        <strong>{seconds}s</strong>
      </div>
    </section></MonitorCallBoundary>:<section className="nid-idle nid-idle-v5">
      <div className="nid-idle-emblem" aria-hidden="true"><DispatchIcon name="bell-ring" size={49} strokeWidth={1.5}/></div>
      <h1>{online?'Aguardando solicitações':'Conexão indisponível'}</h1>
      <p>{online?'O monitor exibirá as chamadas automaticamente assim que chegarem.':error||'Tentando reconectar ao servidor.'}</p>
      {online&&<span className="nid-idle-waiting">● PRONTO PARA RECEBER</span>}
    </section>}
      </div>
      <aside className="nid-monitor-history" aria-label="Histórico de notificações da expedição">
        <div className="nid-monitor-history-heading">
          <span className="nid-monitor-history-heading-icon"><DispatchIcon name="list-check" size={19}/></span>
          <div><strong>Histórico recente</strong><small>Últimas chamadas exibidas</small></div>
          <span className="nid-monitor-history-count">{recent.length}</span>
        </div>
        <div className="nid-monitor-history-list">
          {recent.length===0?<p className="nid-monitor-history-empty">
            Nenhuma notificação exibida recentemente.
          </p>:recent.map(item=><div className={'nid-monitor-history-item'+(item.status==='SHOWING'?' is-showing':'')} key={item.id}>
            <PlatformLogo platform={item.platform}/>
            <div className="nid-monitor-history-details">
              <strong>{LABELS[item.platform]||item.platform}</strong>
              <span>{item.message}</span>
              <div className="nid-monitor-history-meta">
                <time dateTime={item.started_at}>{new Date(item.started_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>
                <span className={'nid-monitor-history-state'+(item.status==='SHOWING'?' is-showing':'')}>
                  {item.status==='SHOWING'?'Em exibição':'Exibida'}
                </span>
              </div>
            </div>
          </div>)}
        </div>
        <div className="nid-monitor-history-foot">Atualização automática · Somente leitura</div>
      </aside>
    </div>
    <footer className="nid-monitor-bottom nid-monitor-footer-v5">
      <div className="nid-footer-queue"><DispatchIcon name="list-check" size={21}/>
        <span>{pending>0?pending+' chamada(s) aguardando na fila':'Nenhuma chamada em espera'}</span></div>
      <div className="nid-monitor-actions">
        <span className={'nid-audio-indicator '+(audioOn?'active':'blocked')} role="status"><DispatchIcon name="volume-2" size={17}/>
          {audioOn?'Som automático pronto · 13s':'Áudio bloqueado pelo navegador'}</span>
        {!audioOn&&<button type="button" onClick={enableAudio}>Liberar áudio</button>}
        <button type="button" onClick={toggleFullScreen} className="nid-fullscreen-action"><DispatchIcon name="monitor" size={17}/> Tela cheia</button>
      </div>
    </footer>
  </main>;
}