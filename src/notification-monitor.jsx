import React,{useCallback,useEffect,useRef,useState} from 'react';
import './notification-dispatch.css';
import { DISPATCH_PLATFORMS,platformColor } from './notification-dispatch-options.js';

const LABELS=Object.fromEntries(DISPATCH_PLATFORMS.map(name=>[name,name.toLowerCase().replace(/\b\w/g,letter=>letter.toUpperCase())]));
const TONES={
  'SHOPEE':[790,980], 'MERCADO LIVRE ANTIGO':[630,760],
  'MERCADO LIVRE NOVO':[700,820], 'MERCADO LIVRE':[630,790],
  'AMAZON':[520,710], 'SHEIN':[660,880], 'TIK TOK':[610,920],
  'MAGALU':[725,910], 'KWAI':[570,845], 'LOJA INTEGRADA':[650,950]
};
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
export default function NotificationMonitor(){
  const [key,setKey]=useState('');
  const [paired,setPaired]=useState(null);
  const [call,setCall]=useState(null);
  const [pending,setPending]=useState(0);
  const [duration,setDuration]=useState(15);
  const [offset,setOffset]=useState(0);
  const [now,setNow]=useState(Date.now());
  const [online,setOnline]=useState(false);
  const [error,setError]=useState('');
  const [audioOn,setAudioOn]=useState(false);
  const [loading,setLoading]=useState(false);
  const audioRef=useRef(null);
  const lastBeepId=useRef(null);
  const pollingRef=useRef(false);
  const audioEnabledRef=useRef(false);
  const nextCallRef=useRef(null);
  const play=useCallback((platform)=>{
    const ctx=audioRef.current;
    if(!audioEnabledRef.current||!ctx||ctx.state!=='running')return false;
    const tones=TONES[platform]||TONES.SHOPEE;
     tones.forEach((frequency,i)=>{
      const oscillator=ctx.createOscillator();
      const gain=ctx.createGain();
      oscillator.type='sine';oscillator.frequency.value=frequency;
      oscillator.connect(gain);gain.connect(ctx.destination);
      const t=ctx.currentTime+i*0.22;
      gain.gain.setValueAtTime(0.0001,t);
      gain.gain.exponentialRampToValueAtTime(0.17,t+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001,t+0.18);
      oscillator.start(t);oscillator.stop(t+0.2);
    });
    return true;
  },[]);
  const poll=useCallback(async()=>{
    if(pollingRef.current)return;
    pollingRef.current=true;
    try{
      const result=await post('/api/dispatch/next');
      const incoming=result.call||null;
       setOffset(Date.parse(result.server_time)-Date.now());
      setCall(incoming);
      setPending(result.pending||0);
      setDuration(result.duration_seconds||15);
      setPaired(true);setOnline(true);setError('');
     }catch(e){
      setOnline(false);setCall(null);
      if(e.status===401){setPaired(false);}
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
  async function activate(e){
    e.preventDefault();setLoading(true);setError('');
    try{
      await post('/api/dispatch/activate',{key});
      setKey('');setPaired(true);
      await poll();
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  }
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
      audioRef.current=null;
      ctx.close().catch(()=>{});
    };
  },[]);
  // Uma chamada só toca uma vez. Se o contexto iniciar um pouco depois da
  // primeira consulta, o alerta ainda toca enquanto a chamada estiver ativa.
  useEffect(()=>{
    if(!audioOn||!call?.id||lastBeepId.current===call.id)return;
    if(remainingSeconds(call.expires_at,offset)>0&&play(call.platform)){
      lastBeepId.current=call.id;
    }
  },[audioOn,call,offset,play]);
  const seconds=call?remainingSeconds(call.expires_at,offset,now):0;
  const current=seconds>0?call:null;
  const color=platformColor(current?.platform);

  if(paired===false)return <main className="nid-monitor nid-setup">
    <div className="nid-pairing-card">
      <span className="nid-brand">NISTI <b>PRINT</b></span>
      <h1>Ativar monitor da expedição</h1>
      <p>Peça à administração a chave em <strong>Notificações da Expedição</strong>. Esta ativação é feita apenas na configuração da tela.</p>
      <form onSubmit={activate}>
        <label htmlFor="nid-monitor-key">Chave do monitor</label>
        <input id="nid-monitor-key" autoComplete="off" spellCheck={false} value={key}
          onChange={e=>setKey(e.target.value.trim().slice(0,64))}
          placeholder="Cole aqui a chave de ativação"/>
        <button disabled={loading||! /^[0-9a-fA-F]{64}$/.test(key)} type="submit" className="nid-send">
          {loading?'Ativando…':'Ativar monitor'}
        </button>
      </form>
      {error&&<p className="nid-monitor-error" role="alert">{error}</p>}
    </div>
  </main>;

  return <main className={'nid-monitor '+(current?'nid-monitor-'+color:'')} aria-label="Monitor NISTI Notificações">
    <header className="nid-monitor-top">
      <span className="nid-brand">NISTI <b>PRINT</b> <small>NOTIFICAÇÕES</small></span>
      <div className="nid-monitor-topright">
        <span className={'nid-monitor-connection '+(online?'is-online':'')}>{online?'● CONECTADO':'● SEM CONEXÃO'}</span>
        <time>{new Date(now).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>
    </header>
    {current?<section className={'nid-live-request '+color} aria-live="polite">
      <div className="nid-call-kicker">SOLICITAÇÃO DA ADMINISTRAÇÃO</div>
      <h1 style={{fontSize:current.platform.length>18?'clamp(38px,6vw,96px)':undefined}}>{LABELS[current.platform]||current.platform}</h1>
      <h2 style={{fontSize:(current.message||'RETIRAR CAPA').length>90?'clamp(28px,3.2vw,58px)':(current.message||'RETIRAR CAPA').length>55?'clamp(32px,4.3vw,76px)':undefined}}>{current.message||'RETIRAR CAPA'}</h2>
      <div className="nid-display-progress">
        <div className="nid-progress-rail"><span style={{width:(Math.min(100,Math.max(0,seconds/duration*100)))+'%'}}/></div>
        <span>{seconds}s</span>
      </div>
    </section>:<section className="nid-idle">
      <div className="nid-idle-orbit" aria-hidden="true"><span>✦</span></div>
      <h1>{online?'Aguardando solicitações':'Conexão indisponível'}</h1>
      <p>{online?'As notificações aparecerão automaticamente.':error||'Tentando reconectar automaticamente ao servidor.'}</p>
    </section>}
    <footer className="nid-monitor-bottom">
      <div>{pending>0?pending+' chamada(s) aguardando na fila':'Nenhuma chamada em espera'}</div>
      <div className="nid-monitor-actions">
        <span className={'nid-audio-indicator '+(audioOn?'active':'blocked')} role="status">
          {audioOn?'Som automático pronto':'Áudio bloqueado pelo navegador'}
        </span>
        {!audioOn&&<button type="button" onClick={enableAudio}>
          Liberar áudio manualmente
        </button>}
        <button type="button" onClick={toggleFullScreen}>Tela cheia</button>
      </div>
    </footer>
  </main>;
}