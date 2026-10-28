import React,{useEffect,useMemo,useRef,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {usePriceSignals,PriceSignalCell} from './commerce-price-signal.jsx';
import {useSalesBreakdown,useSalesMonths,WeeklySalesCell,DailySalesRow,MonthsPanelRow} from './commerce-sales-breakdown.jsx';
import PeriodPicker from './commerce-period-picker.jsx';
import CohortsTab from './commerce-cohorts.jsx';
import {SalesTrend,MonthsTrend,MonthMatrix,PlatformSplit,PlatformTable,SummaryList} from './commerce-dashboard-charts.jsx';
import './commerce-dashboard.css';
import { maskMoney, isPrivate } from './commerce-privacy.js';

const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)'],['ML_NOVO','Mercado Livre (Novo)']];
const PLATFORM_LABEL={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
// Situação do anúncio no catálogo: Ativo, Desativado (não continuou na plataforma; histórico de vendas preservado) ou sem status.
const dm=s=>String(s||'').split('-').reverse().join('/');
const listingState=status=>status==='ACTIVE'?{label:'Ativo',cls:' on',off:false}
  :['INACTIVE','REMOVED','PAUSED'].includes(status)?{label:'Desativado',cls:' off',off:true}
  :{label:'Sem status',cls:'',off:false};
const PERIODS=[7,30,60,90];
const CLASS_NOTE={A:'Até 80% do faturamento',B:'Dos 80% aos 95%',C:'Últimos 5%'};

const SALES_SRC='tabela de vendas diárias por anúncio do sistema, alimentada pelas planilhas de pedidos da Shopee e do Mercado Livre que você importa em "Importar arquivo" (o mesmo dado do Histórico de importações)';
const SOURCES={
  period:'O período termina no último dia fechado com venda importada (o dia de hoje fica de fora por estar incompleto). "Últimos N dias" é comparado com os N dias imediatamente anteriores. Ao escolher um mês, vale o mês inteiro (o mês em andamento vai até o último dia fechado) e a comparação é com o mês anterior, usando o mesmo número de dias quando o mês atual ainda não terminou.',
  kpi:'Fonte: '+SALES_SRC+'. Faturamento = valor dos produtos vendidos, sem frete. Compara o período escolhido com o período anterior de mesmo tamanho (ou o mês anterior, se um mês foi escolhido).',
  kpiRevenue:'Fonte: '+SALES_SRC+'. Soma do valor dos produtos vendidos no período, sem frete e sem descontar taxas. A variação compara com o período anterior de mesmo tamanho.',
  kpiUnits:'Fonte: '+SALES_SRC+'. Soma das unidades vendidas no período. A variação compara com o período anterior de mesmo tamanho.',
  kpiTicket:'Calculado: faturamento ÷ unidades vendidas no período. É o preço médio realizado por unidade, não por pedido. A variação compara com o período anterior.',
  kpiDaily:'Calculado: faturamento do período ÷ dias do período (em "todo o histórico", ÷ dias que tiveram venda importada).',
  daily:'Fonte: '+SALES_SRC+'. Cada barra é um dia, separada por plataforma (Mercado Livre soma ML Antigo e ML Novo). A linha tracejada é o dia equivalente do período anterior. Dias sem venda importada aparecem como zero; confira o Histórico de importações se houver buracos.',
  history:'Fonte: '+SALES_SRC+', somada por mês civil desde a primeira venda importada. Não muda com o filtro de período. Clique em um mês para filtrar o dashboard por ele. Barras mais claras = mês incompleto.',
  platform:'Fonte: '+SALES_SRC+'. Divide o faturamento do período entre Shopee e Mercado Livre (ML Antigo e ML Novo juntos). Para ver cada conta do Mercado Livre separada, use o filtro Plataforma.',
  monthly:'Fonte: '+SALES_SRC+'. Unidades vendidas por mês desde a primeira venda importada; não muda com o filtro de período. Só há vendas de 2026: para ver sazonalidade de verdade é preciso importar o ano anterior.',
  summary:'Calculado a partir das vendas do período filtrado: média por dia, melhor e pior dia, dias sem venda e dia da semana mais forte vêm do gráfico de vendas por dia; mês mais forte vem do histórico mensal (só meses completos); concentração da classe A vem da Curva ABC.',
  top:'Fonte: '+SALES_SRC+'. Os 15 anúncios com maior faturamento no período, com a variação contra o período anterior de mesmo tamanho. Título e situação vêm do cadastro de anúncios do sistema.',
  best:'Fonte: '+SALES_SRC+', por anúncio, no período escolhido. Visitas e conversão vêm dos relatórios de desempenho importados (Mercado Livre e Shopee) e valem para o período de cada relatório. Crescimento = ativos com 5 ou mais unidades antes, 10 ou mais agora e alta de 15% ou mais. ROAS vem do relatório Shopee Ads importado. Mais vendido não significa mais lucrativo: não há custo do produto cadastrado.',
  drops:'Fonte: '+SALES_SRC+'. Compara o período com o período anterior de mesmo tamanho, por anúncio ATIVO: entra quem tinha 5 ou mais unidades antes e caiu 15% ou mais. "Preço médio" compara o preço médio realizado. "Vendas por semana e por dia" mostra as 4 últimas semanas de 7 dias e, em "Ver por dia", os últimos 14 dias.',
  alerts:'Fonte: '+SALES_SRC+' e o cadastro de anúncios. Queda = anúncio ativo com 5 ou mais unidades antes e queda de 15% ou mais. Pararam = ativos que já venderam 3 ou mais unidades e não têm nenhuma venda no período. Sem venda = ativos sem nenhuma unidade no período; "nunca venderam" = ativos sem venda em todo o histórico importado. Inativos com venda = anúncios inativos ou removidos que ainda aparecem nas vendas. ROAS abaixo de 1 vem do relatório Shopee Ads importado.',
  abc:'Fonte: '+SALES_SRC+'. Usa todo o histórico (não muda com o filtro de período) e soma o faturamento por SKU em cada plataforma (Shopee, ML Antigo e ML Novo têm cada uma a sua curva). Ordena do maior para o menor: A = produtos que somam até 80% do faturamento, B = dos 80% aos 95%, C = o restante. Anúncios sem SKU vinculado entram sozinhos. Faturamento = valor dos produtos, sem frete.',
  growing:'Fonte: '+SALES_SRC+'. Anúncios ativos que mais cresceram contra o período anterior: 5 ou mais unidades antes, 10 ou mais agora e alta de 15% ou mais.',
  lowconv:'Fonte: relatórios de desempenho importados (visitas e conversão por anúncio) e vendas do período. Entram anúncios com 300 ou mais visitas e conversão abaixo de 1,5%. As visitas valem para o período de cada relatório, não para o filtro.',
  cohorts:'Data de criação: planilha "Análise de Anúncios Nisti Print" (hoje 99 produtos, 32 da Shopee e 67 do Mercado Livre, ligados por SKU; só vale até a data da última atualização da planilha). Vendas: '+SALES_SRC+', contadas do dia da criação até o último dia fechado. Melhor mês = mês com mais unidades (mês incompleto aparece como parcial). Variações: cada SKU do produto, com média por dia, semana e mês desde a criação. Links: código do anúncio no cadastro do sistema. Não muda com o filtro de período.',
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
const moneyRaw=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const money=(...a)=>maskMoney(moneyRaw(...a));
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

// Quebra o texto em frases: "Fonte:"/"Calculado:" viram um rótulo, o resto vira lista curta.
function infoParts(text){
  const sentences=String(text||'').split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"])/).map(x=>x.trim()).filter(Boolean);
  let kind=null;
  if(sentences.length){const m=sentences[0].match(/^(Fonte|Calculado|Data de criação|Cobertura do que está no banco):\s*(.*)$/s);if(m){kind=m[1]==='Calculado'?'Cálculo':m[1]==='Fonte'?'Fonte':m[1];sentences[0]=m[2].charAt(0).toUpperCase()+m[2].slice(1);}}
  return {kind,items:sentences.filter(Boolean)};
}
export function openImportHistory(){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('ga:navigate',{detail:'imports'}));
}
export function InfoIcon({text,label,link=true}){
  const {kind,items}=infoParts(text);
  return <span className="ndb-info" tabIndex={0} role="note" aria-label={'De onde vêm os dados: '+label}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>
    <span className="ndb-info-pop">
      <strong>{label}</strong>
      {kind&&items.length>0&&<span className="ndb-info-kind"><em>{kind}</em>{items[0]}</span>}
      {items.length>(kind?1:0)&&<ul>{items.slice(kind?1:0).map((t,k)=><li key={k}>{t}</li>)}</ul>}
      {link&&<button type="button" className="ndb-info-link" onClick={openImportHistory}>Conferir os dados no Histórico de importações →</button>}
    </span>
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
const PLAT_COLOR={SHOPEE:'#eb6834',ML_ANTIGO:'#2a78d6',ML_NOVO:'#7b4fd4'};
const axisMoneyRaw=v=>v>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:v>=100000?0:1})+' mil':String(Math.round(v));
const axisMoney=(...a)=>isPrivate()?'•••':axisMoneyRaw(...a);
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
    <header><h3>{icon&&<span className="ndb-ico"><Icon name={icon}/></span>}{title}</h3>{aside}{source&&<InfoIcon text={SOURCES[source]||source} label={title}/>}</header>
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

