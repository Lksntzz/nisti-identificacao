import React,{useEffect,useMemo,useRef,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {usePriceSignals,PriceSignalCell} from './commerce-price-signal.jsx';
import './commerce-dashboard.css';

const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)'],['ML_NOVO','Mercado Livre (Novo)']];
const PLATFORM_LABEL={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const PERIODS=[7,30,60,90];
const CLASS_NOTE={A:'Até 80% do faturamento',B:'Dos 80% aos 95%',C:'Últimos 5%'};

const SOURCES={
  abc:'Vendas importadas (tabela de vendas diárias por anúncio, o mesmo dado do Histórico de importações). Soma o faturamento do período por SKU em cada plataforma (Shopee, ML Antigo e ML Novo nunca se misturam: cada uma tem a sua própria curva), ordena do maior para o menor e classifica: A = produtos que somam até 80% do faturamento, B = dos 80% aos 95%, C = o restante. Anúncios sem SKU vinculado entram sozinhos. Faturamento = valor dos produtos, sem frete.',
  drops:'Vendas importadas: compara os últimos N dias com os N dias imediatamente anteriores, por anúncio ATIVO. Entra quem tinha 5 ou mais unidades no período anterior e caiu 15% ou mais. A coluna “Preço × vendas” compara o preço médio realizado. A linha de causa vem dos relatórios de desempenho Shopee importados (impressões, cliques, conversão); sem esse relatório aparece só o preço. São sinais, não prova de causa.',
  daily:'Vendas importadas (tabela de vendas diárias por anúncio): soma do faturamento de cada dia, separado por plataforma. A linha tracejada é o dia equivalente do período anterior (mesmo tamanho). Dias sem venda importada aparecem como zero; confira o Histórico de importações se houver buracos.',
  top:'Vendas importadas: os 15 anúncios com maior faturamento no período, com a variação de unidades contra o período anterior de mesmo tamanho. Título e situação vêm do cadastro de anúncios do sistema.',
  kpi:'Vendas importadas no período escolhido, contra o período anterior de mesmo tamanho. O período termina no último dia com venda importada, não em hoje.',
  alerts:'Calculado sobre as vendas importadas e o cadastro de anúncios: queda = anúncio ativo com 5 ou mais unidades antes e 15% ou mais de queda; pararam = anúncios ativos que já venderam 3 ou mais unidades e não têm nenhuma venda no período do filtro (30, 60 ou 90 dias; quem está parado há mais tempo também aparece nos filtros menores); sem venda = ativos sem nenhuma unidade no período; inativos com venda = anúncios inativos ou removidos que ainda aparecem nas vendas. Anúncio pago com ROAS abaixo de 1 vem do relatório Shopee Ads importado.',
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
const addDays=(v,n)=>{const d=new Date(String(v||'')+'T12:00:00Z');return Number.isNaN(d.getTime())?'':new Date(d.getTime()+n*86400000).toISOString().slice(0,10);};
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

const SHOPEE_SHOP_ID='376221706';
export function listingUrl(platform,id){
  const v=String(id||'').trim();
  if(!v)return null;
  if(platform==='SHOPEE')return /^[0-9]+$/.test(v)?'https://shopee.com.br/product/'+SHOPEE_SHOP_ID+'/'+v:null;
  const m=v.match(/^MLB-?([0-9]+)$/i);
  return m?'https://produto.mercadolivre.com.br/MLB-'+m[1]:null;
}
function Ext({platform,id}){
  const url=listingUrl(platform,id);
  const name=platform==='SHOPEE'?'Shopee':'Mercado Livre';
  if(!url)return null;
  return <a className="ndb-ext" href={url} target="_blank" rel="noopener noreferrer" title={'Abrir o anúncio no '+name} aria-label={'Abrir o anúncio no '+name}>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
  </a>;
}

function ExtList({links}){
  const list=(links||[]).filter(l=>listingUrl(l.platform,l.external_id));
  if(!list.length)return <span className="ndb-muted">sem link</span>;
  const shown=list.slice(0,4);
  return <span className="ndb-extlist">{shown.map(l=>{const name=l.platform==='SHOPEE'?'Shopee':'Mercado Livre';
    return <a key={l.platform+l.external_id} className={'ndb-extchip '+(l.platform==='SHOPEE'?'shp':'ml')} href={listingUrl(l.platform,l.external_id)} target="_blank" rel="noopener noreferrer" title={'Abrir no '+name+' · '+num(l.units)+' unid. · '+money(l.revenue)}>{l.platform==='SHOPEE'?'Shopee':'ML'}<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/></svg></a>;})}
    {list.length>shown.length&&<span className="ndb-muted" title={list.slice(4).map(l=>l.external_id).join(', ')}>+{list.length-shown.length}</span>}</span>;
}

function PeriodBar({cur,prev}){
  return <div className="ndb-periodbar">
    {prev&&<span className="pb prev"><i/>Período anterior: <b>{prev}</b></span>}
    {prev&&<span className="pb arrow" aria-hidden="true">→</span>}
    <span className="pb cur"><i/>Período atual: <b>{cur}</b></span>
  </div>;
}

function Delta({cur,prev}){
  const v=changePct(cur,prev);
  return <span className={'ndb-chip tone-'+tone(v)}>{v==null?'novo':(v>0?'▲ ':v<0?'▼ ':'')+String(Math.abs(v)).replace('.',',')+'%'}</span>;
}

function niceMax(v){
  if(v<=0)return 1;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  const m=[1,2,2.5,5,10].find(k=>k*p>=v);
  return m*p;
}

const CLASS_COLOR={A:'#1d5fd1',B:'#16a46b',C:'#f08a1c'};
const PLAT_COLOR={SHOPEE:'#eb6834',ML_ANTIGO:'#2a78d6',ML_NOVO:'#2a78d6'};
const axisMoney=v=>v>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':String(Math.round(v));
const when=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});};

