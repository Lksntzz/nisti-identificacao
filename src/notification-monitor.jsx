import React,{useCallback,useEffect,useRef,useState} from 'react';
import './notification-dispatch.css';

const LABELS={'SHOPEE':'Shopee','MERCADO LIVRE':'Mercado Livre','AMAZON':'Amazon'};
const TONES={'SHOPEE':[790,980],'MERCADO LIVRE':[630,790],'AMAZON':[520,710]};
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
  const [offset,setOffset]=useState(0);
  const [now,setNow]=useState(Date.now());
  const [online,setOnline]=useState(false);
  const [error,setError]=useState('');
  const [audioOn,setAudioOn]=useState(false);
  const [loading,setLoading]=useState(false);
  const audioRef=useRef(null);
  const lastCallId=useRef(null);
  const pollingRef=useRef(false);
  const audioEnabledRef=useRef(false);
  const nextCallRef=useRef(null);
  const play=useCallback((platform)=>{
    const ctx=audioRef.current;
    if(!audioEnabledRef.current||!ctx)return;
    const tones=TONES[platform]||TONES.SHOPEE;
    if(ctx.state==='suspended')ctx.resume().catch(()=>{});
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
  },[]);
  const poll=useCallback(async()=>{
    if(pollingRef.current)return;
    pollingRef.current=true;
    try{
      const result=await post('/api/dispatch/next');
      const incoming=result.call||null;
      const previous=lastCallId.current;
      setOffset(Date.parse(result.server_time)-Date.now());
      setCall(incoming);
      setPending(result.pending||0);
      setPaired(true);setOnline(true);setError('');
      if(incoming?.id!==undefined && incoming.id!==null && incoming.id!==previous){
        lastCallId.current=incoming.id;
        // Never beep on a repeat poll for the same call.
        play(incoming.platform);
      }
      if(!incoming)lastCallId.current=null;
    }catch(e){
      setOnline(false);setCall(null);
      if(e.status===401){setPaired(false);lastCallId.current=null;}
      setError(e.message);
    }finally{pollingRef.current=false}
  },[play]);
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
      setKey('');setPaired(true);lastCallId.current=null;
      await poll();
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  }
  async function enableAudio(){
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw Error('Este navegador não oferece suporte ao áudio.');
      if(!audioRef.current)audioRef.current=new Audio();
      await audioRef.current.resume();
      audioEnabledRef.current=true;setAudioOn(true);
      play('SHOPEE');
    }catch{setError('Áudio bloqueado. Verifique as permissões de som do navegador.')}
  }
  function toggleFullScreen(){
    if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});
    else document.exitFullscreen?.().catch(()=>{});
  }
  useEffect(()=>()=>{audioRef.current?.close().catch(()=>{})},[]);
  const seconds=call?remainingSeconds(call.expires_at,offset,now):0;
  const current=seconds>0?call:null;
  const color=current?.platform==='SHOPEE'?'shopee':current?.platform==='AMAZON'?'amazon':'ml';

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
      <h1>{LABELS[current.platform]||current.platform}</h1>
      <h2>RETIRAR CAPA</h2>
      <div className="nid-display-progress">
        <div className="nid-progress-rail"><span style={{width:(seconds*10)+'%'}}/></div>
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
        <button type="button" onClick={enableAudio} disabled={audioOn}>
          {audioOn?'Som ativado':'Ativar som'}
        </button>
        <button type="button" onClick={toggleFullScreen}>Tela cheia</button>
      </div>
    </footer>
  </main>;
}