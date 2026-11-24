// GA-013 — Visão estratégica por conta: regras puras (sem rede, sem React, sem banco).
// Só unidades. Crescimento, queda, parada e "nunca vendeu" só são afirmados quando a cobertura de vendas
// (GA-018) do período comprova; sem isso o item aparece como "sem classificação" e o histórico fica visível, identificado.
import {coverageProven,perfItemFor} from './commerce-platform-scope-logic.js';

export const STRATEGIC_PLATFORMS=Object.freeze([
  {id:'SHOPEE',label:'Shopee',color:'#eb6834'},
  {id:'ML_ANTIGO',label:'ML Antigo',color:'#2a78d6'},
  {id:'ML_NOVO',label:'ML Novo',color:'#7b4fd4'}
]);
export const STRATEGIC_DAYS=Object.freeze([7,30,60,90]);
export const isStrategicPlatform=p=>STRATEGIC_PLATFORMS.some(x=>x.id===p);

// Nada de faturamento, lucro, margem ou ticket em qualquer resposta desta visão.
export const FORBIDDEN_KEY_RE=/(^|_)(rev|revenue|gmv|faturamento|lucro|profit|margem|margin|roas|spend|gross)(_|$)|ticket/i;
export function stripCommercial(v){
  if(Array.isArray(v))return v.map(stripCommercial);
  if(v&&typeof v==='object'){
    const out={};
    for(const [k,x] of Object.entries(v))if(!FORBIDDEN_KEY_RE.test(k))out[k]=stripCommercial(x);
    return out;
  }
  return v;
}

const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const isoDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.slice(0,10))&&!Number.isNaN(Date.parse(v.slice(0,10)))?v.slice(0,10):null;
const dayBefore=d=>new Date(Date.parse(d)-86400000).toISOString().slice(0,10);

// Períodos do próprio Dashboard: atual até o último dia importado (nunca o dia parcial de hoje), anterior logo antes.
export function strategicPeriods(dash){
  const last=isoDay(dash?.last_day),first=isoDay(dash?.first_day),cs=isoDay(dash?.current_start),ps=isoDay(dash?.previous_start);
  if(!last||!first||!cs||!ps)return null;
  return {days:num(dash.days),current:{start:cs,end:last},previous:{start:ps,end:dayBefore(cs)},history:{start:first,end:last}};
}

function stateOf(dq,platform,period){
  if(!period||!dq)return {proven:false,reason:'INDISPONIVEL'};
  if(dq.platform===platform&&dq.sales?.status==='SEM_INFORMACAO')return {proven:false,reason:'SEM_INFORMACAO'};
  return coverageProven(dq,platform,period)?{proven:true,reason:null}:{proven:false,reason:'NAO_COMPROVADA'};
}
// A cobertura só vale se a GA-018 for da MESMA conta e do MESMO período; qualquer dúvida = não comprovada.
export function coverageState({platform,periods,dqCurrent,dqPrevious,dqHistory}){
  return {current:stateOf(dqCurrent,platform,periods?.current),previous:stateOf(dqPrevious,platform,periods?.previous),
    history:stateOf(dqHistory,platform,periods?.history)};
}

// Mesmos limiares do Dashboard (overview/dashboard): anterior ≥ 5; crescimento = atual ≥ 10 e ≥ +15%; queda ≤ −15%.
export function classifyChange(units,previous){
  const u=num(units),p=num(previous);
  if(u==null||p==null||p<5)return 'POUCO_VOLUME';
  const ch=(u-p)/p;
  if(u>=10&&ch>=0.15)return 'CRESCIMENTO';
  if(ch<=-0.15)return 'QUEDA';
  return 'ESTAVEL';
}

