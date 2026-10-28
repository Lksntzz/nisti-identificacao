import React,{useMemo,useState} from 'react';
import { maskMoney, isPrivate } from './commerce-privacy.js';

// Gráficos e resumo do Dashboard (visão geral). Só recebem dados já carregados; não buscam nada.
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const moneyRaw=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const money=(...a)=>maskMoney(moneyRaw(...a));
const dm=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]:'—';};
const WEEK=['dom','seg','ter','qua','qui','sex','sáb'];
const weekday=v=>WEEK[new Date(String(v).slice(0,10)+'T00:00:00Z').getUTCDay()];
const axisMoneyRaw=v=>v>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:v>=100000?0:1})+' mil':String(Math.round(v));
const axisMoney=(...a)=>isPrivate()?'•••':axisMoneyRaw(...a);
const C_PREV='#8a97ad';
export const PLATS=[['SHOPEE','Shopee','shopee','units_shopee','prev_shopee','prev_units_shopee','#eb6834'],
  ['ML_ANTIGO','ML Antigo','ml_antigo','units_ml_antigo','prev_ml_antigo','prev_units_ml_antigo','#2a78d6'],
  ['ML_NOVO','ML Novo','ml_novo','units_ml_novo','prev_ml_novo','prev_units_ml_novo','#7b4fd4']];
const visible=(platform,code)=>platform==='TODAS'||platform===code;

function niceMax(v){
  if(v<=0)return 1;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  return [1,2,2.5,5,10].find(k=>k*p>=v)*p;
}


// Vendas por dia: barras empilhadas por plataforma (Shopee, ML Antigo e ML Novo separados), com linha do período anterior e dica ao passar o mouse.
export function SalesTrend({daily,platform='TODAS'}){
  const [metric,setMetric]=useState('revenue');
  const [hover,setHover]=useState(null);
  const isRev=metric==='revenue';
  const plats=PLATS.filter(p=>visible(platform,p[0]));
  const rows=useMemo(()=>(daily||[]).map(d=>({day:d.day,parts:PLATS.map(p=>Number(d[isRev?p[2]:p[3]])||0),prev:Number(isRev?d.prev_revenue:d.prev_units)||0})),[daily,isRev]);
  if(!rows.length)return <p className="ndb-empty">Sem vendas importadas para este filtro.</p>;
  const tot=r=>r.parts.reduce((a,v)=>a+v,0);
  const W=760,H=250,L=48,R=10,T=12,B=26,pw=W-L-R,ph=H-T-B;
  const max=niceMax(Math.max(1,...rows.map(r=>Math.max(tot(r),r.prev))));
  const bw=pw/rows.length;
  const x=i=>L+bw*i+bw/2;
  const y=v=>T+ph-(v/max)*ph;
  const ticks=[0,.25,.5,.75,1].map(t=>t*max);
  const step=Math.max(1,Math.ceil(rows.length/8));
  const h=hover!=null?rows[hover]:null;
  const fmt=v=>isRev?money(v):num(v)+' un.';
  const line=rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(r.prev).toFixed(1)).join(' ');
  const onMove=e=>{
    const box=e.currentTarget.getBoundingClientRect();
    const px=(e.clientX-box.left)/box.width*W;
    setHover(Math.min(rows.length-1,Math.max(0,Math.floor((px-L)/bw))));
  };
  return <div className="ndb-trend">
    <div className="ndb-trend-bar">
      <div className="ndb-seg" role="group" aria-label="Métrica do gráfico">
        <button type="button" className={isRev?'is-active':''} aria-pressed={isRev} onClick={()=>setMetric('revenue')}>Faturamento</button>
        <button type="button" className={!isRev?'is-active':''} aria-pressed={!isRev} onClick={()=>setMetric('units')}>Unidades</button>
      </div>
      <ul className="ndb-legend">
        {plats.map(p=><li key={p[0]}><i style={{background:p[6]}}/>{p[1]}</li>)}
        <li><i className="is-line" style={{background:C_PREV}}/>Dia equivalente do período anterior</li>
      </ul>
    </div>
    <div className="ndb-trend-box">
      <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label={isRev?'Faturamento por dia':'Unidades por dia'} onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
        {ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={y(t)} y2={y(t)} className="ndb-grid-line"/><text x={L-6} y={y(t)+3} textAnchor="end" fontSize="10" fill="#7a8aa3">{isRev?axisMoney(t):Math.round(t)}</text></g>)}
        {rows.map((r,i)=>{const w=Math.max(2,bw*.7);let acc=0;
          return <g key={r.day} opacity={hover==null||hover===i?1:.55}>
            {PLATS.map((p,k)=>{const v=r.parts[k];if(!(v>0)||!visible(platform,p[0]))return null;const y0=y(acc+v),hh=y(acc)-y0;acc+=v;
              return <rect key={p[0]} x={x(i)-w/2} y={y0} width={w} height={Math.max(0,hh)} fill={p[6]} rx="1.5"/>;})}
            {i%step===0&&<text x={x(i)} y={H-8} textAnchor="middle" fontSize="10" fill="#7a8aa3">{dm(r.day)}</text>}
          </g>;})}
        <path d={line} fill="none" stroke={C_PREV} strokeWidth="1.6" strokeDasharray="4 3"/>
        {h&&<line x1={x(hover)} x2={x(hover)} y1={T} y2={T+ph} stroke="#1d5fd1" strokeDasharray="2 3"/>}
      </svg>
      {h&&<div className="ndb-trend-tip" style={{left:Math.min(78,Math.max(22,x(hover)/W*100))+'%'}} role="status">
        <b>{dm(h.day)} · {weekday(h.day)}</b>
        <span>{fmt(tot(h))}</span>
        {plats.map(p=><small key={p[0]}><i className="ndb-tip-dot" style={{background:p[6]}}/>{p[1]} {fmt(h.parts[PLATS.indexOf(p)])}</small>)}
        <small>Dia equivalente anterior: {fmt(h.prev)}</small>
      </div>}
    </div>
  </div>;
}

