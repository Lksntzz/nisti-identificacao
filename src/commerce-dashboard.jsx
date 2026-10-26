import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {usePriceSignals,PriceSignalCell} from './commerce-price-signal.jsx';
import './commerce-dashboard.css';

const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)']];
const PLATFORM_LABEL={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const PERIODS=[7,30,60,90];
const CLASS_NOTE={A:'Até 80% do faturamento',B:'Dos 80% aos 95%',C:'Últimos 5%'};

const SOURCES={
  abc:'Vendas importadas (tabela de vendas diárias por anúncio, o mesmo dado do Histórico de importações). Soma o faturamento do período por SKU, ordena do maior para o menor e classifica: A = produtos que somam até 80% do faturamento, B = dos 80% aos 95%, C = o restante. Anúncios sem SKU vinculado entram sozinhos. Faturamento = valor dos produtos, sem frete.',
  drops:'Vendas importadas: compara os últimos N dias com os N dias imediatamente anteriores, por anúncio ATIVO. Entra quem tinha 5 ou mais unidades no período anterior e caiu 15% ou mais. A coluna “Preço × vendas” compara o preço médio realizado. A linha de causa vem dos relatórios de desempenho Shopee importados (impressões, cliques, conversão); sem esse relatório aparece só o preço. São sinais, não prova de causa.',
  daily:'Vendas importadas (tabela de vendas diárias por anúncio): soma do faturamento de cada dia, separado por plataforma. A linha tracejada é o dia equivalente do período anterior (mesmo tamanho). Dias sem venda importada aparecem como zero; confira o Histórico de importações se houver buracos.',
  top:'Vendas importadas: os 15 anúncios com maior faturamento no período, com a variação de unidades contra o período anterior de mesmo tamanho. Título e situação vêm do cadastro de anúncios do sistema.',
  kpi:'Vendas importadas no período escolhido, contra o período anterior de mesmo tamanho. O período termina no último dia com venda importada, não em hoje.',
  alerts:'Calculado sobre as vendas importadas e o cadastro de anúncios: queda = anúncio ativo com 5 ou mais unidades antes e 15% ou mais de queda; pararam = ativos que venderam 3 ou mais unidades no período anterior e zero no atual; sem venda = ativos sem nenhuma unidade no período; inativos com venda = anúncios inativos ou removidos que ainda aparecem nas vendas. Anúncio pago com ROAS abaixo de 1 vem do relatório Shopee Ads importado.',
  best:'Vendas importadas, por anúncio, no período escolhido. Crescimento = ativos com 5 ou mais unidades antes, 10 ou mais agora e alta de 15% ou mais, ordenados pelas unidades a mais. ROAS vem do relatório Shopee Ads importado (período próprio) e só inclui anúncios com campanha individual. Mais vendido não significa mais lucrativo: não há custo do produto cadastrado.',
  ads:'Relatório Shopee Ads “Dados gerais” mais recente importado (Importar > Shopee Ads). O período dele é o do próprio arquivo, não o filtro da tela. Linhas de grupos de anúncios e de anúncios individuais podem se sobrepor, então não some as linhas. Mercado Livre Publicidade ainda não é importado.',
  trust:'Cobertura do que está no banco: último dia com venda e última importação aplicada por plataforma (Histórico de importações), dias do período com venda importada e faturamento sem SKU vinculado.',
  help:'Lista de dados que o sistema ainda não recebe e que ajudariam a explicar quedas.'
};
const HELP=[
  ['Relatório de desempenho do Mercado Livre','visitas e conversão por anúncio; hoje só a Shopee tem esse dado, então a causa das quedas do ML não aparece.'],
  ['Shopee: relatórios de desempenho de cada mês','quanto mais períodos importados, mais anúncios ganham a linha de causa (impressões, cliques, conversão).'],
  ['Gasto e retorno de anúncios pagos (Shopee Ads e Mercado Livre Publicidade)','muita queda é só verba reduzida ou campanha pausada.'],
  ['Estoque e dias sem disponibilidade','anúncio pausado ou sem estoque parece queda de demanda.'],
  ['Datas de mudanças no anúncio (título, fotos, preço, variações)','permite ligar a queda ao dia da alteração.'],
  ['Preço de concorrentes e posição na busca','mostra se perdeu espaço para outro vendedor.'],
  ['Notas e avaliações, reclamações, cancelamentos e devoluções','reputação baixa reduz a exibição.'],
  ['Calendário de promoções e campanhas (ex.: dias 10.10, 11.11)','explica picos e quedas de calendário.'],
  ['Custo do produto','permite mostrar margem e priorizar o que realmente dá lucro, não só o que vende.']
];

const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmtDay=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]:'—';};
const fmtDayFull=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const dayBefore=v=>{const d=new Date(String(v||'')+'T12:00:00Z');return Number.isNaN(d.getTime())?'':new Date(d.getTime()-86400000).toISOString().slice(0,10);};
export const changePct=(cur,prev)=>{
  const c=Number(cur),p=Number(prev);
  if(!Number.isFinite(c)||!Number.isFinite(p)||p<=0)return null;
  return Math.round((c-p)/p*1000)/10;
};
const pctText=v=>v==null?'novo':(v>0?'+':'')+String(v).replace('.',',')+'%';
const tone=v=>v==null?'neutral':v>=5?'good':v<=-5?'bad':'neutral';

