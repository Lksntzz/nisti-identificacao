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
    if(never)return c.history?.proven?{label:'SEM_VENDA_HISTORICO_IMPORTADO',reason:null}
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
// Limites reais das listas do banco (funções existentes; não alteramos SQL). Ver docs/MAPA-GA.md.
export const LIST_LIMITS=Object.freeze({champions:10,growth:10,drops:20,stopped:300,never:1000});
const LIST_CAP=1000; // sem corte próprio: o único limite é o do banco (LIST_LIMITS)
const NOTICE_TEXT={
  HISTORICO_NAO_VERIFICADO:'O histórico completo ainda não foi verificado: as unidades aparecem, mas a ausência de vendas no histórico não é afirmada.',
  PERIODO_ATUAL_NAO_COMPROVADO:'A cobertura do período atual não está comprovada: nada é confirmado como crescimento, queda ou parada; as listas são apenas candidatos.',
  PERIODO_ANTERIOR_NAO_COMPROVADO:'A cobertura do período anterior não está comprovada: crescimento e queda são apenas candidatos. Dados importados, não conferidos no marketplace.',
  SEM_INFORMACAO:'Sem informação: nenhuma venda importada para este período. Isso não significa zero vendas.'
};
const DROPS_ORDERING_NOTE='Os anúncios mostrados foram escolhidos pelo maior valor de venda perdido (em reais), e não pelas maiores perdas de unidades: esta lista não é um ranking por unidades. O total de quedas segue a regra por unidades.';
const rangeText=r=>r.start+' a '+r.end;

// Respostas de outra conta ou de outro período nunca entram na visão. Cada fonte tem o contrato REAL da sua função:
//  dashboard/série/mensal/categorias devolvem 'platform' no topo; o resumo (overview) NÃO devolve platform nem days no topo:
//  a conta é conferida pela 'coverage' retornada e as datas por first_day/last_day e window_days_with_sales; a divisão por SKU
//  devolve start/end. Quando a fonte não permite confirmação independente, o nível é NAO_CONFIRMAVEL e a limitação é declarada.
const LIMITATION={
  overview:'Resumo: a função não devolve conta nem dias no nível principal e a cobertura retornada veio vazia; sem conferência independente da conta nem das datas (os anúncios foram filtrados pela conta de cada linha).',
  series:'Evolução diária: a resposta veio sem dias; não há datas para conferir.',
  split:'Divisão por SKU: a resposta não informa as datas consultadas; não foi possível confirmar o período.',
  monthly:'Evolução mensal: a resposta não informa a conta; não foi possível confirmar de forma independente.',
  categories:'Categorias: a resposta não informa a conta nem as datas; não foi possível confirmar de forma independente.'
};
const spanDays=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
function checkSource(name,pl,{platform,days,dash,periods}){
  if(!pl||typeof pl!=='object')return {ok:true,level:null};
  const top=pl.platform??pl.plat;
  if(top!=null&&top!==platform)return {ok:false};
  const topDays=pl.days??pl.window?.days;
  if(topDays!=null&&Number(topDays)!==Number(days))return {ok:false};
  const confirmed={ok:true,level:'CONFIRMADA'},unknown={ok:true,level:'NAO_CONFIRMAVEL'};
  switch(name){
    case 'dashboard':return top!=null&&topDays!=null?confirmed:unknown;
    case 'overview':{
      const cov=Array.isArray(pl.coverage)?pl.coverage:[];
      if(cov.some(c=>c&&c.platform!=null&&c.platform!==platform))return {ok:false};
      const mine=cov.find(c=>c&&c.platform===platform);
      if(mine&&dash){
        if(mine.last_day&&dash.last_day&&String(mine.last_day).slice(0,10)!==String(dash.last_day).slice(0,10))return {ok:false};
        if(mine.first_day&&dash.first_day&&String(mine.first_day).slice(0,10)!==String(dash.first_day).slice(0,10))return {ok:false};
      }
      const w=num(pl.window_days_with_sales);
      if(w!=null&&w>Number(days))return {ok:false};
      return mine||top!=null?confirmed:unknown;
    }
    case 'monthly':{
      if(dash&&pl.last_day&&dash.last_day&&String(pl.last_day).slice(0,10)!==String(dash.last_day).slice(0,10))return {ok:false};
      if(dash&&pl.first_day&&dash.first_day&&String(pl.first_day).slice(0,10)!==String(dash.first_day).slice(0,10))return {ok:false};
      return top!=null?confirmed:unknown;
    }
    case 'series':{
      const d=Array.isArray(pl.daily)?pl.daily:[];
      if(!d.length)return unknown;
      if(!periods)return unknown;
      if(d.length!==Number(days)||String(d[0].day).slice(0,10)!==periods.current.start||String(d[d.length-1].day).slice(0,10)!==periods.current.end)return {ok:false};
      return confirmed;
    }
    case 'split':{
      if(!pl.start||!pl.end||!periods)return unknown;
      return String(pl.start).slice(0,10)===periods.current.start&&String(pl.end).slice(0,10)===periods.current.end?confirmed:{ok:false};
    }
    case 'categories':{
      if(pl.cur_from&&pl.cur_to&&spanDays(pl.cur_from,pl.cur_to)!==Number(days))return {ok:false};
      return top!=null&&pl.cur_from?confirmed:unknown;
    }
    default:return confirmed;
  }
}

