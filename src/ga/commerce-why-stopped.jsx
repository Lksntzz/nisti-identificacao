import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {Dropdown,InfoIcon,listingUrl} from './commerce-dashboard.jsx';
import {maskMoney} from './commerce-privacy.js';
import {WHY_DAYS,causeOf,priceChange,priceRose,steps,FILTERS,filterItems,reportIsStale} from './commerce-why-stopped-logic.js';
import './commerce-dashboard.css';
import './commerce-why-stopped.css';

const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>maskMoney(v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const dBr=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const dm=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]:'—';};
const pctTxt=v=>v==null?'—':(v>0?'+':'')+Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const stepVal=(v,u)=>v==null?'—':u==='%'?Number(v).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%':num(v);

const SRC={
  window:'Compara os últimos dias COMPLETOS com o mesmo número de dias antes deles (o dia de hoje fica de fora). Entram só anúncios ATIVOS da Shopee que vendiam (5 ou mais unidades antes em 7 dias; 10 ou mais em 14 e 30) e caíram 30% ou mais ou pararam.',
  cause:'Motivo provável: compara o relatório de desempenho (parentskudetail) mais recente com o anterior, por dia. A etapa que mais caiu (20% ou mais) define o motivo: impressões = visibilidade, CTR = cliques, pedidos ÷ visitantes = conversão. É uma pista para conferir, não um veredito.'
};

function Ico({name}){
  const p={viewBox:'0 0 24 24',width:22,height:22,fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true};
  if(name==='down')return <svg {...p}><path d="m22 17-8.5-8.5-5 5L2 7M16 17h6v-6"/></svg>;
  if(name==='money')return <svg {...p}><path d="M12 2v20M17 6.5C16 5 14.2 4 12 4c-2.8 0-5 1.4-5 3.5S9.2 10.5 12 11s5 1.4 5 3.5S14.8 18 12 18c-2.3 0-4.2-1-5.2-2.6"/></svg>;
  if(name==='eye')return <svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>;
  if(name==='click')return <svg {...p}><path d="m9 9 5 12 1.8-5.2L21 14z"/><path d="M7.2 2.2 8 5.1M5.1 8 2.2 7.2M14 4.1 12 6.2M6.2 12l-2.1 2"/></svg>;
  if(name==='cart')return <svg {...p}><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6"/></svg>;
  if(name==='tag')return <svg {...p}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>;
}
function Card({icon,label,value,foot,tone='neutral',active,onClick,info}){
  const Tag=onClick?'button':'article';
  return <Tag type={onClick?'button':undefined} className={'ndb-kpi'+(onClick?' ndb-idx':'')+' tone-'+tone+(active?' is-active':'')} onClick={onClick} aria-pressed={onClick?!!active:undefined}>
    <span className="ndb-kpi-ico"><Ico name={icon}/></span>
    <span className="ndb-kpi-body">
      <span className="ndb-kpi-label">{label}{info&&<InfoIcon text={info} label={label}/>}</span>
      <span className="ndb-kpi-row"><strong>{value}</strong></span>
      <small>{foot}</small>
    </span>
  </Tag>;
}