function Icon({name}){
  const p={viewBox:'0 0 24 24',width:22,height:22,fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true};
  if(name==='money')return <svg {...p}><path d="M12 2v20M17 6.5C16 5 14.2 4 12 4c-2.8 0-5 1.4-5 3.5S9.2 10.5 12 11s5 1.4 5 3.5S14.8 18 12 18c-2.3 0-4.2-1-5.2-2.6"/></svg>;
  if(name==='box')return <svg {...p}><path d="m21 8-9-5-9 5v8l9 5 9-5zM3.3 7.5 12 12.5l8.7-5M12 22V12.5"/></svg>;
  if(name==='cart')return <svg {...p}><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6"/></svg>;
  if(name==='list')return <svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
  if(name==='down')return <svg {...p}><path d="m22 17-8.5-8.5-5 5L2 7M16 17h6v-6"/></svg>;
  if(name==='alert')return <svg {...p}><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>;
  if(name==='pause')return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/></svg>;
  if(name==='eye')return <svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>;
  if(name==='megaphone')return <svg {...p}><path d="m3 11 18-5v12L3 14zM11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>;
  if(name==='trophy')return <svg {...p}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1.2 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1.2 1.2 1 .6 1.8 2 1.8 3.8M18 2H6v7a6 6 0 0 0 12 0z"/></svg>;
  if(name==='pie')return <svg {...p}><path d="M21.2 15.9A10 10 0 1 1 8 2.8M22 12A10 10 0 0 0 12 2v10z"/></svg>;
  return <svg {...p}><path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg>;
}

function Panel({title,icon,source,children,className='',aside}){
  return <section className={'ndb-panel '+className}>
    <header><h3>{icon&&<span className="ndb-ico"><Icon name={icon}/></span>}{title}</h3>{aside}{source&&<InfoIcon text={SOURCES[source]} label={title}/>}</header>
    {children}
  </section>;
}

function KpiCard({icon,label,source,value,chip,foot,muted}){
  return <article className={'ndb-kpi'+(muted?' is-muted':'')}>
    <span className="ndb-kpi-ico"><Icon name={icon}/></span>
    <div className="ndb-kpi-body">
      <span className="ndb-kpi-label">{label}<InfoIcon text={SOURCES[source]||source} label={label}/></span>
      <div className="ndb-kpi-row"><strong>{value}</strong>{chip}</div>
      <small>{foot}</small>
    </div>
  </article>;
}

function useBox(){
  const ref=useRef(null);
  const [dim,setDim]=useState({W:760,H:200});
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const el=ref.current;if(!el)return undefined;
    const set=()=>{const r=el.getBoundingClientRect();if(r.width>120&&r.height>60)setDim({W:Math.round(r.width),H:Math.round(r.height)});};
    set();
    if(typeof ResizeObserver==='undefined')return undefined;
    const ro=new ResizeObserver(set);ro.observe(el);return()=>ro.disconnect();
  },[ready]);
  const setRef=el=>{if(el!==ref.current){ref.current=el;setReady(Boolean(el));}};
  return [setRef,dim];
}

// Vendas por dia: linha do período atual (com preenchimento) contra o período anterior (tracejado).
const SEG_THEME={total:'#1d5fd1',drops:'#d63535',stopped:'#d98a00',best:'#139a62',a:'#1d5fd1',b:'#16a46b',c:'#f08a1c'};
function DailyChart({daily,animKey,theme='total'}){
  const [hover,setHover]=useState(null);
  const [boxRef,{W,H}]=useBox();
  const n=daily.length;
  const reduce=typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!n)return <p className="ndb-empty">Sem dados diários para este período.</p>;
  const col=SEG_THEME[theme]||SEG_THEME.total;
  const stopped=theme==='stopped';
  const L=46,R=10,T=8,B=20,iw=W-L-R,ih=H-T-B;
  const cur=d=>Number(d.shopee)+Number(d.ml);
  const prv=d=>Number(d.prev_revenue)||0;
  // Pararam: o que vale mostrar é o que vendiam antes (agora é zero); nos demais, linha cheia = período atual.
  const main=stopped?prv:cur;
  const alt=stopped?cur:prv;
  const maxV=niceMax(Math.max(...daily.map(d=>Math.max(cur(d),prv(d)))));
  const x=i=>L+(n===1?iw/2:i/(n-1)*iw);
  const y=v=>T+ih-(v/maxV)*ih;
  const line=f=>daily.map((d,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(f(d)).toFixed(1)).join(' ');
  const steps=ih<110?2:4;
  const ticks=Array.from({length:steps+1},(_,k)=>k/steps*maxV);
  const xt=n<=7?daily.map((_,i)=>i):[0,1,2,3,4,5,6].map(k=>Math.round(k*(n-1)/6));
  const h=hover!=null?daily[hover]:null;
  const gid='ndbfill-'+theme;
  // Faixa entre o período anterior e o atual quando o atual ficou abaixo (venda perdida).
  const gap=theme==='drops'?daily.map((d,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(Math.max(prv(d),cur(d))).toFixed(1)).join(' ')+daily.slice().reverse().map((d,k)=>'L'+x(n-1-k).toFixed(1)+' '+y(cur(d)).toFixed(1)).join(' ')+' Z':null;
  return <div className="ndb-chartbox fill" ref={boxRef}>
    <svg viewBox={'0 0 '+W+' '+H} width={W} height={H} role="img" aria-label="Faturamento por dia" onMouseLeave={()=>setHover(null)}
      onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*W;setHover(Math.max(0,Math.min(n-1,Math.round((px-L)/iw*(n-1)))));}}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".26"/><stop offset="1" stopColor={col} stopOpacity="0"/></linearGradient></defs>
      {ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={y(t)} y2={y(t)} className="ndb-grid-line"/><text x={L-8} y={y(t)+4} textAnchor="end" className="ndb-axis">{axisMoney(t)}</text></g>)}
      <g key={animKey} className={reduce?'':'ndb-reveal'}>
      {gap&&<path d={gap} fill={col} fillOpacity=".14"/>}
      <path d={line(main)+' L'+x(n-1).toFixed(1)+' '+y(0)+' L'+x(0).toFixed(1)+' '+y(0)+' Z'} fill={'url(#'+gid+')'}/>
      <path d={line(alt)} fill="none" stroke={stopped?col:'#8a97ab'} strokeWidth={stopped?2:1.6} strokeDasharray="5 4" strokeLinecap="round"/>
      <path d={line(main)} fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      {daily.map((d,i)=>n<=31&&<circle key={i} cx={x(i)} cy={y(main(d))} r="2.3" fill={col}/>)}
      </g>
      {xt.map(i=><text key={i} x={x(i)} y={H-5} textAnchor={i===0?'start':i===n-1?'end':'middle'} className="ndb-axis">{fmtDay(daily[i].day)}</text>)}
      {h&&<g><line x1={x(hover)} x2={x(hover)} y1={T} y2={T+ih} className="ndb-cross"/><circle cx={x(hover)} cy={y(main(h))} r="4.5" fill="#fff" stroke={col} strokeWidth="2.2"/></g>}
    </svg>
    {h&&<div className="ndb-tip" style={{left:Math.min(W-250,Math.max(L,x(hover)+12))+'px'}}>
      <b>{fmtDayFull(h.day)}</b>
      {Number(h.shopee)>0&&<span><i style={{background:PLAT_COLOR.SHOPEE}}/>Shopee {money(h.shopee)}</span>}
      {Number(h.ml)>0&&<span><i style={{background:PLAT_COLOR.ML_ANTIGO}}/>Mercado Livre {money(h.ml)}</span>}
      <em>Total {money(cur(h))} · {num(h.units)} unid.</em>
      <em>Mesmo dia do período anterior: {money(h.prev_revenue)}</em></div>}
  </div>;
}