function IndexCard({icon,label,value,foot,tone,active,onClick,disabled,title}){
  return <button type="button" className={'ndb-kpi ndb-idx tone-'+tone+(active?' is-active':'')} onClick={onClick} disabled={disabled} aria-pressed={active} title={title}>
    <span className="ndb-kpi-ico"><Icon name={icon}/></span>
    <span className="ndb-kpi-body">
      <span className="ndb-kpi-label">{label}</span>
      <span className="ndb-kpi-row"><strong>{value}</strong></span>
      <small>{foot}</small>
    </span>
  </button>;
}

function RevenueByProduct({items,showPlatform=true}){
  const rows=(items||[]).filter(r=>Number(r.revenue)>0);
  const max=Math.max(1,...rows.map(r=>Number(r.revenue)));
  const total=rows.reduce((a,r)=>a+Number(r.revenue),0);
  if(!rows.length)return <p className="ndb-empty">Nenhum anúncio com faturamento neste filtro.</p>;
  return <ol className="ndb-rev-list" aria-label="Faturamento por produto">
    {rows.map((r,i)=><li key={r.platform+r.external_id} title={(r.title||r.external_id)+' — '+(total>0?(Number(r.revenue)/total*100).toLocaleString('pt-BR',{maximumFractionDigits:1}):'0')+'% do faturamento desta lista'+(Number(r.units)>0?' · ticket '+money(Number(r.revenue)/Number(r.units)):'')}>
      <span className="ndb-rev-rank">{i+1}</span>
      <div className="ndb-rev-main">
        <span className="ndb-rev-name" title={r.title||r.external_id}>{r.title||r.external_id}</span>
        <span className="ndb-rev-track"><i style={{width:Math.max(2,Number(r.revenue)/max*100)+'%',background:PLAT_COLOR[r.platform]||'#1d5fd1'}}/></span>
      </div>
      <span className="ndb-rev-val"><b>{money(r.revenue)}</b><small>{num(r.units)} un.{showPlatform?' · '+(PLATFORM_LABEL[r.platform]||r.platform):''}</small></span>
      <Ext platform={r.platform} id={r.external_id}/>
    </li>)}
  </ol>;
}

function GrowingList({rows,all,hasOverview}){
  if(all)return <p className="ndb-empty">Escolha um período para comparar com o anterior.</p>;
  if(!hasOverview)return <p className="ndb-empty">Consulta indisponível.</p>;
  if(!rows.length)return <p className="ndb-empty">Nenhum anúncio cresceu 15% ou mais neste período.</p>;
  return <ul className="ndb-side-list">{rows.map(r=><li key={r.platform+r.external_id}>
    <div className="ndb-side-main"><strong title={r.title||''}>{r.title||r.external_id}</strong><small>{r.multi?(PLATFORM_LABEL[r.platform]||r.platform)+' · ':''}{num(r.units_previous)} → {num(r.units)} un.</small></div>
    <span className="ndb-side-val pos">{pctText(changePct(r.units,r.units_previous))}</span>
    <Ext platform={r.platform} id={r.external_id}/>
  </li>)}</ul>;
}

function LowConversionList({rows,hasPerf,note}){
  if(!hasPerf)return <p className="ndb-empty">Importe o relatório de desempenho do Mercado Livre ou da Shopee para ver visitas e conversão.</p>;
  if(!rows.length)return <p className="ndb-empty">Nenhum anúncio com muitas visitas e conversão baixa.</p>;
  return <><ul className="ndb-side-list">{rows.map(r=><li key={r.platform+r.external_id}>
    <div className="ndb-side-main"><strong title={r.title||''}>{r.title||r.external_id}</strong><small>{r.multi?(PLATFORM_LABEL[r.platform]||r.platform)+' · ':''}{num(r.visits)} visitas · {num(r.units)} un. no período</small></div>
    <span className="ndb-side-val neg" title="Conversão: ML vendas ÷ visitas; Shopee pedidos ÷ visitantes">{String(r.conversion).replace('.',',')}%</span>
    <Ext platform={r.platform} id={r.external_id}/>
  </li>)}</ul>{note&&<p className="ndb-note">{note}</p>}</>;
}