// Cobertura por mês/dia a partir da GA-018 do histórico/período atual (nunca inventa: sem prova = não verificada).
const monthEnd=m=>{const [y,mo]=m.split('-').map(Number);return new Date(Date.UTC(y,mo,0)).toISOString().slice(0,10);};
function gapInfo(dq,platform,period){
  const sl=dq?.sales;
  if(!sl||dq.platform!==platform||!period||dq.period?.start!==period.start||dq.period?.end!==period.end)return null;
  if(!Array.isArray(sl.missing_ranges))return null;
  const listed=sl.missing_ranges.reduce((a,r)=>a+(num(r.days)??spanDays(r.start,r.end)),0);
  const missing=num(sl.days_without_information)??0;
  return {ranges:sl.missing_ranges,complete:listed>=missing,otherIssues:(num(sl.partial_days)||0)>0||(num(sl.days_with_records_unverified)||0)>0};
}
function monthCoverage(month,histProven,gi){
  if(histProven)return 'COMPROVADA';
  if(!gi)return 'NAO_VERIFICADA';
  const ms=month+'-01',me=monthEnd(month);
  if(gi.ranges.some(r=>r.start<=me&&r.end>=ms))return 'COM_LACUNA';
  return gi.complete&&!gi.otherIssues?'COMPROVADA':'NAO_VERIFICADA';
}
function dayState(day,curProven,gi){
  if(curProven)return 'OK';
  if(gi&&gi.complete&&gi.ranges.some(r=>r.start<=day&&r.end>=day))return 'SEM_INFORMACAO';
  return 'NAO_VERIFICADO';
}

function makeGroup({kind,available,rows,total,limit,verified,titles,counts,note,ordering,orderingNote,totalKnown=true}){
  const items=available?rows:[];
  const shown=items.length;
  const truncated=available&&(totalKnown&&total!=null?total>shown:shown>=limit);
  const candidate=kind==='CANDIDATO';
  const n=total??shown;
  return {kind,available,title:candidate?titles[1]:titles[0],
    count_label:available&&(totalKnown||shown>0)?(candidate?counts[1](n):counts[0](n)):null,
    total:available?(totalKnown?total??shown:null):null,shown,limit,truncated,
    limit_note:!available?null:truncated?(totalKnown&&total!=null?'Lista limitada a '+limit+': '+shown+' de '+total+' exibidos; a lista não está completa.'
      :'Lista limitada a '+limit+' anúncios; pode haver mais além dos exibidos.'):null,
    ordering:ordering||null,ordering_note:orderingNote||null,note:note||null,verified,items};
}


