import { DISPATCH_PLATFORMS } from './notification-dispatch-options.js';

// Monitor feed is a transport boundary, not trusted React content.
// Bad payloads must never crash an unattended expedition screen.
export function normalizeMonitorCall(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return null;
  if(typeof value.platform!=='string'||!DISPATCH_PLATFORMS.includes(value.platform))return null;
  const expires=typeof value.expires_at==='string'?value.expires_at:'';
  if(!expires||!Number.isFinite(Date.parse(expires)))return null;
  const id=(typeof value.id==='string'||typeof value.id==='number')?String(value.id):'';
  if(!id.trim())return null;
  const message=typeof value.message==='string'&&value.message.trim()
    ?value.message:'RETIRAR CAPA';
  return {
    id,platform:value.platform,expires_at:expires,message,
    started_at:typeof value.started_at==='string'?value.started_at:null
  };
}
// Public history contains only previously displayed calls, never pending items.
export function normalizeMonitorHistory(value){
  if(!Array.isArray(value))return [];
  const seen=new Set();
  const items=[];
  for(const raw of value.slice(0,32)){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const id=(typeof raw.id==='number'&&Number.isSafeInteger(raw.id)&&raw.id>0)
      ||(typeof raw.id==='string'&&/^\\d{1,18}$/.test(raw.id))?String(raw.id):null;
    if(!id||seen.has(id)||!DISPATCH_PLATFORMS.includes(raw.platform))continue;
    if(raw.status!=='SHOWING'&&raw.status!=='EXPIRED')continue;
    const started=typeof raw.started_at==='string'?raw.started_at:'';
    if(!started||!Number.isFinite(Date.parse(started)))continue;
    const message=typeof raw.message==='string'&&raw.message.trim()
      ?raw.message.slice(0,250):'RETIRAR CAPA';
    seen.add(id);
    items.push({id,platform:raw.platform,message,started_at:started,status:raw.status});
    if(items.length===8)break;
  }
  return items;
}
export function normalizeMonitorFeed(result){
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Resposta inválida do servidor de notificações.');
  const call=result.call==null?null:normalizeMonitorCall(result.call);
  const pending=Number(result.pending);
  const duration=Number(result.duration_seconds);
  const serverTime=Date.parse(result.server_time);
  return {
    call,
    invalidCall:result.call!=null&&!call,
    recent:normalizeMonitorHistory(result.recent),
    pending:Number.isSafeInteger(pending)&&pending>=0?Math.min(pending,10000):0,
    duration:Number.isFinite(duration)&&duration>0&&duration<=3600?duration:15,
    offset:Number.isFinite(serverTime)?serverTime-Date.now():0
  };
}
