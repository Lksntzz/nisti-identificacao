// GA-012 — Seletor de plataformas do Dashboard Comercial: regras puras (sem rede, sem React, sem banco).
// Cada conta é independente; "Consolidado" é só a soma das três e fica sempre rotulado.
import {summaryItems,fmtDate,isoDate} from './commerce-data-quality-logic.js';

export const SCOPE_PLATFORMS=Object.freeze([
  {id:'TODAS',label:'Consolidado',color:'#475569'},
  {id:'SHOPEE',label:'Shopee',color:'#eb6834'},
  {id:'ML_ANTIGO',label:'ML Antigo',color:'#2a78d6'},
  {id:'ML_NOVO',label:'ML Novo',color:'#7b4fd4'}
]);
export const platformLabel=id=>SCOPE_PLATFORMS.find(p=>p.id===id)?.label||String(id||'');

// Tudo que a tela guarda vem acompanhado da chave do escopo em que foi pedido.
export const scopeKey=({platform,days,month})=>[platform,days,month||''].join('|');
export const makeEntry=(key,data)=>({key,data});
export const isCurrentScope=(entry,key)=>Boolean(entry)&&entry.key===key;
// O servidor devolve "platform" em várias respostas: se vier diferente do pedido, é de outra conta e não entra.
export const matchesPlatform=(payload,platform)=>Boolean(payload)&&typeof payload==='object'&&(payload.platform==null||payload.platform===platform);

// Atenção: com uma conta escolhida, só a linha dela; Consolidado mostra as três.
export function filterAttentionPlatforms(plats,platform){
  if(!Array.isArray(plats))return plats;
  return platform==='TODAS'?plats:plats.filter(p=>p.platform===platform);
}

const dm=s=>String(s||'').slice(0,10).split('-').reverse().slice(0,2).join('/');
const reportsOf=x=>Array.isArray(x?.reports)?x.reports:[];
// Relatórios de desempenho por conta: a conta sem relatório não herda o de outra.
export function perfStatus(platform,{ml,shopee}={}){
  const mlAll=reportsOf(ml),spAll=reportsOf(shopee);
  const mlOf=a=>mlAll.filter(r=>r.account===a);
  const note=(label,r)=>label+' '+dm(r.start)+' a '+dm(r.end);
  const mlNote=r=>note(r.account==='NOVO'?'ML Novo':'ML Antigo',r);
  let notes=[];
  if(platform==='SHOPEE')notes=spAll.map(r=>note('Shopee',r));
  else if(platform==='ML_ANTIGO')notes=mlOf('ANTIGO').map(mlNote);
  else if(platform==='ML_NOVO')notes=mlOf('NOVO').map(mlNote);
  else notes=[...mlAll.map(mlNote),...spAll.map(r=>note('Shopee',r))];
  return {has:notes.length>0,notes};
}

// Desempenho por plataforma, conta e ID do anúncio. O mesmo ID externo pode existir na Shopee e no ML (ou nas duas contas do ML):
// cada linha só usa o item da PRÓPRIA plataforma/conta, e a conta precisa ter relatório importado.
const ML_ACCOUNT={ML_ANTIGO:'ANTIGO',ML_NOVO:'NOVO'};
export function perfItemFor(row,{ml,shopee}={}){
  const id=row?.external_id;
  if(id==null||id==='')return null;
  const has=Object.prototype.hasOwnProperty;
  if(row.platform==='SHOPEE'){
    if(!reportsOf(shopee).length||!shopee.items||!has.call(shopee.items,id))return null;
    return shopee.items[id]||null;
  }
  const acc=ML_ACCOUNT[row.platform];
  if(!acc||!reportsOf(ml).some(r=>r.account===acc)||!ml.items||!has.call(ml.items,id))return null;
  const it=ml.items[id];
  return it&&it.account===acc?it:null;
}