const unclassified=(reason,cov,key)=>({label:'SEM_CLASSIFICACAO',reason,coverage_reason:cov?.[key]?.reason||'NAO_COMPROVADA'});
export function movementLabel(kind,row,cov){
  const c=cov||{};
  if(kind==='growth'||kind==='drop'){
    if(!c.current?.proven)return unclassified('PERIODO_ATUAL_NAO_COMPROVADO',c,'current');
    if(!c.previous?.proven)return unclassified('PERIODO_ANTERIOR_NAO_COMPROVADO',c,'previous');
    return {label:classifyChange(row?.units,row?.units_previous),reason:null};
  }
  if(kind==='stopped'){
    if(!c.current?.proven)return unclassified('PERIODO_ATUAL_NAO_COMPROVADO',c,'current');
    return {label:'PAROU',reason:null,last_sale_verified:Boolean(c.history?.proven)};
  }
  if(kind==='no_sales'){
    const never=!row?.last_sale&&!(num(row?.units_ever)>0);
    if(never)return c.history?.proven?{label:'NUNCA_VENDEU',reason:null}
      :{label:'SEM_VENDAS_HISTORICO_NAO_VERIFICADO',reason:'HISTORICO_NAO_COMPROVADO',coverage_reason:c.history?.reason||'NAO_COMPROVADA'};
    if(!c.current?.proven)return unclassified('PERIODO_ATUAL_NAO_COMPROVADO',c,'current');
    return {label:'SEM_VENDA_NO_PERIODO',reason:null};
  }
  return unclassified('TIPO_DESCONHECIDO',c,'current');
}

// Visitas, impressões e conversão: só do relatório da MESMA plataforma/conta; campo ausente = null (nunca zero).
export function trafficFor(platform,row,perf){
  const it=perfItemFor({platform,external_id:row?.external_id},{ml:perf?.ml,shopee:perf?.shopee});
  if(!it)return null;
  const acc=platform==='ML_NOVO'?'NOVO':platform==='ML_ANTIGO'?'ANTIGO':null;
  const reports=(platform==='SHOPEE'?perf?.shopee?.reports:(perf?.ml?.reports||[]).filter(r=>r.account===acc))||[];
  const rep=[...reports].sort((a,b)=>String(b.end||'').localeCompare(String(a.end||'')))[0]||null;
  const start=it.start||rep?.start||null,end=it.end||rep?.end||null;
  return {visits:num(it.visits),impressions:num(it.impressions),conversion_pct:num(it.conversion_pct),
    period:start&&end?{start,end}:null};
}

// Shopee: total por SKU (GA-021) x vinculada x sem vínculo x outras causas x resíduo. O resíduo nunca vira "sem vínculo".
export function salesSplit(platform,{split,overview}={}){
  if(platform!=='SHOPEE')return {kind:'ML',unlinked_listings:num(overview?.unlinked?.listings)};
  if(!split||typeof split!=='object')return {kind:'SHOPEE',status:'INDISPONIVEL'};
  if(split.status==='SEM_INFORMACAO'||split.total_units==null)
    return {kind:'SHOPEE',status:'SEM_INFORMACAO',total:null,linked:null,unlinked:null,residual:null};
  const d=split.difference||{};
  return {kind:'SHOPEE',status:split.reconciliation?.status||'INDISPONIVEL',coverage_status:split.status||null,
    total:num(split.total_units),linked:num(split.linked_units),unlinked:num(split.unlinked_units),unlinked_skus:num(split.unlinked_sku_count),
    base:num(split.base_units),difference:num(d.units),other_explained:num(d.other_explained_units),residual:num(d.residual_units),
    missing_days:num(split.coverage?.missing_days)};
}

const KEY={SHOPEE:'shopee',ML_ANTIGO:'ml_antigo',ML_NOVO:'ml_novo'};
const LIST_CAP=50;
const NOTICE_TEXT={
  HISTORICO_NAO_VERIFICADO:'O histórico completo ainda não foi verificado: as unidades aparecem, mas “nunca vendeu” não é afirmado.',
  PERIODO_ATUAL_NAO_COMPROVADO:'A cobertura do período atual não está comprovada: nada é classificado como crescimento, queda ou parada.',
  PERIODO_ANTERIOR_NAO_COMPROVADO:'A cobertura do período anterior não está comprovada: crescimento e queda não são classificados. Dados importados, não conferidos no marketplace.',
  SEM_INFORMACAO:'Sem informação: nenhuma venda importada para este período. Isso não significa zero vendas.'
};

