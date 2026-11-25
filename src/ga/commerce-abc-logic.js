// GA-015 — Evolução da Curva ABC por produto/SKU: regras puras (sem rede, sem React, sem banco). SOMENTE UNIDADES.
// Não calcula valor em dinheiro, não altera a Curva ABC do Dashboard, não mexe na Central de decisões nem na Visão estratégica.
// A classificação é feita sobre a POPULAÇÃO COMPLETA do período (todos os SKUs com venda positiva); só depois as listas são limitadas.
export const ABC_PLATFORMS=Object.freeze(['SHOPEE','ML_ANTIGO','ML_NOVO']);
export const ABC_MODES=Object.freeze(['7d','30d','mensal','anual']);
// Cortes pelo acumulado ANTERIOR ao grupo de empatados: A enquanto o acumulado antes do grupo for < 80% do total, B < 95%, senão C.
export const ABC_CUTS=Object.freeze({A:80,B:95});
// Volume mínimo da CONTA no período: indicador de relevância comercial, nunca impedimento para calcular a classe.
export const RELEVANCE_MIN_UNITS=100;
export const HISTORY_MONTHS=12;
export const LIST_LIMIT=200;
// Limiares fixados depois da simulação com dados reais (semanas comprovadas 27/10 a 23/11/2026; ver docs/MAPA-GA.md):
// minUnitDelta/minRankMove: variação mínima de unidades e de posições para uma mudança de classe ser "relevante";
// unitBand/ppBand: faixa de estabilidade (unidades e pontos percentuais) para diferenciar crescimento de unidades e de participação.
export const ABC_THRESHOLDS=Object.freeze({
  '7d':Object.freeze({minUnitDelta:5,minRankMove:3,unitBand:2,ppBand:0.25}),
  '30d':Object.freeze({minUnitDelta:10,minRankMove:3,unitBand:3,ppBand:0.25}),
  mensal:Object.freeze({minUnitDelta:10,minRankMove:3,unitBand:3,ppBand:0.25}),
  anual:Object.freeze({minUnitDelta:10,minRankMove:3,unitBand:3,ppBand:0.25})
});
export const isAbcPlatform=p=>ABC_PLATFORMS.includes(p);
export const isAbcMode=m=>ABC_MODES.includes(m);

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isoDay=v=>typeof v==='string'&&DAY.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null;
const ms=d=>Date.parse(d+'T00:00:00Z');
export const dayAdd=(d,n)=>new Date(ms(d)+n*86400000).toISOString().slice(0,10);
export const daysBetween=(a,b)=>Math.round((ms(b)-ms(a))/86400000)+1;
const monthOf=d=>d.slice(0,7);
const monthStart=k=>k+'-01';
const monthEnd=k=>{const [y,m]=k.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const monthAdd=(k,n)=>{const [y,m]=k.split('-').map(Number);const t=y*12+(m-1)+n;return String(Math.floor(t/12)).padStart(4,'0')+'-'+String(t%12+1).padStart(2,'0');};
const isInt=v=>typeof v==='number'&&Number.isInteger(v);
const pc=(a,b)=>b>0?Math.round(a/b*1000)/10:null;
const pp=v=>Math.round(v*100)/100;

// ---------- 1. Classificação de UM período ----------
// products: [{sku,units}] da população completa. Posição competitiva (1,2,2,4); empatados ficam na MESMA posição e na MESMA classe.
// A classe do grupo vem do acumulado ANTERIOR ao grupo. boundary_tie = o grupo cruza um corte (a classe poderia ser outra se fosse desempatado).
export function classifyPeriod(products,key){
  const rows0=(Array.isArray(products)?products:[]).filter(p=>p&&typeof p.sku==='string'&&p.sku&&isInt(p.units)&&p.units>0).slice().sort((a,b)=>b.units-a.units||(a.sku<b.sku?-1:a.sku>b.sku?1:0));
  const total=rows0.reduce((s,p)=>s+p.units,0);
  const clsAt=prec=>prec*100<ABC_CUTS.A*total?'A':prec*100<ABC_CUTS.B*total?'B':'C';
  const rows=[];let prec=0;
  for(let i=0;i<rows0.length;){
    let j=i;while(j<rows0.length&&rows0[j].units===rows0[i].units)j++;
    const size=j-i,u=rows0[i].units,cls=clsAt(prec),boundary=size>1&&clsAt(prec+(size-1)*u)!==cls;
    for(let k=i;k<j;k++){
      const before=prec+(k-i)*u;
      rows.push({sku:rows0[k].sku,units:u,rank:i+1,share_pct:pc(u,total),cum_pct:pc(before+u,total),class:cls,tie_size:size,boundary_tie:boundary});
    }
    prec+=size*u;i=j;
  }
  const counts={A:0,B:0,C:0},classUnits={A:0,B:0,C:0};
  for(const r of rows){counts[r.class]++;classUnits[r.class]+=r.units;}
  // Soma das N maiores quantidades: não depende de como os empatados forem ordenados.
  const top=n=>total>0?pc(rows.slice(0,n).reduce((s,r)=>s+r.units,0),total):null;
  return {key,ranked_units:total,products:rows.length,rows,class_counts:counts,class_units:classUnits,
    concentration:{top1:top(1),top3:top(3),top5:top(5),top10:top(10)},
    top10_members:rows.filter(r=>r.rank<=10).length};
}

// ---------- 2. Conciliação de UM período (GA-019 e GA-021) ----------
// fp = período devolvido pela função SQL; products = lista da função; ga019 = soma da fonte diária GA-019 nas MESMAS datas;
// split = GA-021 (só Shopee) nas mesmas datas. Resíduo precisa ser o NÚMERO 0 (nulo, ausente, texto ou NaN nunca valem).
export function reconcilePeriod({platform,period:fp,products,ga019,split}){
  const out=(status,reason,extra={})=>({status,reason,...extra});
  if(!fp||!isInt(fp.total_units)||!isInt(fp.sku_units)||!isInt(fp.no_sku_units)||!isInt(fp.ranked_units))return out('INDISPONIVEL','FUNCAO_SEM_TOTAIS');
  const sum=(Array.isArray(products)?products:[]).reduce((s,p)=>s+(isInt(p.units)&&p.units>0?p.units:0),0);
  if(fp.sku_units+fp.no_sku_units!==fp.total_units||sum!==fp.ranked_units)return out('DIVERGENTE','TOTAIS_INTERNOS',{total_units:fp.total_units});
  if(!isInt(ga019))return out('INDISPONIVEL','GA019_INDISPONIVEL',{total_units:fp.total_units});
  if(ga019!==fp.total_units)return out('DIVERGENTE','GA019_DIFERENTE',{total_units:fp.total_units,ga019_units:ga019,difference:fp.total_units-ga019});
  if(platform==='SHOPEE'){
    if(!split||typeof split!=='object')return out('INDISPONIVEL','GA021_INDISPONIVEL',{total_units:fp.total_units,ga019_units:ga019});
    const st=split.reconciliation?.status,resid=split.difference?.residual_units;
    if(st==='INDISPONIVEL'||st==='SEM_INFORMACAO'||st==null)return out('INDISPONIVEL','GA021_INDISPONIVEL',{total_units:fp.total_units,ga019_units:ga019});
    if(st!=='EXPLICADA'||split.total_units!==fp.total_units||resid!==0||split.reconciliation?.source_units_match!==true||split.reconciliation?.identity_ok!==true)
      return out('DIVERGENTE','GA021_NAO_EXPLICA',{total_units:fp.total_units,ga019_units:ga019});
    return out('CONCILIADO',null,{total_units:fp.total_units,ga019_units:ga019,explained_by:'GA-021',unlinked_units:isInt(split.unlinked_units)?split.unlinked_units:null});
  }
  return out('CONCILIADO',null,{total_units:fp.total_units,ga019_units:ga019});
}

// ---------- 3. Planejamento dos períodos ----------
// last = último dia completo comprovado (GA-018) da conta; firstDay = primeira data importada da conta.
// Devolve o histórico mensal (até 12 meses, o mês corrente fica "incompleto" e é cortado no último dia completo)
// e o par atual x anterior da comparação pedida, sempre com o MESMO número de dias.
export function planPeriods({mode,last,firstDay,month}){
  if(!isAbcMode(mode))return {error:'MODO_INVALIDO'};
  if(!isoDay(last))return {error:'SEM_ULTIMO_DIA_COMPLETO'};
  const first=isoDay(firstDay)?firstDay:null;
  const lastMonth=monthOf(last);
  const history=[];
  for(let i=HISTORY_MONTHS-1;i>=0;i--){
    const k=monthAdd(lastMonth,-i),s=monthStart(k),e=monthEnd(k);
    if(first&&e<first)continue;
    const incomplete=e>last;
    history.push({key:k,start:s,end:incomplete?last:e,month_end:e,incomplete,kind:'MES'});
  }
  let cur,prev=null,equivalent=true,note=null;
  if(mode==='7d'||mode==='30d'){
    const n=mode==='7d'?7:30;
    cur={key:'j'+n+'_atual',start:dayAdd(last,-n+1),end:last,incomplete:false,kind:'JANELA'};
    prev={key:'j'+n+'_ant',start:dayAdd(last,-2*n+1),end:dayAdd(last,-n),incomplete:false,kind:'JANELA'};
  }else{
    const m=month==null?lastMonth:month;
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))return {error:'MES_INVALIDO'};
    if(m>lastMonth||monthStart(m)>last)return {error:'MES_SEM_DADOS_COMPLETOS'};
    const s=monthStart(m),e=monthEnd(m),incomplete=e>last,end=incomplete?last:e,n=daysBetween(s,end);
    cur={key:'m_atual',start:s,end,month_end:e,incomplete,kind:'MES_ATE_AQUI'};
    if(mode==='mensal'){
      const pm=monthAdd(m,-1),ps=monthStart(pm),pe=monthEnd(pm);
      if(n<=daysBetween(ps,pe))prev={key:'m_ant',start:ps,end:dayAdd(ps,n-1),month_end:pe,incomplete:false,kind:'MES_ATE_AQUI'};
      else{prev={key:'m_ant',start:ps,end:pe,month_end:pe,incomplete:false,kind:'MES_ATE_AQUI'};equivalent=false;note='O mês anterior tem menos dias que o período atual.';}
    }else{
      const sy=String(Number(s.slice(0,4))-1)+s.slice(4);
      let ey=String(Number(end.slice(0,4))-1)+end.slice(4);
      if(!isoDay(ey))ey=dayAdd(String(Number(end.slice(0,4))-1)+'-03-01',-1); // 29/02 sem ano bissexto vira 28/02
      prev={key:'a_ant',start:sy,end:ey,incomplete:false,kind:'MES_ATE_AQUI'};
      if(daysBetween(sy,ey)!==n){equivalent=false;note='O mesmo período do ano anterior tem tamanho diferente.';}
      if(first&&sy<first){prev=null;note='Não há histórico importado do ano anterior nesta conta.';}
    }
  }
  return {mode,history,current:cur,previous:prev,equivalent,note};
}

