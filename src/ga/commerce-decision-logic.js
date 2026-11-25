// GA-014 — Central de decisões comerciais: regras puras (sem rede, sem React, sem banco). SOMENTE UNIDADES e somente leitura.
// Nada aqui altera anúncio, calcula valor em dinheiro, afirma estoque/preço/tráfego/conversão como causa, nem projeta vendas futuras.
// A cobertura de vendas (GA-018) decide dinamicamente o que é confirmado; sem ela, o anúncio vira "dados insuficientes" (possível, não confirmado).
import {coverageState,stripCommercial,STRATEGIC_PLATFORMS} from './commerce-strategic-logic.js';

export const DECISION_PLATFORMS=STRATEGIC_PLATFORMS;
export const DECISION_DAYS=Object.freeze([7,30]);
export const isDecisionDays=d=>DECISION_DAYS.includes(Number(d));
// drop_pct: queda mínima (%); high_loss: perda mínima (un) para prioridade alta junto com a queda percentual; high_loss_abs: perda (un) que
// vira prioridade alta SOZINHA, qualquer que seja o percentual; review_loss: perda mínima para revisão; gain: ganho mínimo (un) para oportunidade;
// small_base: abaixo disto (un no período anterior) a base é pequena e não se calcula porcentagem de crescimento.
export const DECISION_THRESHOLDS=Object.freeze({
  7:Object.freeze({drop_pct:30,high_loss:5,review_loss:2,high_loss_abs:20,gain:5,small_base:2}),
  30:Object.freeze({drop_pct:30,high_loss:10,review_loss:4,high_loss_abs:60,gain:10,small_base:4})
});
export const TIER_LIMIT=50;
export const REPORT_MAX_AGE_DAYS=14;
const MIN_VISITS=100,MIN_IMPRESSIONS=1000,EVIDENCE_DROP_PCT=-20,CONV_RATIO=0.5;
const TIER_IDS=['alta','revisao','oportunidade','hipotese_conversao','insuficiente','sem_prioridade'];

const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const isoDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&!Number.isNaN(Date.parse(v.slice(0,10)))?v.slice(0,10):null;
const ddmm=d=>d?d.slice(8,10)+'/'+d.slice(5,7):'—';
const rng=(a,b)=>ddmm(a)+' a '+ddmm(b);
const pc=v=>String(Math.round(v*10)/10).replace('.',',')+'%';
const spanOf=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
const ageDays=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const sameRange=(a,b)=>Boolean(a&&b&&isoDay(a.start)===b.start&&isoDay(a.end)===b.end);

// Valida a resposta de commerce_decision_units_v1: conta e datas devem ser as pedidas; lista cortada não classifica nada.
function checkUnits(u,{platform,periods}){
  if(!u||typeof u!=='object'||Array.isArray(u))return {ok:false,why:'resposta vazia ou em formato inesperado'};
  if(u.platform!==platform)return {ok:false,why:'a resposta é de outra conta'};
  if(!periods||!sameRange(u.current,periods.current)||!sameRange(u.previous,periods.previous))return {ok:false,why:'os períodos da resposta não são os pedidos'};
  if(!Array.isArray(u.rows)||!u.totals||typeof u.totals!=='object')return {ok:false,why:'lista ou totais ausentes'};
  if(u.truncated===true)return {ok:false,why:'a lista veio cortada; classificar só uma parte esconderia anúncios'};
  if(num(u.row_count)!==u.rows.length)return {ok:false,why:'a quantidade de linhas não confere'};
  for(const r of u.rows){
    if(!r||typeof r.ext!=='string'||r.ext===''||num(r.units_current)==null||num(r.units_previous)==null||r.units_current<0||r.units_previous<0)
      return {ok:false,why:'linha de anúncio inválida'};
  }
  return {ok:true};
}

