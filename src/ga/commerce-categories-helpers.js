// Regras puras do painel Categorias (testáveis sem navegador).
import {growth} from './commerce-annual-compare-helpers.js';

// Filtros do Painel Comercial -> parâmetros da consulta: dias > mês > acumulado do ano.
export function periodParams(filters={}){
  const days=Number(filters.days)||0,month=Number(filters.month)||0;
  if(days>0)return {mode:'days',days};
  if(month>=1&&month<=12)return {mode:'month',month};
  return {mode:'ytd'};
}

export function periodQuery(filters={},year=null){
  const p=periodParams(filters);
  return 'platform='+encodeURIComponent(filters.platform||'SHOPEE')+(year?'&year='+Number(year):'')+'&mode='+p.mode
    +(p.mode==='month'?'&month='+p.month:'')+(p.mode==='days'?'&days='+p.days:'');
}

const dm=iso=>String(iso||'').split('-').reverse().join('/');

// Texto fiel ao par de datas realmente consultado.
export function periodLabel(d){
  if(!d||!d.cur_from)return '';
  const cur=dm(d.cur_from)+' a '+dm(d.cur_to),base=dm(d.base_from)+' a '+dm(d.base_to);
  if(d.mode==='ytd')return 'Acumulado até '+dm(d.cur_to)+' × até '+dm(d.base_to);
  return cur+' × '+base;
}

// Variação só com base positiva; sem base não vira +100% nem infinito.
export const variation=(cur,base)=>growth(cur,base);

// Cards: base confiável = ano anterior com unidades; estável não entra em nenhum dos dois.
export function categoryKpis(d){
  const cats=d?.categories||[];
  let up=0,down=0;
  for(const c of cats){const b=Number(c.base),diff=Number(c.cur)-b;if(b>0){if(diff>0)up++;else if(diff<0)down++;}}
  const none=cats.find(c=>c.name==='Sem categoria');
  return {units:Number(d?.total?.cur||0),base:Number(d?.total?.base||0),up,down,noneUnits:Number(none?.cur||0)};
}

export const SORTS={units:'Unidades',gain:'Maior ganho',loss:'Maior perda',recent:'Desempenho recente'};
export const SHOWS={all:'Todas',up:'Em crescimento',down:'Em queda',none:'Sem categoria'};

// Busca e filtro só escondem linhas; totais e participação continuam os da plataforma/período.
export function listCategories(cats,{search='',show='all',sort='units'}={}){
  const q=String(search||'').trim().toLocaleLowerCase('pt-BR');
  const diff=c=>Number(c.cur)-Number(c.base);
  const rec=c=>Number(c.c28)-Number(c.b28);
  let rows=(cats||[]).filter(c=>!q||String(c.name).toLocaleLowerCase('pt-BR').includes(q));
  if(show==='up')rows=rows.filter(c=>Number(c.base)>0&&diff(c)>0);
  else if(show==='down')rows=rows.filter(c=>Number(c.base)>0&&diff(c)<0);
  else if(show==='none')rows=rows.filter(c=>c.name==='Sem categoria');
  const cmp={units:(a,b)=>Number(b.cur)-Number(a.cur),gain:(a,b)=>diff(b)-diff(a),loss:(a,b)=>diff(a)-diff(b),recent:(a,b)=>rec(b)-rec(a)}[sort]||((a,b)=>Number(b.cur)-Number(a.cur));
  return [...rows].sort((a,b)=>cmp(a,b)||String(a.name).localeCompare(String(b.name),'pt-BR'));
}

// Preço médio por unidade (receita de produtos ÷ unidades); nunca ticket por pedido.
export const unitPrice=(rev,units)=>Number(units)>0&&Number(rev)>0?Number(rev)/Number(units):null;
