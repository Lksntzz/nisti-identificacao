// GA-014 — dados FICTÍCIOS nos formatos reais das respostas (commerce_decision_units_v1 revisada, Dashboard, GA-018, GA-021). Sem rede.
import {analysisWindow} from '../src/ga/commerce-decision-logic.js';
export const spanOf=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
// Hoje = 25/11; 24/11 é parcial e 23/11 é o último dia completo comprovado (caso real das três contas).
export const TODAY='2026-11-25';
export const facts=(o={})=>({today:TODAY,last_import_day:'2026-11-24',last_import_at:'2026-11-24T13:53:39+00:00',last_complete_day:'2026-11-23',skipped:[{day:'2026-11-24',state:'PARCIAL'}],probes:2,...o});
export const winOf=(days=7,o={})=>{const r=analysisWindow(facts(o),days);if(!r.ok)throw new Error(r.why);return r.window;};
// Total da fonte diária da GA-019 nas MESMAS datas da Central (soma da view + vendas sem ID).
export const sourceOf=(u,w,o={})=>({current:{start:w.current.start,end:w.current.end,units:u.reconciliation.current.source_units,...(o.current||{})},
  previous:{start:w.previous.start,end:w.previous.end,units:u.reconciliation.previous.source_units,...(o.previous||{})}});
export const dq=(platform,start,end,ok=true)=>{const span=spanOf(start,end);
  return {platform,period:{start,end},sales:{status:ok?'COMPLETA':'PARCIAL',requested_days:span,complete_days:ok?span:span-2,partial_days:0,
    days_without_information:ok?0:2,days_with_records_unverified:0,missing_ranges:ok?[]:[{start:end,end,days:2}]}};};
export const row=(ext,uc,up,o={})=>({ext,listing_id:Number(String(ext).replace(/\D/g,''))||1,title:'Anúncio '+ext,registered:true,ambiguous_status:false,status:'ACTIVE',
  status_checked_at:'2026-11-17T11:17:46.521006+00:00',units_current:uc,units_previous:up,last_sale:'2026-11-22',first_sale:'2026-01-05',in_report:false,
  perf:{latest:null,previous:null},...o});
// Relatórios no formato novo: dias, intervalo e comparable.
export const reports=(l,p)=>({
  latest:l?{start:l[0],end:l[1],days:spanOf(l[0],l[1]),imported_at:'2026-11-23T10:00:00+00:00',store_visits:2000,store_orders:100,...(l[2]||{})}:null,
  previous:p?{start:p[0],end:p[1],days:spanOf(p[0],p[1]),imported_at:'2026-11-05T10:00:00+00:00'}:null,
  gap_days:l&&p?spanOf(p[1],l[0])-2:null,
  comparable:{ok:Boolean(l&&p),reason:!l?'SEM_RELATORIO':!p?'SEM_RELATORIO_ANTERIOR':null}});
// Desempenho de uma linha: valores brutos + por dia (dias do relatório).
export const perfOf=(days,{imp=null,clk=null,vis=null,ord=null,ambiguous=false}={})=>({ambiguous_rows:ambiguous,impressions:imp,clicks:clk,visits:vis,orders:ord,
  impressions_per_day:imp==null?null:Math.round(imp/days*10000)/10000,clicks_per_day:clk==null?null:Math.round(clk/days*10000)/10000,
  visits_per_day:vis==null?null:Math.round(vis/days*10000)/10000,orders_per_day:ord==null?null:Math.round(ord/days*10000)/10000});
export const units=(rows,o={})=>{
  const sum=(k,f=()=>true)=>rows.filter(f).reduce((a,r)=>a+r[k],0);
  const noid=o.noid||{current:0,previous:0};
  const t={listings:rows.length,listings_registered:rows.filter(r=>r.registered).length,listings_with_sales:rows.filter(r=>r.units_current>0||r.units_previous>0).length,
    listings_without_sales:rows.filter(r=>r.units_current===0&&r.units_previous===0).length,units_current:sum('units_current'),units_previous:sum('units_previous'),
    listings_unregistered:rows.filter(r=>!r.registered&&(r.units_current>0||r.units_previous>0)).length,
    units_current_unregistered:sum('units_current',r=>!r.registered),units_previous_unregistered:sum('units_previous',r=>!r.registered),
    listings_ambiguous_status:rows.filter(r=>r.ambiguous_status).length,listings_without_external_id:0};
  const rec={status:'CONCILIADA',
    current:{source_units:t.units_current+noid.current,units_without_id:noid.current,units_registered:sum('units_current',r=>r.registered),units_unregistered:t.units_current_unregistered,rows_units:t.units_current,unexplained_units:0},
    previous:{source_units:t.units_previous+noid.previous,units_without_id:noid.previous,units_registered:sum('units_previous',r=>r.registered),units_unregistered:t.units_previous_unregistered,rows_units:t.units_previous,unexplained_units:0}};
  const {noid:_n,...rest}=o;
  return {platform:'SHOPEE',current:{start:'2026-11-17',end:'2026-11-23'},previous:{start:'2026-11-10',end:'2026-11-16'},totals:t,reconciliation:rec,
    row_count:rows.length,truncated:false,reports:reports(null,null),rows,...rest};
};
// Divisão total x vinculada x sem vínculo (GA-021) de UM período.
export const splitOf=(start,end,{total,linked,base,residual=0}={})=>({start,end,status:'COMPLETO',total_units:total,linked_units:linked,unlinked_units:total-linked,unlinked_sku_count:total>linked?2:0,base_units:base??linked,
  difference:{units:(base??linked)-total,direction:'NEGATIVA',unlinked_effect_units:linked-total,other_explained_units:0,residual_units:residual,explained:residual===0},
  reconciliation:{status:residual===0?'EXPLICADA':'RESIDUO_NAO_EXPLICADO',source_units_match:true,identity_ok:true},coverage:{missing_days:0,days_with_data:7,missing_ranges:[]}});
export const splitFor=(u,w)=>{const sc=u.reconciliation.current.source_units,sp=u.reconciliation.previous.source_units;
  return {current:splitOf(w.current.start,w.current.end,{total:sc+4,linked:sc}),previous:splitOf(w.previous.start,w.previous.end,{total:sp+4,linked:sp})};};
export const mk=(rows,o={})=>{
  const days=o.days||7,w=o.window||winOf(days,o.facts||{});
  const u=units(rows,{current:w.current,previous:w.previous,...(o.units||{})});
  const {facts:_f,units:_u,...rest}=o;
  // Shopee: a divisão por SKU (GA-021) das mesmas datas fecha por padrão; as contas do ML não têm essa fonte.
  const split=splitFor(u,w);
  return {platform:'SHOPEE',days,window:w,source:sourceOf(u,w),dqCurrent:dq('SHOPEE',w.current.start,w.current.end),dqPrevious:dq('SHOPEE',w.previous.start,w.previous.end),split,failed:[],...rest,units:u};};
export const tierOf=(v,ext)=>Object.entries(v.tiers).find(([,t])=>t.rows.some(r=>r.external_id===ext))?.[0]??null;
export const get=(v,ext)=>Object.values(v.tiers).flatMap(t=>t.rows).find(r=>r.external_id===ext);
export const confirmedTotal=v=>['alta','revisao','oportunidade','sem_prioridade'].reduce((a,t)=>a+v.tiers[t].total,0);