function evidenceOf(reports,periods){
  const l=reports?.latest,p=reports?.previous;
  const out={latest:{available:false,fresh:false,stale:false,text:'Nenhum relatório de desempenho importado para esta conta: visitas, impressões e conversão estão indisponíveis.'},
    previous:{available:false,comparable:false}};
  if(!l||!isoDay(l.start)||!isoDay(l.end))return out;
  const age=Math.max(0,ageDays(l.end,periods.current.end));
  const fresh=age<=REPORT_MAX_AGE_DAYS;
  out.latest={available:true,fresh,stale:!fresh,start:isoDay(l.start),end:isoDay(l.end),imported_at:l.imported_at??null,age_days:age,
    store_visits:num(l.store_visits),store_orders:num(l.store_orders),
    text:fresh?'Relatório de desempenho de '+rng(l.start,l.end)+' (termina '+age+' dia(s) antes do fim do período atual).'
      :'O relatório de desempenho mais recente é de '+rng(l.start,l.end)+' ('+(age)+' dias antes do fim do período atual): antigo demais para servir de evidência. Visitas, impressões e conversão ficam indisponíveis.'};
  if(p&&isoDay(p.start)&&isoDay(p.end)){
    const comparable=Math.abs(spanOf(l.start,l.end)-spanOf(p.start,p.end))<=1&&fresh;
    out.previous={available:true,comparable,start:isoDay(p.start),end:isoDay(p.end)};
  }
  return out;
}

const conv=m=>m&&num(m.visits)>0&&num(m.orders)!=null?m.orders/m.visits:null;
function hypothesesFor(r,ev,{drop,platform}){
  const out=[];const l=r.perf?.latest;
  if(!ev.latest.fresh||!l||l.ambiguous_rows)return out;
  const period={start:ev.latest.start,end:ev.latest.end};
  // Conversão baixa: relatório recente da MESMA conta, volume mínimo e menos da metade da média da loja no mesmo relatório.
  const storeConv=ev.latest.store_visits>0&&ev.latest.store_orders!=null?ev.latest.store_orders/ev.latest.store_visits:null;
  const c=conv(l);
  if(!drop&&c!=null&&storeConv!=null&&num(l.visits)>=MIN_VISITS&&c<storeConv*CONV_RATIO)
    out.push({kind:'CONVERSAO_BAIXA',period,
      text:'A conversão (pedidos ÷ visitas) foi '+pc(c*100)+' no relatório de '+rng(period.start,period.end)+', abaixo de metade da média da loja ('+pc(storeConv*100)+') no mesmo relatório: pode indicar problema de conversão. É uma hipótese, não um fato.'});
  // Queda: dois relatórios comparáveis (mesma conta, sem sobreposição, durações iguais) e volume mínimo nos dois.
  const pv=r.perf?.previous;
  if(drop&&ev.previous.comparable&&pv&&!pv.ambiguous_rows){
    const chg=(a,b)=>a>0?Math.round((b-a)/a*1000)/10:null;
    const add=(kind,c0,text)=>{if(c0!=null&&c0<=EVIDENCE_DROP_PCT)out.push({kind,change_pct:c0,period,previous_period:{start:ev.previous.start,end:ev.previous.end},text});};
    if(platform==='SHOPEE'&&num(l.impressions)>=MIN_IMPRESSIONS&&num(pv.impressions)>=MIN_IMPRESSIONS)
      add('VISIBILIDADE_MENOR',chg(pv.impressions,l.impressions),'As impressões caíram entre os relatórios de '+rng(ev.previous.start,ev.previous.end)+' e '+rng(period.start,period.end)+': pode indicar perda de visibilidade. É uma hipótese, não um fato.');
    if(platform==='SHOPEE'&&num(l.impressions)>=MIN_IMPRESSIONS&&num(pv.impressions)>=MIN_IMPRESSIONS&&num(l.clicks)!=null&&num(pv.clicks)!=null){
      const a=pv.clicks/pv.impressions,b=l.clicks/l.impressions;
      add('CLIQUE_MENOR',chg(a,b),'A taxa de cliques caiu entre os mesmos relatórios: pode indicar que o anúncio atrai menos cliques. É uma hipótese, não um fato.');
    }
    if(num(l.visits)>=MIN_VISITS&&num(pv.visits)>=MIN_VISITS){
      if(platform!=='SHOPEE')add('VISITAS_MENORES',chg(pv.visits,l.visits),'As visitas caíram entre os relatórios de '+rng(ev.previous.start,ev.previous.end)+' e '+rng(period.start,period.end)+': pode indicar menos exposição. É uma hipótese, não um fato.');
      const ca=conv(pv),cb=conv(l);
      if(ca!=null&&cb!=null)add('CONVERSAO_MENOR',chg(ca,cb),'A conversão (pedidos ÷ visitas) caiu entre os mesmos relatórios: pode indicar perda de conversão. É uma hipótese, não um fato.');
    }
  }
  return out;
}