function ItemCard({r}){
  const c=causeOf(r.cause),pc=priceChange(r),url=listingUrl('SHOPEE',r.item_id);
  return <article className={'nwy-item tone-'+c.tone}>
    <header>
      <div className="nwy-item-title">
        <span className={'nwy-kind '+(r.kind==='PAROU'?'is-stop':'is-fall')}>{r.kind==='PAROU'?'PAROU':'EM QUEDA'}</span>
        {url?<a href={url} target="_blank" rel="noreferrer">{r.title||r.item_id}</a>:<b>{r.title||r.item_id}</b>}
      </div>
      <div className="nwy-item-sales"><b>{num(r.units_prev)} → {num(r.units_cur)} un.</b><span className="nwy-drop">−{Number(r.drop_pct).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span><small>{money(r.revenue_prev-r.revenue_cur)} a menos{r.kind==='PAROU'&&r.last_sale?' · última venda '+dBr(r.last_sale):''}</small></div>
    </header>
    <div className="nwy-why">
      <strong>Motivo provável: {c.label}</strong>
      <span>{c.why}</span>
      {priceRose(r)&&<span className="nwy-price">Preço médio vendido subiu {pctTxt(pc)} ({money(r.price_prev)} → {money(r.price_cur)}).</span>}
    </div>
    {r.cause!=='SEM_RELATORIO'&&<ul className="nwy-steps" aria-label="Funil antes e depois">
      {steps(r).map(s=><li key={s.key} className={(s.bad?'is-bad':'')+(s.main?' is-main':'')}>
        <span>{s.label}</span><b>{stepVal(s.before,s.unit)} → {stepVal(s.after,s.unit)}</b><em>{pctTxt(s.change)}</em>
      </li>)}
    </ul>}
    {r.low_volume&&r.cause!=='SEM_RELATORIO'&&<p className="nwy-low">Pouco volume no relatório (menos de 1.000 impressões ou 100 visitantes): etapas sem volume não entram no motivo.</p>}
    <p className="nwy-check"><b>O que olhar:</b> {c.check.join(' · ')}</p>
  </article>;
}

export default function CommerceWhyStopped(){
  const [days,setDays]=useState(14);const [filter,setFilter]=useState('all');
  const [data,setData]=useState(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const c=new AbortController();setLoading(true);
    fetchCommercialManager('/api/admin/commerce/shopee/why-stopped?days='+days,{signal:c.signal})
      .then(d=>{setError('');setData(d);setLoading(false);})
      .catch(e=>{if(!c.signal.aborted){setError(e.message||'Não foi possível carregar o painel.');setLoading(false);}});
    return()=>c.abort();
  },[days]);
  const k=data?.kpis||{};
  const rows=useMemo(()=>filterItems(data?.items,filter),[data,filter]);
  const w=data?.window,ra=data?.report_before,rb=data?.report_after;
  const toggle=f=>setFilter(cur=>cur===f?'all':f);
  return <section className="nwy-root" aria-label="Por que parou">
    <header className="ndb-head">
      <div className="ndb-head-title"><div>
        <p>{w?'Shopee · '+dm(w.cur_start)+' a '+dm(w.cur_end)+' comparado com '+dm(w.prev_start)+' a '+dm(w.prev_end):'Shopee · anúncios bons que pararam ou caíram'}</p></div></div>
      <div className="ndb-head-filters">
        <Dropdown label="Comparar" value={String(days)} options={WHY_DAYS.map(d=>[String(d),'Últimos '+d+' dias'])} onChange={v=>setDays(Number(v))}/>
        <InfoIcon text={SRC.window} label="Período"/>
        <Dropdown label="Mostrar" value={filter} options={FILTERS} onChange={setFilter}/>
      </div>
    </header>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {loading&&!data&&<p className="ndb-empty">Consultando…</p>}
    {data&&<>
      {!rb&&<p className="ndb-warn">Nenhum relatório de desempenho da Shopee importado: sem ele não dá para dizer o motivo. Importe pela Central de Importações.</p>}
      {rb&&!ra&&<p className="ndb-warn">Só existe um relatório de desempenho; é preciso outro, de antes, para comparar.</p>}
      {reportIsStale(data)&&<p className="ndb-warn">O relatório de desempenho mais recente vai até {dBr(rb.end)}, antes da queda ({dBr(w.cur_start)} a {dBr(w.cur_end)}). Importe um relatório mais novo para o motivo refletir este período.</p>}
      <div className="ndb-kpis nwy-kpis">
        <Card icon="down" label="Anúncios bons em queda" value={num(k.total)} foot={num(k.stopped)+' pararam · '+num(k.falling)+' caindo'} tone="bad" active={filter==='all'} onClick={()=>setFilter('all')} info={SRC.window}/>
        <Card icon="money" label="Vendas perdidas" value={money(k.lost_revenue)} foot={num(k.lost_units)+' unidades a menos'} tone="bad"/>
        <Card icon="eye" label="Perdeu visibilidade" value={num(k.visibility)} foot="impressões caíram" tone="bad" active={filter==='VISIBILIDADE'} onClick={()=>toggle('VISIBILIDADE')} info={SRC.cause}/>
        <Card icon="click" label="Perdeu cliques" value={num(k.click)} foot="CTR caiu" tone="warn" active={filter==='CLIQUE'} onClick={()=>toggle('CLIQUE')} info={SRC.cause}/>
        <Card icon="cart" label="Perdeu conversão" value={num(k.conversion)} foot="entram e não compram" tone="warn" active={filter==='CONVERSAO'} onClick={()=>toggle('CONVERSAO')} info={SRC.cause}/>
        <Card icon="tag" label="Preço subiu" value={num(k.price_up)} foot="10% ou mais" tone="warn" active={filter==='PRICE'} onClick={()=>toggle('PRICE')}/>
        <Card icon="info" label="Sem diagnóstico" value={num((k.no_signal||0)+(k.no_report||0))} foot="relatório não explica" tone="neutral" active={filter==='SEM'} onClick={()=>toggle('SEM')}/>
      </div>
      {ra&&rb&&<p className="nwy-note">Motivo calculado com os relatórios de desempenho de {dBr(ra.start)} a {dBr(ra.end)} (antes) e {dBr(rb.start)} a {dBr(rb.end)} (depois), por dia.</p>}
      <div className="nwy-list">
        {rows.map(r=><ItemCard key={r.item_id} r={r}/>)}
        {!rows.length&&<p className="ndb-empty">{(k.total||0)===0?'Nenhum anúncio bom parou ou caiu 30% ou mais nos últimos '+days+' dias.':'Nenhum anúncio neste filtro.'}</p>}
      </div>
    </>}
  </section>;
}
