import React,{useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {funnelSteps,rates,deltaPct,enrichRows,sortRows,filterRows,toCsv} from './commerce-shopee-performance-view-logic.js';
import './commerce-shopee-performance-view.css';

const dateBr=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const int=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const pc=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
const brl=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const days=r=>r?Math.round((Date.parse(r.end)-Date.parse(r.start))/86400000)+1:0;
const periodOf=r=>r?dateBr(r.start)+' a '+dateBr(r.end):'—';

function Delta({value,invert}){
  if(value==null)return null;
  const up=value>0.05,down=value<-0.05;
  const cls=!up&&!down?'is-flat':(up!==!!invert)?'is-good':'is-bad';
  return <span className={'nspv-delta '+cls}>{up?'▲':down?'▼':'='} {Math.abs(value).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span>;
}
function Kpi({label,value,delta,hint}){
  return <div className="nspv-kpi"><span>{label}</span><strong>{value}</strong><em>{delta}</em>{hint&&<small>{hint}</small>}</div>;
}
const HEAD=[['revenue_paid','Vendas pagas'],['impressions','Impressões'],['clicks','Cliques'],['ctr','CTR'],['visitors','Visitantes'],['cart','Carrinho'],['orders','Pedidos'],['conv','Conversão']];

export default function ShopeePerformanceView({onClose}){
  const [report,setReport]=useState('');const [compare,setCompare]=useState('');
  const [data,setData]=useState(null);const [error,setError]=useState('');
  const [q,setQ]=useState('');const [activeOnly,setActiveOnly]=useState(true);const [weakOnly,setWeakOnly]=useState(false);
  const [sort,setSort]=useState({key:'revenue_paid',dir:'desc'});
  useEffect(()=>{
    const c=new AbortController();
    const qs=new URLSearchParams();if(report)qs.set('report',report);if(compare)qs.set('compare',compare);
    fetchCommercialManager('/api/admin/commerce/shopee/performance/overview'+(qs.toString()?'?'+qs:''),{signal:c.signal})
      .then(d=>{setError('');setData(d);}).catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível carregar o desempenho.');});
    return()=>c.abort();
  },[report,compare]);
  const reports=data?.reports||[];
  const cur=reports.find(r=>r.id===data?.selected_id),prev=reports.find(r=>r.id===data?.compare_id);
  const rows=useMemo(()=>data?enrichRows(data.items,data.totals):[],[data]);
  const shown=useMemo(()=>sortRows(filterRows(rows,{q,activeOnly,weakOnly}),sort.key,sort.dir),[rows,q,activeOnly,weakOnly,sort]);
  const t=data?.totals,ct=data?.compare_totals;
  const rt=t?rates(t):{},rc=ct?rates(ct):{};
  const hasCmp=!!ct;
  const d=(a,b)=>hasCmp?deltaPct(a,b):null;
  const dp=(a,b)=>hasCmp&&a!=null&&b!=null?(a-b):null;
  const sortBy=k=>setSort(s=>({key:k,dir:s.key===k&&s.dir==='desc'?'asc':'desc'}));
  const download=()=>{const blob=new Blob([toCsv(shown)],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='desempenho-shopee.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  return createPortal(<div className="nspv-overlay" role="dialog" aria-label="Desempenho Shopee">
    <div className="nspv-toolbar">
      <label>Período <select value={report||String(data?.selected_id||'')} onChange={e=>{setData(null);setReport(e.target.value);}}>
        {reports.map(r=><option key={r.id} value={String(r.id)}>{periodOf(r)}</option>)}</select></label>
      <label>Comparar com <select value={compare} onChange={e=>{setData(null);setCompare(e.target.value);}}>
        <option value="">Sem comparação</option>{reports.filter(r=>r.id!==data?.selected_id).map(r=><option key={r.id} value={String(r.id)}>{periodOf(r)}</option>)}</select></label>
      <span className="nspv-gap"/>
      <button type="button" onClick={download} disabled={!data}>Baixar planilha</button>
      <button type="button" className="is-ghost" onClick={onClose}>Fechar</button>
    </div>
    <article className="nspv-page">
      <header><p>NISTI ID · Gestor de Anúncios</p><h1>Desempenho Shopee</h1>
        <small>{cur?'Relatório de '+periodOf(cur)+' ('+days(cur)+' dias)':'Carregando…'}{prev?' · comparando com '+periodOf(prev)+' ('+days(prev)+' dias)':''}</small></header>
      {error&&<p className="nspv-error" role="alert">{error}</p>}
      {!data&&!error&&<p>Carregando desempenho…</p>}
      {data&&!reports.length&&<p>Nenhum relatório de desempenho da Shopee foi importado ainda. Use a Central de Importações.</p>}
      {data&&reports.length>0&&<>
        {prev&&days(cur)!==days(prev)&&<p className="nspv-warn">Os períodos têm durações diferentes ({days(cur)} e {days(prev)} dias). Compare as taxas (CTR, carrinho, conversão), não os volumes.</p>}
        <section className="nspv-kpis" aria-label="Resumo do período">
          <Kpi label="Impressões" value={int(t.impressions)} delta={<Delta value={d(t.impressions,ct?.impressions)}/>}/>
          <Kpi label="CTR" value={pc(rt.ctr)} delta={hasCmp&&<span className="nspv-delta is-flat">{dp(rt.ctr,rc.ctr)==null?'':(dp(rt.ctr,rc.ctr)>=0?'+':'')+dp(rt.ctr,rc.ctr).toFixed(2).replace('.',',')+' p.p.'}</span>} hint="cliques ÷ impressões"/>
          <Kpi label="Visitantes" value={int(t.visitors)} delta={<Delta value={d(t.visitors,ct?.visitors)}/>}/>
          <Kpi label="Carrinho" value={pc(rt.cart)} delta={hasCmp&&<span className="nspv-delta is-flat">{dp(rt.cart,rc.cart)==null?'':(dp(rt.cart,rc.cart)>=0?'+':'')+dp(rt.cart,rc.cart).toFixed(2).replace('.',',')+' p.p.'}</span>} hint="carrinho ÷ visitantes"/>
          <Kpi label="Conversão" value={pc(rt.conv)} delta={hasCmp&&<span className="nspv-delta is-flat">{dp(rt.conv,rc.conv)==null?'':(dp(rt.conv,rc.conv)>=0?'+':'')+dp(rt.conv,rc.conv).toFixed(2).replace('.',',')+' p.p.'}</span>} hint="pedidos feitos ÷ visitantes"/>
          <Kpi label="Vendas pagas" value={brl(t.revenue_paid)} delta={<Delta value={d(t.revenue_paid,ct?.revenue_paid)}/>}/>
        </section>
        <section className="nspv-funnel" aria-label="Funil">
          {funnelSteps(t).map((s,i)=><React.Fragment key={s.key}>
            {i>0&&<div className="nspv-step-rate"><b>{pc(s.rate)}</b><small>{s.rateLabel}</small></div>}
            <div className="nspv-step"><span>{s.label}</span><strong>{int(s.value)}</strong>{hasCmp&&ct&&<Delta value={deltaPct(s.value,ct[s.key])}/>}</div></React.Fragment>)}
        </section>
        <div className="nspv-filters">
          <input type="search" placeholder="Buscar por nome ou ID do anúncio" value={q} onChange={e=>setQ(e.target.value)}/>
          <label><input type="checkbox" checked={activeOnly} onChange={e=>setActiveOnly(e.target.checked)}/> Só anúncios ativos no GA</label>
          <label><input type="checkbox" checked={weakOnly} onChange={e=>setWeakOnly(e.target.checked)}/> Só os que pedem atenção</label>
          <span>{shown.length} de {rows.length} anúncios</span>
        </div>
        <div className="nspv-table-wrap"><table className="nspv-table"><thead><tr><th>Anúncio</th>
          {HEAD.map(([k,l])=><th key={k} className="num"><button type="button" onClick={()=>sortBy(k)} aria-label={'Ordenar por '+l}>{l}{sort.key===k?(sort.dir==='desc'?' ▼':' ▲'):''}</button></th>)}
          <th>Atenção</th></tr></thead>
          <tbody>{shown.map(r=><tr key={r.item_id}>
            <td className="nspv-name">{r.title||'(sem título)'}<small>{r.item_id}{r.status!=='ACTIVE'?' · fora do GA ou inativo':''}</small></td>
            <td className="num">{brl(r.revenue_paid)}{hasCmp&&<Delta value={r.revenue_delta}/>}</td>
            <td className="num">{int(r.impressions)}</td><td className="num">{int(r.clicks)}</td><td className="num">{pc(r.ctr)}</td>
            <td className="num">{int(r.visitors)}{hasCmp&&<Delta value={r.visitors_delta}/>}</td><td className="num">{pc(r.cart)}</td>
            <td className="num">{int(r.orders)}{hasCmp&&<Delta value={r.orders_delta}/>}</td><td className="num">{pc(r.conv)}</td>
            <td>{r.weak&&<span className="nspv-badge" title={'Está em '+Math.round(r.weak.ratio*100)+'% da média da loja nesta etapa'}>{r.weak.label}</span>}</td></tr>)}
            {!shown.length&&<tr><td colSpan="10">Nenhum anúncio com esse filtro.</td></tr>}</tbody></table></div>
        <footer>Fonte: relatório "parentskudetail" da Shopee importado na Central de Importações. Pedidos feitos incluem os cancelados depois. "Atenção" = etapa abaixo de 70% da média da loja, só em anúncios com volume mínimo (1.000 impressões, 200 visitantes); é um sinal para olhar o anúncio, não um veredito.</footer>
      </>}
    </article></div>,document.body);
}
