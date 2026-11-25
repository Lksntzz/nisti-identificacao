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
// Relatórios comparativos: duração mínima, intervalo máximo entre eles e sem sobreposição (valores por dia absorvem durações diferentes).
export const REPORT_MIN_DAYS=5,REPORT_MAX_GAP_DAYS=35;
const MIN_VISITS=100,MIN_IMPRESSIONS=1000,EVIDENCE_DROP_PCT=-20,CONV_RATIO=0.5;
const TIER_IDS=['alta','revisao','oportunidade','hipotese_conversao','insuficiente','sem_prioridade'];

const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const isoDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&!Number.isNaN(Date.parse(v.slice(0,10)))?v.slice(0,10):null;
const ddmm=d=>d?d.slice(8,10)+'/'+d.slice(5,7):'—';
const rng=(a,b)=>ddmm(a)+' a '+ddmm(b);
const nf1=v=>String(Math.round(Number(v)*10)/10).replace('.',',');
const pc=v=>String(Math.round(v*10)/10).replace('.',',')+'%';
const spanOf=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
const ageDays=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const dayBefore=d=>new Date(Date.parse(d)-86400000).toISOString().slice(0,10);
const sameRange=(a,b)=>Boolean(a&&b&&isoDay(a.start)===b.start&&isoDay(a.end)===b.end);

// Valida o Dashboard ANTES de usar os períodos: conta e dias pedidos, datas reais, tamanho exato e continuidade entre atual e anterior.
export function validateDashboardPeriods(dash,{platform,days}){
  if(!dash||typeof dash!=='object'||Array.isArray(dash))return {ok:false,why:'resposta do Dashboard vazia ou em formato inesperado'};
  if(dash.platform!==platform)return {ok:false,why:'o Dashboard respondeu para outra conta'};
  const n=Number(days);
  if(!Number.isInteger(n)||Number(dash.days)!==n)return {ok:false,why:'o Dashboard respondeu para outra quantidade de dias'};
  const last=isoDay(dash.last_day),first=isoDay(dash.first_day),cs=isoDay(dash.current_start),ps=isoDay(dash.previous_start);
  if(!last||!first||!cs||!ps)return {ok:false,why:'datas do Dashboard ausentes ou inválidas'};
  if(cs>last)return {ok:false,why:'o período atual do Dashboard começa depois do último dia'};
  if(spanOf(cs,last)!==n)return {ok:false,why:'o período atual do Dashboard não tem '+n+' dias'};
  const pe=dayBefore(cs);
  if(spanOf(ps,pe)!==n||ps>pe)return {ok:false,why:'o período anterior do Dashboard não tem '+n+' dias ou não é contínuo com o atual'};
  if(first>cs)return {ok:false,why:'o início do histórico é posterior ao período atual'};
  return {ok:true,periods:{days:n,current:{start:cs,end:last},previous:{start:ps,end:pe},history:{start:first,end:last}}};
}

// Valida a resposta de commerce_decision_units_v1: conta e datas devem ser as pedidas; lista cortada ou soma que não fecha não classifica nada.
function checkUnits(u,{platform,periods}){
  if(!u||typeof u!=='object'||Array.isArray(u))return {ok:false,why:'resposta vazia ou em formato inesperado'};
  if(u.platform!==platform)return {ok:false,why:'a resposta é de outra conta'};
  if(!periods||!sameRange(u.current,periods.current)||!sameRange(u.previous,periods.previous))return {ok:false,why:'os períodos da resposta não são os pedidos'};
  if(!Array.isArray(u.rows)||!u.totals||typeof u.totals!=='object')return {ok:false,why:'lista ou totais ausentes'};
  if(!u.reconciliation||typeof u.reconciliation!=='object'||!u.reconciliation.current||!u.reconciliation.previous)return {ok:false,why:'a conciliação da função está ausente'};
  if(u.truncated===true)return {ok:false,why:'a lista veio cortada; classificar só uma parte esconderia anúncios'};
  if(num(u.row_count)!==u.rows.length)return {ok:false,why:'a quantidade de linhas não confere'};
  let sc=0,sp=0,uc=0,up=0;
  for(const r of u.rows){
    if(!r||typeof r.ext!=='string'||r.ext===''||num(r.units_current)==null||num(r.units_previous)==null||r.units_current<0||r.units_previous<0)
      return {ok:false,why:'linha de anúncio inválida'};
    sc+=r.units_current;sp+=r.units_previous;
    if(!r.registered){uc+=r.units_current;up+=r.units_previous;}
  }
  const t=u.totals;
  if(num(t.listings)!==u.rows.length)return {ok:false,why:'o total de anúncios não confere com as linhas'};
  if(num(t.units_current)!==sc||num(t.units_previous)!==sp)return {ok:false,why:'a soma das unidades das linhas não confere com os totais da função'};
  if(num(t.units_current_unregistered)!==uc||num(t.units_previous_unregistered)!==up)return {ok:false,why:'as unidades sem cadastro não conferem com as linhas'};
  return {ok:true};
}