const INVESTIGATE={
  QUEDA:['Conferir no painel do marketplace a situação atual do anúncio (ativo, pausado, com restrição).','Conferir o estoque disponível de cada variação.','Verificar se algo mudou no anúncio no período (título, fotos, categoria, preço, campanhas).'],
  PAROU:['Conferir no painel do marketplace se o anúncio continua ativo e visível.','Conferir o estoque disponível de cada variação.','Verificar se o anúncio foi alterado, reprovado ou perdeu posição na busca.'],
  OPORTUNIDADE:['Conferir se há estoque para sustentar a demanda.','Verificar o que mudou neste anúncio antes do aumento (título, fotos, campanhas) para repetir em outros.'],
  CONVERSAO_BAIXA:['Conferir fotos, título, descrição, variações e avaliações do anúncio.','Comparar com os anúncios de melhor conversão da loja.'],
  INSUFICIENTE:['Conferir a cobertura de vendas na tela Qualidade dos dados.','Importar os relatórios de vendas que faltam e consultar de novo.'],
  NAO_ATIVO:['Conferir no painel do marketplace a situação atual do anúncio: o cadastro do GA pode estar desatualizado.','Conferir o estoque disponível de cada variação.']
};
const EXTRA={VISIBILIDADE_MENOR:'Verificar posição na busca, categoria e participação em campanhas.',CLIQUE_MENOR:'Comparar foto de capa e título com anúncios concorrentes.',
  VISITAS_MENORES:'Verificar posição na busca e participação em campanhas.',CONVERSAO_MENOR:'Conferir fotos, descrição, variações e avaliações.'};

function unavailableFor(platform,r,ev){
  const list=[{item:'ESTOQUE',text:platform==='SHOPEE'
      ?'Estoque: indisponível. A única fonte é a foto do catálogo, que não é estoque real nem em tempo real. Conferir no painel da Shopee.'
      :'Estoque: indisponível. Esta conta não tem fonte de estoque no GA. Conferir no painel do Mercado Livre.'},
    {item:'PRECO',text:'Preço: indisponível como evidência (sem fonte datada). O GA não recomenda nem altera preços; conferência manual no painel do marketplace.'}];
  const l=r.perf?.latest;
  if(!ev.latest.available)list.push({item:'TRAFEGO',text:'Visitas e conversão: indisponíveis. '+ev.latest.text});
  else if(!ev.latest.fresh)list.push({item:'TRAFEGO',text:'Visitas e conversão: indisponíveis. '+ev.latest.text});
  else if(!l)list.push({item:'TRAFEGO',text:'Visitas e conversão: este anúncio não aparece no relatório de '+rng(ev.latest.start,ev.latest.end)+'.'});
  else if(l.ambiguous_rows)list.push({item:'TRAFEGO',text:'Visitas e conversão: o relatório traz mais de uma linha para este anúncio (variações); não foram somadas.'});
  return list;
}

function factsFor(r,{periods,cov,u,p,pct,newBase}){
  const f=['Unidades vendidas: '+u+' no período atual ('+rng(periods.current.start,periods.current.end)+') e '+p+' no anterior ('+rng(periods.previous.start,periods.previous.end)+').'];
  const d=u-p;
  f.push('Variação: '+(d>0?'+':'')+d+' un'+(pct!=null?' ('+(pct>0?'+':'')+pc(pct)+')':newBase?' (base pequena: sem porcentagem)':'')+'.');
  const covTxt=[cov.current.proven&&'período atual',cov.previous.proven&&'período anterior'].filter(Boolean);
  f.push(covTxt.length===2?'Cobertura de vendas comprovada nos dois períodos (GA-018).':covTxt.length===1?'Cobertura de vendas comprovada só no '+covTxt[0]+' (GA-018).':'Cobertura de vendas não comprovada nos dois períodos (GA-018).');
  if(r.registered&&!r.ambiguous_status&&r.status){
    const when=isoDay(r.status_checked_at);
    f.push('Último estado cadastrado: '+r.status+(when?', verificado em '+when:', sem data de verificação')+' (não é uma confirmação em tempo real).');
  }
  if(r.last_sale)f.push('Última venda importada: '+r.last_sale+' (só histórico importado).');
  return f;
}