// ---------- 4. Comparação entre dois períodos ----------
function dir(v,band){return Math.abs(v)<band?0:v>0?1:-1;}
const GROWTH={'1,1':'UNIDADES_E_PARTICIPACAO_SOBEM','1,-1':'UNIDADES_SOBEM_PARTICIPACAO_CAI','1,0':'UNIDADES_SOBEM_PARTICIPACAO_ESTAVEL',
  '-1,1':'UNIDADES_CAEM_PARTICIPACAO_SOBE','-1,-1':'UNIDADES_E_PARTICIPACAO_CAEM','-1,0':'UNIDADES_CAEM_PARTICIPACAO_ESTAVEL',
  '0,1':'UNIDADES_ESTAVEIS_PARTICIPACAO_SOBE','0,-1':'UNIDADES_ESTAVEIS_PARTICIPACAO_CAI','0,0':'ESTAVEL'};
const ORDER={A:0,B:1,C:2};
// prev/cur = resultados de classifyPeriod. confirmed=false: só unidades (sem posição, participação, classe nem migração).
export function comparePeriods(prev,cur,{mode='7d',confirmed=true}={}){
  const th=ABC_THRESHOLDS[mode]||ABC_THRESHOLDS['7d'];
  const pm=new Map(prev.rows.map(r=>[r.sku,r])),cm=new Map(cur.rows.map(r=>[r.sku,r]));
  const accountRelevant=prev.ranked_units>=RELEVANCE_MIN_UNITS&&cur.ranked_units>=RELEVANCE_MIN_UNITS;
  const skus=[...new Set([...pm.keys(),...cm.keys()])];
  const entries=skus.map(sku=>{
    const p=pm.get(sku)||null,c=cm.get(sku)||null,pu=p?p.units:0,cu=c?c.units:0;
    const e={sku,previous_units:pu,current_units:cu,delta_units:cu-pu,delta_units_pct:pu>=th.unitBand?Math.round((cu-pu)/pu*1000)/10:null,
      kind:p&&c?'PERMANECE':c?'ENTRADA':'SAIDA'};
    if(!confirmed)return e;
    e.previous=p&&{rank:p.rank,share_pct:p.share_pct,class:p.class,boundary_tie:p.boundary_tie};
    e.current=c&&{rank:c.rank,share_pct:c.share_pct,class:c.class,boundary_tie:c.boundary_tie};
    if(p&&c){
      const dpp=pp(c.share_pct-p.share_pct),du=cu-pu;
      e.delta_share_pp=dpp;e.delta_rank=p.rank-c.rank; // positivo = subiu na lista
      e.growth=GROWTH[dir(du,th.unitBand)+','+dir(dpp,th.ppBand)];
      if(p.class!==c.class){
        e.kind='MIGRACAO';e.class_change=p.class+'>'+c.class;e.direction=ORDER[c.class]<ORDER[p.class]?'SUBIU':'DESCEU';
        // comprovada (mesmo SKU canônico nos dois períodos, ambos confirmados) é diferente de relevante comercialmente
        e.proven=true;e.relevant=accountRelevant&&Math.abs(du)>=th.minUnitDelta&&Math.abs(e.delta_rank)>=th.minRankMove;
      }
    }else{
      // entrada/saída NÃO são migração: o SKU não tem venda em um dos períodos (ou mudou de identidade sem vínculo comprovado)
      e.identity_note=p?'SEM_VENDA_NO_ATUAL':'SEM_VENDA_NO_ANTERIOR';
    }
    return e;
  });
  const sorter=(a,b)=>Math.abs(b.delta_units)-Math.abs(a.delta_units)||(a.sku<b.sku?-1:1);
  const migrations=entries.filter(e=>e.kind==='MIGRACAO').sort(sorter);
  const top10=r=>r&&r.rank<=10;
  const newTop10=confirmed?entries.filter(e=>top10(e.current)&&!top10(e.previous)).map(e=>({sku:e.sku,previous_rank:e.previous?e.previous.rank:null,rank:e.current.rank,units:e.current_units,from_outside_curve:!e.previous,relevant:accountRelevant&&e.current_units>=th.minUnitDelta})).sort((a,b)=>a.rank-b.rank||(a.sku<b.sku?-1:1)):[];
  const newClassA=confirmed?entries.filter(e=>e.current?.class==='A'&&e.previous?.class!=='A').map(e=>({sku:e.sku,previous_class:e.previous?e.previous.class:null,rank:e.current.rank,units:e.current_units,from_outside_curve:!e.previous,relevant:accountRelevant&&e.current_units>=th.minUnitDelta})).sort((a,b)=>a.rank-b.rank||(a.sku<b.sku?-1:1)):[];
  const mig={total:migrations.length,relevant:migrations.filter(m=>m.relevant).length,up:migrations.filter(m=>m.direction==='SUBIU').length,down:migrations.filter(m=>m.direction==='DESCEU').length};
  return {confirmed,thresholds:th,
    relevance:{min_units:RELEVANCE_MIN_UNITS,previous_units:prev.ranked_units,current_units:cur.ranked_units,relevant:accountRelevant},
    entries:entries.sort(sorter),migrations:confirmed?migrations:[],migration_counts:confirmed?mig:null,new_top10:newTop10,new_class_a:newClassA,
    entered:entries.filter(e=>e.kind==='ENTRADA').length,left:entries.filter(e=>e.kind==='SAIDA').length};
}