export function buildStrategicView(p){
  const platform=p.platform,key=KEY[platform];
  const failed=new Set(p.failed||[]);
  const periods=p.periods??strategicPeriods(p.dash);
  const cov=coverageState({platform,periods,dqCurrent:p.dqCurrent,dqPrevious:p.dqPrevious,dqHistory:p.dqHistory});
  const own=rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&r.platform===platform);
  const base=r=>({listing_id:r.listing_id??null,external_id:r.external_id??null,title:r.title??null,units:num(r.units),units_previous:num(r.units_previous),
    traffic:trafficFor(platform,r,p.perf)});
  const ov=p.overview||null,totals=p.dash?.totals||null;
  const status=periods&&totals?'OK':'SEM_INFORMACAO';
  const curU=num(totals?.cur_units),prevU=num(totals?.prev_units);
  const bothProven=cov.current.proven&&cov.previous.proven;
  const partState=(name,value)=>failed.has(name)?'INDISPONIVEL':(name==='split'&&platform!=='SHOPEE')?'NAO_SE_APLICA':value==null?'SEM_DADOS':'OK';

  const notices=[];
  if(status==='SEM_INFORMACAO')notices.push({kind:'SEM_INFORMACAO',text:NOTICE_TEXT.SEM_INFORMACAO});
  else{
    if(!cov.current.proven)notices.push({kind:'PERIODO_ATUAL_NAO_COMPROVADO',text:NOTICE_TEXT.PERIODO_ATUAL_NAO_COMPROVADO});
    else if(!cov.previous.proven)notices.push({kind:'PERIODO_ANTERIOR_NAO_COMPROVADO',text:NOTICE_TEXT.PERIODO_ANTERIOR_NAO_COMPROVADO});
    if(!cov.history.proven)notices.push({kind:'HISTORICO_NAO_VERIFICADO',text:NOTICE_TEXT.HISTORICO_NAO_VERIFICADO});
  }

  const stopped=own(ov?.stopped).slice(0,LIST_CAP).map(r=>({...base(r),units_ever:num(r.units_ever),last_sale:r.last_sale??null,days_since:num(r.days_since),...movementLabel('stopped',r,cov)}));
  const never=own(ov?.no_sales).filter(r=>!r.last_sale&&!(num(r.units_ever)>0)).slice(0,LIST_CAP)
    .map(r=>({...base(r),units_ever:0,last_sale:null,...movementLabel('no_sales',r,cov)}));
  const out={
    platform,days:p.days,status,periods,coverage:cov,
    units:{current:status==='OK'?curU:null,previous:status==='OK'?prevU:null,
      change_pct:status==='OK'&&bothProven&&prevU>0?Math.round((curU-prevU)/prevU*1000)/10:null,
      verified:{current:cov.current.proven,previous:cov.previous.proven}},
    listings:{active:num(ov?.listings?.active),inactive:num(ov?.listings?.inactive),inactive_with_sales:num(ov?.listings?.inactive_with_sales),
      active_without_sales:num(ov?.listings?.active_without_sales),selling_without_sku:num(ov?.unlinked?.listings)},
    champions:own(ov?.top_units).map(base),
    movements:{
      growth:own(ov?.growth).map(r=>({...base(r),...movementLabel('growth',r,cov)})),
      drops:own(p.dash?.drops?.items).map(r=>({...base(r),...movementLabel('drop',r,cov)})),
      stopped:{total:num(ov?.stopped_total),items:stopped,verified:cov.current.proven},
      never:{total:num(ov?.no_sales_never),items:never,verified:cov.history.proven}
    },
    evolution:{
      months:(p.monthly?.months||[]).map(m=>({month:m.month,units:num(m['units_'+key]),days_with_sales:num(m.days_with_sales)})).slice(-13),
      daily:(p.series?.daily||[]).map(d=>({day:d.day,units:num(d['units_'+key]),units_previous:num(d['prev_units_'+key])}))
    },
    categories:p.categories?{total:{units:num(p.categories.total?.cur),previous:num(p.categories.total?.base)},
      items:(p.categories.categories||[]).map(c=>({name:c.name,units:num(c.cur),previous:num(c.base),
        collections:(c.cols||[]).slice(0,8).map(x=>({name:x.name,units:num(x.cur),previous:num(x.base)}))}))}:null,
    sales_split:salesSplit(platform,{split:p.split,overview:ov}),
    traffic_available:Boolean((platform==='SHOPEE'?p.perf?.shopee?.reports:(p.perf?.ml?.reports||[]).filter(r=>r.account===(platform==='ML_NOVO'?'NOVO':'ANTIGO')))?.length),
    notices,
    parts:{dashboard:partState('dashboard',p.dash),overview:partState('overview',p.overview),monthly:partState('monthly',p.monthly),
      series:partState('series',p.series),categories:partState('categories',p.categories),split:partState('split',p.split),
      quality:failed.has('quality')?'INDISPONIVEL':(p.dqCurrent||p.dqPrevious||p.dqHistory)?'OK':'SEM_DADOS',
      performance:partState('performance',p.perf)}
  };
  return stripCommercial(out);
}