const baseRow=(platform,r,{periods,cov,ev,u,p,th})=>{
  const d=p-u;
  const small=p<th.small_base;
  const pct=p>0&&!(small&&u>p)?Math.round((u-p)/p*1000)/10:null;
  return {key:platform+':'+r.ext,external_id:r.ext,listing_id:r.listing_id??null,title:r.title??null,
    status:{label:'Último estado cadastrado',value:r.registered&&!r.ambiguous_status?r.status??null:null,checked_at:r.registered&&!r.ambiguous_status?r.status_checked_at??null:null,registered:Boolean(r.registered)},
    units_current:u,units_previous:p,delta:d,impact_units:u-p,pct_change:pct,kind:null,reason:'',rules:[],missing:[],
    facts:factsFor(r,{periods,cov,u,p,pct,newBase:small&&u>=th.gain&&p<th.small_base}),hypotheses:[],unavailable:unavailableFor(platform,r,ev),investigation:[]};
};

function classifyRow(platform,r,ctx){
  const {th,cov,ev,periods}=ctx;
  const u=r.units_current,p=r.units_previous,d=p-u;
  const row=baseRow(platform,r,{periods,cov,ev,u,p,th});
  const dropPct=p>0&&u*100<=p*(100-th.drop_pct)&&d>=th.review_loss;
  const dropAbs=d>=th.high_loss_abs;
  const newBase=p<th.small_base&&u>=th.gain;
  const gainPct=!newBase&&p>0&&u*100>=p*(100+th.drop_pct)&&u-p>=th.gain;
  const stop=u===0&&p>=th.review_loss;
  const isDrop=dropPct||dropAbs,isGain=newBase||gainPct;
  const drop=isDrop;
  row.hypotheses=hypothesesFor(r,ev,{drop,platform});
  if(!isDrop&&!isGain){
    const conv0=row.hypotheses.find(h=>h.kind==='CONVERSAO_BAIXA');
    if(conv0&&r.registered&&!r.ambiguous_status&&r.status==='ACTIVE'){
      row.kind='CONVERSAO_BAIXA';row.reason='Hipótese de conversão baixa (relatório de desempenho); sem variação relevante de unidades.';row.investigation=INVESTIGATE.CONVERSAO_BAIXA;return {tier:'hipotese_conversao',row};
    }
    row.hypotheses=[];row.kind='SEM_SINAL';
    row.reason='Sem sinal de prioridade: a variação de unidades é pequena ou o volume é baixo'+((cov.current.proven&&cov.previous.proven)?'.':' (a cobertura de vendas dos períodos não está comprovada).');
    return {tier:'sem_prioridade',row};
  }
  row.rules=isDrop?[dropPct&&'PERCENTUAL',dropAbs&&'ABSOLUTA'].filter(Boolean):[newBase?'BASE_PEQUENA':'PERCENTUAL'];
  // O que cada sinal precisa comprovar: parada só do período atual; queda/ganho/base pequena dos dois.
  const needsPrev=!(isDrop&&stop);
  const missing=[];
  if(!cov.current.proven)missing.push('PERIODO_ATUAL');
  if(needsPrev&&!cov.previous.proven)missing.push('PERIODO_ANTERIOR');
  row.kind=isDrop?(stop?'PAROU':'QUEDA'):'NOVA_OU_RETOMADA';
  if(!isDrop&&gainPct)row.kind='CRESCIMENTO';
  const known=r.registered&&!r.ambiguous_status&&Boolean(r.status);
  if(!known)missing.push('SITUACAO_CADASTRADA');
  if(missing.length){
    row.missing=missing;
    row.kind=isDrop?(stop?'POSSIVEL_PARADA':'POSSIVEL_QUEDA'):'POSSIVEL_OPORTUNIDADE';
    row.reason=(r.ambiguous_status?'Atribuição ambígua: o cadastro do anúncio está repetido para esta conta; ':'')+'Possível '+(isDrop?(stop?'parada':'queda'):'oportunidade')+', não confirmada: falta comprovar '
      +missing.map(m=>({PERIODO_ATUAL:'a cobertura de vendas do período atual',PERIODO_ANTERIOR:'a cobertura de vendas do período anterior',SITUACAO_CADASTRADA:'a situação cadastrada do anúncio'}[m])).join(' e ')+'.';
    row.investigation=INVESTIGATE.INSUFICIENTE;
    return {tier:'insuficiente',row};
  }
  if(r.status!=='ACTIVE'){
    row.reason='Variação de unidades confirmada, mas o último estado cadastrado não é ativo ('+r.status+'): o cadastro pode estar desatualizado ou explicar a variação.';
    row.investigation=INVESTIGATE.NAO_ATIVO;
    return {tier:'revisao',row};
  }
  if(isGain){
    row.reason=(newBase?'Saiu de '+p+' para '+u+' un (base pequena, sem porcentagem).':'Crescimento de '+pc(row.pct_change)+' ('+(u-p>0?'+':'')+(u-p)+' un).')+' Comprovado pela cobertura de vendas dos dois períodos.';
    row.investigation=INVESTIGATE.OPORTUNIDADE;
    return {tier:'oportunidade',row};
  }
  const high=(dropPct&&d>=th.high_loss)||dropAbs;
  row.reason=(stop?'Parou de vender: ':'Queda ')+(stop?p+' un no período anterior e 0 no atual.':(row.pct_change!=null?pc(Math.abs(row.pct_change))+' ':'')+'('+d+' un a menos).')
    +(dropAbs&&!dropPct?' Entra como alta pela perda absoluta de '+th.high_loss_abs+' un ou mais.':'');
  row.investigation=[...(stop?INVESTIGATE.PAROU:INVESTIGATE.QUEDA),...row.hypotheses.map(h=>EXTRA[h.kind]).filter(Boolean)];
  return {tier:high?'alta':'revisao',row};
}