// ---------- 5. Evolução completa de uma conta ----------
// data = resposta da função SQL (periods/products); ga019 = {chave:unidades}; coverage = {chave:'COMPLETA'|...}; splits = {chave:split GA-021}.
// plan = planPeriods(...). Períodos sem prova de cobertura ficam "não comprovados": mostram unidades, nunca classe confirmada nem migração.
export function buildAbcEvolution({platform,mode,today,last,plan,data,ga019,coverage,splits,limit=LIST_LIMIT}){
  if(!isAbcPlatform(platform))return {status:'INVALIDO',reason:'PLATAFORMA'};
  if(!plan||plan.error)return {status:'INDISPONIVEL',reason:plan?plan.error:'SEM_PLANO',platform,mode,today:today||null,last_complete_day:last||null};
  const fper=new Map((data&&Array.isArray(data.periods)?data.periods:[]).map(p=>[p.key,p]));
  const skuUnits=key=>(data&&Array.isArray(data.products)?data.products:[]).filter(p=>p&&p.units&&isInt(p.units[key])&&p.units[key]>0).map(p=>({sku:p.sku,units:p.units[key]}));
  const all=[...plan.history,plan.current,...(plan.previous?[plan.previous]:[])];
  const info=new Map();
  for(const pd of all){
    const fp=fper.get(pd.key),products=skuUnits(pd.key);
    const rec=reconcilePeriod({platform,period:fp,products,ga019:ga019?ga019[pd.key]:null,split:splits?splits[pd.key]:null});
    const cov=coverage&&coverage[pd.key]?coverage[pd.key]:'INDISPONIVEL';
    const blocked=rec.status!=='CONCILIADO';
    const status=blocked?(rec.status==='DIVERGENTE'?'BLOQUEADO_DIVERGENTE':'BLOQUEADO_INDISPONIVEL'):cov==='COMPLETA'?'CONFIRMADO':'NAO_COMPROVADO';
    const cls=blocked?null:classifyPeriod(products,pd.key);
    info.set(pd.key,{pd,fp,products,rec,cov,status,cls});
  }
  const view=i=>{
    const {pd,fp,rec,cov,status,cls}=i;
    const base=fp?{kind:'UNIDADES_COM_SKU',ranked_units:fp.ranked_units,total_units:fp.total_units,no_sku_units:fp.no_sku_units,no_sku_pct:pc(fp.no_sku_units,fp.total_units),nonpositive_units:fp.nonpositive_units}:null;
    return {key:pd.key,kind:pd.kind,start:pd.start,end:pd.end,month_end:pd.month_end||null,days:daysBetween(pd.start,pd.end),incomplete:pd.incomplete,
      status,coverage:cov,reconciliation:rec,base,
      products:cls?cls.products:null,class_counts:cls?cls.class_counts:null,class_units:cls?cls.class_units:null,
      concentration:cls&&status==='CONFIRMADO'?cls.concentration:null,concentration_provisional:cls&&status!=='CONFIRMADO'?cls.concentration:null,
      top10_members:cls?cls.top10_members:null,classes_confirmed:status==='CONFIRMADO'};
  };
  const cur=info.get(plan.current.key),prv=plan.previous?info.get(plan.previous.key):null;
  let comparison;
  if(!prv)comparison={state:'SEM_PERIODO_ANTERIOR',reason:plan.note||'SEM_HISTORICO'};
  else if(cur.status.startsWith('BLOQUEADO')||prv.status.startsWith('BLOQUEADO')){
    const div=[cur,prv].some(x=>x.status==='BLOQUEADO_DIVERGENTE');
    comparison={state:div?'BLOQUEADA_DIVERGENTE':'BLOQUEADA_INDISPONIVEL',reason:'CONCILIACAO'};
    const cu=new Map(cur.products.map(p=>[p.sku,p.units])),pu=new Map(prv.products.map(p=>[p.sku,p.units]));
    comparison.entries=[];comparison.note='As unidades não passaram na conciliação: classes e migrações ficam bloqueadas.';
    comparison.migrations=[];comparison.new_top10=[];comparison.new_class_a=[];void cu;void pu;
  }else if(!plan.equivalent)comparison={state:'PERIODOS_DIFERENTES',reason:plan.note};
  else{
    const ok=cur.status==='CONFIRMADO'&&prv.status==='CONFIRMADO';
    const cmp=comparePeriods(prv.cls,cur.cls,{mode,confirmed:ok});
    comparison={state:ok?'CONFIRMADA':'NAO_COMPROVADA',reason:ok?null:'COBERTURA_NAO_COMPROVADA',...cmp};
  }
  if(comparison.entries){
    comparison.entries_total=comparison.entries.length;
    // listas limitadas só na exibição; classificação e contagens já usaram a população completa
    comparison.entries=comparison.entries.slice(0,limit);comparison.entries_truncated=comparison.entries_total>comparison.entries.length;
    delete comparison.thresholds;comparison.thresholds=ABC_THRESHOLDS[mode];
  }
  return {status:'OK',platform,mode,basis:'UNIDADES',today:today||null,last_complete_day:last,
    equivalent:plan.equivalent,note:plan.note||null,
    current:view(cur),previous:prv?view(prv):null,history:plan.history.map(h=>view(info.get(h.key))),comparison};
}
