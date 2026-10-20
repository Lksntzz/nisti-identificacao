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
export function normalizeMonitorFeed(result){
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Resposta inválida do servidor de notificações.');
  const call=result.call==null?null:normalizeMonitorCall(result.call);
  const pending=Number(result.pending);
  const duration=Number(result.duration_seconds);
  const serverTime=Date.parse(result.server_time);
  return {
    call,
    invalidCall:result.call!=null&&!call,
    pending:Number.isSafeInteger(pending)&&pending>=0?Math.min(pending,10000):0,
    duration:Number.isFinite(duration)&&duration>0&&duration<=3600?duration:15,
    offset:Number.isFinite(serverTime)?serverTime-Date.now():0
  };
}