const cmp={
  alta:(a,b)=>b.delta-a.delta||b.units_previous-a.units_previous||a.external_id.localeCompare(b.external_id),
  oportunidade:(a,b)=>b.impact_units-a.impact_units||a.external_id.localeCompare(b.external_id),
  hipotese_conversao:(a,b)=>(b.visits??0)-(a.visits??0)||a.external_id.localeCompare(b.external_id),
  insuficiente:(a,b)=>Math.abs(b.delta??0)-Math.abs(a.delta??0)||a.external_id.localeCompare(b.external_id),
  sem_prioridade:(a,b)=>(b.units_current+b.units_previous)-(a.units_current+a.units_previous)||a.external_id.localeCompare(b.external_id)
};
cmp.revisao=cmp.alta;

function makeTier(id,rows){
  const sorted=[...rows].sort(cmp[id]);
  const total=sorted.length,shown=Math.min(total,TIER_LIMIT);
  return {id,total,shown,limit:TIER_LIMIT,truncated:total>TIER_LIMIT,
    limit_note:total>TIER_LIMIT?'Mostrando '+shown+' de '+total+' anúncios desta faixa (maiores impactos primeiro). Os totais incluem todos.':null,rows:sorted.slice(0,TIER_LIMIT)};
}

function reconcile({platform,u,dash,split,periods}){
  const sumCur=num(u?.totals?.units_current),sumPrev=num(u?.totals?.units_previous);
  const dc=num(dash?.totals?.cur_units),dp=num(dash?.totals?.prev_units);
  const dashboard=dc==null||dp==null||sumCur==null?{status:'INDISPONIVEL',decision:{current:sumCur,previous:sumPrev},dashboard:null}
    :{status:dc===sumCur&&dp===sumPrev?'CONCILIADO':'DIVERGENTE',decision:{current:sumCur,previous:sumPrev},dashboard:{current:dc,previous:dp}};
  let shopee=null;
  if(platform==='SHOPEE'){
    if(!split||typeof split!=='object')shopee={status:'INDISPONIVEL'};
    else if(split.start!==periods.current.start||split.end!==periods.current.end)shopee={status:'RESPOSTA_INVALIDA'};
    else if(split.total_units==null)shopee={status:'SEM_INFORMACAO'};
    else{
      const base=num(split.base_units);
      const diverges=base!=null&&sumCur!=null&&base!==sumCur;
      shopee={status:diverges?'DIVERGENTE':(split.reconciliation?.status||'INDISPONIVEL'),total:num(split.total_units),linked:num(split.linked_units),unlinked:num(split.unlinked_units),
        unlinked_skus:num(split.unlinked_sku_count),base,listing_sum:sumCur,residual:num(split.difference?.residual_units),
        note:'Vendas por SKU sem vínculo a anúncio ('+(num(split.unlinked_units)??0)+' un no período atual) não foram atribuídas a nenhum anúncio nem distribuídas entre eles; a soma dos anúncios abaixo não as inclui.'};
    }
  }
  return {dashboard,shopee};
}

