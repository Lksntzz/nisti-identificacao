import React from 'react';
import {maskMoney} from './commerce-privacy.js';
import {PLATS} from './commerce-dashboard-charts.jsx';
import {PLATFORM_LABEL,PROBLEM_PCT,headline,windowWarning,listingsNote} from './commerce-problems-logic.js';
import {filterAttentionPlatforms,platformLabel} from './commerce-platform-scope-logic.js';

const money=v=>maskMoney(v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}));
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const pct=(v,d=1)=>v==null?'—':(v>0?'+':'')+Number(v).toLocaleString('pt-BR',{maximumFractionDigits:d})+'%';

// Atenção: uma linha por plataforma, dizendo se está pior e quais anúncios explicam. Clicar abre o painel Anúncios com problema.
export function AttentionByPlatform({plats:allPlats,platform='TODAS',counts,window:win,unavailable,error,onOpen}){
  const plats=filterAttentionPlatforms(allPlats,platform);
  if(unavailable)return <p className="ndb-empty">Para ver quem está piorando, escolha 30, 60 ou 90 dias.</p>;
  if(error)return <p className="ndb-empty">Consulta indisponível agora. Tente de novo em instantes.</p>;
  if(!plats)return <p className="ndb-empty">Carregando…</p>;
  if(!plats.length)return <p className="ndb-empty">Sem informação: não há comparação de {platformLabel(platform)} neste período.</p>;
  const warn=windowWarning(win);
  return <>
    {warn&&<p className="ndb-warn">{warn}</p>}
    <ul className="ndb-alert-list">{plats.map(p=>{const bad=p.base_ok&&Number(p.var_pct)<=PROBLEM_PCT;
      const note=listingsNote(counts?.[p.platform]);
      return <li key={p.platform}><button type="button" className={bad?'tone-bad':note?'tone-warn':'tone-muted'} onClick={onOpen} title="Abrir Anúncios com problema">
        <span className="ndb-alert-txt"><strong>{PLATFORM_LABEL[p.platform]} {p.base_ok?pct(p.var_pct):''}</strong><small>{headline(p)}{note&&!bad?' Mas '+note+'.':''}{note&&bad?' Além disso, '+note+'.':''}</small></span>
        <span className="ndb-alert-go" aria-hidden="true">›</span></button></li>;})}</ul>
  </>;
}

// Resumo do período: um bloco por plataforma (nunca o total geral).
export function PlatformSummary({daily,platform='TODAS',all}){
  const d=daily||[];
  if(!d.length)return <p className="ndb-empty">Sem dados no período.</p>;
  const blocks=PLATS.filter(p=>platform==='TODAS'||platform===p[0]).map(p=>{
    const rev=d.reduce((a,x)=>a+Number(x[p[2]]||0),0),un=d.reduce((a,x)=>a+Number(x[p[3]]||0),0);
    const prev=d.reduce((a,x)=>a+Number(x[p[4]]||0),0);
    const days=d.filter(x=>Number(x[p[2]]||0)>0).length;
    return {p,rev,un,prev,days};
  }).filter(b=>b.rev>0||b.un>0);
  if(!blocks.length)return <p className="ndb-empty">Sem vendas no período.</p>;
  return <div className="ndb-plat-sum">{blocks.map(({p,rev,un,prev,days})=><section key={p[0]}>
    <h4><i style={{background:p[6]}}/>{p[1]}</h4>
    <dl className="ndb-sumlist">
      <div><dt>Faturamento</dt><dd>{money(rev)}{!all&&prev>0&&<small> {pct((rev/prev-1)*100,0)} vs. anterior</small>}</dd></div>
      <div><dt>Unidades</dt><dd>{num(un)}</dd></div>
      <div><dt>Ticket médio</dt><dd>{un>0?money(rev/un):'—'}</dd></div>
      {!all&&<div><dt>Média por dia</dt><dd>{money(rev/Math.max(1,d.length))} · {days} de {d.length} dias com venda</dd></div>}
    </dl></section>)}</div>;
}
