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
  top:'Vendas importadas: os 15 anúncios com maior faturamento no período, com a variação de unidades contra o período anterior de mesmo tamanho. Título e situação vêm do cadastro de anúncios do sistema.',
  kpi:'Vendas importadas no período escolhido, contra o período anterior de mesmo tamanho. O período termina no último dia com venda importada, não em hoje.',
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

const CLASS_COLOR={A:'#1f5fb4',B:"#3f93e0",C:"#7f93ad"};
const shortMoney=v=>{const n=Number(v)||0;return n>=1000?'R$ '+(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':money(n);};

// Curva de Pareto: eixo único (% acumulado do faturamento), produtos do maior para o menor.
function ParetoChart({items}){
  const [hover,setHover]=useState(null);
  if(!items.length)return <p className="ndb-empty">Sem vendas no período.</p>;
  const W=760,H=300,L=44,R=16,T=14,B=34,iw=W-L-R,ih=H-T-B,n=items.length;
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
  return <div className="ndb-pareto">
    <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label="Curva ABC: percentual acumulado do faturamento por produto"
      onMouseLeave={()=>setHover(null)}
      onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*W;setHover(Math.max(0,Math.min(n-1,Math.round((px-L)/iw*(n-1)))));}}>
      {[0,20,40,60,80,100].map(g=><g key={g}><line x1={L} x2={W-R} y1={y(g)} y2={y(g)} className="ndb-grid-line"/><text x={L-8} y={y(g)+4} textAnchor="end" className="ndb-axis">{g}%</text></g>)}
      <line x1={L} x2={W-R} y1={y(80)} y2={y(80)} className="ndb-guide"/><line x1={L} x2={W-R} y1={y(95)} y2={y(95)} className="ndb-guide"/>
      {seg.map(s=><rect key={'bg'+s.c} x={s.start} y={T} width={Math.max(2,s.end-s.start)} height={ih} fill={CLASS_COLOR[s.c]} opacity="0.09"/>)}
      {seg.map(s=><path key={s.c} d={s.path} fill="none" stroke={CLASS_COLOR[s.c]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>)}
      {seg.map(s=><text key={'t'+s.c} x={(s.start+s.end)/2} y={H-12} textAnchor="middle" className="ndb-axis-strong">Classe {s.c}</text>)}
      {h&&<g><line x1={pts[hover][0]} x2={pts[hover][0]} y1={T} y2={T+ih} className="ndb-cross"/><circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill={CLASS_COLOR[h.class]} stroke="#fff" strokeWidth="2"/></g>}
    </svg>
    {h&&<div className="ndb-tip" style={{left:Math.min(70,Math.max(4,pts[hover][0]/W*100))+'%'}}>
      <b>{h.key}</b><span>{h.title||'—'}</span>
      <em>{money(h.revenue)} · {num(h.units)} un. · acumulado {String(h.cum_pct).replace('.',',')}%</em></div>}
  </div>;
}

// Barras horizontais em HTML: uma linha por anúncio, barra proporcional ao maior valor.
function BarList({rows,max,color,value,extra}){
  return <ol className="ndb-bars">
    {rows.map((r,i)=><li key={r.platform+r.external_id}>
      <span className="ndb-rank">{i+1}</span>
      <div className="ndb-bar-main">
        <div className="ndb-bar-title"><strong title={r.title||''}>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform} · {r.external_id}{r.status&&r.status!=='ACTIVE'?' · inativo':''}</small></div>
        <div className="ndb-bar-track"><i style={{width:Math.max(2,value(r)/max*100)+'%',background:color}}/></div>
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
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [cls,setCls]=useState('A');
  const [showAbc,setShowAbc]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    fetchCommercialManager('/api/admin/commerce/sales-dashboard?platform='+platform+'&days='+days,{signal:controller.signal})
      .then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Não foi possível carregar o dashboard.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
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
  const totalRev=classes.reduce((a,c)=>a+Number(c.revenue||0),0)||1;
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
      <article><span>Anúncios com venda<InfoIcon text={SOURCES.kpi} label="Anúncios com venda"/></span><strong>{num(totals.listings_selling)}</strong><small>{num(data.drops?.total)} ativos em queda</small></article>
      <article className="is-loss"><span>Perda nos anúncios em queda<InfoIcon text={SOURCES.drops} label="Perda"/></span><strong>{money(data.drops?.lost_revenue)}</strong><small>faturamento a menos contra o período anterior</small></article>
    </div>}
    <div className="ndb-grid">
      <Card className="span-12" title="Curva ABC de produtos" subtitle="Quanto do faturamento cada produto concentra, do maior para o menor (por SKU)" source="abc">
        <div className="ndb-abc-layout">
          <ParetoChart items={allItems}/>
          <div className="ndb-classes">
            <div className="ndb-stack" aria-hidden="true">{classes.map(c=><i key={c.class} style={{width:(Number(c.revenue)/totalRev*100)+'%',background:CLASS_COLOR[c.class]}}/>)}</div>
            {classes.map(c=><button type="button" key={c.class} className={'ndb-class'+(c.class===cls?' is-active':'')} onClick={()=>{setCls(c.class);setShowAbc(true);}} aria-pressed={c.class===cls}>
              <span className="dot" style={{background:CLASS_COLOR[c.class]}}/>
              <b>Classe {c.class}</b><em>{CLASS_NOTE[c.class]}</em>
              <strong>{num(c.products)} produtos</strong><small>{String(c.revenue_pct).replace('.',',')}% · {shortMoney(c.revenue)}</small>
            </button>)}
          </div>
        </div>
        <p className="ndb-note">O gráfico mostra até os 120 maiores produtos; passe o mouse na curva para ver cada um. Clique numa classe para listar os produtos.</p>
        <button type="button" className="ndb-toggle" aria-expanded={showAbc} onClick={()=>setShowAbc(v=>!v)}>{showAbc?'Ocultar':'Ver'} produtos da classe {cls}</button>
        {showAbc&&<div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Produto (SKU)</th><th className="num">Unid.</th><th className="num">Faturamento</th><th className="num">% acum.</th></tr></thead><tbody>
          {items.map(i=><tr key={i.key}><td title={i.title||''}><strong>{i.key}</strong><small>{i.title||'—'}</small></td><td className="num">{num(i.units)}</td><td className="num">{money(i.revenue)}</td><td className="num">{String(i.cum_pct).replace('.',',')}%</td></tr>)}
          {!loading&&items.length===0&&<tr><td colSpan={4} className="ndb-empty">Sem produtos nesta classe.</td></tr>}
        </tbody></table></div>}
      </Card>
      <Card className="span-6" title="Anúncios em queda" subtitle="Ativos que mais perderam faturamento contra o período anterior" source="drops">
        {drops.length===0&&!loading&&<p className="ndb-empty">Nenhum anúncio ativo em queda neste período.</p>}
        <BarList rows={drops.slice(0,12)} max={maxDrop} color="#eb6834" value={r=>Number(r.lost_revenue)||0}
          extra={r=><div className="ndb-bar-extra"><span>{num(r.units_previous)} → {num(r.units)} unid.</span><PriceSignalCell signal={signals[r.listing_id]} window={days} diagnosis={diagnosis[r.listing_id]}/></div>}/>
        {drops.length>12&&<p className="ndb-note">Mostrando 12 de {num(data.drops?.total)} anúncios em queda.</p>}
      </Card>
      <Card className="span-6" title="Top 15 anúncios" subtitle="Maior faturamento no período, com a variação de unidades" source="top">
        {top.length===0&&!loading&&<p className="ndb-empty">Sem vendas no período.</p>}
        <BarList rows={top} max={maxTop} color="#2a78d6" value={r=>Number(r.revenue)||0}
          extra={r=><div className="ndb-bar-extra"><span>{num(r.units)} unid. · preço médio {money(r.price)}</span></div>}/>
      </Card>
    </div>
    <details className="ndb-help-box"><summary>Dados que ajudariam a explicar as quedas<InfoIcon text={SOURCES.help} label="Dados que ajudariam"/></summary>
      <ul className="ndb-help">{HELP.map(([t,d])=><li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
    </details>
  </section>;
}