// Curva de Pareto: eixo único (% acumulado do faturamento), produtos do maior para o menor.
function ParetoChart({items}){
  const [hover,setHover]=useState(null);
  const [boxRef,{W,H}]=useBox();
  if(!items.length)return <p className="ndb-empty">Sem vendas no período.</p>;
  const L=40,R=12,T=8,B=22,iw=W-L-R,ih=H-T-B,n=items.length;
  const x=i=>L+(n===1?iw/2:i/(n-1)*iw);
  const y=v=>T+ih-(v/100)*ih;
  const pts=items.map((it,i)=>[x(i),y(it.cum_pct)]);
  const seg=['A','B','C'].map(c=>{
    const idx=items.map((it,i)=>it.class===c?i:-1).filter(i=>i>=0);
    if(!idx.length)return null;
    const from=Math.max(0,idx[0]-1),to=idx[idx.length-1];
    return {c,path:pts.slice(from,to+1).map((p,k)=>(k?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' '),start:x(from),end:x(to)};
  }).filter(Boolean);
  const h=hover!=null?items[hover]:null;
  return <div className="ndb-chartbox fill" ref={boxRef}>
    <svg viewBox={'0 0 '+W+' '+H} width={W} height={H} role="img" aria-label="Curva ABC: percentual acumulado do faturamento por produto"
      onMouseLeave={()=>setHover(null)}
      onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*W;setHover(Math.max(0,Math.min(n-1,Math.round((px-L)/iw*(n-1)))));}}>
      {[0,20,40,60,80,100].map(g=><g key={g}><line x1={L} x2={W-R} y1={y(g)} y2={y(g)} className="ndb-grid-line"/><text x={L-8} y={y(g)+4} textAnchor="end" className="ndb-axis">{g}%</text></g>)}
      <line x1={L} x2={W-R} y1={y(80)} y2={y(80)} className="ndb-guide"/><line x1={L} x2={W-R} y1={y(95)} y2={y(95)} className="ndb-guide"/>
      {seg.map(s=><path key={s.c} d={s.path} fill="none" stroke={CLASS_COLOR[s.c]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
      {seg.map(s=><text key={'t'+s.c} x={(s.start+s.end)/2} y={H-6} textAnchor="middle" className="ndb-axis-strong">Classe {s.c}</text>)}
      {h&&<g><line x1={pts[hover][0]} x2={pts[hover][0]} y1={T} y2={T+ih} className="ndb-cross"/><circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill={CLASS_COLOR[h.class]} stroke="#fff" strokeWidth="2"/></g>}
    </svg>
    {h&&<div className="ndb-tip" style={{left:Math.min(66,Math.max(2,pts[hover][0]/W*100))+'%'}}>
      <b>{h.key}</b><span>{h.title||'—'}</span>
      <em>{money(h.revenue)} · {num(h.units)} unid. · acumulado {String(h.cum_pct).replace('.',',')}%</em></div>}
  </div>;
}

const pf=v=>v==null?'':String(Math.abs(v)).replace('.',',')+'%';
// Tradução simples dos sinais em um motivo provável. É correlação observada, não prova de causa.
function reasonFor(signal,diag){
  const d=diag&&diag.driver&&diag.driver!=='INSUFFICIENT'&&diag.trend==='DOWN'?diag:null;
  if(d&&d.driver==='IMPRESSIONS')return {tone:'bad',title:'Menos exposição',text:'Impressões '+pf(d.impressions_pct)+' menores (relatório Shopee): o anúncio está sendo mostrado menos.'};
  if(d&&d.driver==='CTR')return {tone:'bad',title:'Menos cliques',text:'Cliques por impressão '+pf(d.ctr_pct)+' menores: título, foto ou preço atraem menos.'};
  if(d&&d.driver==='CONVERSION')return {tone:'bad',title:'Converte menos',text:'Conversão '+pf(d.conversion_pct)+' menor: visitam mas compram menos (preço, avaliações ou estoque).'};
  if(!signal)return {tone:'muted',title:'Sem dados',text:'Ainda carregando ou sem vendas suficientes para comparar.'};
  if(signal.signal==='PRICE_UP_SALES_DOWN')return {tone:'warn',title:'Preço subiu',text:'Preço médio '+pf(signal.price_change_pct)+' maior e as unidades caíram junto.'};
  if(signal.signal==='DROP_PRICE_STABLE')return {tone:'warn',title:'Queda sem mudança de preço',text:'Preço estável. Sem relatório de visitas/impressões deste anúncio não dá para apontar a causa.'};
  if(signal.signal==='INSUFFICIENT')return {tone:'muted',title:'Poucas vendas',text:'Vendas insuficientes nas duas janelas para uma conclusão segura.'};
  return {tone:'muted',title:'Sem causa clara',text:'Os dados disponíveis não explicam a queda.'};
}

function Dropdown({label,value,options,onChange}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return undefined;
    const down=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    const key=e=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key);};
  },[open]);
  const cur=options.find(o=>o[0]===value);
  return <div className="ndb-dd" ref={ref}>
    <button type="button" className="ndb-dd-btn" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
      <span>{label}</span><b>{cur?cur[1]:''}</b>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {open&&<ul className="ndb-dd-list" role="listbox" aria-label={label}>{options.map(([v,l])=><li key={v}>
      <button type="button" role="option" aria-selected={v===value} className={v===value?'is-active':''} onClick={()=>{onChange(v);setOpen(false);}}>{l}</button></li>)}</ul>}
  </div>;
}