// Faturamento por plataforma no período (três fatias: Shopee, ML Antigo e ML Novo); clicar em uma filtra o dashboard por ela.
export function PlatformSplit({daily,platform,onPick}){
  const sums=useMemo(()=>PLATS.map(p=>(daily||[]).reduce((a,d)=>a+Number(d[p[2]]||0),0)),[daily]);
  const total=sums.reduce((a,v)=>a+v,0);
  if(total<=0)return <p className="ndb-empty">Sem faturamento no período.</p>;
  const parts=PLATS.map((p,i)=>({p,v:sums[i]})).filter(x=>x.v>0);
  return <div className="ndb-split">
    <div className="ndb-split-bar" role="img" aria-label="Divisão do faturamento por plataforma">{parts.map(({p,v})=><i key={p[0]} style={{width:v/total*100+'%',background:p[6]}} title={p[1]+': '+money(v)}/>)}</div>
    <ul>{parts.map(({p,v})=>{const can=platform==='TODAS';
      return <li key={p[0]}><i style={{background:p[6]}}/>
        {can?<button type="button" className="ndb-link" onClick={()=>onPick(p[0])} title={'Filtrar o dashboard só por '+p[1]}>{p[1]}</button>:<span>{p[1]}</span>}
        <b>{money(v)}</b><small>{(v/total*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</small></li>;})}</ul>
  </div>;
}

// Comparativo por plataforma no período: faturamento, unidades, ticket médio e participação, com variação contra o período anterior.
export function PlatformTable({daily,platform,all,onPick}){
  const rows=useMemo(()=>PLATS.map(p=>{
    const d=daily||[];
    const rev=d.reduce((a,x)=>a+Number(x[p[2]]||0),0),un=d.reduce((a,x)=>a+Number(x[p[3]]||0),0);
    const prev=d.reduce((a,x)=>a+Number(x[p[4]]||0),0),pun=d.reduce((a,x)=>a+Number(x[p[5]]||0),0);
    return {p,rev,un,prev,pun};
  }),[daily]);
  const total=rows.reduce((a,r)=>({rev:a.rev+r.rev,un:a.un+r.un,prev:a.prev+r.prev,pun:a.pun+r.pun}),{rev:0,un:0,prev:0,pun:0});
  if(total.rev<=0&&total.un<=0)return <p className="ndb-empty">Sem vendas no período.</p>;
  const delta=(c,p)=>{if(all||!(p>0))return <small className="ndb-dn">—</small>;const v=(c/p-1)*100;return <small className={'ndb-dn '+(v>=5?'up':v<=-5?'down':'flat')}>{(v>0?'▲ ':v<0?'▼ ':'')+Math.abs(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</small>;};
  const all_=[...rows.filter(r=>visible(platform,r.p[0])),{p:['TOTAL','Total'],...total}];
  return <div className="ndb-scroll"><table className="ndb-table ndb-plat-table">
    <thead><tr><th>Plataforma</th><th className="num">Faturamento</th><th className="num">Unidades</th><th className="num">Ticket médio</th><th className="num">Participação</th></tr></thead>
    <tbody>{all_.map(r=>{const isTot=r.p[0]==='TOTAL';return <tr key={r.p[0]} className={isTot?'is-total':''}>
      <td>{isTot?<b>Total</b>:<span className="ndb-plat-name"><i style={{background:r.p[6]}}/>{platform==='TODAS'&&onPick?<button type="button" className="ndb-link" onClick={()=>onPick(r.p[0])} title={'Filtrar o dashboard só por '+r.p[1]}>{r.p[1]}</button>:r.p[1]}</span>}</td>
      <td className="num"><b>{money(r.rev)}</b>{delta(r.rev,r.prev)}</td>
      <td className="num"><b>{num(r.un)}</b>{delta(r.un,r.pun)}</td>
      <td className="num">{r.un>0?money(r.rev/r.un):'—'}</td>
      <td className="num">{total.rev>0?(r.rev/total.rev*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—'}</td></tr>;})}</tbody></table></div>;
}

// Resumo em linguagem simples, calculado dos mesmos números do filtro.
export function SummaryList({daily,totals,months,classes,all}){
  if(all)return <SummaryMonths months={months} classes={classes}/>;
  const rows=(daily||[]).map(d=>({day:d.day,v:Number(d.shopee||0)+Number(d.ml||0),u:Number(d.units||0)}));
  if(!rows.length||!totals)return <p className="ndb-empty">Sem dados no período.</p>;
  const withSales=rows.filter(r=>r.v>0);
  const best=rows.reduce((a,r)=>r.v>a.v?r:a,rows[0]);
  const worst=withSales.length?withSales.reduce((a,r)=>r.v<a.v?r:a,withSales[0]):null;
  const noSale=rows.length-withSales.length;
  const avg=rows.reduce((a,r)=>a+r.v,0)/rows.length;
  const avgU=rows.reduce((a,r)=>a+r.u,0)/rows.length;
  const byWeek=Array(7).fill(0),cnt=Array(7).fill(0);
  rows.forEach(r=>{const w=new Date(r.day+'T00:00:00Z').getUTCDay();byWeek[w]+=r.v;cnt[w]++;});
  const wAvg=byWeek.map((s,i)=>cnt[i]?s/cnt[i]:0);
  const topW=wAvg.indexOf(Math.max(...wAvg));
  const complete=(months||[]).filter(m=>m&&m.last_day&&m.first_day);
  const monthKey=m=>Number(m.shopee||0)+Number(m.ml_antigo||0)+Number(m.ml_novo||0);
  const lastMonth=(months||[]).length?months[months.length-1].month:null;
  const full=(months||[]).filter(m=>m.month!==lastMonth);
  const bestMonth=(full.length?full:complete).reduce((a,m)=>!a||monthKey(m)>monthKey(a)?m:a,null);
  const monthName=m=>new Date(String(m.month).slice(0,10)+'T00:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
  const A=(classes||[]).find(c=>c.class==='A');
  const items=[
    ['Média por dia',money(avg)+' · '+avgU.toLocaleString('pt-BR',{maximumFractionDigits:0})+' un.'],
    ['Melhor dia',dm(best.day)+' ('+weekday(best.day)+') · '+money(best.v)],
    worst&&['Dia mais fraco (com venda)',dm(worst.day)+' ('+weekday(worst.day)+') · '+money(worst.v)],
    ['Dias sem venda',noSale===0?'nenhum':noSale+' de '+rows.length],
    ['Dia da semana mais forte',WEEK[topW]+' · média '+money(wAvg[topW])],
    bestMonth&&['Mês mais forte (completo)',monthName(bestMonth)+' · '+money(monthKey(bestMonth))],
    A&&['Concentração (classe A)',String(A.revenue_pct).replace('.',',')+'% do faturamento em '+num(A.products)+' produtos']
  ].filter(Boolean);
  return <dl className="ndb-sumlist">{items.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

const MON=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const monLabel=m=>{const d=String(m).slice(0,7);return MON[Number(d.slice(5,7))-1]+'/'+d.slice(2,4);};
const monFull=m=>new Date(String(m).slice(0,10)+'T00:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});


// Histórico de todos os meses: barras empilhadas por plataforma (três fatias); clicar num mês filtra o dashboard por ele.
export function MonthsTrend({months,platform='TODAS',onPick}){
  const [metric,setMetric]=useState('revenue');
  const [hover,setHover]=useState(null);
  const isRev=metric==='revenue';
  const plats=PLATS.filter(p=>visible(platform,p[0]));
  const rows=useMemo(()=>(months||[]).map(m=>({m:m.month,parts:PLATS.map(p=>Number(m[isRev?p[2]:p[3]]||0)),partial:Boolean(m.last_day&&m.first_day&&String(m.last_day).slice(8,10)<'28')})),[months,isRev]);
  if(!rows.length)return <p className="ndb-empty">Sem vendas importadas para este filtro.</p>;
  const tot=r=>r.parts.reduce((a,v)=>a+v,0);
  const W=760,H=250,L=48,R=10,T=12,B=26,pw=W-L-R,ph=H-T-B;
  const max=niceMax(Math.max(1,...rows.map(tot)));
  const bw=pw/rows.length,x=i=>L+bw*i+bw/2,y=v=>T+ph-(v/max)*ph;
  const fmt=v=>isRev?money(v):num(v)+' un.';
  const h=hover!=null?rows[hover]:null;
  const best=rows.filter(r=>!r.partial).reduce((acc,r)=>!acc||tot(r)>tot(acc)?r:acc,null);
  return <div className="ndb-trend">
    <div className="ndb-trend-bar">
      <div className="ndb-seg" role="group" aria-label="Métrica do gráfico">
        <button type="button" className={isRev?'is-active':''} aria-pressed={isRev} onClick={()=>setMetric('revenue')}>Faturamento</button>
        <button type="button" className={!isRev?'is-active':''} aria-pressed={!isRev} onClick={()=>setMetric('units')}>Unidades</button>
      </div>
      <ul className="ndb-legend">
        {plats.map(p=><li key={p[0]}><i style={{background:p[6]}}/>{p[1]}</li>)}
        <li>Clique em um mês para filtrar</li>
      </ul>
    </div>
    <div className="ndb-trend-box">
      <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label="Vendas de todos os meses" onMouseLeave={()=>setHover(null)}>
        {[0,.25,.5,.75,1].map(t=>{const v=t*max;return <g key={t}><line x1={L} x2={W-R} y1={y(v)} y2={y(v)} className="ndb-grid-line"/><text x={L-6} y={y(v)+3} textAnchor="end" fontSize="10" fill="#7a8aa3">{isRev?axisMoney(v):Math.round(v)}</text></g>;})}
        {rows.map((r,i)=>{const w=Math.max(6,bw*.62);const o=hover==null||hover===i?1:.55;let acc=0;
          return <g key={r.m} opacity={r.partial?o*.7:o} style={{cursor:'pointer'}} onMouseEnter={()=>setHover(i)} onClick={()=>onPick&&onPick(String(r.m).slice(0,7))}>
            <rect x={L+bw*i} y={T} width={bw} height={ph} fill="transparent"/>
            {PLATS.map((p,k)=>{const v=r.parts[k];if(!(v>0)||!visible(platform,p[0]))return null;const y0=y(acc+v),hh=y(acc)-y0;acc+=v;
              return <rect key={p[0]} x={x(i)-w/2} y={y0} width={w} height={Math.max(0,hh)} fill={p[6]} rx="2"/>;})}
            <text x={x(i)} y={H-8} textAnchor="middle" fontSize="10" fill={best&&best.m===r.m?'#1f8a4c':'#7a8aa3'} fontWeight={best&&best.m===r.m?'700':'400'}>{monLabel(r.m)}</text>
          </g>;})}
      </svg>
      {h&&<div className="ndb-trend-tip" style={{left:Math.min(78,Math.max(22,x(hover)/W*100))+'%'}} role="status">
        <b>{monFull(h.m)}{h.partial?' (parcial)':''}</b>
        <span>{fmt(tot(h))}</span>
        {plats.map(p=><small key={p[0]}><i className="ndb-tip-dot" style={{background:p[6]}}/>{p[1]} {fmt(h.parts[PLATS.indexOf(p)])}</small>)}
        <small>Clique para filtrar este mês</small>
      </div>}
    </div>
    {best&&<p className="ndb-note">Mês mais forte (completo): <b>{monFull(best.m)}</b> com {fmt(tot(best))}. Barras mais claras = mês incompleto.</p>}
  </div>;
}

// Mês a mês por plataforma: tabela com faturamento (ou unidades) de cada mês e a variação do total contra o mês anterior.
export function MonthMatrix({months,platform='TODAS',onPick}){
  const [metric,setMetric]=useState('revenue');
  const isRev=metric==='revenue';
  const plats=PLATS.filter(p=>visible(platform,p[0]));
  const rows=useMemo(()=>(months||[]).map(m=>({m:m.month,parts:PLATS.map(p=>Number(m[isRev?p[2]:p[3]]||0)),partial:Boolean(m.last_day&&m.first_day&&String(m.last_day).slice(8,10)<'28')})),[months,isRev]);
  if(!rows.length)return <p className="ndb-empty">Sem vendas importadas.</p>;
  const tot=r=>PLATS.reduce((a,p,k)=>a+(visible(platform,p[0])?r.parts[k]:0),0);
  const fmt=v=>v>0?(isRev?money(v):num(v)):'—';
  const list=[...rows].reverse();
  return <div className="ndb-trend">
    <div className="ndb-trend-bar"><div className="ndb-seg" role="group" aria-label="Métrica da tabela">
      <button type="button" className={isRev?'is-active':''} aria-pressed={isRev} onClick={()=>setMetric('revenue')}>Faturamento</button>
      <button type="button" className={!isRev?'is-active':''} aria-pressed={!isRev} onClick={()=>setMetric('units')}>Unidades</button></div></div>
    <div className="ndb-scroll ndb-matrix"><table className="ndb-table">
      <thead><tr><th>Mês</th>{plats.map(p=><th key={p[0]} className="num"><span className="ndb-plat-name"><i style={{background:p[6]}}/>{p[1]}</span></th>)}<th className="num">Total</th><th className="num">vs. mês anterior</th></tr></thead>
      <tbody>{list.map((r,i)=>{const prev=list[i+1];const t=tot(r),pt=prev?tot(prev):0;const v=pt>0&&!r.partial?(t/pt-1)*100:null;
        return <tr key={r.m}>
          <td><button type="button" className="ndb-link" onClick={()=>onPick&&onPick(String(r.m).slice(0,7))} title="Filtrar o dashboard por este mês">{monFull(r.m)}</button>{r.partial&&<small className="ndb-dn"> parcial</small>}</td>
          {PLATS.map((p,k)=>visible(platform,p[0])?<td key={p[0]} className="num">{fmt(r.parts[k])}</td>:null)}
          <td className="num"><b>{fmt(t)}</b></td>
          <td className="num">{v==null?<small className="ndb-dn">—</small>:<small className={'ndb-dn '+(v>=5?'up':v<=-5?'down':'flat')}>{(v>0?'▲ ':v<0?'▼ ':'')+Math.abs(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</small>}</td></tr>;})}</tbody></table></div>
    <p className="ndb-note">Cada plataforma tem a sua própria conta e os seus números. Mês incompleto não entra na comparação.</p>
  </div>;
}

function SummaryMonths({months,classes}){
  const rows=(months||[]).map(m=>({m:m.month,v:Number(m.shopee||0)+Number(m.ml_antigo||0)+Number(m.ml_novo||0),u:Number(m.units_shopee||0)+Number(m.units_ml_antigo||0)+Number(m.units_ml_novo||0),partial:Boolean(m.last_day&&String(m.last_day).slice(8,10)<'28')}));
  if(!rows.length)return <p className="ndb-empty">Sem dados.</p>;
  const full=rows.filter(r=>!r.partial&&r.v>0);
  const best=full.length?full.reduce((a,r)=>r.v>a.v?r:a,full[0]):null;
  const worst=full.length>1?full.reduce((a,r)=>r.v<a.v?r:a,full[0]):null;
  const total=rows.reduce((a,r)=>a+r.v,0);
  const avg=full.length?full.reduce((a,r)=>a+r.v,0)/full.length:0;
  const A=(classes||[]).find(c=>c.class==='A');
  const items=[
    ['Faturamento no histórico',money(total)],
    full.length&&['Média por mês completo',money(avg)],
    best&&['Mês mais forte',monFull(best.m)+' · '+money(best.v)],
    worst&&['Mês mais fraco (completo)',monFull(worst.m)+' · '+money(worst.v)],
    ['Meses com venda',String(rows.length)],
    A&&['Concentração (classe A)',String(A.revenue_pct).replace('.',',')+'% do faturamento em '+num(A.products)+' produtos']
  ].filter(Boolean);
  return <dl className="ndb-sumlist">{items.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