export function buildDecisionCenter(p){
  const platform=p.platform,days=Number(p.days);
  const th=DECISION_THRESHOLDS[days]||DECISION_THRESHOLDS[7];
  const failed=new Set(p.failed||[]);
  const dash=p.dash&&typeof p.dash==='object'&&p.dash.platform===platform?p.dash:null;
  const periods=dash?(p.periods??null):null;
  const empty={};for(const id of TIER_IDS)empty[id]=makeTier(id,[]);
  const parts={units:'OK',dashboard:dash?'OK':failed.has('dashboard')?'INDISPONIVEL':'SEM_DADOS',quality:(p.dqCurrent&&p.dqPrevious)?'OK':failed.has('quality')?'INDISPONIVEL':'SEM_DADOS',
    split:platform!=='SHOPEE'?'NAO_SE_APLICA':failed.has('split')?'INDISPONIVEL':p.split?'OK':'SEM_DADOS'};
  const notices=[];
  const out={platform,days,status:'OK',read_only:true,thresholds:th,periods:periods?{current:periods.current,previous:periods.previous}:null,coverage:null,
    summary:{counts:Object.fromEntries(TIER_IDS.map(t=>[t,0])),listings_with_sales:null,units:{current:null,previous:null}},tiers:empty,
    evidence:{latest:{available:false},previous:{available:false}},reconciliation:{dashboard:{status:'INDISPONIVEL'},shopee:null},sources:[],notices,parts,elapsed_ms:p.elapsed_ms??null};
  if(!dash||!periods){
    out.status='SEM_INFORMACAO';
    notices.push({kind:'SEM_INFORMACAO',essential:true,text:'Sem informação de vendas para esta conta: nada foi classificado. Isso não significa zero vendas.'});
    return stripCommercial(out);
  }
  const cov=coverageState({platform,periods,dqCurrent:p.dqCurrent,dqPrevious:p.dqPrevious,dqHistory:null});
  out.coverage={current:cov.current,previous:cov.previous};
  const rawUnits=p.units;
  let chk;
  if(failed.has('units')||!rawUnits){parts.units=failed.has('units')?'INDISPONIVEL':'SEM_DADOS';chk={ok:false,why:'consulta indisponível'};}
  else{chk=checkUnits(rawUnits,{platform,periods});if(!chk.ok)parts.units='RESPOSTA_INVALIDA';}
  out.sources=[
    {name:'VENDAS',label:'Vendas importadas',until:periods.current.end,state:parts.units},
    {name:'COBERTURA',label:'Cobertura de vendas (GA-018)',state:parts.quality,current:cov.current.proven?'COMPROVADA':'NAO_COMPROVADA',previous:cov.previous.proven?'COMPROVADA':'NAO_COMPROVADA'},
    {name:'SITUACAO',label:'Situação cadastrada',state:'ULTIMO_ESTADO_CADASTRADO',note:'Último estado cadastrado, com a data da verificação; não é confirmação em tempo real.'},
    {name:'ESTOQUE',label:'Estoque',state:'INDISPONIVEL'},{name:'PRECO',label:'Preço',state:'INDISPONIVEL'}
  ];
  if(!cov.current.proven)notices.push({kind:'PERIODO_ATUAL_NAO_COMPROVADO',essential:true,text:'A cobertura de vendas do período atual não está comprovada: quedas, paradas e oportunidades aparecem só como possíveis, em "Dados insuficientes".'});
  else if(!cov.previous.proven)notices.push({kind:'PERIODO_ANTERIOR_NAO_COMPROVADO',essential:true,text:'A cobertura de vendas do período anterior não está comprovada: só paradas são confirmadas; quedas e oportunidades aparecem como possíveis.'});
  if(!chk.ok){
    out.status='INDISPONIVEL';
    notices.push({kind:parts.units==='RESPOSTA_INVALIDA'?'FONTE_INVALIDA':'CONSULTA_INDISPONIVEL',essential:true,text:'Não foi possível classificar os anúncios ('+chk.why+'). Nenhuma lista foi montada; isso não significa que não haja prioridades.'});
    return stripCommercial(out);
  }
  const ev=evidenceOf(rawUnits.reports,periods);
  out.evidence=ev;
  out.sources.push({name:'DESEMPENHO',label:'Relatório de desempenho',state:!ev.latest.available?'INDISPONIVEL':ev.latest.fresh?'OK':'DESATUALIZADO',period:ev.latest.available?{start:ev.latest.start,end:ev.latest.end}:null});
  if(ev.latest.stale)notices.push({kind:'RELATORIO_DESATUALIZADO',essential:false,text:ev.latest.text});
  // Identidade = conta + ID. Linha repetida na resposta é atribuição ambígua: não distribui venda, aparece uma vez em "dados insuficientes".
  const seen=new Map();for(const r of rawUnits.rows)seen.set(r.ext,(seen.get(r.ext)||0)+1);
  const buckets=Object.fromEntries(TIER_IDS.map(t=>[t,[]]));
  for(const r of rawUnits.rows){
    if(seen.get(r.ext)>1){
      if(seen.get(r.ext)===-1)continue;
      seen.set(r.ext,-1);
      const row=baseRow(platform,{...r,units_current:0,units_previous:0},{periods,cov,ev,u:0,p:0,th});
      Object.assign(row,{units_current:null,units_previous:null,delta:null,impact_units:null,pct_change:null,kind:'ATRIBUICAO_AMBIGUA',missing:['ATRIBUICAO'],
        facts:['O mesmo anúncio apareceu mais de uma vez na resposta.'],reason:'Atribuição ambígua: o mesmo anúncio apareceu mais de uma vez; nenhuma venda foi atribuída a ele.',investigation:INVESTIGATE.INSUFICIENTE});
      buckets.insuficiente.push(row);continue;
    }
    const {tier,row}=classifyRow(platform,r,{th,cov,ev,periods});
    if(tier==='hipotese_conversao')row.visits=num(r.perf?.latest?.visits);
    buckets[tier].push(row);
  }
  for(const id of TIER_IDS){out.tiers[id]=makeTier(id,buckets[id]);out.summary.counts[id]=buckets[id].length;}
  out.summary.listings_with_sales=num(rawUnits.totals.listings_with_sales);
  out.summary.units={current:num(rawUnits.totals.units_current),previous:num(rawUnits.totals.units_previous),
    unregistered:{listings:num(rawUnits.totals.listings_unregistered),current:num(rawUnits.totals.units_current_unregistered)}};
  out.reconciliation=reconcile({platform,u:rawUnits,dash,split:p.split,periods});
  if(out.reconciliation.dashboard.status==='DIVERGENTE')
    notices.push({kind:'UNIDADES_DIVERGENTES',essential:true,text:'A soma das unidades por anúncio ('+out.reconciliation.dashboard.decision.current+' no período atual) não coincide com o Dashboard ('+out.reconciliation.dashboard.dashboard.current+'): conferir antes de decidir.'});
  if(out.reconciliation.shopee?.status==='DIVERGENTE')
    notices.push({kind:'UNIDADES_DIVERGENTES',essential:true,text:'A soma das unidades por anúncio não coincide com a base da divisão por SKU da Shopee: conferir antes de decidir.'});
  if(out.summary.units.unregistered.listings>0)
    notices.push({kind:'VENDA_SEM_CADASTRO',essential:false,text:out.summary.units.unregistered.listings+' anúncio(s) com venda não têm cadastro no GA: suas unidades estão contadas, mas a situação é desconhecida.'});
  return stripCommercial(out);
}
