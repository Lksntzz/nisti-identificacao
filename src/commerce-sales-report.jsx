import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {groupReport,periodLabel,PLATFORM_LABELS,SCOPE_LABELS,SITUATION_LABELS} from './commerce-sales-report-logic.js';
import './commerce-sales-report.css';

const dateBr=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const nowBr=v=>{const d=new Date(v||Date.now());return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});};

function Table({rows}){
  return <table className="nsr-table"><thead><tr><th>Tipo</th><th>Anúncio</th><th>Variação / SKU</th><th>ID</th><th>Última venda</th><th>Dias sem vender</th><th>Un. vendidas (histórico)</th></tr></thead>
    <tbody>{rows.map((r,i)=><tr key={r.platform+r.external_id+(r.sku||'')+i} className={r.scope==='VARIACAO'?'is-var':'is-all'}>
      <td><span className={'nsr-badge '+(r.scope==='VARIACAO'?'is-var':'is-all')}>{SCOPE_LABELS[r.scope]}</span></td>
      <td className="nsr-title">{r.title||'(sem título)'}</td>
      <td>{r.scope==='VARIACAO'?<><strong>{r.variation_name||'—'}</strong><br/><small>{r.sku||''}</small></>:<small>{Number(r.listing_variations)>1?r.listing_variations+' variações — todas sem vender':'—'}</small>}</td>
      <td>{r.url?<a href={r.url} target="_blank" rel="noreferrer">{r.external_id}</a>:r.external_id}</td>
      <td>{dateBr(r.last_sale)}</td><td>{r.days_since==null?'—':r.days_since}</td><td>{r.units_ever??0}</td></tr>)}</tbody></table>;
}

export default function SalesReport({platform,days,month,onClose}){
  const [data,setData]=useState(null);const [error,setError]=useState('');
  useEffect(()=>{
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/report-no-sales?platform='+platform+'&days='+days+(month?'&month='+month:''),{signal:c.signal})
      .then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível gerar o relatório.');});
    document.body.classList.add('nsr-printing');
    return()=>{c.abort();document.body.classList.remove('nsr-printing');};
  },[platform,days,month]);
  const groups=data?groupReport(data.rows):[];
  const total=data?.counts?.rows||0;
  return createPortal(<div className="nsr-overlay" role="dialog" aria-label="Relatório de anúncios sem vendas">
    <div className="nsr-toolbar"><button type="button" onClick={()=>window.print()} disabled={!data}>Imprimir / salvar PDF</button><button type="button" onClick={onClose}>Fechar</button></div>
    <article className="nsr-page">
      <header className="nsr-head"><p>NISTI ID · Gestor de Anúncios</p><h1>Relatório de anúncios sem vendas</h1>
        <dl><div><dt>Período</dt><dd>{periodLabel(days,month)}</dd></div>
          <div><dt>Plataforma</dt><dd>{platform==='TODAS'?'Todas':PLATFORM_LABELS[platform]}</dd></div>
          <div><dt>Dados até</dt><dd>{dateBr(data?.data_until)}</dd></div>
          <div><dt>Gerado em</dt><dd>{nowBr(data?.generated_at)}</dd></div></dl></header>
      {error&&<p className="nsr-error" role="alert">{error}</p>}
      {!data&&!error&&<p>Gerando relatório…</p>}
      {data&&<>
        <section className="nsr-summary"><h2>Resumo</h2>
          <p>Somente anúncios ativos. <strong>Sem vendas</strong>: nunca venderam ou venderam menos de 3 unidades no histórico. <strong>Vendia e parou</strong>: já venderam 3 unidades ou mais, mas não venderam no período. <strong>Variação</strong>: o anúncio vende, porém uma variação cadastrada não vendeu.</p>
          <table className="nsr-table nsr-sum"><thead><tr><th>Plataforma</th><th>Anúncios inteiros</th><th>Variações</th><th>Sem vendas</th><th>Vendia e parou</th><th>Total</th></tr></thead>
            <tbody>{groups.map(g=><tr key={g.code}><td>{g.label}</td><td>{g.anuncios}</td><td>{g.variacoes}</td><td>{g.semVendas.length}</td><td>{g.parou.length}</td><td><strong>{g.total}</strong></td></tr>)}
              {!groups.length&&<tr><td colSpan="6">Nenhum item encontrado no período.</td></tr>}</tbody></table>
          {total>=3000&&<p className="nsr-warn">Atenção: a lista foi limitada a 3.000 linhas; refine por plataforma ou período.</p>}
        </section>
        {groups.map(g=><section key={g.code} className="nsr-plat"><h2>{g.label}</h2>
          {[['SEM_VENDAS',g.semVendas],['PAROU',g.parou]].map(([sit,rows])=>rows.length>0&&<div key={sit}>
            <h3>{SITUATION_LABELS[sit]} <span>({rows.length})</span></h3><Table rows={rows}/></div>)}</section>)}
        <footer className="nsr-foot">NISTI ID · Gestor de Anúncios — relatório gerado automaticamente; confira no painel antes de decidir pausar ou excluir um anúncio.</footer>
      </>}
    </article></div>,document.body);
}