function MonthlyUnits({months,platform,onPick}){
  const [hover,setHover]=useState(null);
  const plats=MONTH_PLATS.filter(([c])=>platform==='TODAS'||platform===c);
  const colors={SHOPEE:'#eb6834',ML_ANTIGO:'#2a78d6',ML_NOVO:'#7b4fd4'};
  const rows=(months||[]).map(m=>({m,parts:plats.map(([c,k,l])=>({c,l,v:Number(m['units_'+k]||0)})),partial:monthPartial(m)})).map(r=>({...r,units:r.parts.reduce((a,x)=>a+x.v,0)}));
  if(!rows.length)return <p className="ndb-empty">Sem vendas importadas.</p>;
  const complete=rows.filter(r=>!r.partial&&r.units>0);
  const best=(complete.length?complete:rows).reduce((a,r)=>r.units>a.units?r:a,rows[0]);
  const max=Math.max(1,...rows.map(r=>r.units));
  const h=hover!=null?rows[hover]:null;
  return <div className="ndb-seas">
    <div className="ndb-seas-bars" role="img" aria-label="Unidades vendidas por mês" onMouseLeave={()=>setHover(null)}>{rows.map((r,i)=><div key={r.m.month} className={'ndb-seas-col is-click'+(r===best?' is-best':'')+(r.partial?' is-partial':'')+(hover===i?' is-hover':'')} onMouseEnter={()=>setHover(i)} onClick={()=>onPick&&onPick(String(r.m.month).slice(0,7))} title={'Clique para filtrar o dashboard só por '+monthLabel(r.m.month)}>
      <b>{num(r.units)}</b>
      <span className="ndb-seas-stack" style={{height:Math.max(3,r.units/max*100)+'%'}}>{r.parts.filter(x=>x.v>0).map(x=><i key={x.c} style={{flex:x.v,background:colors[x.c]}}/>)}</span>
      <small>{monthLabel(r.m.month)}</small></div>)}</div>
    <p className="ndb-note ndb-seas-tip">{h?<><b>{monthLabel(h.m.month)}</b>: {num(h.units)} un.{h.partial?' (mês incompleto)':''} {h.parts.filter(x=>x.v>0).map(x=><span key={x.c}><i className="ndb-tip-dot" style={{background:colors[x.c]}}/>{x.l} {num(x.v)}</span>)}</>:<>Mês mais forte (completo): <b>{monthLabel(best.m.month)}</b> com {num(best.units)} un. Passe o mouse num mês para ver por plataforma; clique para filtrar. Barras claras = mês incompleto.</>}</p>
  </div>;
}

const normSearch=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

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
// Vendas por mês: barras agrupadas, uma por plataforma. Meses incompletos são marcados.
const MONTH_PLATS=[['SHOPEE','shopee','Shopee'],['ML_ANTIGO','ml_antigo','ML Antigo'],['ML_NOVO','ml_novo','ML Novo']];
const monthLabel=m=>new Date(String(m).slice(0,10)+'T00:00:00Z').toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'}).replace('.','');
const monthPartial=m=>{
  const f=String(m.first_day||'').slice(0,10),l=String(m.last_day||'').slice(0,10),mo=String(m.month).slice(0,10);
  if(!f||!l)return false;
  const [y,mm]=mo.split('-').map(Number);
  const end=new Date(Date.UTC(y,mm,0)).getUTCDate();
  return f.slice(8,10)!=='01'||Number(l.slice(8,10))<end;
};
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