// Dias do intervalo, contagem inclusiva (22/10 a 20/11 = 30). Inválido ou invertido = 0.
const spanDays=(start,end)=>{
  const a=Date.parse(start),b=Date.parse(end);
  return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.round((b-a)/86400000)+1:0;
};
// A GA-018 comprova a cobertura quando é da MESMA conta e do MESMO período do dashboard, a cobertura é COMPLETA
// (todos os dias do intervalo completos, nenhum parcial) e não há dias sem informação nem registros não verificados.
// Campo ausente nunca comprova.
export function coverageProven(dq,platform,period){
  if(!dq||!dq.sales||!period||dq.platform!==platform)return false;
  if(dq.period?.start!==period.start||dq.period?.end!==period.end)return false;
  const s=dq.sales,span=spanDays(period.start,period.end);
  const eq=(v,n)=>v!=null&&v!==''&&Number(v)===n;
  return s.status==='COMPLETA'
    &&span>0&&eq(s.requested_days,span)&&eq(s.complete_days,span)&&eq(s.partial_days,0)
    &&eq(s.days_without_information,0)&&eq(s.days_with_records_unverified,0)
    &&Array.isArray(s.missing_ranges)&&s.missing_ranges.length===0;
}

// Ausência de informação (nada importado) ≠ ausência de vendas importadas (cobertura não comprovada) ≠ zero vendas (cobertura comprovada).
export function salesNotice({platform,coverage,data,period,dq}){
  if(!data)return null;
  const label=platformLabel(platform);
  if(!coverage?.last_day&&!data.last_day)
    return {kind:'SEM_INFORMACAO',text:'Sem informação: nenhuma venda de '+label+' foi importada. Isso não significa zero vendas.'};
  const t=data.totals||{};
  if(!(data.totals&&Number(t.cur_units)===0&&Number(t.cur_rev)===0))return null;
  if(platform!=='TODAS'&&coverageProven(dq,platform,period))
    return {kind:'ZERO',text:'Zero vendas nos dados importados: há vendas de '+label+' importadas até '+fmtDate(coverage?.last_day||data.last_day)+', a cobertura do período está completa e nenhuma venda caiu nele. Vale para os dados importados no sistema; não é uma confirmação do marketplace.'};
  return {kind:'SEM_VENDAS_IMPORTADAS',text:'Nenhuma venda de '+(platform==='TODAS'?'nenhuma plataforma':label)+' importada neste período. A cobertura do período não está comprovada: não é possível afirmar que foram zero vendas.'};
}

// Período da faixa GA-018: o mesmo que o dashboard analisa (inclusive "todo o histórico"). Sem período do dashboard, usa 90 dias e avisa.
export function dashboardQualityPeriod(per,{days,month}={},today=new Date()){
  if(per&&per.curFrom&&per.curTo){
    const all=!month&&Number(days)===0;
    return {start:per.curFrom,end:per.curTo,differs:false,
      label:(all?'todo o histórico, ':'')+fmtDate(per.curFrom)+' a '+fmtDate(per.curTo)};
  }
  const q=qualityPeriod(days,month,today);
  return {...q,differs:true,label:(!month&&Number(days)===0?'últimos 90 dias, ':'')+fmtDate(q.start)+' a '+fmtDate(q.end)+' (diferente do dashboard, que ainda não tem período definido)'};
}

// Período usado só pela faixa de qualidade (a GA-018 pede datas): dias, mês ou ano do dashboard; "todo o histórico" usa 90 dias.
export function qualityPeriod(days,month,today=new Date()){
  const t=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const cap=d=>d>t?t:d;
  if(/^\d{4}-\d{2}$/.test(month||'')){
    const [y,m]=month.split('-').map(Number);
    return {start:isoDate(new Date(y,m-1,1)),end:isoDate(cap(new Date(y,m,0)))};
  }
  if(/^\d{4}$/.test(month||'')){
    const y=Number(month);
    return {start:isoDate(new Date(y,0,1)),end:isoDate(cap(new Date(y,11,31)))};
  }
  const n=[7,30,60,90].includes(Number(days))?Number(days):90;
  const start=new Date(t);start.setDate(start.getDate()-(n-1));
  return {start:isoDate(start),end:isoDate(t)};
}

// Resumo compacto da GA-018 para UMA conta (última venda, atualização, conciliação interna). Não existe versão consolidada.
export function qualityStrip(dq){
  if(!dq||!dq.sales)return null;
  const it=Object.fromEntries(summaryItems(dq).map(i=>[i.key,i]));
  return {last:it.last.value,fresh:it.last.sub,freshTone:it.last.tone,recon:it.recon.value,reconTone:it.recon.tone,reconSub:it.recon.sub||null};
}

export const matchesDays=(payload,days)=>payload!=null&&typeof payload==='object'&&(payload.window?.days==null||Number(payload.window.days)===Number(days));
