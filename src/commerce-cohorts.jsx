import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';

const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const PLAT={SHOPEE:'Shopee',ML:'Mercado Livre'};
const MONTH_NAMES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const monthTitle=m=>{const s=String(m).slice(0,10);return MONTH_NAMES[Number(s.slice(5,7))-1]+' de '+s.slice(0,4);};
const dmy=d=>{const s=String(d||'').slice(0,10);return s?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'—';};
const norm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();

// Média por semana desde o cadastro: deixa comparar produtos de idades diferentes.
function perWeek(units,ageDays){return ageDays>0?Math.round(units/ageDays*7*10)/10:null;}

// Aba "Cadastros por mês": produtos criados em cada mês e o desempenho desde o dia da criação.
export default function CohortsTab({platform='TODAS',query=''}){
  const [data,setData]=useState(null);
  const [error,setError]=useState(false);
  const [open,setOpen]=useState({});
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setError(false);
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/cohorts?platform='+platform,{signal:controller.signal})
      .then(setData).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[platform]);
  const qn=norm(query);
  const months=useMemo(()=>(data?.months||[]).map(m=>({...m,items:(m.items||[]).filter(i=>!qn||norm(i.title).includes(qn)||norm(i.product_ref).includes(qn))})).filter(m=>m.items.length),[data,qn]);
  if(error)return <p className="ndb-empty">Consulta indisponível. Tente atualizar.</p>;
  if(!data)return <p className="ndb-empty">Carregando…</p>;
  if(!months.length)return <p className="ndb-empty">{qn?'Nenhum produto cadastrado encontrado nessa busca.':'Nenhum anúncio com data de criação para esta plataforma.'}</p>;
  const lastIdx=months.length-1;
  return <div className="ndb-coh">
    {months.map((m,idx)=>{
      const isOpen=open[m.month]??(idx===lastIdx);
      const units=m.items.reduce((a,i)=>a+Number(i.units||0),0),rev=m.items.reduce((a,i)=>a+Number(i.revenue||0),0);
      return <section key={m.month} className="ndb-coh-month">
        <button type="button" className="ndb-coh-head" aria-expanded={isOpen} onClick={()=>setOpen(o=>({...o,[m.month]:!isOpen}))}>
          <strong>{monthTitle(m.month)}</strong>
          <span>{num(m.items.length)} produto{m.items.length===1?'':'s'} cadastrado{m.items.length===1?'':'s'}</span>
          <span>{num(units)} un.</span><span>{money(rev)}</span><i aria-hidden="true">{isOpen?'▾':'▸'}</i>
        </button>
        {isOpen&&<div className="ndb-scroll"><table className="ndb-table ndb-detail-table ndb-coh-table">
          <thead><tr><th>Produto</th><th>Criado em</th><th className="num" title="Dias desde a criação até o último dia fechado">Idade</th><th className="num">Vendas</th><th className="num">Faturamento</th><th className="num" title="Média de unidades por semana desde a criação">Un./semana</th><th className="num" title="Dias entre a criação e a primeira venda">1ª venda</th><th className="num" title="Unidades acumuladas nos primeiros 7, 14, 28 e 56 dias. Vazio = produto ainda não completou esse tempo.">7d</th><th className="num">14d</th><th className="num">28d</th><th className="num">56d</th><th className="num" title="Unidades nos últimos 28 dias">Últimos 28d</th></tr></thead>
          <tbody>{m.items.map(i=>{
            const early=i.days_to_first_sale!=null&&i.days_to_first_sale<0;
            return <tr key={i.platform+i.product_ref}>
              <td title={i.title}><div className="ndb-pc"><div className="ndb-pt"><strong>{i.title}</strong><small>{PLAT[i.platform]||i.platform} · {i.product_ref} · {num(i.listings)} {i.listings===1?'anúncio':'anúncios'}</small></div></div></td>
              <td>{dmy(i.created_on)}</td>
              <td className="num">{num(i.age_days)} d</td>
              <td className="num"><b>{num(i.units)}</b></td><td className="num">{money(i.revenue)}</td>
              <td className="num">{perWeek(i.units,i.age_days)==null?'—':String(perWeek(i.units,i.age_days)).replace('.',',')}</td>
              <td className="num" title={early?'Há venda antes da data de criação informada: confira a data na planilha.':undefined}>{i.days_to_first_sale==null?'sem venda':early?'⚠ '+i.days_to_first_sale+' d':i.days_to_first_sale+' d'}</td>
              <td className="num">{i.u7==null?'':num(i.u7)}</td><td className="num">{i.u14==null?'':num(i.u14)}</td>
              <td className="num">{i.u28==null?'':num(i.u28)}</td><td className="num">{i.u56==null?'':num(i.u56)}</td>
              <td className="num">{num(i.u_last28)}</td>
            </tr>;})}</tbody></table></div>}
      </section>;})}
    <p className="ndb-note">Data de criação vinda da planilha “Análise de Anúncios” ({num((data.months||[]).reduce((a,m)=>a+(m.items||[]).length,0))} produtos). Vendas contadas até {dmy(data.last_day)}. No Mercado Livre, o produto soma todos os itens do mesmo catálogo (ML Antigo e ML Novo juntos). Compare pelos blocos de 7, 14, 28 e 56 dias, não pelo total, porque produtos mais antigos tiveram mais tempo para vender. “⚠” indica venda anterior à data de criação informada.</p>
  </div>;
}