// Mês de calendário imediatamente anterior (aaaa-mm). Mês ausente da série NUNCA vira zero: fica null e "ausente".
const prevMonthKey=m=>{const [y,mo]=m.split('-').map(Number);const d=new Date(Date.UTC(y,mo-2,1));return d.toISOString().slice(0,7);};
function buildMonths(monthly,cov,dqHistory,platform,periods,key){
  // Contrato real: 'month' vem como data (aaaa-mm-01). A chave interna é sempre aaaa-mm.
  const list=(monthly?.months||[]).map(m=>({...m,month:String(m.month).slice(0,7)}));
  const by=new Map(list.map(m=>[m.month,m]));
  const gi=gapInfo(dqHistory,platform,periods?.history);
  const flags=month=>{
    const out={incomplete:false};
    const end=periods?.history?.end,start=periods?.history?.start;
    if(end&&month===end.slice(0,7)&&end<monthEnd(month)){out.incomplete=true;out.incomplete_until=end;}
    if(start&&month===start.slice(0,7)&&start>month+'-01'){out.incomplete=true;out.incomplete_from=start;}
    return out;
  };
  return list.map(m=>{
    const pk=prevMonthKey(m.month),pm=by.get(pk);
    return {month:m.month,units:num(m['units_'+key]),days_with_sales:num(m.days_with_sales),
      coverage:monthCoverage(m.month,cov.history.proven,gi),...flags(m.month),
      previous:pm?{month:pk,units:num(pm['units_'+key]),absent:false,coverage:monthCoverage(pk,cov.history.proven,gi),...flags(pk)}
        :{month:pk,units:null,absent:true,coverage:'NAO_VERIFICADA',incomplete:false}};
  }).slice(-13);
}
// Dia sem informação é LACUNA (null), nunca zero; a cobertura do período anterior é avaliada à parte, dia a dia.
const addDays=(iso,n)=>new Date(Date.parse(iso)+n*86400000).toISOString().slice(0,10);
function buildDaily(series,cov,dqCurrent,dqPrevious,platform,periods,key){
  const rows=series?.daily||[];
  const curGi=gapInfo(dqCurrent,platform,periods?.current),prevGi=gapInfo(dqPrevious,platform,periods?.previous);
  return rows.map((d,i)=>{
    const day=String(d.day).slice(0,10);
    const state=dayState(day,cov.current.proven,curGi);
    const pDay=periods?.previous?addDays(periods.previous.start,i):null;
    const pState=pDay?dayState(pDay,cov.previous.proven,prevGi):'NAO_VERIFICADO';
    return {day,units:state==='SEM_INFORMACAO'?null:num(d['units_'+key]),state,
      units_previous:pState==='SEM_INFORMACAO'?null:num(d['prev_units_'+key]),previous_state:pState,previous_day:pDay};
  });
}

