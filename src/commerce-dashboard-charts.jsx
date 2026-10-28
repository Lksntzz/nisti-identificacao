import React,{useMemo,useState} from 'react';

// Gráficos e resumo do Dashboard (visão geral). Só recebem dados já carregados; não buscam nada.
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dm=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]:'—';};
const WEEK=['dom','seg','ter','qua','qui','sex','sáb'];
const weekday=v=>WEEK[new Date(String(v).slice(0,10)+'T00:00:00Z').getUTCDay()];
const axisMoney=v=>v>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:v>=100000?0:1})+' mil':String(Math.round(v));
const C_SHOPEE='#eb6834',C_ML='#2a78d6',C_PREV='#8a97ad';

function niceMax(v){
  if(v<=0)return 1;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  return [1,2,2.5,5,10].find(k=>k*p>=v)*p;
}

// Vendas por dia: barras empilhadas por plataforma (faturamento) ou unidades, com linha do período anterior e dica ao passar o mouse.
export function SalesTrend({daily,platform='TODAS'}){
  const [metric,setMetric]=useState('revenue');
  const [hover,setHover]=useState(null);
  const rows=useMemo(()=>(daily||[]).map(d=>({day:d.day,shopee:Number(d.shopee||0),ml:Number(d.ml||0),units:Number(d.units||0),prevRev:Number(d.prev_revenue||0),prevUnits:Number(d.prev_units||0)})),[daily]);
  if(!rows.length)return <p className="ndb-empty">Sem vendas importadas para este filtro.</p>;
  const isRev=metric==='revenue';
  const val=r=>isRev?r.shopee+r.ml:r.units;
  const prev=r=>isRev?r.prevRev:r.prevUnits;
  const W=760,H=250,L=48,R=10,T=12,B=26,pw=W-L-R,ph=H-T-B;
  const max=niceMax(Math.max(1,...rows.map(r=>Math.max(val(r),prev(r)))));
  const bw=pw/rows.length;
  const x=i=>L+bw*i+bw/2;
  const y=v=>T+ph-(v/max)*ph;
  const ticks=[0,.25,.5,.75,1].map(t=>t*max);
  const step=Math.max(1,Math.ceil(rows.length/8));
  const h=hover!=null?rows[hover]:null;
  const fmt=v=>isRev?money(v):num(v)+' un.';
  const line=rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(prev(r)).toFixed(1)).join(' ');
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
        {isRev?<>{platform!=='ML_ANTIGO'&&platform!=='ML_NOVO'&&<li><i style={{background:C_SHOPEE}}/>Shopee</li>}{platform!=='SHOPEE'&&<li><i style={{background:C_ML}}/>Mercado Livre</li>}</>:<li><i style={{background:C_ML}}/>Unidades</li>}
        <li><i className="is-line" style={{background:C_PREV}}/>Dia equivalente do período anterior</li>
      </ul>
    </div>
    <div className="ndb-trend-box">
      <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label={isRev?'Faturamento por dia':'Unidades por dia'} onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
        {ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={y(t)} y2={y(t)} stroke="#e8edf5"/><text x={L-6} y={y(t)+3} textAnchor="end" fontSize="10" fill="#7a8aa3">{isRev?axisMoney(t):Math.round(t)}</text></g>)}
        {rows.map((r,i)=>{const w=Math.max(2,bw*.7);
          const sh=isRev?r.shopee:0,ml=isRev?r.ml:r.units;
          return <g key={r.day} opacity={hover==null||hover===i?1:.55}>
            <rect x={x(i)-w/2} y={y(ml)} width={w} height={Math.max(0,T+ph-y(ml))} fill={C_ML} rx="1.5"/>
            {isRev&&<rect x={x(i)-w/2} y={y(ml+sh)} width={w} height={Math.max(0,y(ml)-y(ml+sh))} fill={C_SHOPEE} rx="1.5"/>}
            {i%step===0&&<text x={x(i)} y={H-8} textAnchor="middle" fontSize="10" fill="#7a8aa3">{dm(r.day)}</text>}
          </g>;})}
        <path d={line} fill="none" stroke={C_PREV} strokeWidth="1.6" strokeDasharray="4 3"/>
        {h&&<line x1={x(hover)} x2={x(hover)} y1={T} y2={T+ph} stroke="#1d5fd1" strokeDasharray="2 3"/>}
      </svg>
      {h&&<div className="ndb-trend-tip" style={{left:Math.min(78,Math.max(22,x(hover)/W*100))+'%'}} role="status">
        <b>{dm(h.day)} · {weekday(h.day)}</b>
        <span>{fmt(val(h))}</span>
        {isRev&&<small>Shopee {money(h.shopee)} · ML {money(h.ml)}</small>}
        <small>Dia equivalente anterior: {fmt(prev(h))}</small>
      </div>}
    </div>
  </div>;
}

// Faturamento por plataforma no período; clicar na Shopee filtra o dashboard por ela.
export function PlatformSplit({daily,platform,onPick}){
  const t=useMemo(()=>(daily||[]).reduce((a,d)=>({s:a.s+Number(d.shopee||0),m:a.m+Number(d.ml||0),su:a.su,mu:a.mu}),{s:0,m:0,su:0,mu:0}),[daily]);
  const total=t.s+t.m;
  if(total<=0)return <p className="ndb-empty">Sem faturamento no período.</p>;
  const parts=[['SHOPEE','Shopee',t.s,C_SHOPEE],['ML','Mercado Livre',t.m,C_ML]].filter(p=>p[2]>0);
  return <div className="ndb-split">
    <div className="ndb-split-bar" role="img" aria-label="Divisão do faturamento por plataforma">{parts.map(p=><i key={p[0]} style={{width:p[2]/total*100+'%',background:p[3]}} title={p[1]+': '+money(p[2])}/>)}</div>
    <ul>{parts.map(p=>{const pct=p[2]/total*100;const can=p[0]==='SHOPEE'&&platform==='TODAS';
      return <li key={p[0]}><i style={{background:p[3]}}/>
        {can?<button type="button" className="ndb-link" onClick={()=>onPick(p[0])} title="Filtrar o dashboard só pela Shopee">{p[1]}</button>:<span>{p[1]}</span>}
        <b>{money(p[2])}</b><small>{pct.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</small></li>;})}</ul>
  </div>;
}

// Resumo em linguagem simples, calculado dos mesmos números do filtro.
export function SummaryList({daily,totals,months,classes,all}){
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