export function InfoIcon({text,label}){
  return <span className="ndb-info" tabIndex={0} role="note" aria-label={'De onde vêm os dados: '+label}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>
    <span className="ndb-info-pop"><strong>De onde vêm os dados</strong>{text}</span>
  </span>;
}

function Card({title,subtitle,source,children,className=''}){
  return <section className={'ndb-card '+className}>
    <header><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><InfoIcon text={SOURCES[source]} label={title}/></header>
    {children}
  </section>;
}

function Delta({cur,prev}){
  const v=changePct(cur,prev);
  return <span className={'ndb-chip tone-'+tone(v)}>{v==null?'novo':(v>0?'▲ ':v<0?'▼ ':'')+String(Math.abs(v)).replace('.',',')+'%'}</span>;
}

const CLASS_COLOR={A:'#3b2f9e',B:'#7b6bdc',C:'#a99ee6'};
const PLAT_COLOR={SHOPEE:'#eb6834',ML_ANTIGO:'#2a78d6',ML_NOVO:'#2a78d6'};
const shortMoney=v=>{const n=Number(v)||0;return n>=1000?'R$ '+(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':money(n);};
const axisMoney=v=>v>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':String(Math.round(v));

function niceMax(v){
  if(v<=0)return 1;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  const m=[1,2,2.5,5,10].find(k=>k*p>=v);
  return m*p;
}

// Faturamento por dia: áreas empilhadas por plataforma (período atual) e linha tracejada do período anterior.
function DailyChart({daily}){
  const [hover,setHover]=useState(null);
  const n=daily.length;
  if(!n)return <p className="ndb-empty">Sem vendas no período.</p>;
  const W=760,H=300,L=52,R=14,T=14,B=30,iw=W-L-R,ih=H-T-B;
  const tot=d=>Number(d.shopee)+Number(d.ml);
  const maxV=niceMax(Math.max(...daily.map(d=>Math.max(tot(d),Number(d.prev_revenue)||0))));
  const x=i=>L+(n===1?iw/2:i/(n-1)*iw);
  const y=v=>T+ih-(v/maxV)*ih;
  const hasShopee=daily.some(d=>Number(d.shopee)>0),hasMl=daily.some(d=>Number(d.ml)>0);
  const area=(lo,hi)=>daily.map((d,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(hi(d)).toFixed(1)).join(' ')+' '+
    daily.map((d,i)=>'L'+x(n-1-i).toFixed(1)+' '+y(lo(daily[n-1-i])).toFixed(1)).join(' ')+' Z';
  const top=(f)=>daily.map((d,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(f(d)).toFixed(1)).join(' ');
  const ticks=[0,.25,.5,.75,1].map(k=>k*maxV);
  const xt=n<=7?daily.map((_,i)=>i):[0,1,2,3,4,5].map(k=>Math.round(k*(n-1)/5));
  const h=hover!=null?daily[hover]:null;
  return <div className="ndb-chartbox">
    <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label="Faturamento por dia" onMouseLeave={()=>setHover(null)}
      onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*W;setHover(Math.max(0,Math.min(n-1,Math.round((px-L)/iw*(n-1)))));}}>
      {ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={y(t)} y2={y(t)} className="ndb-grid-line"/><text x={L-8} y={y(t)+4} textAnchor="end" className="ndb-axis">{axisMoney(t)}</text></g>)}
      {hasShopee&&<path d={area(()=>0,d=>Number(d.shopee))} fill={PLAT_COLOR.SHOPEE} opacity="0.85"/>}
      {hasMl&&<path d={area(d=>Number(d.shopee),d=>tot(d))} fill={PLAT_COLOR.ML_ANTIGO} opacity="0.85"/>}
      <path d={top(d=>Number(d.prev_revenue)||0)} fill="none" stroke="#314058" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round"/>
      {xt.map(i=><text key={i} x={x(i)} y={H-8} textAnchor={i===0?'start':i===n-1?'end':'middle'} className="ndb-axis">{fmtDay(daily[i].day)}</text>)}
      {h&&<g><line x1={x(hover)} x2={x(hover)} y1={T} y2={T+ih} className="ndb-cross"/><circle cx={x(hover)} cy={y(tot(h))} r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="2"/></g>}
    </svg>
    {h&&<div className="ndb-tip" style={{left:Math.min(68,Math.max(2,x(hover)/W*100))+'%'}}>
      <b>{fmtDayFull(h.day)}</b>
      {hasShopee&&<span><i style={{background:PLAT_COLOR.SHOPEE}}/>Shopee {money(h.shopee)}</span>}
      {hasMl&&<span><i style={{background:PLAT_COLOR.ML_ANTIGO}}/>Mercado Livre {money(h.ml)}</span>}
      <em>Total {money(tot(h))} · {num(h.units)} unid.</em>
      <em>Mesmo dia do período anterior: {money(h.prev_revenue)}</em></div>}
    <div className="ndb-legend">
      {hasShopee&&<span><i style={{background:PLAT_COLOR.SHOPEE}}/>Shopee</span>}
      {hasMl&&<span><i style={{background:PLAT_COLOR.ML_ANTIGO}}/>Mercado Livre</span>}
      <span><i className="dash"/>Período anterior</span>
    </div>
  </div>;
}

function Donut({parts,center,sub}){
  const total=parts.reduce((a,p)=>a+p.value,0)||1;
  const R=54,C=2*Math.PI*R;
  let acc=0;
  return <svg className="ndb-donut" viewBox="0 0 140 140" role="img" aria-label={parts.map(p=>p.label+' '+Math.round(p.value/total*100)+'%').join(', ')}>
    <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f8" strokeWidth="18"/>
    {parts.filter(p=>p.value>0).map(p=>{const len=p.value/total*C;const el=<circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="18"
      strokeDasharray={Math.max(0,len-2)+' '+(C-Math.max(0,len-2))} strokeDashoffset={-acc} transform="rotate(-90 70 70)"/>;acc+=len;return el;})}
    <text x="70" y="66" textAnchor="middle" className="ndb-donut-main">{center}</text>
    <text x="70" y="82" textAnchor="middle" className="ndb-donut-sub">{sub}</text>
  </svg>;
}

// Curva de Pareto: eixo único (% acumulado do faturamento), produtos do maior para o menor.
function ParetoChart({items}){
  const [hover,setHover]=useState(null);
  if(!items.length)return <p className="ndb-empty">Sem vendas no período.</p>;
  const W=760,H=280,L=44,R=16,T=14,B=32,iw=W-L-R,ih=H-T-B,n=items.length;
  const x=i=>L+(n===1?iw/2:i/(n-1)*iw);
  const y=v=>T+ih-(v/100)*ih;
  const pts=items.map((it,i)=>[x(i),y(it.cum_pct)]);
  const seg=['A','B','C'].map(c=>{
    const idx=items.map((it,i)=>it.class===c?i:-1).filter(i=>i>=0);
    if(!idx.length)return null;
    const from=Math.max(0,idx[0]-1),to=idx[idx.length-1];
    const path=pts.slice(from,to+1).map((p,k)=>(k?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    return {c,path,start:x(from),end:x(to)};
  }).filter(Boolean);
  const h=hover!=null?items[hover]:null;
  return <div className="ndb-chartbox">
    <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label="Curva ABC: percentual acumulado do faturamento por produto"
      onMouseLeave={()=>setHover(null)}
      onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*W;setHover(Math.max(0,Math.min(n-1,Math.round((px-L)/iw*(n-1)))));}}>
      {[0,20,40,60,80,100].map(g=><g key={g}><line x1={L} x2={W-R} y1={y(g)} y2={y(g)} className="ndb-grid-line"/><text x={L-8} y={y(g)+4} textAnchor="end" className="ndb-axis">{g}%</text></g>)}
      <line x1={L} x2={W-R} y1={y(80)} y2={y(80)} className="ndb-guide"/><line x1={L} x2={W-R} y1={y(95)} y2={y(95)} className="ndb-guide"/>
      {seg.map(s=><rect key={'bg'+s.c} x={s.start} y={T} width={Math.max(2,s.end-s.start)} height={ih} fill={CLASS_COLOR[s.c]} opacity="0.1"/>)}
      {seg.map(s=><path key={s.c} d={s.path} fill="none" stroke={CLASS_COLOR[s.c]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
      {seg.map(s=><text key={'t'+s.c} x={(s.start+s.end)/2} y={H-10} textAnchor="middle" className="ndb-axis-strong">Classe {s.c}</text>)}
      {h&&<g><line x1={pts[hover][0]} x2={pts[hover][0]} y1={T} y2={T+ih} className="ndb-cross"/><circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill={CLASS_COLOR[h.class]} stroke="#fff" strokeWidth="2"/></g>}
    </svg>
    {h&&<div className="ndb-tip" style={{left:Math.min(68,Math.max(2,pts[hover][0]/W*100))+'%'}}>
      <b>{h.key}</b><span>{h.title||'—'}</span>
      <em>{money(h.revenue)} · {num(h.units)} unid. · acumulado {String(h.cum_pct).replace('.',',')}%</em></div>}
  </div>;
}

// Barras horizontais: uma linha por anúncio, barra proporcional ao maior valor.
function BarList({rows,max,colorOf,value,extra}){
  return <ol className="ndb-bars">
    {rows.map((r,i)=><li key={r.platform+r.external_id}>
      <span className="ndb-rank">{i+1}</span>
      <div className="ndb-bar-main">
        <div className="ndb-bar-title"><strong title={r.title||''}>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform} · {r.external_id}{r.status&&r.status!=='ACTIVE'?' · inativo':''}</small></div>
        <div className="ndb-bar-track"><i style={{width:Math.max(2,value(r)/max*100)+'%',background:colorOf(r)}}/></div>
        {extra&&extra(r)}
      </div>
      <div className="ndb-bar-val"><b>{money(value(r))}</b><Delta cur={r.units} prev={r.units_previous}/></div>
    </li>)}
  </ol>;
}

export default function CommerceDashboard(){
  const [platform,setPlatform]=useState('TODAS');
  const [days,setDays]=useState(30);
  const [data,setData]=useState(null);
  const [series,setSeries]=useState(null);
  const [overview,setOverview]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [cls,setCls]=useState('A');
  const [showAbc,setShowAbc]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const q='?platform='+platform+'&days='+days;
    setLoading(true);setError('');
    fetchCommercialManager('/api/admin/commerce/sales-dashboard'+q,{signal:controller.signal})
      .then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Não foi possível carregar o dashboard.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/series'+q,{signal:controller.signal})
      .then(setSeries).catch(()=>{if(!controller.signal.aborted)setSeries(null);});
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/overview'+q,{signal:controller.signal})
      .then(setOverview).catch(()=>{if(!controller.signal.aborted)setOverview(null);});
    return()=>controller.abort();
  },[platform,days]);
  const drops=data?.drops?.items||[];
  const top=data?.top||[];
  const signalRows=useMemo(()=>drops.filter(r=>r.listing_id).map(r=>({id:r.listing_id})),[data]);
  const {signals,diagnosis}=usePriceSignals(signalRows,days);
  const totals=data?.totals||{};
  const classes=data?.abc?.classes||[];
  const allItems=data?.abc?.items||[];
  const items=allItems.filter(i=>i.class===cls);
  const hasData=data&&data.last_day;
  const daily=series?.daily||[];
  const shopeeTotal=daily.reduce((a,d)=>a+Number(d.shopee||0),0);
  const mlTotal=daily.reduce((a,d)=>a+Number(d.ml||0),0);
  const ov=overview||{};
  const ovListings=ov.listings||{};
  const adsRows=ov.ads?.rows||[];
  const lowRoas=adsRows.filter(r=>r.roas!=null&&Number(r.roas)<1);
  const [best,setBest]=useState('revenue');
  const bestRows=best==='units'?(ov.top_units||[]).map(r=>({...r,value:num(r.units)+' unid.',sub:money(r.revenue),delta:[r.units,r.units_previous]}))
    :best==='growth'?(ov.growth||[]).map(r=>({...r,value:'+'+num(r.units-r.units_previous)+' unid.',sub:num(r.units_previous)+' → '+num(r.units)+' unid.',delta:[r.units,r.units_previous]}))
    :best==='roas'?adsRows.filter(r=>r.listing_id&&r.roas!=null).sort((a,b)=>Number(b.roas)-Number(a.roas)).slice(0,10).map(r=>({platform:'SHOPEE',external_id:'Ads',title:r.title||r.campaign,value:'ROAS '+String(r.roas).replace('.',','),sub:'Gasto '+money(r.spend)+' · vendas atribuídas '+money(r.gmv)}))
    :top.slice(0,15).map(r=>({...r,value:money(r.revenue),sub:num(r.units)+' unid.',delta:[r.units,r.units_previous]}));
  const maxTop=Math.max(1,...top.map(r=>Number(r.revenue)||0));
  const maxDrop=Math.max(1,...drops.map(r=>Number(r.lost_revenue)||0));
  return <section className="ndb-root" aria-label="Dashboard comercial">
    <div className="ndb-toolbar">
      <div className="ndb-toolbar-main">
        <div className="ndb-seg" role="group" aria-label="Plataforma">
          {PLATFORMS.map(([v,l])=><button key={v} type="button" className={v===platform?'is-active':''} aria-pressed={v===platform} onClick={()=>setPlatform(v)}>{l}</button>)}
        </div>
        <div className="ndb-seg" role="group" aria-label="Período">
          {PERIODS.map(p=><button key={p} type="button" className={p===days?'is-active':''} aria-pressed={p===days} onClick={()=>setDays(p)}>{p} dias</button>)}
        </div>
      </div>
      <p className="ndb-period">{loading?'Consultando…':hasData?'Vendas de '+fmtDayFull(data.current_start)+' a '+fmtDayFull(data.last_day)+', comparadas com os '+days+' dias anteriores. Dados importados até '+fmtDayFull(data.last_day)+'.':''}</p>
    </div>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {hasData&&data.previous_complete===false&&<p className="ndb-warn">Não há vendas importadas para todo o período anterior; as variações podem estar incompletas.</p>}
    {hasData&&<div className="ndb-kpis">
      <article><span>Faturamento<InfoIcon text={SOURCES.kpi} label="Faturamento"/></span><strong>{money(totals.cur_rev)}</strong><small><Delta cur={totals.cur_rev} prev={totals.prev_rev}/> antes: {money(totals.prev_rev)}</small></article>
      <article><span>Unidades vendidas<InfoIcon text={SOURCES.kpi} label="Unidades"/></span><strong>{num(totals.cur_units)}</strong><small><Delta cur={totals.cur_units} prev={totals.prev_units}/> antes: {num(totals.prev_units)}</small></article>
      <article><span>Pedidos<InfoIcon text={SOURCES.kpi+' Pedidos são somados por anúncio: um pedido com dois anúncios diferentes conta duas vezes.'} label="Pedidos"/></span><strong>{ov.orders?num(ov.orders.current):'—'}</strong><small>{ov.orders&&<Delta cur={ov.orders.current} prev={ov.orders.previous}/>} {ov.orders?'antes: '+num(ov.orders.previous):'sem dados'}</small></article>
      <article><span>Anúncios ativos<InfoIcon text={SOURCES.alerts} label="Anúncios ativos"/></span><strong>{ov.listings?num(ovListings.active):'—'}</strong><small>{ov.listings?num(ovListings.inactive)+' inativos · '+num(ovListings.active_without_sales)+' ativos sem venda':'sem dados'}</small></article>
      <article className="is-loss"><span>Perda nos anúncios em queda<InfoIcon text={SOURCES.drops} label="Perda"/></span><strong>{money(data.drops?.lost_revenue)}</strong><small>{num(data.drops?.total)} anúncios ativos em queda</small></article>
      <article className="is-muted"><span>Investimento em anúncios e ROAS<InfoIcon text={SOURCES.ads} label="Investimento e ROAS"/></span><strong>Sem dados</strong><small>no período escolhido; veja Shopee Ads abaixo</small></article>
      <article className="is-muted"><span>Margem e lucro<InfoIcon text="O sistema ainda não tem o custo de cada produto. Sem custo, margem e lucro não podem ser calculados com segurança." label="Margem e lucro"/></span><strong>Sem dados</strong><small>falta cadastrar o custo do produto</small></article>
    </div>}
    {hasData&&overview&&<Card className="span-12 ndb-alerts" title="Precisa de ação" subtitle={'Comparação: últimos '+days+' dias contra os '+days+' dias anteriores'} source="alerts">
      <div className="ndb-tiles">
        <div className="ndb-tile bad"><b>{num(data.drops?.total)}</b><strong>Em queda</strong><span>ativos com queda de 15% ou mais; {money(data.drops?.lost_revenue)} a menos</span></div>
        <div className="ndb-tile bad"><b>{num((ov.stopped||[]).length)}{(ov.stopped||[]).length>=10?'+':''}</b><strong>Pararam de vender</strong><span>ativos com 3 ou mais unidades antes e nenhuma agora</span></div>
        <div className="ndb-tile warn"><b>{num(ovListings.active_without_sales)}</b><strong>Ativos sem venda</strong><span>de {num(ovListings.active)} ativos, nenhuma unidade no período</span></div>
        <div className="ndb-tile warn"><b>{num(ovListings.inactive_with_sales)}</b><strong>Inativos com venda</strong><span>inativos ou removidos que ainda aparecem nas vendas</span></div>
        <div className={'ndb-tile '+(lowRoas.length?'bad':'good')}><b>{adsRows.length?num(lowRoas.length):'—'}</b><strong>Anúncios pagos com ROAS &lt; 1</strong><span>{adsRows.length?'gastou mais do que vendeu (relatório Ads de '+fmtDayFull(ov.ads.period_start)+' a '+fmtDayFull(ov.ads.period_end)+')':'sem relatório Shopee Ads importado'}</span></div>
        <div className="ndb-tile good"><b>{num((ov.growth||[]).length)}{(ov.growth||[]).length>=10?'+':''}</b><strong>Em alta</strong><span>ativos com alta de 15% ou mais; veja em Melhores produtos</span></div>
      </div>
      {(ov.stopped||[]).length>0&&<div className="ndb-stopped"><strong>Pararam de vender (maiores primeiro)</strong>
        <ul>{(ov.stopped||[]).slice(0,6).map(r=><li key={r.platform+r.external_id}><span title={r.title||''}>{r.title||r.external_id}</span><small>{PLATFORM_LABEL[r.platform]||r.platform} · {num(r.units_previous)} unid. antes · {money(r.revenue_previous)}</small></li>)}</ul></div>}
    </Card>}
    <div className="ndb-grid">
      <Card className="span-8" title="Faturamento por dia" subtitle="Cada dia do período, empilhado por plataforma, contra o mesmo dia do período anterior" source="daily">
        <DailyChart daily={daily}/>
      </Card>
      <Card className="span-4" title="Participação por plataforma" subtitle="Faturamento do período" source="daily">
        <div className="ndb-donut-box">
          <Donut parts={[{label:'Shopee',value:shopeeTotal,color:PLAT_COLOR.SHOPEE},{label:'Mercado Livre',value:mlTotal,color:PLAT_COLOR.ML_ANTIGO}]} center={shortMoney(shopeeTotal+mlTotal)} sub="total"/>
          <ul className="ndb-donut-legend">
            <li><i style={{background:PLAT_COLOR.SHOPEE}}/>Shopee<b>{money(shopeeTotal)}</b><small>{Math.round(shopeeTotal/((shopeeTotal+mlTotal)||1)*100)}%</small></li>
            <li><i style={{background:PLAT_COLOR.ML_ANTIGO}}/>Mercado Livre<b>{money(mlTotal)}</b><small>{Math.round(mlTotal/((shopeeTotal+mlTotal)||1)*100)}%</small></li>
          </ul>
        </div>
      </Card>
      <Card className="span-8" title="Curva ABC de produtos" subtitle="Quanto do faturamento cada produto concentra, do maior para o menor (por SKU)" source="abc">
        <ParetoChart items={allItems}/>
        <p className="ndb-note">Passe o mouse na curva para ver cada produto (até os 120 maiores).</p>
      </Card>
      <Card className="span-4" title="Classes A, B e C" subtitle="Clique para listar os produtos" source="abc">
        <div className="ndb-donut-box">
          <Donut parts={classes.map(c=>({label:'Classe '+c.class,value:Number(c.revenue)||0,color:CLASS_COLOR[c.class]}))} center={num(classes.reduce((a,c)=>a+Number(c.products||0),0))} sub="produtos"/>
          <div className="ndb-classes">
            {classes.map(c=><button type="button" key={c.class} className={'ndb-class'+(c.class===cls?' is-active':'')} onClick={()=>{setCls(c.class);setShowAbc(true);}} aria-pressed={c.class===cls}>
              <span className="dot" style={{background:CLASS_COLOR[c.class]}}/>
              <b>Classe {c.class}</b><em>{CLASS_NOTE[c.class]}</em>
              <strong>{num(c.products)} produtos</strong><small>{String(c.revenue_pct).replace('.',',')}% · {shortMoney(c.revenue)}</small>
            </button>)}
          </div>
        </div>
      </Card>
      {showAbc&&<Card className="span-12" title={'Produtos da classe '+cls} subtitle={CLASS_NOTE[cls]} source="abc">
        <div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Produto (SKU)</th><th className="num">Unid.</th><th className="num">Faturamento</th><th className="num">% acum.</th></tr></thead><tbody>
          {items.map(i=><tr key={i.key}><td title={i.title||''}><strong>{i.key}</strong><small>{i.title||'—'}</small></td><td className="num">{num(i.units)}</td><td className="num">{money(i.revenue)}</td><td className="num">{String(i.cum_pct).replace('.',',')}%</td></tr>)}
          {!loading&&items.length===0&&<tr><td colSpan={4} className="ndb-empty">Sem produtos nesta classe.</td></tr>}
        </tbody></table></div>
        <button type="button" className="ndb-toggle" onClick={()=>setShowAbc(false)}>Fechar lista</button>
      </Card>}
      <Card className="span-6" title="Anúncios em queda" subtitle="Ativos que mais perderam faturamento contra o período anterior" source="drops">
        {drops.length===0&&!loading&&<p className="ndb-empty">Nenhum anúncio ativo em queda neste período.</p>}
        <BarList rows={drops.slice(0,10)} max={maxDrop} colorOf={()=>'#e34948'} value={r=>Number(r.lost_revenue)||0}
          extra={r=><div className="ndb-bar-extra"><span>{num(r.units_previous)} → {num(r.units)} unid.</span><PriceSignalCell signal={signals[r.listing_id]} window={days} diagnosis={diagnosis[r.listing_id]}/></div>}/>
        {drops.length>10&&<p className="ndb-note">Mostrando 10 de {num(data.drops?.total)} anúncios em queda.</p>}
      </Card>
      <Card className="span-6" title="Melhores produtos" subtitle="Cada critério mostra uma coisa diferente; o mais vendido não é necessariamente o mais lucrativo" source="best">
        <div className="ndb-seg" role="group" aria-label="Critério">
          {[['revenue','Maior faturamento'],['units','Mais unidades'],['growth','Maior crescimento'],['roas','Melhor ROAS (Ads)']].map(([v,l])=><button key={v} type="button" className={v===best?'is-active':''} aria-pressed={v===best} onClick={()=>setBest(v)}>{l}</button>)}
        </div>
        {bestRows.length===0&&<p className="ndb-empty">Sem dados para este critério no período.</p>}
        <ol className="ndb-rank-list">{bestRows.map((r,i)=><li key={(r.platform||'')+(r.external_id||'')+i}>
          <span className="ndb-rank">{i+1}</span>
          <div><strong title={r.title||''}>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform}{r.external_id&&r.external_id!=='Ads'?' · '+r.external_id:''} · {r.sub}</small></div>
          <div className="ndb-bar-val"><b>{r.value}</b>{r.delta&&<Delta cur={r.delta[0]} prev={r.delta[1]}/>}</div>
        </li>)}</ol>
      </Card>
    </div>
    {hasData&&overview&&<div className="ndb-grid">
      <Card className="span-12" title="Shopee Ads: campanhas" subtitle={adsRows.length?'Relatório de '+fmtDayFull(ov.ads.period_start)+' a '+fmtDayFull(ov.ads.period_end)+' (período próprio, não segue o filtro)':'Nenhum relatório importado'} source="ads">
        {adsRows.length===0?<p className="ndb-empty">Sem dados de anúncios pagos. Importe o relatório “Dados gerais” em Importar, opção Shopee Ads.</p>:
        <div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Campanha</th><th className="num">Impressões</th><th className="num">Cliques</th><th className="num">CTR</th><th className="num">Itens vendidos</th><th className="num">Vendas atribuídas</th><th className="num">Gasto</th><th className="num">ROAS</th></tr></thead><tbody>
          {adsRows.map((r,i)=><tr key={i}><td title={r.campaign}><strong>{r.title||r.campaign}</strong><small>{r.listing_id?'Anúncio individual':'Grupo de anúncios'}</small></td>
            <td className="num">{num(r.impressions)}</td><td className="num">{num(r.clicks)}</td><td className="num">{r.impressions?String((r.clicks/r.impressions*100).toFixed(2)).replace('.',',')+'%':'—'}</td>
            <td className="num">{num(r.items_sold)}</td><td className="num">{money(r.gmv)}</td><td className="num">{money(r.spend)}</td>
            <td className={'num'+(r.roas!=null&&Number(r.roas)<1?' bad':'')}>{r.roas==null?'sem dados':String(r.roas).replace('.',',')}</td></tr>)}
        </tbody></table></div>}
        <p className="ndb-note">Não some as linhas: grupos de anúncios e anúncios individuais podem contar as mesmas vendas.</p>
      </Card>
      <Card className="span-12" title="Confiabilidade dos dados" subtitle="O que está no banco e o que pode estar faltando" source="trust">
        <div className="ndb-tiles">
          {(ov.coverage||[]).map(c=><div key={c.platform} className="ndb-tile"><strong>{PLATFORM_LABEL[c.platform]||c.platform}</strong><span>Vendas até {fmtDayFull(c.last_day)}</span><span>Última importação aplicada: {c.last_import?new Date(c.last_import).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'sem dados'}</span></div>)}
          <div className="ndb-tile"><strong>Dias com venda</strong><span>{num(ov.window_days_with_sales)} de {days} dias do período{Number(ov.window_days_with_sales)<days?' (há dias sem venda importada)':''}</span></div>
          <div className={'ndb-tile '+(Number(ov.unlinked?.revenue)>0?'warn':'good')}><strong>Vendas sem SKU vinculado</strong><span>{Number(ov.unlinked?.revenue)>0?num(ov.unlinked.listings)+' anúncios, '+money(ov.unlinked.revenue)+' fora da curva ABC por produto':'nenhuma no período'}</span></div>
        </div>
        <details className="ndb-defs"><summary>Definição de cada indicador</summary><ul>
          <li><b>Faturamento:</b> valor dos produtos vendidos, sem frete, das vendas importadas. Não é o faturamento atribuído aos anúncios pagos.</li>
          <li><b>Pedidos:</b> soma por anúncio; um pedido com dois anúncios conta duas vezes.</li>
          <li><b>Curva ABC:</b> por SKU, ordenada pelo faturamento do período. A = até 80% do total, B = até 95%, C = o restante. Produto C pode ser novo, sazonal ou estratégico.</li>
          <li><b>Em queda:</b> anúncio ativo com 5 ou mais unidades no período anterior e queda de 15% ou mais nas unidades.</li>
          <li><b>ROAS:</b> vendas atribuídas ÷ gasto, do relatório Shopee Ads. ROAS menor que 1 = gastou mais do que vendeu, antes de custo de produto e taxas.</li>
          <li><b>Sem dados:</b> a informação não existe no sistema. Nunca é mostrada como zero.</li>
        </ul></details>
      </Card>
    </div>}
    <details className="ndb-help-box"><summary>Dados que ajudariam a explicar as quedas<InfoIcon text={SOURCES.help} label="Dados que ajudariam"/></summary>
      <ul className="ndb-help">{HELP.map(([t,d])=><li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
    </details>
  </section>;
}