export default function CommerceDashboard({mode='overview',initialTab=null,onOpenTab=null,actions=null,initialFilter=null}){
  const [platform,setPlatform]=useState(initialFilter?.platform||'TODAS');
  const [query,setQuery]=useState('');
  const [days,setDays]=useState(initialFilter?.days??30);
  const [month,setMonth]=useState(initialFilter?.month||'');
  const [data,setData]=useState(null);
  const [overview,setOverview]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [cls,setCls]=useState(null);
  const [abcPlat,setAbcPlat]=useState('SHOPEE');
  const [curve,setCurve]=useState(false);
  const [tab,setTabRaw]=useState(initialTab==='never'?'nosales':initialTab||'best');
  const [focus,setFocus]=useState(Boolean(initialTab));
  const setTab=k=>{setTabRaw(k);setFocus(true);};
  const [helpOpen,setHelpOpen]=useState(false);
  const [monthly,setMonthly]=useState(null);
  const [nsf,setNsf]=useState(initialTab==='never'?'never':'all');
  useEffect(()=>{
    const controller=new AbortController();
    const q='?platform='+platform+'&days='+days+(month?'&month='+month:'');
    setLoading(true);setError('');
    fetchCommercialManager('/api/admin/commerce/sales-dashboard'+q,{signal:controller.signal})
      .then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Não foi possível carregar o dashboard.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/overview'+q,{signal:controller.signal})
      .then(setOverview).catch(()=>{if(!controller.signal.aborted)setOverview(null);});
    return()=>controller.abort();
  },[platform,days,month]);
  const [series,setSeries]=useState(null);
  useEffect(()=>{
    if(mode!=='overview')return undefined;
    setSeries(null);
    if(days===0&&!month)return undefined;
    const controller=new AbortController();
    const url='/api/admin/commerce/sales-dashboard/series?platform='+platform+(month?'&month='+month:'&days='+days);
    fetchCommercialManager(url,{signal:controller.signal})
      .then(setSeries).catch(()=>{if(!controller.signal.aborted)setSeries(null);});
    return()=>controller.abort();
  },[platform,days,month,mode]);
  useEffect(()=>{
    const controller=new AbortController();
    setMonthly(null);
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/monthly?platform='+platform,{signal:controller.signal})
      .then(setMonthly).catch(()=>{if(!controller.signal.aborted)setMonthly(null);});
    return()=>controller.abort();
  },[platform]);
  const abcP=platform==='TODAS'?abcPlat:platform;
  const all=days===0&&!month;
  const span=month?Number(data?.days)||30:days;
  // Desempenho do Mercado Livre (relatório importado): visitas e conversão por anúncio; falha silenciosa.
  const [mlPerf,setMlPerf]=useState(null),[spPerf,setSpPerf]=useState(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetchCommercialManager('/api/admin/commerce/ml/performance/latest',{signal:controller.signal}).then(setMlPerf).catch(()=>{});
    fetchCommercialManager('/api/admin/commerce/shopee/performance/latest',{signal:controller.signal}).then(setSpPerf).catch(()=>{});
    return()=>controller.abort();
  },[]);
  const perfItems=useMemo(()=>({...(spPerf?.items||{}),...(mlPerf?.items||{})}),[mlPerf,spPerf]);
  const perfNotes=[...(mlPerf?.reports||[]).map(x=>(x.account==='NOVO'?'ML Novo':'ML Antigo')+' '+dm(x.start)+' a '+dm(x.end)),
    ...(spPerf?.reports||[]).map(x=>'Shopee '+dm(x.start)+' a '+dm(x.end))];
  const growingRows=useMemo(()=>(overview?.growth||[]).filter(r=>platform==='TODAS'||r.platform===platform).slice(0,8).map(r=>({...r,multi:platform==='TODAS'})),[overview,platform]);
  // Muita visita e pouca venda: só anúncios com ao menos 300 visitas e conversão abaixo de 1,5% no relatório de desempenho.
  const lowConvRows=useMemo(()=>{
    if(!overview)return [];
    const seen=new Set(),out=[];
    const add=(r,units)=>{
      const pf=perfItems[r.external_id];
      if(!pf||seen.has(r.platform+r.external_id)||(platform!=='TODAS'&&r.platform!==platform))return;
      if(!(Number(pf.visits)>=300)||pf.conversion_pct==null||Number(pf.conversion_pct)>=1.5)return;
      seen.add(r.platform+r.external_id);
      out.push({platform:r.platform,external_id:r.external_id,title:r.title,visits:Number(pf.visits),conversion:pf.conversion_pct,units,multi:platform==='TODAS'});
    };
    (overview.no_sales||[]).forEach(r=>add(r,0));
    (data?.top||[]).forEach(r=>add(r,Number(r.units)||0));
    return out.sort((a,b)=>b.visits-a.visits).slice(0,6);
  },[overview,data,perfItems,platform]);
  const hasPerf=Object.keys(perfItems).length>0;
  const drops=data?.drops?.items||[];
  const top=data?.top||[];
  const signalRows=useMemo(()=>drops.filter(r=>r.listing_id).map(r=>({id:r.listing_id})),[data]);
  const {signals}=usePriceSignals(signalRows,all?90:days);
  // Histórico de vendas (semanas, dias e meses) só da lista aberta, para não pedir dados à toa.
  const idsOf=a=>a.filter(r=>r.listing_id).map(r=>({id:r.listing_id}));
  const bestIds=useMemo(()=>mode==='explorer'&&tab==='best'?idsOf(top):[],[data,tab,mode]);
  const dropIds=useMemo(()=>mode==='explorer'&&tab==='drops'?signalRows:[],[signalRows,tab,mode]);
  const stoppedIds=useMemo(()=>mode==='explorer'&&tab==='stopped'?idsOf(overview?.stopped||[]):[],[overview,tab,mode]);
  const noSalesIds=useMemo(()=>mode==='explorer'&&tab==='nosales'?(overview?.no_sales||[]).filter(r=>r.last_sale&&r.listing_id).slice(0,200).map(r=>({id:r.listing_id})):[],[overview,tab,mode]);
  const bestBreakdown=useSalesBreakdown(bestIds);
  const dropBreakdown=useSalesBreakdown(dropIds);
  const stoppedBreakdown=useSalesBreakdown(stoppedIds,'last_sale');
  const noSalesBreakdown=useSalesBreakdown(noSalesIds,'last_sale');
  const salesMonths=useSalesMonths(useMemo(()=>[...bestIds,...dropIds,...stoppedIds,...noSalesIds],[bestIds,dropIds,stoppedIds,noSalesIds]));
  const [openDays,setOpenDays]=useState({});
  const [openMonths,setOpenMonths]=useState({});
  const salesCell=(rk,lid,sb,anchored)=><WeeklySalesCell anchored={anchored} data={sb} open={Boolean(openDays[rk])} onToggle={()=>setOpenDays(o=>({...o,[rk]:!o[rk]}))} months={salesMonths[lid]} monthsOpen={Boolean(openMonths[rk])} onToggleMonths={()=>setOpenMonths(o=>({...o,[rk]:!o[rk]}))}/>;
  const salesRows=(rk,lid,sb,anchored,span)=><>{openDays[rk]&&sb&&<DailySalesRow anchored={anchored} data={sb} colSpan={span}/>}{openMonths[rk]&&salesMonths[lid]&&<MonthsPanelRow listingId={lid} data={salesMonths[lid]} colSpan={span}/>}</>;
  const totals=data?.totals||{};
  const classes=data?.abc?.classes_by_platform?.[abcP]||[];
  const qn=normSearch(query);
  const hit=r=>!qn||[r.title,r.sku,r.ean,r.external_id,r.product_key].some(v=>normSearch(v).includes(qn));
  const allItems=(data?.abc?.items||[]).filter(i=>i.platform===abcP).filter(hit);
  const hasData=data&&data.last_day;
  const per=hasData?(all?{curFrom:data.first_day||data.current_start,curTo:data.last_day,prevFrom:null,prevTo:null}:month?{curFrom:data.current_start,curTo:addDays(data.current_start,span-1),prevFrom:data.previous_start,prevTo:addDays(data.previous_start,span-1)}:{curFrom:addDays(data.last_day,-days+1),curTo:data.last_day,prevFrom:addDays(data.last_day,-2*days+1),prevTo:addDays(data.last_day,-days)}):null;
  const rng=(a,b)=>fmtDay(a)+' a '+fmtDay(b);
  const curTxt=per?(all?'todo o histórico ('+rng(per.curFrom,per.curTo)+')':rng(per.curFrom,per.curTo)):'';
  const prevTxt=per&&!all?rng(per.prevFrom,per.prevTo):'';
  const ov=overview||{};
  const lst=ov.listings||{};
  const totalProducts=classes.reduce((a,c)=>a+Number(c.products||0),0)||1;

  const classRows=cls?allItems.filter(i=>i.class===cls):[];
  const updated=(ov.coverage||[]).map(c=>c.last_import).filter(Boolean).sort().pop();
  const alerts=[
    all?{k:'drops',t:'muted',i:'down',h:'Em queda: escolha um período',d:'A comparação com o período anterior precisa de 30, 60 ou 90 dias.'}
      :{k:'drops',t:'bad',i:'down',h:num(data?.drops?.total)+' produtos em queda',d:'Perderam '+money(data?.drops?.lost_revenue)+' de faturamento ('+curTxt+' vs. '+prevTxt+').'},
    all?{k:'stopped',t:'muted',i:'pause',h:'Pararam de vender: escolha um período',d:'Precisa de 30, 60 ou 90 dias para saber quem ficou sem vender.'}
      :overview?{k:'stopped',t:'bad',i:'pause',h:num(ov.stopped_total??(ov.stopped||[]).length)+' pararam de vender',d:'Já venderam 3 ou mais unidades e estão sem nenhuma venda desde '+(per?fmtDayFull(per.curFrom):'o início do período')+' ('+span+' dias ou mais).'}
      :{k:'stopped',t:'muted',i:'pause',h:'Pararam de vender: sem dados',d:'A consulta de alertas ainda não está disponível.'},
    overview?{k:'nosales',t:'warn',i:'eye',h:num(ov.no_sales_total??lst.active_without_sales)+' anúncios ativos sem vendas',d:'Nenhuma unidade vendida em '+curTxt+', de '+num(lst.active)+' anúncios ativos.'}
      :{k:'nosales',t:'muted',i:'eye',h:'Anúncios sem vendas: sem dados',d:'A consulta de alertas ainda não está disponível.'},
  ];
  // No Dashboard, os cards e alertas levam ao Painel Comercial (aba Desempenho); lá abrem a lista correspondente.
  // Com uma plataforma escolhida, a coluna/etiqueta de plataforma é redundante; só aparece em "Todas as plataformas".
  const multi=platform==='TODAS';
  const goTab=k=>{if(onOpenTab)onOpenTab(k,{platform,days,month});else{if(k==='never'){setNsf('never');setTab('nosales');}else setTab(k);}};
  const openAlert=k=>goTab(k);
  const openAbc=(c,curveMode)=>{if(mode==='overview'){goTab('abc');return;}setTab('abc');setCurve(curveMode);if(c)setCls(c);};
  
  const stoppedRows=(ov.stopped||[]).filter(hit);
  const firstDay=fmtDayFull((ov.coverage||[]).map(c=>c.first_day).filter(Boolean).sort()[0]);
  const TABS=[
    ['best','Melhores produtos',null],
    ['drops','Em queda',all?null:data?.drops?.total],
    ['stopped','Pararam',overview&&!all?(ov.stopped_total??stoppedRows.length):null],
    ['nosales','Sem vendas',overview?(ov.no_sales_total??lst.active_without_sales):null],
    ['abc','Curva ABC',null],
    ['cohorts','Cadastros por mês',null]
  ];
  const TAB_SOURCE={best:'best',drops:'drops',stopped:'alerts',nosales:'alerts',abc:'abc',cohorts:'cohorts'};
  const bestAll=[...top].filter(hit).sort((x,y)=>Number(y.units)-Number(x.units));
  const availableMonths=(monthly?.months||[]).map(m=>String(m.month).slice(0,7));
  const splitRows=all?(monthly?.months||[]):series?.daily;
  const filters=<>
    <PeriodPicker days={days} month={month} periods={PERIODS} available={availableMonths} onDays={v=>{setMonth('');setDays(v);}} onMonth={setMonth}/>
    <InfoIcon text={SOURCES.period} label="Período"/>
    <Dropdown label="Plataforma" value={platform} options={PLATFORMS} onChange={setPlatform}/>
    {mode==='explorer'&&<label className="ndb-search" title="Busca nos anúncios que aparecem nas listas abaixo (nome, SKU ou código do anúncio).">
      <span>Buscar</span>
      <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Produto, SKU ou código" aria-label="Buscar produto, SKU ou código do anúncio"/>
    </label>}
    {actions}
  </>;
  const whyRows=drops.filter(hit);
  return <section className={'ndb-root'+(mode==='explorer'?' is-explorer':'')} aria-label="Dashboard comercial">
    <header className="ndb-head">
      <div className="ndb-head-title"><div>
        <p>{loading?'Consultando…':hasData?(all?fmtDayFull(per.curFrom)+' a '+fmtDayFull(data.last_day)+' · todo o histórico, sem comparação':fmtDayFull(data.current_start)+' a '+fmtDayFull(data.last_day)+' · anterior: '+fmtDayFull(per.prevFrom)+' a '+fmtDayFull(per.prevTo)):'Visão geral do desempenho dos produtos'}</p></div></div>
      <div className="ndb-head-filters">
        {filters}
        <small>{updated?'Última importação: '+when(updated):hasData?'Dados até '+fmtDayFull(data.last_day):''}</small>
        <button type="button" className="ndb-help-btn" onClick={()=>setHelpOpen(true)}>Definições e dados</button>
      </div>
    </header>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {hasData&&!all&&data.previous_complete===false&&<p className="ndb-warn">Não há vendas importadas para todo o período anterior; as variações podem estar incompletas.</p>}
    {hasData&&mode==='overview'&&<div className="ndb-kpis ndb-sum-row" role="group" aria-label="Resumo do período">
      <KpiCard icon="money" label="Faturamento" source="kpiRevenue" value={money(totals.cur_rev)} chip={!all&&<Delta cur={totals.cur_rev} prev={totals.prev_rev}/>} foot={all?'todo o histórico':'vs. '+prevTxt}/>
      <KpiCard icon="box" label="Unidades vendidas" source="kpiUnits" value={num(totals.cur_units)} chip={!all&&<Delta cur={totals.cur_units} prev={totals.prev_units}/>} foot={all?'todo o histórico':'vs. '+prevTxt}/>
      <KpiCard icon="cart" label="Ticket médio por unidade" source="kpiTicket" value={Number(totals.cur_units)>0?money(Number(totals.cur_rev)/Number(totals.cur_units)):'—'} chip={!all&&Number(totals.prev_units)>0&&<Delta cur={Number(totals.cur_rev)/Math.max(1,Number(totals.cur_units))} prev={Number(totals.prev_rev)/Number(totals.prev_units)}/>} foot="faturamento ÷ unidades"/>
      <KpiCard icon="list" label="Média por dia" source="kpiDaily" value={money(Number(totals.cur_rev)/Math.max(1,all?(Number(ov.window_days_with_sales)||1):span))} foot={all?'por dia com venda':'por dia no período'}/>
    </div>}
    {hasData&&mode==='overview'&&<div className="ndb-kpis ndb-idx-row" role="group" aria-label="Índices de performance">
      <IndexCard icon="box" tone="good" label="Vendendo" value={num(totals.listings||0)} foot={all?'anúncios com venda no histórico':'anúncios com venda no período'} active={tab==='best'&&focus} onClick={()=>goTab('best')} title="Anúncios que tiveram ao menos uma venda no período do filtro."/>
      <IndexCard icon="down" tone="bad" label="Em queda" value={all?'—':num(data?.drops?.total||0)} foot={all?'escolha um período':'vendem menos que no período anterior'} active={tab==='drops'&&focus} disabled={all} onClick={()=>goTab('drops')} title="Anúncios ativos que venderam pelo menos 15% menos que no período anterior."/>
      <IndexCard icon="pause" tone="warn" label="Vendia e parou" value={all||!overview?'—':num(ov.stopped_total??stoppedRows.length)} foot={all?'escolha um período':overview?'já venderam e estão sem vender no período':'consulta indisponível'} active={tab==='stopped'&&focus} disabled={all||!overview} onClick={()=>goTab('stopped')} title="Anúncios ativos que já venderam 3 ou mais unidades e não tiveram nenhuma venda no período."/>
      <IndexCard icon="eye" tone="muted" label="Não vendeu" value={overview?num(ov.no_sales_never??0):'—'} foot={overview?'ativos que nunca venderam nos dados':'consulta indisponível'} active={tab==='nosales'&&focus&&nsf==='never'} disabled={!overview} onClick={()=>goTab('never')} title="Anúncios ativos sem nenhuma venda em todo o histórico importado."/>
    </div>}
    <div className="ndb-main">
      <div className="ndb-left">
        {mode==='overview'&&<Panel title={all?'Histórico de vendas por mês':'Vendas por dia'} icon="chart" source={all?'history':'daily'} className="ndb-trend-panel" aside={month&&<button type="button" className="ndb-link" onClick={()=>{setMonth('');setDays(0);}}>Ver todos os meses</button>}>
          {all?(monthly?<MonthsTrend months={monthly.months} platform={platform} onPick={setMonth}/>:<p className="ndb-empty">Carregando…</p>)
            :(series?<SalesTrend daily={series.daily} platform={platform}/>:<p className="ndb-empty">{loading?'Carregando…':'Gráfico indisponível.'}</p>)}
        </Panel>}
        {mode==='overview'&&<div className="ndb-duo">
          <Panel title="Faturamento por plataforma" icon="pie" source="platform">
            {splitRows?<PlatformSplit daily={splitRows} platform={platform} onPick={setPlatform}/>:<p className="ndb-empty">Carregando…</p>}
          </Panel>
          <Panel title="Vendas por mês (unidades)" icon="chart" source="monthly">
            <MonthlyUnits months={monthly?.months} platform={platform} onPick={setMonth}/>
          </Panel>
        </div>}
        {mode==='overview'&&<Panel title="Comparativo por plataforma" icon="pie" source="platform">
          {splitRows?<PlatformTable daily={splitRows} platform={platform} all={all} onPick={setPlatform}/>:<p className="ndb-empty">Carregando…</p>}
        </Panel>}
        {mode==='overview'&&!month&&<Panel title="Mês a mês por plataforma" icon="chart" source="monthly">
          {monthly?<MonthMatrix months={monthly.months} platform={platform} onPick={setMonth}/>:<p className="ndb-empty">Carregando…</p>}
        </Panel>}
        {mode==='overview'&&<Panel title="Faturamento por produto" icon="money" source="top" className="ndb-chart-panel ndb-rank-panel" aside={hasData&&<span className="ndb-rev-sum">Total {money(totals.cur_rev)} · {num(totals.cur_units)} un.{!all&&<> <Delta cur={totals.cur_rev} prev={totals.prev_rev}/></>}</span>}>
          <p className="ndb-note">{all?'15 anúncios que mais faturaram em todo o histórico.':'15 anúncios que mais faturaram em '+curTxt+'.'}</p>
          <RevenueByProduct items={top} showPlatform={multi}/>
        </Panel>}
        {mode==='explorer'&&<section className="ndb-panel ndb-explorer">
          <header className="ndb-tabs-head">
            <div className="ndb-tabs" role="tablist" aria-label="Detalhes">{TABS.map(([k,l,c])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={tab===k?'is-active':''} onClick={()=>setTab(k)}>{l}{c!=null&&<em>{num(c)}</em>}</button>)}</div>
            <InfoIcon text={SOURCES[TAB_SOURCE[tab]]} label={TABS.find(t=>t[0]===tab)[1]}/>
          </header>
          {tab==='best'&&<><PeriodBar cur={curTxt}/>{perfNotes.length>0&&<p className="ndb-perf-note">Visitas e Conversão vêm dos relatórios de desempenho importados ({perfNotes.join(' · ')}) e valem para o período de cada relatório, não para o filtro acima. ML: vendas ÷ visitas; Shopee: pedidos feitos ÷ visitantes.</p>}<div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Produto / SKU</th>{multi&&<th>Plataforma</th>}<th>Status</th><th className="num">Unidades</th><th className="num">Faturamento</th><th className="num" title="Visitas únicas no período do relatório de desempenho importado de cada plataforma">Visitas</th><th className="num" title="Mercado Livre: vendas ÷ visitas. Shopee: pedidos feitos ÷ visitantes (inclui cancelados depois)">Conversão</th><th>Histórico de vendas</th></tr></thead><tbody>
            {bestAll.map(r=>{const st=listingState(r.status);const rk='b'+r.platform+r.external_id;const sb=bestBreakdown[r.listing_id];return <React.Fragment key={rk}><tr className={st.off?'ndb-off':''}>
              <td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{r.sku||r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              {multi&&<td>{PLATFORM_LABEL[r.platform]||r.platform}</td>}
              <td><span className={'ndb-status'+st.cls}>{st.label}</span></td>
              <td className="num"><b>{num(r.units)}</b></td><td className="num">{money(r.revenue)}</td>
              {(()=>{const pf=perfItems[r.external_id];return <><td className="num">{pf&&pf.visits!=null?num(pf.visits):'—'}</td><td className="num">{pf&&pf.conversion_pct!=null?String(pf.conversion_pct).replace('.',',')+'%':'—'}</td></>;})()}
              <td>{salesCell(rk,r.listing_id,sb,false)}</td></tr>{salesRows(rk,r.listing_id,sb,false,multi?8:7)}</React.Fragment>;})}
            {top.length===0&&!loading&&<tr><td colSpan={multi?8:7} className="ndb-empty">Sem vendas no período.</td></tr>}
          </tbody></table></div>
          <p className="ndb-note">Os 15 anúncios que mais faturam no período.</p></>}
          {(tab==='drops'||tab==='stopped')&&all&&<p className="ndb-empty">Escolha 30, 60 ou 90 dias no filtro de período: esta lista compara períodos.</p>}
          {tab==='drops'&&!all&&<><PeriodBar cur={curTxt} prev={prevTxt}/><div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Produto</th><th className="num">Unidades (ant. → atual)</th><th className="num">Variação</th><th className="num">Perdeu</th><th className="num">Preço médio</th><th>Vendas por semana, dia e mês</th></tr></thead><tbody>
            {whyRows.map(r=>{const sg=signals[r.listing_id];const rk=r.platform+r.external_id;const sb=dropBreakdown[r.listing_id];return <React.Fragment key={rk}><tr>
              <td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{multi?(PLATFORM_LABEL[r.platform]||r.platform)+' · ':''}{r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              <td className="num">{num(r.units_previous)} → {num(r.units)}</td><td className="num neg">{pctText(changePct(r.units,r.units_previous))}</td>
              <td className="num neg" title={money(r.revenue_previous)+' → '+money(r.revenue)}>{money(r.lost_revenue)}</td>
              <td className="num">{sg&&sg.price_previous!=null&&sg.price_current!=null?money(sg.price_previous)+' → '+money(sg.price_current):'—'}</td><td>{salesCell(rk,r.listing_id,sb,false)}</td></tr>{salesRows(rk,r.listing_id,sb,false,6)}</React.Fragment>;})}
            {drops.length===0&&!loading&&<tr><td colSpan={6} className="ndb-empty">Nenhum anúncio ativo em queda neste período.</td></tr>}
          </tbody></table></div>
          <p className="ndb-note">Mostrando {Math.min(drops.length,20)} de {num(data?.drops?.total)} em queda, por maior perda de faturamento. O % compara com o período anterior.</p></>}
          {tab==='stopped'&&!all&&<><PeriodBar cur={curTxt}/><div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Produto</th><th className="num">Última venda</th><th className="num">Sem vender há</th><th className="num">Já vendeu</th><th>Como vendia antes de parar</th></tr></thead><tbody>
            {stoppedRows.map(r=>{const rk='s'+r.platform+r.external_id;const sb=stoppedBreakdown[r.listing_id];return <React.Fragment key={rk}><tr><td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{multi?(PLATFORM_LABEL[r.platform]||r.platform)+' · ':''}{r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              <td className="num">{r.last_sale?fmtDayFull(r.last_sale):'—'}</td><td className="num">{r.days_since!=null?num(r.days_since)+' dias':'—'}</td><td className="num">{num(r.units_ever)} un. · {money(r.revenue_ever)}</td><td>{salesCell(rk,r.listing_id,sb,true)}</td></tr>{salesRows(rk,r.listing_id,sb,true,5)}</React.Fragment>;})}
            {stoppedRows.length>0&&stoppedRows.length<Number(ov.stopped_total||0)&&<tr><td colSpan={5} className="ndb-empty">Mostrando os {num(stoppedRows.length)} que pararam mais recentemente, de {num(ov.stopped_total)}.</td></tr>}
            {stoppedRows.length===0&&<tr><td colSpan={5} className="ndb-empty">{overview?'Nenhum anúncio ativo está parado neste período.':'Sem dados: consulta indisponível.'}</td></tr>}
          </tbody></table></div><p className="ndb-note">Semanas, dias e meses contados até a última venda de cada anúncio, para ver como ele vendia antes de parar. Confira estoque, se o anúncio está pausado ou bloqueado e se o preço mudou.</p></>}
          {tab==='nosales'&&<><div className="ndb-abc-bar-row">
            <div className="ndb-seg" role="group" aria-label="Filtrar sem vendas">{[['all','Todos',(ov.no_sales||[]).length],['stopped','Vendia e parou',(ov.no_sales||[]).filter(r=>r.last_sale).length],['never','Nunca venderam',(ov.no_sales||[]).filter(r=>!r.last_sale).length]].map(([v,l,c])=><button key={v} type="button" className={v===nsf?'is-active':''} aria-pressed={v===nsf} onClick={()=>setNsf(v)}>{l} ({num(c)})</button>)}</div>
            </div><PeriodBar cur={curTxt}/>
          <div className="ndb-scroll"><table className="ndb-table ndb-detail-table"><thead><tr><th>Anúncio</th>{multi&&<th>Plataforma</th>}<th>Última venda</th><th>Como vendia antes de parar</th></tr></thead><tbody>
            {(ov.no_sales||[]).filter(hit).filter(r=>nsf==='all'||(nsf==='stopped'?r.last_sale:!r.last_sale)).map(r=>{const sold=Boolean(r.last_sale);const rk='n'+r.platform+r.external_id;const sb=noSalesBreakdown[r.listing_id];return <React.Fragment key={rk}><tr><td title={r.title||''}><div className="ndb-pc"><div className="ndb-pt"><strong>{r.title||r.external_id}</strong><small>{r.external_id}</small></div><Ext platform={r.platform} id={r.external_id}/></div></td>
              {multi&&<td>{PLATFORM_LABEL[r.platform]||r.platform}</td>}<td>{sold?fmtDayFull(r.last_sale):'nunca'}</td><td>{sold?salesCell(rk,r.listing_id,sb,true):<span className="ndb-sb-empty">nunca vendeu nos dados</span>}</td></tr>{sold&&salesRows(rk,r.listing_id,sb,true,multi?4:3)}</React.Fragment>;})}
            {(ov.no_sales||[]).length===0&&<tr><td colSpan={multi?4:3} className="ndb-empty">{overview?'Todos os anúncios ativos venderam no período.':'Sem dados: consulta indisponível.'}</td></tr>}
          </tbody></table></div>
          <p className="ndb-note">{num(ov.no_sales_total)} sem venda no período{ov.no_sales_never!=null?', sendo '+num(ov.no_sales_never)+' que nunca venderam nos dados importados':''}. Lista completa do período escolhido: primeiro os que já venderam, depois os que nunca venderam. Confira estoque, preço e se está pausado. Em quem já vendeu, as semanas e os dias são contados até a última venda (até 200 anúncios).</p></>}
          {tab==='cohorts'&&<CohortsTab platform={platform} query={query} linkFor={listingUrl}/>}
          {tab==='abc'&&<>
            <PeriodBar cur="todo o histórico (não muda com o período)"/>
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
        </section>}
      </div>
      <aside className="ndb-right">
        {mode==='overview'&&<Panel title="Atenção" icon="alert" source="alerts" className="ndb-attention">
          <ul className="ndb-alert-list">{alerts.map(a=><li key={a.k}><button type="button" className={'tone-'+a.t+(tab===a.k?' is-open':'')} disabled={a.t==='muted'} title={a.d} onClick={()=>openAlert(a.k)}>
            <span className="ndb-alert-ico"><Icon name={a.i}/></span><span className="ndb-alert-txt"><strong>{a.h}</strong><small>{a.d}</small></span><span className="ndb-alert-go" aria-hidden="true">›</span></button></li>)}</ul>
        </Panel>}
        {mode==='overview'&&<Panel title="Resumo do período" icon="list" source="summary">
          <SummaryList daily={series?.daily} totals={hasData?totals:null} months={monthly?.months} classes={classes} all={all}/>
        </Panel>}
        {<Panel title={'ABC · '+(PLATFORM_LABEL[abcP]||abcP)} icon="pie" source="abc" className="ndb-abc-panel" aside={<button type="button" className="ndb-link" onClick={()=>openAbc(null,true)}>Ver curva</button>}>
          {platform==='TODAS'&&<div className="ndb-seg ndb-abc-plat" role="group" aria-label="Plataforma da curva ABC">{['SHOPEE','ML_ANTIGO','ML_NOVO'].map(v=><button key={v} type="button" className={v===abcPlat?'is-active':''} aria-pressed={v===abcPlat} onClick={()=>setAbcPlat(v)}>{PLATFORM_LABEL[v]}</button>)}</div>}
          <div className="ndb-abc">
            {classes.map(c=><button type="button" key={c.class} className={'ndb-abc-card c-'+c.class+(mode==='explorer'&&tab==='abc'&&cls===c.class?' is-active':'')} onClick={()=>openAbc(c.class,false)} aria-pressed={mode==='explorer'&&tab==='abc'&&cls===c.class} title={CLASS_NOTE[c.class]+' · '+money(c.revenue)}>
              <span className="ndb-abc-badge" style={{background:CLASS_COLOR[c.class]}}>{c.class}</span>
              <div><strong>{String(c.revenue_pct).replace('.',',')}% do faturamento</strong><small>{Math.round(Number(c.products)/totalProducts*100)}% dos produtos ({num(c.products)}) · {money(c.revenue)}</small></div>
              <i className="ndb-abc-bar"><b style={{width:Number(c.revenue_pct)+'%',background:CLASS_COLOR[c.class]}}/></i>
            </button>)}
            {classes.length===0&&!loading&&<p className="ndb-empty">Sem vendas no período.</p>}
          </div>
        </Panel>}
        {<Panel title="Em alta" icon="down" source="growing" className="ndb-side-panel ndb-grow-panel"><GrowingList rows={growingRows} all={all} hasOverview={Boolean(overview)}/></Panel>}
        {mode==='explorer'&&<Panel title="Muita visita, pouca venda" icon="eye" source="lowconv" className="ndb-side-panel"><LowConversionList rows={lowConvRows} hasPerf={hasPerf} note={perfNotes.length?'Relatórios: '+perfNotes.join(' · ')+'. Visitas e conversão valem para o período de cada relatório.':''}/></Panel>}
        {mode==='explorer'&&<Panel title="Vendas por mês (unidades)" icon="chart" source="monthly" className="ndb-side-panel"><MonthlyUnits months={monthly?.months} platform={platform} onPick={setMonth}/></Panel>}
      </aside>
    </div>
    {helpOpen&&<div className="ndb-modal" role="dialog" aria-modal="true" aria-label="Definições e dados" onMouseDown={e=>{if(e.target===e.currentTarget)setHelpOpen(false);}}>
      <div className="ndb-modal-box">
        <header><h3>Confiabilidade, definições e dados que faltam</h3><button type="button" className="ndb-link" onClick={()=>setHelpOpen(false)}>Fechar</button></header>
        <div className="ndb-modal-body">
          <h4>Confiabilidade dos dados<InfoIcon text={SOURCES.trust} label="Confiabilidade"/></h4>
          <div className="ndb-trust">
            {(ov.coverage||[]).map(c=><div key={c.platform}><strong>{PLATFORM_LABEL[c.platform]||c.platform}</strong><span>Vendas até {fmtDayFull(c.last_day)}</span><span>Importação aplicada: {c.last_import?when(c.last_import):'sem dados'}</span></div>)}
            <div><strong>Dias com venda</strong><span>{all?num(ov.window_days_with_sales)+' dias com venda em todo o histórico':num(ov.window_days_with_sales)+' de '+span+' dias do período'+(Number(ov.window_days_with_sales)<span?' (há dias sem venda importada)':'')}</span></div>
            <div><strong>Vendas sem SKU vinculado</strong><span>{Number(ov.unlinked?.revenue)>0?num(ov.unlinked.listings)+' anúncios, '+money(ov.unlinked.revenue)+' fora da curva ABC':'nenhuma no período'}</span></div>
            <div><strong>Margem e lucro</strong><span>Sem dados: falta cadastrar o custo do produto.</span></div>
          </div>
          <h4>Definições</h4>
          <ul className="ndb-defs">
            <li><b>Faturamento:</b> valor dos produtos vendidos, sem frete, das vendas importadas. Não é o faturamento atribuído aos anúncios pagos.</li>
            <li><b>Pedidos:</b> soma por anúncio; um pedido com dois anúncios conta duas vezes.</li>
            <li><b>Curva ABC:</b> por SKU em cada plataforma, ordenada pelo faturamento de todo o histórico (não muda com o filtro de período). A = até 80% do total, B = até 95%, C = o restante. Produto C pode ser novo, sazonal ou estratégico.</li>
            <li><b>Período e mês:</b> {SOURCES.period}</li>
            <li><b>Cadastros por mês:</b> data de criação vinda da planilha “Análise de Anúncios Nisti Print”; vendas contadas do dia da criação até o último dia fechado.</li>
            <li><b>Em queda:</b> anúncio ativo com 5 ou mais unidades no período anterior e queda de 15% ou mais.</li>
            <li><b>Sem dados:</b> a informação não existe no sistema. Nunca é mostrada como zero.</li>
          </ul>
          <h4>Dados que ajudariam a explicar as quedas<InfoIcon text={SOURCES.help} label="Dados que ajudariam" link={false}/></h4>
          <ul className="ndb-help">{HELP.map(([t,d])=><li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        </div>
      </div>
    </div>}
  </section>;
}
