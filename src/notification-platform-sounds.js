// Alertas auditivos exclusivos por canal. Os tempos são relativos ao AudioContext.
import { DISPATCH_PLATFORMS } from './notification-dispatch-options.js';

// Notas [frequencia Hz, atraso s, duracao s]. Cada canal tem contorno e ritmo
// proprios (incluindo as tres filas Mercado Livre), sem arquivos ou CDN.
export const DISPATCH_SOUND_PATTERNS={
  'SHOPEE':{wave:'triangle',notes:[[784,0,.15],[988,.18,.15],[1175,.37,.26]]},
  'MERCADO LIVRE ANTIGO':{wave:'sine',notes:[[698,0,.22],[523,.29,.2],[440,.58,.32]]},
  'MERCADO LIVRE NOVO':{wave:'triangle',notes:[[587,0,.12],[784,.15,.12],[988,.31,.12],[1175,.47,.27]]},
  'MERCADO LIVRE':{wave:'sine',notes:[[659,0,.17],[880,.25,.28],[659,.61,.2]]},
  'AMAZON':{wave:'sine',notes:[[523,0,.17],[659,.2,.17],[784,.41,.17],[1047,.62,.28]]},
  'SHEIN':{wave:'triangle',notes:[[988,0,.13],[740,.18,.16],[880,.4,.28]]},
  'TIK TOK':{wave:'square',notes:[[659,0,.10],[988,.14,.1],[659,.3,.1],[1175,.46,.23]]},
  'MAGALU':{wave:'triangle',notes:[[784,0,.2],[587,.24,.16],[880,.45,.28]]},
  'KWAI':{wave:'sine',notes:[[1175,0,.1],[1175,.15,.1],[784,.33,.23],[988,.62,.17]]},
  'LOJA INTEGRADA':{wave:'triangle',notes:[[440,0,.2],[659,.29,.19],[880,.58,.27]]}
};
export const DISPATCH_SOUND_DURATION_SECONDS=13;

// Repete a melodia de cada canal dentro de uma janela de até 13s.
// Web Audio agenda os toques sem intervalos JavaScript.
const activeSound=new WeakMap();
export function stopNotificationSound(ctx){
  if(!ctx)return;
  const active=activeSound.get(ctx);
  if(!active)return;
  activeSound.delete(ctx);
  for(const node of active.nodes){
    try{node.osc.stop(ctx.currentTime)}catch{}
    try{node.osc.disconnect()}catch{}
    try{node.gain.disconnect()}catch{}
  }
  active.nodes.clear();
}
export function notificationSoundNotes(platform,durationSeconds=DISPATCH_SOUND_DURATION_SECONDS){
  const pattern=DISPATCH_SOUND_PATTERNS[platform]||DISPATCH_SOUND_PATTERNS.SHOPEE;
  const limit=Number.isFinite(durationSeconds)
    ?Math.max(0,Math.min(DISPATCH_SOUND_DURATION_SECONDS,durationSeconds))
    :0;
  const cycleSeconds=Math.max(...pattern.notes.map(([,delay,duration])=>delay+duration))+0.38;
  const events=[];
  for(let cycle=0;cycle<limit;cycle+=cycleSeconds){
    for(const [frequency,delay,duration] of pattern.notes){
      const begin=cycle+delay;
      const available=Math.min(duration,limit-begin);
      if(available<0.065)continue;
      events.push({frequency,begin,duration:available});
    }
  }
  return events;
}
export function playNotificationSound(ctx,platform,durationSeconds=DISPATCH_SOUND_DURATION_SECONDS){
  if(!ctx||ctx.state!=='running')return false;
  const events=notificationSoundNotes(platform,durationSeconds);
  if(events.length===0)return false;
  stopNotificationSound(ctx);
  const pattern=DISPATCH_SOUND_PATTERNS[platform]||DISPATCH_SOUND_PATTERNS.SHOPEE;
  const start=ctx.currentTime+0.008;
  const active={nodes:new Set()};
  activeSound.set(ctx,active);
  try{
    for(const {frequency,begin,duration} of events){
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      const node={osc,gain};
      active.nodes.add(node);
      osc.type=pattern.wave;
      osc.frequency.value=frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t=start+begin;
      const peak=pattern.wave==='square'?0.055:0.115;
      const attack=Math.min(0.018,duration/3);
      gain.gain.setValueAtTime(0.0001,t);
      gain.gain.exponentialRampToValueAtTime(peak,t+attack);
      gain.gain.exponentialRampToValueAtTime(0.0001,t+duration);
      osc.onended=()=>{
        try{osc.disconnect();gain.disconnect()}catch{}
        active.nodes.delete(node);
        if(active.nodes.size===0&&activeSound.get(ctx)===active)activeSound.delete(ctx);
      };
      osc.start(t);
      osc.stop(t+duration);
    }
  }catch(error){
    stopNotificationSound(ctx);
    throw error;
  }
  return true;
}

export function missingSoundPlatforms(){
  return DISPATCH_PLATFORMS.filter(platform=>!DISPATCH_SOUND_PATTERNS[platform]);
}
