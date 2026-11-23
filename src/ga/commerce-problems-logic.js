// Regras puras do GA "Anúncios com problema": texto automático e aviso de campanha. Sem rede e sem React.
export const GROUPS=[['PAROU','Parou'],['QUEDA','Em queda'],['PIOR','Pior performance'],['NUNCA','Nunca vendeu']];
export const PROBLEM_PCT=-15;
export const PLATFORM_LABEL={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};

const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});

// Frase única por plataforma. Régua sem dados nunca vira queda.
export function headline(p){
  const label=PLATFORM_LABEL[p?.platform]||String(p?.platform||'Plataforma');
  if(!p?.base_ok||p.var_pct==null)return label+': sem base de comparação.';
  const v=Number(p.var_pct);
  if(!(v<=PROBLEM_PCT))return label+': sem queda.';
  const top=Array.isArray(p.top)?p.top:[];
  const share=Math.round(top.reduce((a,t)=>a+(Number(t.share_pct)||0),0));
  let s=label+' caiu '+Math.round(Math.abs(v))+'% ('+money(p.lost_revenue)+' a menos).';
  if(top.length)s+=' '+top.length+(top.length===1?' anúncio explica ':' anúncios explicam ')+share+'%.';
  const inactive=Math.round(Number(p.inactive_share_pct)||0);
  if(inactive>0)s+=' '+inactive+'% da queda vem de anúncios que não estão mais ativos.';
  return s;
}

// Anúncios que pararam/caíram dentro da plataforma — pode haver mesmo quando o total da plataforma sobe.
export function listingsNote(c){
  const par=Number(c?.PAROU)||0,qu=Number(c?.QUEDA)||0;
  const a=par?par+(par===1?' anúncio parou':' anúncios pararam')+' de vender':'';
  const b=qu?qu+(qu===1?' anúncio caiu':' anúncios caíram'):'';
  return a&&b?a+' e '+b:a||b;
}

// Sexta-feira depois da 4ª quinta-feira de novembro.
function blackFriday(year){
  const d=new Date(Date.UTC(year,10,1));
  const firstThursday=1+((4-d.getUTCDay()+7)%7);
  return new Date(Date.UTC(year,10,firstThursday+21+1));
}
const iso=d=>d.toISOString().slice(0,10);

// Avisa quando o período contém um dia de campanha, que distorce a comparação.
export function campaignWarning(start,end){
  const s=String(start||''),e=String(end||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!/^\d{4}-\d{2}-\d{2}$/.test(e))return null;
  const found=[];
  for(let y=Number(s.slice(0,4));y<=Number(e.slice(0,4));y++){
    for(const [name,date] of [['10.10',y+'-10-10'],['11.11',y+'-11-11'],['Black Friday',iso(blackFriday(y))]])
      if(date>=s&&date<=e&&!found.includes(name))found.push(name);
  }
  return found.length?'Este período contém '+found.join(' e ')+': a comparação pode parecer maior ou menor do que é.':null;
}

// Aviso para a janela atual e também para os meses usados como base (campanha na base infla a comparação).
export function windowWarning(w){
  if(!w)return null;
  const cur=campaignWarning(w.start,w.end);
  if(cur)return cur;
  const base=campaignWarning(w.base_start,w.base_end);
  return base?base.replace('Este período contém','Os meses usados como base contêm')+' Isso pode inflar a base e mostrar queda que não existe.':null;
}