export function buildStrategicView(p){
  const platform=p.platform,key=KEY[platform];
  const failed=new Set(p.failed||[]);
  const invalid=new Set();
  const levels={},limitations=[];
  const dash0=p.dash&&checkSource('dashboard',p.dash,{platform,days:p.days}).ok?p.dash:null;
  if(p.dash&&!dash0)invalid.add('dashboard');
  const dash=dash0;
  const periods=dash?(p.periods??strategicPeriods(dash)):null;
  const ctx={platform,days:p.days,dash,periods};
  const take=(name,payload)=>{
    if(!payload)return null;
    const r=checkSource(name,payload,ctx);
    if(!r.ok){invalid.add(name);return null;}
    levels[name]=r.level;
    if(r.level==='NAO_CONFIRMAVEL'&&LIMITATION[name])limitations.push(LIMITATION[name]);
    return payload;
  };
  if(dash)levels.dashboard=checkSource('dashboard',dash,{platform,days:p.days}).level;
  const overview=take('overview',p.overview),monthly=take('monthly',p.monthly),series=take('series',p.series),
    categoriesRaw=take('categories',p.categories),splitRaw=take('split',p.split);
  const cov=coverageState({platform,periods,dqCurrent:p.dqCurrent,dqPrevious:p.dqPrevious,dqHistory:p.dqHistory});
  const own=rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&r.platform===platform);
  const base=r=>({listing_id:r.listing_id??null,external_id:r.external_id??null,title:r.title??null,units:num(r.units),units_previous:num(r.units_previous),
    traffic:trafficFor(platform,r,p.perf)});
  const ov=overview,totals=dash?.totals||null;
  const status=periods&&totals?'OK':'SEM_INFORMACAO';
  const curU=num(totals?.cur_units),prevU=num(totals?.prev_units);
  const bothProven=cov.current.proven&&cov.previous.proven;
  const partState=(name,value)=>failed.has(name)?'INDISPONIVEL':invalid.has(name)?'RESPOSTA_INVALIDA':(name==='split'&&platform!=='SHOPEE')?'NAO_SE_APLICA':value==null?'SEM_DADOS':'OK';
  const ovAvail=ov!=null;
  const notices=[];
  if(status==='SEM_INFORMACAO')notices.push({kind:'SEM_INFORMACAO',text:NOTICE_TEXT.SEM_INFORMACAO});
  else{
    if(!cov.current.proven)notices.push({kind:'PERIODO_ATUAL_NAO_COMPROVADO',text:NOTICE_TEXT.PERIODO_ATUAL_NAO_COMPROVADO});
    else if(!cov.previous.proven)notices.push({kind:'PERIODO_ANTERIOR_NAO_COMPROVADO',text:NOTICE_TEXT.PERIODO_ANTERIOR_NAO_COMPROVADO});
    if(!cov.history.proven)notices.push({kind:'HISTORICO_NAO_VERIFICADO',text:NOTICE_TEXT.HISTORICO_NAO_VERIFICADO});
  }

  // Base das unidades: o Dashboard soma vendas dos ANÚNCIOS vinculados; a Shopee também tem o total por SKU (inclui sem vínculo).
  const split=platform==='SHOPEE'?(invalid.has('split')?{kind:'SHOPEE',status:'RESPOSTA_INVALIDA',total:null,linked:null,unlinked:null,residual:null}:salesSplit(platform,{split:splitRaw,overview:ov})):salesSplit(platform,{overview:ov});
  const skuTotal=platform==='SHOPEE'&&split.total!=null&&periods
    ?{current:split.total,unlinked:split.unlinked,basis:'TOTAL_POR_SKU',period:periods.current}:null;
  if(platform==='SHOPEE'&&split.base!=null&&curU!=null&&split.base!==curU)
    notices.push({kind:'BASE_UNIDADES_DIVERGENTE',text:'O total de unidades dos anúncios ('+curU+') não coincide com a base da divisão por SKU ('+split.base+'): conferir antes de comparar.'});

  const candidate=ok=>ok?'CONFIRMADO':'CANDIDATO';
  const stoppedRows=own(ov?.stopped).slice(0,LIST_CAP).map(r=>({...base(r),units_ever:num(r.units_ever),last_sale:r.last_sale??null,days_since:num(r.days_since),...movementLabel('stopped',r,cov)}));
  const neverRows=own(ov?.no_sales).filter(r=>!r.last_sale&&!(num(r.units_ever)>0)).slice(0,LIST_CAP)
    .map(r=>({...base(r),units_ever:0,last_sale:null,...movementLabel('no_sales',r,cov)}));
  const histStart=periods?.history?.start;
  const movements={
    growth:makeGroup({kind:candidate(bothProven),available:ovAvail,rows:own(ov?.growth).map(r=>({...base(r),...movementLabel('growth',r,cov)})),
      total:null,totalKnown:false,limit:LIST_LIMITS.growth,verified:bothProven,
      titles:['Crescimento','Possível crescimento (não confirmado)'],
      counts:[n=>n+(n===1?' anúncio exibido':' anúncios exibidos')+', por maior ganho de unidades',n=>n+(n===1?' possível crescimento':' possíveis crescimentos')+' exibido(s), por maior ganho de unidades (não confirmados)'],ordering:'GANHO_DE_UNIDADES'}),
    drops:makeGroup({kind:candidate(bothProven),available:dash!=null,rows:own(dash?.drops?.items).map(r=>({...base(r),...movementLabel('drop',r,cov)})),
      total:num(dash?.drops?.total),limit:LIST_LIMITS.drops,verified:bothProven,
      titles:['Queda','Possíveis quedas (não confirmadas)'],
      counts:[n=>n+(n===1?' anúncio em queda':' anúncios em queda'),n=>n+(n===1?' possível queda (não confirmada)':' possíveis quedas (não confirmadas)')],
      ordering:'VALOR_PERDIDO',orderingNote:DROPS_ORDERING_NOTE}),
    stopped:makeGroup({kind:candidate(cov.current.proven),available:ovAvail,rows:stoppedRows,total:num(ov?.stopped_total),limit:LIST_LIMITS.stopped,
      verified:cov.current.proven,titles:['Anúncios que pararam','Possíveis parados (não confirmados)'],
      counts:[n=>n+(n===1?' anúncio parado':' anúncios parados'),n=>n+(n===1?' possível parado (não confirmado)':' possíveis parados (não confirmados)')],ordering:'ULTIMA_VENDA_MAIS_RECENTE',
      note:cov.current.proven&&!cov.history.proven?'A data da última venda ainda não foi verificada em todo o histórico.':null}),
    never:makeGroup({kind:candidate(cov.history.proven),available:ovAvail,rows:neverRows,total:num(ov?.no_sales_never),limit:LIST_LIMITS.never,
      verified:cov.history.proven,titles:['Sem venda no histórico importado','Sem venda nos dados importados (histórico não verificado)'],
      counts:[n=>n+(n===1?' anúncio ativo':' anúncios ativos')+' sem venda no histórico importado',n=>n+(n===1?' anúncio ativo':' anúncios ativos')+' sem venda nos dados importados (histórico não verificado)'],
      note:histStart?(cov.history.proven?'Considera apenas as vendas importadas a partir de '+histStart+': não prova que o anúncio nunca vendeu antes de '+histStart+'.'
        :'O histórico importado a partir de '+histStart+' tem dias sem cobertura comprovada: ausência de venda aqui não é afirmada.'):null})
  };
  movements.never.history_span=periods?.history||null;
  

  // Categorias: o banco compara o período com o MESMO período do ano anterior e termina na última venda importada do ano.
  let categories=null;
  if(categoriesRaw){
    const c=categoriesRaw,cur={start:c.cur_from??null,end:c.cur_to??null},baseP={start:c.base_from??null,end:c.base_to??null};
    const aligned=Boolean(periods&&cur.start===periods.current.start&&cur.end===periods.current.end);
    const curState=aligned&&!p.dqCatCurrent?cov.current:stateOf(p.dqCatCurrent,platform,cur.start?cur:null);
    const baseState=stateOf(p.dqCatBase,platform,baseP.start?baseP:null);
    categories={basis:platform==='SHOPEE'?'TOTAL_POR_SKU':'POR_ANUNCIO',comparison:'ANO_ANTERIOR',period:{current:cur,base:baseP},aligned,
      verified:{current:curState.proven,base:baseState.proven},
      total:{units:num(c.total?.cur),base:num(c.total?.base)},
      items:(c.categories||[]).map(x=>({name:x.name,units:num(x.cur),base:num(x.base),
        collections:(x.cols||[]).slice(0,8).map(y=>({name:y.name,units:num(y.cur),base:num(y.base)}))}))};
    if(cur.start&&baseP.start)notices.push({kind:'CATEGORIAS_COMPARACAO_ANUAL',text:'Categorias e coleções comparam '+rangeText(cur)+' com o mesmo período do ano anterior ('+rangeText(baseP)+'); não é o período imediatamente anterior das demais seções.'});
    if(!aligned&&cur.start)notices.push({kind:'CATEGORIAS_PERIODO_DIFERENTE',text:'As categorias usam '+rangeText(cur)+' (até a última venda importada do ano, que pode ser um dia parcial), diferente do período fechado'+(periods?' '+rangeText(periods.current):'')+' das demais seções.'});
    if(!categories.verified.current||!categories.verified.base){
      const which=[!categories.verified.current&&'do período atual',!categories.verified.base&&'do mesmo período do ano anterior'].filter(Boolean).join(' e ');
      notices.push({kind:'CATEGORIAS_NAO_VERIFICADAS',text:'A cobertura de vendas '+which+' nas categorias não está comprovada: valores não verificados.'});
    }
  }

  const out={
    platform,days:p.days,status,periods,coverage:cov,
    units:{current:status==='OK'?curU:null,previous:status==='OK'?prevU:null,
      change_pct:status==='OK'&&bothProven&&prevU>0?Math.round((curU-prevU)/prevU*1000)/10:null,
      verified:{current:cov.current.proven,previous:cov.previous.proven},
      basis:platform==='SHOPEE'?'ANUNCIOS_VINCULADOS':'POR_ANUNCIO',sku_total:skuTotal},
    listings:{active:num(ov?.listings?.active),inactive:num(ov?.listings?.inactive),inactive_with_sales:num(ov?.listings?.inactive_with_sales),
      active_without_sales:num(ov?.listings?.active_without_sales),selling_without_sku:num(ov?.unlinked?.listings),
      // Contrato real do Dashboard: totals.listings = anúncios com venda no período, SEM filtro de situação (inclui inativos e sem cadastro).
      with_sales:status==='OK'?num(totals?.listings):null,with_sales_includes_inactive:true,
      with_sales_note:'inclui anúncios inativos e anúncios sem cadastro que venderam no período'+(num(ov?.listings?.inactive_with_sales)!=null?' ('+num(ov.listings.inactive_with_sales)+' inativos)':''),
      coverage_verified:cov.current.proven,
      active_without_sales_label:cov.current.proven?'sem venda no período':'sem venda nos dados importados (cobertura não comprovada)'},
    champions:own(ov?.top_units).map(base),champions_available:ovAvail,champions_verified:cov.current.proven,
    champions_note:cov.current.proven?null:'Ranking pelas vendas importadas: a cobertura do período atual não comprovada pode alterar a ordem e as unidades.',champions_limit:LIST_LIMITS.champions,
    movements,
    evolution:{
      months:buildMonths(monthly,cov,p.dqHistory,platform,periods,key),
      daily:buildDaily(series,cov,p.dqCurrent,p.dqPrevious,platform,periods,key),
      verified:{months:cov.history.proven,daily:cov.current.proven,daily_previous:cov.previous.proven},
      basis:platform==='SHOPEE'?'ANUNCIOS_VINCULADOS':'POR_ANUNCIO',
      available:{months:monthly!=null,daily:series!=null}
    },
    categories,
    sales_split:split,
    traffic_available:Boolean((platform==='SHOPEE'?p.perf?.shopee?.reports:(p.perf?.ml?.reports||[]).filter(r=>r.account===(platform==='ML_NOVO'?'NOVO':'ANTIGO')))?.length),
    notices,
    validation:{levels,limitations},
    sources:{cached_in_database:['dashboard','overview','series','monthly','categories'],live:['quality','split','performance'],
      note:'Dashboard, resumo, evolução e categorias vêm do cache interno do banco (válido até a próxima importação, a virada do dia ou 6 horas). Cobertura, divisão por SKU e relatórios de visitas são consultados ao vivo.',
      elapsed_ms:num(p.elapsed_ms)},
    parts:{dashboard:partState('dashboard',dash),overview:partState('overview',overview),monthly:partState('monthly',monthly),
      series:partState('series',series),categories:partState('categories',categoriesRaw),split:partState('split',splitRaw),
      quality:failed.has('quality')?'INDISPONIVEL':(p.dqCurrent||p.dqPrevious||p.dqHistory)?'OK':'SEM_DADOS',
      performance:partState('performance',p.perf?.shopee||p.perf?.ml)}
  };
  return stripCommercial(out);
}