export default function CommerceDashboard(){
  const [platform,setPlatform]=useState('TODAS');
  const [days,setDays]=useState(30);
  const [data,setData]=useState(null);
  const [series,setSeries]=useState(null);
  const [overview,setOverview]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [cls,setCls]=useState(null);
  const [abcPlat,setAbcPlat]=useState('SHOPEE');
  const [curve,setCurve]=useState(false);
  const [tab,setTabRaw]=useState('best');
  const [focus,setFocus]=useState(false);
  const setTab=k=>{setTabRaw(k);setFocus(true);};
  const [helpOpen,setHelpOpen]=useState(false);
  const [nsf,setNsf]=useState('all');
  const [segSeries,setSegSeries]=useState(null);
  const [segFail,setSegFail]=useState(false);
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
  const abcP=platform==='TODAS'?abcPlat:platform;
  const segment=!focus?null:tab==='best'?'best':tab==='drops'?'drops':tab==='stopped'?'stopped':(tab==='abc'&&cls)?cls.toLowerCase():null;
  const segPlatform=segment&&segment.length===1?abcP:platform;
  useEffect(()=>{
    if(!segment){setSegSeries(null);return undefined;}
    const controller=new AbortController();
    setSegSeries(null);setSegFail(false);
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/segment-series?platform='+segPlatform+'&days='+days+'&segment='+segment,{signal:controller.signal})
      .then(setSegSeries).catch(()=>{if(!controller.signal.aborted){setSegSeries(null);setSegFail(true);}});
    return()=>controller.abort();
  },[segPlatform,days,segment]);
  const drops=data?.drops?.items||[];
  const top=data?.top||[];
  const signalRows=useMemo(()=>drops.filter(r=>r.listing_id).map(r=>({id:r.listing_id})),[data]);
  const {signals,diagnosis}=usePriceSignals(signalRows,days);
  const totals=data?.totals||{};
  const classes=data?.abc?.classes_by_platform?.[abcP]||[];
  const allItems=(data?.abc?.items||[]).filter(i=>i.platform===abcP);
  const hasData=data&&data.last_day;
  const per=hasData?{curFrom:addDays(data.last_day,-days+1),curTo:data.last_day,prevFrom:addDays(data.last_day,-2*days+1),prevTo:addDays(data.last_day,-days)}:null;
  const rng=(a,b)=>fmtDay(a)+' a '+fmtDay(b);
  const curTxt=per?rng(per.curFrom,per.curTo):'';
  const prevTxt=per?rng(per.prevFrom,per.prevTo):'';
  const SEG_TITLE={best:'15 anúncios que mais faturam',drops:'Anúncios em queda',stopped:'Anúncios que pararam de vender',a:'Produtos da classe A',b:'Produtos da classe B',c:'Produtos da classe C'};
  const segActive=Boolean(segment&&segSeries&&segSeries.segment&&segSeries.segment.toLowerCase()===segment);
  const daily=segActive?(segSeries.daily||[]):(series?.daily||[]);
  const segColor=SEG_THEME[segActive?segment:'total'];
  const curSum=daily.reduce((a,d)=>a+Number(d.shopee||0)+Number(d.ml||0),0);
  const prevSum=daily.reduce((a,d)=>a+Number(d.prev_revenue||0),0);
  const segDelta=changePct(curSum,prevSum);
  const shopeeTotal=daily.reduce((a,d)=>a+Number(d.shopee||0),0);
  const mlTotal=daily.reduce((a,d)=>a+Number(d.ml||0),0);
  const ov=overview||{};
  const lst=ov.listings||{};
  const isML=platform==='ML_ANTIGO'||platform==='ML_NOVO';
  const adsRows=isML?[]:(ov.ads?.rows||[]);
  const lowRoas=adsRows.filter(r=>r.roas!=null&&Number(r.roas)<1);
  const totalProducts=classes.reduce((a,c)=>a+Number(c.products||0),0)||1;

  const adsByListing=Object.fromEntries(adsRows.filter(r=>r.listing_id).map(r=>[r.listing_id,r]));
  const classRows=cls?allItems.filter(i=>i.class===cls):[];
  const updated=(ov.coverage||[]).map(c=>c.last_import).filter(Boolean).sort().pop();
  const alerts=[
    {k:'drops',t:'bad',i:'down',h:num(data?.drops?.total)+' produtos em queda',d:'Perderam '+money(data?.drops?.lost_revenue)+' de faturamento ('+curTxt+' vs. '+prevTxt+').'},
    overview?{k:'stopped',t:'bad',i:'pause',h:num(ov.stopped_total??(ov.stopped||[]).length)+' pararam de vender',d:'Já venderam 3 ou mais unidades e estão sem nenhuma venda desde '+(per?fmtDayFull(per.curFrom):'o início do período')+' ('+days+' dias ou mais).'}
      :{k:'stopped',t:'muted',i:'pause',h:'Pararam de vender: sem dados',d:'A consulta de alertas ainda não está disponível.'},
    overview?{k:'nosales',t:'warn',i:'eye',h:num(ov.no_sales_total??lst.active_without_sales)+' anúncios ativos sem vendas',d:'Nenhuma unidade vendida em '+curTxt+', de '+num(lst.active)+' anúncios ativos.'}
      :{k:'nosales',t:'muted',i:'eye',h:'Anúncios sem vendas: sem dados',d:'A consulta de alertas ainda não está disponível.'},
    adsRows.length&&!isML?{k:'ads',t:lowRoas.length?'bad':'good',i:'megaphone',h:num(lowRoas.length)+' anúncios com ROAS abaixo de 1',d:'Gastaram mais do que venderam. Relatório Shopee Ads de '+fmtDayFull(ov.ads.period_start)+' a '+fmtDayFull(ov.ads.period_end)+' (período próprio, não segue o filtro).'}
      :{k:'ads',t:'muted',i:'megaphone',h:'Gasto e retorno de anúncios: sem dados',d:isML?'Não há relatório de anúncios do Mercado Livre importado.':'Nenhum relatório Shopee Ads importado.'}
  ];
  const openAlert=k=>{if(k==='abc'){setTab('abc');return;}setTab(k);};
  
  const stoppedRows=ov.stopped||[];
  const firstDay=fmtDayFull((ov.coverage||[]).map(c=>c.first_day).filter(Boolean).sort()[0]);
  const TABS=[
    ['best','Melhores produtos',null],
    ['drops','Em queda',data?.drops?.total],
    ['stopped','Pararam',overview?(ov.stopped_total??stoppedRows.length):null],
    ['nosales','Sem vendas',overview?(ov.no_sales_total??lst.active_without_sales):null],
    ['ads','Anúncios pagos (ROAS)',adsRows.length||null],
    ['abc','Curva ABC',null]
  ];
  const TAB_SOURCE={best:'best',drops:'drops',stopped:'alerts',nosales:'alerts',ads:'ads',abc:'abc'};
  const bestAll=[...top].sort((x,y)=>Number(y.units)-Number(x.units));
  const filters=<>
    <Dropdown label="Período" value={days} options={PERIODS.map(p=>[p,'Últimos '+p+' dias'])} onChange={setDays}/>
    <Dropdown label="Plataforma" value={platform} options={PLATFORMS} onChange={setPlatform}/>
  </>;
  const whyRows=drops;
  return <section className="ndb-root" aria-label="Dashboard comercial">
    <header className="ndb-head">
      <div className="ndb-head-title"><span className="ndb-logo"><Icon name="chart"/></span><div><h2>Gestão de Anúncios</h2>
        <p>{loading?'Consultando…':hasData?fmtDayFull(data.current_start)+' a '+fmtDayFull(data.last_day)+' · anterior: '+fmtDayFull(per.prevFrom)+' a '+fmtDayFull(per.prevTo):'Visão geral do desempenho dos produtos'}</p></div></div>
      <div className="ndb-head-filters">
        {filters}
        <small>{updated?'Última importação: '+when(updated):hasData?'Dados até '+fmtDayFull(data.last_day):''}</small>
        <button type="button" className="ndb-help-btn" onClick={()=>setHelpOpen(true)}>Definições e dados</button>
      </div>
    </header>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {hasData&&data.previous_complete===false&&<p className="ndb-warn">Não há vendas importadas para todo o período anterior; as variações podem estar incompletas.</p>}
    {hasData&&<div className="ndb-kpis">
      <KpiCard icon="money" label="Faturamento total" source="kpi" value={money(totals.cur_rev)} chip={<Delta cur={totals.cur_rev} prev={totals.prev_rev}/>} foot={'vs. '+money(totals.prev_rev)+' em '+prevTxt}/>
      <KpiCard icon="box" label="Unidades vendidas" source="kpi" value={num(totals.cur_units)} chip={<Delta cur={totals.cur_units} prev={totals.prev_units}/>} foot={'vs. '+num(totals.prev_units)+' em '+prevTxt}/>
      <KpiCard icon="megaphone" muted label="Investimento em anúncios" source="ads" value="Sem dados" foot="sem relatório de anúncios para este período"/>
      <KpiCard icon="chart" muted label="ROAS dos anúncios" source="ads" value="Sem dados" foot="depende do investimento em anúncios"/>
    </div>}
    <div className="ndb-main">
      <div className="ndb-left">
        <Panel title={segActive?SEG_TITLE[segment]+' ('+num(segSeries.listings)+')':segment?(segFail?'Vendas ao longo do período (gráfico do grupo indisponível)':'Carregando…'):'Vendas ao longo do período'} icon="chart" source="daily" className={'ndb-chart-panel'+(segment?' is-seg seg-'+segment:'')} aside={hasData&&<span className="ndb-plat-split">
          {segment&&<button type="button" className="ndb-link" onClick={()=>setFocus(false)}>Voltar ao total</button>}
          {segActive&&<span className={'ndb-seg-sum'+(segDelta!=null&&segDelta<0?' neg':' pos')} style={{borderColor:segColor}}>{segment==='stopped'?'Vendiam '+money(prevSum)+' · agora R$ 0,00':money(curSum)+' vs. '+money(prevSum)+(segDelta!=null?' ('+(segDelta>0?'+':'')+String(segDelta).replace('.',',')+'%)':'')}</span>}
          {!segment&&shopeeTotal>0&&<span><i style={{background:PLAT_COLOR.SHOPEE}}/>Shopee {money(shopeeTotal)}</span>}{!segment&&mlTotal>0&&<span><i style={{background:PLAT_COLOR.ML_ANTIGO}}/>ML {money(mlTotal)}</span>}
          <span><i className="ln" style={{borderTopColor:segColor}}/>{segment==='stopped'?'Antes (período anterior)':'Atual'}</span><span><i className="ln dash" style={segment==='stopped'?{borderTopColor:segColor}:undefined}/>{segment==='stopped'?'Agora':'Anterior'}</span></span>}>
          <DailyChart daily={daily} theme={segActive?segment:'total'} animKey={platform+days+(segActive?segment:'total')}/>
          {!segment&&(tab==='nosales'||tab==='ads')&&focus===true&&<p className="ndb-note">Esta aba não tem gráfico próprio: mostra o total de vendas.</p>}
        </Panel>
        <section className="ndb-panel ndb-explorer">
          <header className="ndb-tabs-head">
            <div className="ndb-tabs" role="tablist" aria-label="Detalhes">{TABS.map(([k,l,c])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={tab===k?'is-active':''} onClick={()=>setTab(k)}>{l}{c!=null&&<em>{num(c)}</em>}</button>)}</div>
            <InfoIcon text={SOURCES[TAB_SOURCE[tab]]} label={TABS.find(t=>t[0]===tab)[1]}/>
          </header>
          {tab==='best'&&<><PeriodBar cur={curTxt}/><div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Produto / SKU</th><th>Plataforma</th><th>Status</th><th className="num">Unidades</th><th className="num">Faturamento</th><th className="num">Investimento</th><th className="num">ROAS</th></tr></thead><tbody>
            {bestAll.map(r=>{const ad=adsByListing[r.listing_id];return <tr key={r.platform+r.external_id}>
              <td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{r.sku||r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              <td>{PLATFORM_LABEL[r.platform]||r.platform}</td>
              <td><span className={'ndb-status'+(r.status==='ACTIVE'?' on':'')}>{r.status==='ACTIVE'?'Ativo':'Inativo'}</span></td>
              <td className="num"><b>{num(r.units)}</b></td><td className="num">{money(r.revenue)}</td>
              <td className="num">{ad?money(ad.spend):'sem dados'}</td>
              <td className="num">{ad&&ad.roas!=null?<span className={'ndb-roas'+(Number(ad.roas)<1?' low':'')}>{String(ad.roas).replace('.',',')}x</span>:'sem dados'}</td></tr>;})}
            {top.length===0&&!loading&&<tr><td colSpan={7} className="ndb-empty">Sem vendas no período.</td></tr>}
          </tbody></table></div>
          <p className="ndb-note" title="Investimento e ROAS vêm do relatório Shopee Ads importado (período próprio) e só aparecem para anúncios com campanha individual.">Os 15 anúncios que mais faturam. Investimento e ROAS: relatório Shopee Ads importado, só anúncios com campanha individual.</p></>}
          {tab==='drops'&&<><PeriodBar cur={curTxt} prev={prevTxt}/><div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Produto</th><th className="num">Unidades (ant. → atual)</th><th className="num">Variação</th><th className="num">Perdeu</th><th className="num">Preço médio</th><th>Por que caiu</th></tr></thead><tbody>
            {whyRows.map(r=>{const sg=signals[r.listing_id];const why=reasonFor(sg,diagnosis[r.listing_id]);return <tr key={r.platform+r.external_id}>
              <td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform} · {r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              <td className="num">{num(r.units_previous)} → {num(r.units)}</td><td className="num neg">{pctText(changePct(r.units,r.units_previous))}</td>
              <td className="num neg" title={money(r.revenue_previous)+' → '+money(r.revenue)}>{money(r.lost_revenue)}</td>
              <td className="num">{sg&&sg.price_previous!=null&&sg.price_current!=null?money(sg.price_previous)+' → '+money(sg.price_current):'—'}</td>
              <td><span className={'ndb-why tone-'+why.tone} title={why.text}><strong>{why.title}</strong><small>{why.text}</small></span></td></tr>;})}
            {drops.length===0&&!loading&&<tr><td colSpan={6} className="ndb-empty">Nenhum anúncio ativo em queda neste período.</td></tr>}
          </tbody></table></div>
          <p className="ndb-note">Mostrando {Math.min(drops.length,20)} de {num(data?.drops?.total)} em queda, por maior perda de faturamento. “Por que caiu” é correlação, não prova de causa.</p></>}
          {tab==='stopped'&&<><PeriodBar cur={curTxt}/><div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Produto</th><th className="num">Última venda</th><th className="num">Sem vender há</th><th className="num">Já vendeu</th><th>O que verificar</th></tr></thead><tbody>
            {stoppedRows.map(r=><tr key={r.platform+r.external_id}><td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform} · {r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              <td className="num">{r.last_sale?fmtDayFull(r.last_sale):'—'}</td><td className="num">{r.days_since!=null?num(r.days_since)+' dias':'—'}</td><td className="num">{num(r.units_ever)} un. · {money(r.revenue_ever)}</td>
              <td><span className="ndb-why tone-warn"><strong>Sem vendas no período</strong><small>Confira estoque, se o anúncio está pausado ou bloqueado e se o preço mudou.</small></span></td></tr>)}
            {stoppedRows.length>0&&stoppedRows.length<Number(ov.stopped_total||0)&&<tr><td colSpan={5} className="ndb-empty">Mostrando os {num(stoppedRows.length)} que pararam mais recentemente, de {num(ov.stopped_total)}.</td></tr>}
            {stoppedRows.length===0&&<tr><td colSpan={5} className="ndb-empty">{overview?'Nenhum anúncio ativo está parado neste período.':'Sem dados: consulta indisponível.'}</td></tr>}
          </tbody></table></div></>}
          {tab==='nosales'&&<><div className="ndb-abc-bar-row">
            <div className="ndb-seg" role="group" aria-label="Filtrar sem vendas">{[['all','Todos',(ov.no_sales||[]).length],['stopped','Vendia e parou',(ov.no_sales||[]).filter(r=>r.last_sale).length],['never','Nunca venderam',(ov.no_sales||[]).filter(r=>!r.last_sale).length]].map(([v,l,c])=><button key={v} type="button" className={v===nsf?'is-active':''} aria-pressed={v===nsf} onClick={()=>setNsf(v)}>{l} ({num(c)})</button>)}</div>
            </div><PeriodBar cur={curTxt}/>
          <div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Anúncio</th><th>Plataforma</th><th>Última venda</th><th>Situação</th></tr></thead><tbody>
            {(ov.no_sales||[]).filter(r=>nsf==='all'||(nsf==='stopped'?r.last_sale:!r.last_sale)).map(r=>{const sold=Boolean(r.last_sale);return <tr key={r.platform+r.external_id}><td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              <td>{PLATFORM_LABEL[r.platform]||r.platform}</td><td>{sold?fmtDayFull(r.last_sale):'nunca'}</td>
              <td><span className={'ndb-why tone-'+(sold?'warn':'muted')} title={sold?'Já vendeu ('+num(r.units_ever)+' unid. no total importado) e não vendeu nada neste período.':'Nenhuma venda nos dados importados (desde '+firstDay+'). Pode ser anúncio novo ou nunca ter vendido; o sistema não sabe a data de criação no marketplace.'}><strong>{sold?'Vendia e parou':'Nunca vendeu nos dados'}</strong><small>{sold?(Number(r.units_previous)>0?num(r.units_previous)+' unid. no período anterior; confira estoque, preço e se está pausado.':'Última venda antes do período anterior; confira se ainda vale manter.'):'Sem venda desde '+firstDay+' (início dos dados importados). Pode ser novo.'}</small></span></td></tr>;})}
            {(ov.no_sales||[]).length===0&&<tr><td colSpan={4} className="ndb-empty">{overview?'Todos os anúncios ativos venderam no período.':'Sem dados: consulta indisponível.'}</td></tr>}
          </tbody></table></div>
          <p className="ndb-note">{num(ov.no_sales_total)} sem venda no período{ov.no_sales_never!=null?', sendo '+num(ov.no_sales_never)+' que nunca venderam nos dados importados':''}. Lista completa do período escolhido: primeiro os que já venderam, depois os que nunca venderam.</p></>}
          {tab==='ads'&&<div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Campanha / anúncio</th><th className="num">Investimento</th><th className="num">Vendas atribuídas</th><th className="num">ROAS</th></tr></thead><tbody>
            {[...adsRows].sort((x,y)=>Number(x.roas)-Number(y.roas)).map((r,i)=><tr key={i}><td title={r.campaign}><strong>{r.title||r.campaign}</strong><small>{r.listing_id?'Anúncio individual':'Grupo de anúncios'}</small></td>
              <td className="num">{money(r.spend)}</td><td className="num">{money(r.gmv)}</td><td className="num">{r.roas==null?'sem dados':<span className={'ndb-roas'+(Number(r.roas)<1?' low':'')}>{String(r.roas).replace('.',',')}x</span>}</td></tr>)}
            {adsRows.length===0&&<tr><td colSpan={4} className="ndb-empty">Gasto e retorno de anúncios: sem dados. Nenhum relatório Shopee Ads importado.</td></tr>}
          </tbody></table></div>}
          {tab==='abc'&&<>
            <PeriodBar cur={curTxt}/>
            <div className="ndb-abc-bar-row">
              <div className="ndb-seg" role="group" aria-label="Classe">{[[null,'Todas'],['A','A'],['B','B'],['C','C']].map(([v,l])=><button key={l} type="button" className={v===cls?'is-active':''} aria-pressed={v===cls} onClick={()=>{setCls(v);setFocus(true);}}>{l}</button>)}</div>
              <button type="button" className="ndb-link" onClick={()=>setCurve(v=>!v)}>{curve?'Ver lista':'Ver curva'}</button>
            </div>
            {curve?<ParetoChart items={allItems}/>
              :<div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Produto (SKU) · {PLATFORM_LABEL[abcP]||abcP}{cls?' · classe '+cls:''}</th><th>Anúncios</th><th className="num">Unid.</th><th className="num">Faturamento</th><th className="num">% acum.</th></tr></thead><tbody>
                {(cls?classRows:allItems).map(i=><tr key={i.platform+'|'+i.key}><td title={i.title||''}><strong>{i.key}</strong><small>{i.title||'—'}</small></td><td><ExtList links={i.links}/></td><td className="num">{num(i.units)}</td><td className="num">{money(i.revenue)}</td><td className="num">{String(i.cum_pct).replace('.',',')}%</td></tr>)}
                {allItems.length===0&&!loading&&<tr><td colSpan={5} className="ndb-empty">Sem vendas no período.</td></tr>}
              </tbody></table></div>}
          </>}
        </section>
      </div>
      <aside className="ndb-right">
        <Panel title="Atenção" icon="alert" source="alerts" className="ndb-attention">
          <ul className="ndb-alert-list">{alerts.map(a=><li key={a.k}><button type="button" className={'tone-'+a.t+(tab===a.k?' is-open':'')} disabled={a.t==='muted'} title={a.d} onClick={()=>openAlert(a.k)}>
            <span className="ndb-alert-ico"><Icon name={a.i}/></span><span className="ndb-alert-txt"><strong>{a.h}</strong><small>{a.d}</small></span><span className="ndb-alert-go" aria-hidden="true">›</span></button></li>)}</ul>
        </Panel>
        <Panel title={'ABC · '+(PLATFORM_LABEL[abcP]||abcP)} icon="pie" source="abc" className="ndb-abc-panel" aside={<button type="button" className="ndb-link" onClick={()=>{setTab('abc');setCurve(true);}}>Ver curva</button>}>
          {platform==='TODAS'&&<div className="ndb-seg ndb-abc-plat" role="group" aria-label="Plataforma da curva ABC">{['SHOPEE','ML_ANTIGO','ML_NOVO'].map(v=><button key={v} type="button" className={v===abcPlat?'is-active':''} aria-pressed={v===abcPlat} onClick={()=>setAbcPlat(v)}>{PLATFORM_LABEL[v]}</button>)}</div>}
          <div className="ndb-abc">
            {classes.map(c=><button type="button" key={c.class} className={'ndb-abc-card c-'+c.class+(tab==='abc'&&cls===c.class?' is-active':'')} onClick={()=>{setTab('abc');setCurve(false);setCls(c.class);}} aria-pressed={tab==='abc'&&cls===c.class} title={CLASS_NOTE[c.class]+' · '+money(c.revenue)}>
              <span className="ndb-abc-badge" style={{background:CLASS_COLOR[c.class]}}>{c.class}</span>
              <div><strong>{String(c.revenue_pct).replace('.',',')}% do faturamento</strong><small>{Math.round(Number(c.products)/totalProducts*100)}% dos produtos ({num(c.products)}) · {money(c.revenue)}</small></div>
              <i className="ndb-abc-bar"><b style={{width:Number(c.revenue_pct)+'%',background:CLASS_COLOR[c.class]}}/></i>
            </button>)}
            {classes.length===0&&!loading&&<p className="ndb-empty">Sem vendas no período.</p>}
          </div>
        </Panel>
      </aside>
    </div>
    {helpOpen&&<div className="ndb-modal" role="dialog" aria-modal="true" aria-label="Definições e dados" onMouseDown={e=>{if(e.target===e.currentTarget)setHelpOpen(false);}}>
      <div className="ndb-modal-box">
        <header><h3>Confiabilidade, definições e dados que faltam</h3><button type="button" className="ndb-link" onClick={()=>setHelpOpen(false)}>Fechar</button></header>
        <div className="ndb-modal-body">
          <h4>Confiabilidade dos dados<InfoIcon text={SOURCES.trust} label="Confiabilidade"/></h4>
          <div className="ndb-trust">
            {(ov.coverage||[]).map(c=><div key={c.platform}><strong>{PLATFORM_LABEL[c.platform]||c.platform}</strong><span>Vendas até {fmtDayFull(c.last_day)}</span><span>Importação aplicada: {c.last_import?when(c.last_import):'sem dados'}</span></div>)}
            <div><strong>Dias com venda</strong><span>{num(ov.window_days_with_sales)} de {days} dias do período{Number(ov.window_days_with_sales)<days?' (há dias sem venda importada)':''}</span></div>
            <div><strong>Vendas sem SKU vinculado</strong><span>{Number(ov.unlinked?.revenue)>0?num(ov.unlinked.listings)+' anúncios, '+money(ov.unlinked.revenue)+' fora da curva ABC':'nenhuma no período'}</span></div>
            <div><strong>Margem e lucro</strong><span>Sem dados: falta cadastrar o custo do produto.</span></div>
          </div>
          <h4>Definições</h4>
          <ul className="ndb-defs">
            <li><b>Faturamento:</b> valor dos produtos vendidos, sem frete, das vendas importadas. Não é o faturamento atribuído aos anúncios pagos.</li>
            <li><b>Pedidos:</b> soma por anúncio; um pedido com dois anúncios conta duas vezes.</li>
            <li><b>Curva ABC:</b> por SKU, ordenada pelo faturamento do período. A = até 80% do total, B = até 95%, C = o restante. Produto C pode ser novo, sazonal ou estratégico.</li>
            <li><b>Em queda:</b> anúncio ativo com 5 ou mais unidades no período anterior e queda de 15% ou mais.</li>
            <li><b>ROAS:</b> vendas atribuídas ÷ investimento, do relatório Shopee Ads. Abaixo de 1 = gastou mais do que vendeu, antes de custo e taxas.</li>
            <li><b>Sem dados:</b> a informação não existe no sistema. Nunca é mostrada como zero.</li>
          </ul>
          <h4>Dados que ajudariam a explicar as quedas<InfoIcon text={SOURCES.help} label="Dados que ajudariam"/></h4>
          <ul className="ndb-help">{HELP.map(([t,d])=><li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        </div>
      </div>
    </div>}
  </section>;
}