function reportOk(r){
  if(!r||typeof r!=='object')return null;
  const st=isoDay(r.start),en=isoDay(r.end);
  if(!st||!en||st>en)return null;
  const days=spanOf(st,en);
  if(r.days!=null&&Number(r.days)!==days)return null;
  return {start:st,end:en,days};
}
function evidenceOf(reports,periods){
  const l0=reports?.latest,p0=reports?.previous;
  const out={latest:{available:false,fresh:false,stale:false,text:'Nenhum relatório de desempenho importado para esta conta: visitas, impressões e conversão estão indisponíveis.'},
    previous:{available:false,comparable:false,reason:'SEM_RELATORIO_ANTERIOR'}};
  if(!l0)return out;
  const l=reportOk(l0);
  if(!l){out.latest.text='O relatório de desempenho mais recente tem datas inválidas ou incoerentes: visitas, impressões e conversão estão indisponíveis.';out.previous.reason='RELATORIO_INVALIDO';return out;}
  const age=Math.max(0,ageDays(l.end,periods.current.end));
  const fresh=age<=REPORT_MAX_AGE_DAYS;
  out.latest={available:true,fresh,stale:!fresh,start:l.start,end:l.end,days:l.days,imported_at:l0.imported_at??null,age_days:age,
    store_visits:num(l0.store_visits),store_orders:num(l0.store_orders),
    text:fresh?'Relatório de desempenho de '+rng(l.start,l.end)+' ('+l.days+' dias; termina '+age+' dia(s) antes do fim do período atual).'
      :'O relatório de desempenho mais recente é de '+rng(l.start,l.end)+' ('+(age)+' dias antes do fim do período atual): antigo demais para servir de evidência. Visitas, impressões e conversão ficam indisponíveis.'};
  if(!p0)return out;
  const p=reportOk(p0);
  if(!p){out.previous={available:false,comparable:false,reason:'RELATORIO_INVALIDO'};return out;}
  // Comparável = mesma conta (garantido pela função), sem sobreposição, próximos no tempo, duração mínima e valores por dia disponíveis.
  const overlap=p.end>=l.start;
  const gap=overlap?null:spanOf(p.end,l.start)-2;
  const gapOk=gap!=null&&gap>=0&&gap<=REPORT_MAX_GAP_DAYS&&(reports.gap_days==null||Number(reports.gap_days)===gap);
  let reason=null;
  if(overlap)reason='SOBREPOSTOS';
  else if(!gapOk)reason='DISTANTES';
  else if(p.days<REPORT_MIN_DAYS||l.days<REPORT_MIN_DAYS)reason='CURTOS';
  else if(reports.comparable&&reports.comparable.ok===false)reason=reports.comparable.reason||'NAO_COMPARAVEL';
  else if(!fresh)reason='DESATUALIZADO';
  out.previous={available:true,comparable:reason==null,reason,start:p.start,end:p.end,days:p.days,gap_days:gap};
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
  // Queda: dois relatórios comparáveis (mesma conta, sem sobreposição, próximos, duração mínima) e volume mínimo nos dois.
  // Impressões e visitas são comparadas POR DIA (durações diferentes); sem o valor por dia não há hipótese.
  const pv=r.perf?.previous;
  if(drop&&ev.previous.comparable&&pv&&!pv.ambiguous_rows){
    const chg=(a,b)=>a>0?Math.round((b-a)/a*1000)/10:null;
    const add=(kind,c0,text)=>{if(c0!=null&&c0<=EVIDENCE_DROP_PCT)out.push({kind,change_pct:c0,period,previous_period:{start:ev.previous.start,end:ev.previous.end},text});};
    if(platform==='SHOPEE'&&num(l.impressions)>=MIN_IMPRESSIONS&&num(pv.impressions)>=MIN_IMPRESSIONS&&num(l.impressions_per_day)!=null&&num(pv.impressions_per_day)!=null)
      add('VISIBILIDADE_MENOR',chg(pv.impressions_per_day,l.impressions_per_day),'As impressões por dia caíram de '+nf1(pv.impressions_per_day)+' ('+rng(ev.previous.start,ev.previous.end)+') para '+nf1(l.impressions_per_day)+' ('+rng(period.start,period.end)+'): pode indicar perda de visibilidade. É uma hipótese, não um fato.');
    if(platform==='SHOPEE'&&num(l.impressions)>=MIN_IMPRESSIONS&&num(pv.impressions)>=MIN_IMPRESSIONS&&num(l.clicks)!=null&&num(pv.clicks)!=null){
      const a=pv.clicks/pv.impressions,b=l.clicks/l.impressions;
      add('CLIQUE_MENOR',chg(a,b),'A taxa de cliques caiu entre os mesmos relatórios: pode indicar que o anúncio atrai menos cliques. É uma hipótese, não um fato.');
    }
    if(num(l.visits)>=MIN_VISITS&&num(pv.visits)>=MIN_VISITS){
      if(platform!=='SHOPEE'&&num(l.visits_per_day)!=null&&num(pv.visits_per_day)!=null)add('VISITAS_MENORES',chg(pv.visits_per_day,l.visits_per_day),'As visitas por dia caíram de '+nf1(pv.visits_per_day)+' ('+rng(ev.previous.start,ev.previous.end)+') para '+nf1(l.visits_per_day)+' ('+rng(period.start,period.end)+'): pode indicar menos exposição. É uma hipótese, não um fato.');
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

const MISS_PT={PERIODO_ATUAL:'a cobertura de vendas do período atual',PERIODO_ANTERIOR:'a cobertura de vendas do período anterior',CONCILIACAO:'a conciliação das unidades',SITUACAO_CADASTRADA:'a situação cadastrada do anúncio'};
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
  const {th,cov,ev,periods,blocked}=ctx;
  const u=r.units_current,p=r.units_previous,d=p-u;
  const row=baseRow(platform,r,{periods,cov,ev,u,p,th});
  const dropPct=p>0&&u*100<=p*(100-th.drop_pct)&&d>=th.review_loss;
  const dropAbs=d>=th.high_loss_abs;
  const newBase=p<th.small_base&&u>=th.gain;
  const gainPct=!newBase&&p>0&&u*100>=p*(100+th.drop_pct)&&u-p>=th.gain;
  const stop=u===0&&p>=th.review_loss;
  const isDrop=dropPct||dropAbs,isGain=newBase||gainPct;
  // Qualquer classificação de unidades (perda, ganho OU ausência de prioridade) exige cobertura dos DOIS períodos e conciliação sem divergência.
  const miss=[];
  if(!cov.current.proven)miss.push('PERIODO_ATUAL');
  if(!cov.previous.proven)miss.push('PERIODO_ANTERIOR');
  if(blocked)miss.push('CONCILIACAO');
  const verified=miss.length===0;
  // Fato separado: ausência de vendas no período atual comprovada pela cobertura do próprio período (não confirma o impacto contra o anterior).
  const absence=u===0&&cov.current.proven&&!blocked;
  row.hypotheses=hypothesesFor(r,ev,{drop:isDrop,platform});
  if(!isDrop&&!isGain){
    const conv0=row.hypotheses.find(h=>h.kind==='CONVERSAO_BAIXA');
    if(conv0&&r.registered&&!r.ambiguous_status&&r.status==='ACTIVE'){
      row.kind='CONVERSAO_BAIXA';row.reason='Hipótese de conversão baixa (relatório de desempenho); '+(verified?'sem variação relevante de unidades.':'a variação de unidades não está verificada (cobertura ou conciliação pendente).');
      row.investigation=INVESTIGATE.CONVERSAO_BAIXA;return {tier:'hipotese_conversao',row};
    }
    row.hypotheses=[];
    if(!verified){
      row.kind='SEM_SINAL_NAO_COMPROVADO';row.missing=miss;
      row.reason='Sem sinal nos dados importados, mas a cobertura ou a conciliação das unidades não está comprovada ('+miss.map(m=>MISS_PT[m]).join(', ')+'): isso não comprova ausência de prioridade, nem zero vendas.';
      if(absence){row.proven_facts=['SEM_VENDAS_PERIODO_ATUAL'];row.facts.push('Sem vendas no período atual: ausência comprovada pela cobertura de vendas do período (GA-018).');}
      row.investigation=INVESTIGATE.INSUFICIENTE;return {tier:'insuficiente',row};
    }
    if(u===0&&p===0){row.kind='SEM_VENDAS_COMPROVADO';row.reason='Sem vendas nos dois períodos, com a cobertura de vendas comprovada: sem prioridade comercial.';}
    else{row.kind='SEM_SINAL';row.reason='Sem sinal de prioridade: a variação de unidades é pequena ou o volume é baixo.';}
    return {tier:'sem_prioridade',row};
  }
  row.rules=isDrop?[dropPct&&'PERCENTUAL',dropAbs&&'ABSOLUTA'].filter(Boolean):[newBase?'BASE_PEQUENA':'PERCENTUAL'];
  const missing=[...miss];
  row.kind=isDrop?(stop?'PAROU':'QUEDA'):'NOVA_OU_RETOMADA';
  if(!isDrop&&gainPct)row.kind='CRESCIMENTO';
  const known=r.registered&&!r.ambiguous_status&&Boolean(r.status);
  if(!known)missing.push('SITUACAO_CADASTRADA');
  if(missing.length){
    row.missing=missing;
    row.kind=isDrop?(stop?'POSSIVEL_PARADA':'POSSIVEL_QUEDA'):'POSSIVEL_OPORTUNIDADE';
    if(absence&&missing.includes('PERIODO_ANTERIOR')&&!missing.includes('PERIODO_ATUAL')){
      row.proven_facts=['SEM_VENDAS_PERIODO_ATUAL'];
      row.facts.push('Sem vendas no período atual: ausência comprovada pela cobertura de vendas do período (GA-018).');
      row.reason='Ausência de vendas no período atual comprovada pela cobertura de vendas (GA-018). O período anterior não está comprovado: a perda de unidades e a prioridade não são confirmadas.';
    }else{
      row.reason=(r.ambiguous_status?'Atribuição ambígua: o cadastro do anúncio está repetido para esta conta; ':'')+'Possível '+(isDrop?(stop?'parada':'queda'):'oportunidade')+', não confirmada: falta comprovar '
        +missing.map(m=>MISS_PT[m]).join(' e ')+'.';
    }
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

const BLOCKING=new Set(['DIVERGENTE','RESIDUO_NAO_EXPLICADO','INCONSISTENTE','RESPOSTA_INVALIDA']);
// Conciliação dos DOIS períodos: Dashboard (GA-019), função do banco (sem ID, sem cadastro, resíduo) e, na Shopee, divisão por SKU (GA-021).
function reconcile({platform,u,dash,split,periods}){
  const sc=num(u.totals.units_current),sp=num(u.totals.units_previous);
  const dc=num(dash?.totals?.cur_units),dp=num(dash?.totals?.prev_units);
  const per=(d,s)=>d==null||s==null?'INDISPONIVEL':d===s?'CONCILIADO':'DIVERGENTE';
  const dCur=per(dc,sc),dPrev=per(dp,sp);
  const dashboard={status:dCur==='DIVERGENTE'||dPrev==='DIVERGENTE'?'DIVERGENTE':(dCur==='INDISPONIVEL'||dPrev==='INDISPONIVEL')?'INDISPONIVEL':'CONCILIADO',
    current_status:dCur,previous_status:dPrev,decision:{current:sc,previous:sp},dashboard:dc==null||dp==null?null:{current:dc,previous:dp}};
  const rc=u.reconciliation;
  const brk=k=>{const x=rc[k]||{};return {source_units:num(x.source_units),units_without_id:num(x.units_without_id),units_registered:num(x.units_registered),
    units_unregistered:num(x.units_unregistered),rows_units:num(x.rows_units),unexplained_units:num(x.unexplained_units),unlinked_sku_units:null};};
  const breakdown={current:brk('current'),previous:brk('previous')};
  const db={status:rc.status==='CONCILIADA'&&breakdown.current.unexplained_units===0&&breakdown.previous.unexplained_units===0?'CONCILIADA':'RESIDUO_NAO_EXPLICADO'};
  let shopee=null;
  if(platform==='SHOPEE'){
    const one=(s,period,base0,key)=>{
      if(!s||typeof s!=='object')return {status:'INDISPONIVEL'};
      if(s.start!==period.start||s.end!==period.end)return {status:'RESPOSTA_INVALIDA'};
      if(s.total_units==null)return {status:'SEM_INFORMACAO'};
      const base=num(s.base_units),unl=num(s.unlinked_units);
      breakdown[key].unlinked_sku_units=unl;
      const diverges=base!=null&&base0!=null&&base!==base0;
      return {status:diverges?'DIVERGENTE':(s.reconciliation?.status||'INDISPONIVEL'),total:num(s.total_units),linked:num(s.linked_units),unlinked:unl,
        unlinked_skus:num(s.unlinked_sku_count),base,listing_sum:base0,residual:num(s.difference?.residual_units)};
    };
    const cur=one(split?.current,periods.current,breakdown.current.source_units??sc,'current');
    const prev=one(split?.previous,periods.previous,breakdown.previous.source_units??sp,'previous');
    const all=[cur.status,prev.status];
    const blockedS=all.find(x=>BLOCKING.has(x));
    const status=blockedS||(all.every(x=>x==='EXPLICADA')?'EXPLICADA':all.includes('INDISPONIVEL')?'INDISPONIVEL':all.includes('SEM_INFORMACAO')?'SEM_INFORMACAO':'INDISPONIVEL');
    shopee={status,current:cur,previous:prev,total:cur.total??null,linked:cur.linked??null,unlinked:cur.unlinked??null,unlinked_skus:cur.unlinked_skus??null,base:cur.base??null,
      listing_sum:cur.listing_sum??null,residual:cur.residual??null,
      note:'Vendas por SKU sem vínculo a anúncio ('+(cur.unlinked??0)+' un no período atual, '+(prev.unlinked??0)+' no anterior) não foram atribuídas a nenhum anúncio nem distribuídas entre eles; a soma dos anúncios abaixo não as inclui.'};
  }
  const reasons=[];
  if(dashboard.status==='DIVERGENTE')reasons.push('a soma por anúncio ('+sc+' atual, '+sp+' anterior) não coincide com o Dashboard ('+dc+' atual, '+dp+' anterior)');
  if(db.status!=='CONCILIADA')reasons.push('a função do banco deixou unidades sem explicação (resíduo)');
  if(shopee&&BLOCKING.has(shopee.status))reasons.push('a conciliação com a divisão por SKU da Shopee não fecha ('+shopee.status+')');
  const unavailable=dashboard.status==='INDISPONIVEL'||(shopee&&(shopee.status==='INDISPONIVEL'||shopee.status==='SEM_INFORMACAO'));
  return {dashboard,shopee,breakdown,db,blocked:reasons.length>0,blocked_reasons:reasons,unavailable};
}

export function buildDecisionCenter(p){
  const platform=p.platform,days=Number(p.days);
  const th=DECISION_THRESHOLDS[days]||DECISION_THRESHOLDS[7];
  const failed=new Set(p.failed||[]);
  // O Dashboard é validado (conta, dias, datas, tamanhos e continuidade) ANTES de os períodos serem usados; p.periods é ignorado.
  const dashObj=p.dash&&typeof p.dash==='object'?p.dash:null;
  const dv=dashObj?validateDashboardPeriods(dashObj,{platform,days}):null;
  const periods=dv&&dv.ok?dv.periods:null;
  const dash=periods?dashObj:null;
  const empty={};for(const id of TIER_IDS)empty[id]=makeTier(id,[]);
  const parts={units:'OK',dashboard:dash?'OK':(dv&&!dv.ok)?'RESPOSTA_INVALIDA':failed.has('dashboard')?'INDISPONIVEL':'SEM_DADOS',quality:(p.dqCurrent&&p.dqPrevious)?'OK':failed.has('quality')?'INDISPONIVEL':'SEM_DADOS',
    split:platform!=='SHOPEE'?'NAO_SE_APLICA':failed.has('split')?'INDISPONIVEL':(p.split&&(p.split.current||p.split.previous))?'OK':'SEM_DADOS'};
  const notices=[];
  const out={platform,days,status:'OK',read_only:true,thresholds:th,periods:periods?{current:periods.current,previous:periods.previous}:null,coverage:null,
    blocked_confirmations:false,summary:{counts:Object.fromEntries(TIER_IDS.map(t=>[t,0])),listings_with_sales:null,proven_no_sales_current:0,units:{current:null,previous:null}},tiers:empty,
    evidence:{latest:{available:false},previous:{available:false}},reconciliation:{dashboard:{status:'INDISPONIVEL'},shopee:null},sources:[],notices,parts,elapsed_ms:p.elapsed_ms??null};
  if(dv&&!dv.ok){
    out.status='INDISPONIVEL';
    notices.push({kind:'FONTE_INVALIDA',essential:true,text:'Os períodos do Dashboard não são confiáveis ('+dv.why+'): nada foi classificado. Isso não significa que não haja prioridades.'});
    return stripCommercial(out);
  }
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
  if(!cov.current.proven)notices.push({kind:'PERIODO_ATUAL_NAO_COMPROVADO',essential:true,text:'A cobertura de vendas do período atual não está comprovada: quedas, paradas, oportunidades e "sem prioridade" não são confirmadas; os anúncios aparecem em "Dados insuficientes".'});
  else if(!cov.previous.proven)notices.push({kind:'PERIODO_ANTERIOR_NAO_COMPROVADO',essential:true,text:'A cobertura de vendas do período anterior não está comprovada: nenhuma perda ou ganho de unidades é confirmado e "sem prioridade" também não; a ausência comprovada de vendas no período atual aparece como fato separado, sem confirmar o impacto.'});
  if(!chk.ok){
    out.status='INDISPONIVEL';
    notices.push({kind:parts.units==='RESPOSTA_INVALIDA'?'FONTE_INVALIDA':'CONSULTA_INDISPONIVEL',essential:true,text:'Não foi possível classificar os anúncios ('+chk.why+'). Nenhuma lista foi montada; isso não significa que não haja prioridades.'});
    return stripCommercial(out);
  }
  const rec=reconcile({platform,u:rawUnits,dash,split:p.split,periods});
  out.reconciliation=rec;out.blocked_confirmations=rec.blocked;
  if(rec.blocked)notices.push({kind:'UNIDADES_DIVERGENTES',essential:true,text:'Classificações confirmadas bloqueadas: '+rec.blocked_reasons.join('; ')+'. Os anúncios aparecem em "Dados insuficientes" até a divergência ser conferida.'});
  if(!rec.blocked&&rec.unavailable)notices.push({kind:'CONCILIACAO_INDISPONIVEL',essential:false,text:'Parte da conciliação das unidades não está disponível (Dashboard ou divisão por SKU da Shopee): as classificações seguem, mas não foram conferidas contra essa fonte.'});
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
    const {tier,row}=classifyRow(platform,r,{th,cov,ev,periods,blocked:rec.blocked});
    if(tier==='hipotese_conversao')row.visits=num(r.perf?.latest?.visits);
    buckets[tier].push(row);
  }
  for(const id of TIER_IDS){out.tiers[id]=makeTier(id,buckets[id]);out.summary.counts[id]=buckets[id].length;}
  out.summary.listings_with_sales=num(rawUnits.totals.listings_with_sales);
  out.summary.proven_no_sales_current=Object.values(buckets).flat().filter(r=>r.proven_facts?.includes('SEM_VENDAS_PERIODO_ATUAL')).length;
  out.summary.units={current:num(rawUnits.totals.units_current),previous:num(rawUnits.totals.units_previous),
    unregistered:{listings:num(rawUnits.totals.listings_unregistered),current:num(rawUnits.totals.units_current_unregistered)}};
  if(out.summary.units.unregistered.listings>0)
    notices.push({kind:'VENDA_SEM_CADASTRO',essential:false,text:out.summary.units.unregistered.listings+' anúncio(s) com venda não têm cadastro no GA: suas unidades estão contadas, mas a situação é desconhecida.'});
  return stripCommercial(out);
}
