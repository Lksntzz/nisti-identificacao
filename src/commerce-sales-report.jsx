import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {groupReport,periodLabel,topLongest,SUMMARY_LIMIT,reportToCsv,groupListings,sortItems,PLATFORM_LABELS,SCOPE_LABELS,SITUATION_LABELS} from './commerce-sales-report-logic.js';
import './commerce-sales-report.css';

const dateBr=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const nowBr=v=>{const d=new Date(v||Date.now());return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});};

function ListTable({items}){
  return <table className="nsr-list"><thead><tr><th>Tipo</th><th>ID</th><th>Anúncio</th><th className="num">Dias sem vender</th></tr></thead>
    <tbody>{items.map(g=><tr key={g.key}>
      <td><span className={'nsr-badge '+(g.scope==='VARIACAO'?'is-var':'is-all')}>{g.scope==='VARIACAO'?'VARIAÇÃO':'ANÚNCIO TODO'}</span></td>
      <td className="nsr-id">{g.url?<a href={g.url} target="_blank" rel="noreferrer">{g.external_id}</a>:g.external_id}</td>
      <td className="nsr-name">{g.title||'(sem título)'}{g.vars.length>0&&<small>{g.vars.length===1?'Variação sem vender: ':g.vars.length+' variações sem vender: '}{g.vars.join(', ')}</small>}</td>
      <td className="num">{g.days_since==null?'nunca':g.days_since}</td></tr>)}</tbody></table>;
}
function download(rows){
  const blob=new Blob([reportToCsv(rows)],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='anuncios-sem-vendas.csv';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

export default function SalesReport({platform,days,month,onClose}){
  const [full,setFull]=useState(false);const [data,setData]=useState(null);const [error,setError]=useState('');
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
    <div className="nsr-toolbar"><button type="button" onClick={()=>setFull(v=>!v)} disabled={!data}>{full?'Ver resumo':'Ver lista completa'}</button><button type="button" onClick={()=>download(data.rows)} disabled={!data}>Baixar planilha (Excel)</button><button type="button" onClick={()=>window.print()} disabled={!data}>Imprimir / salvar PDF</button><button type="button" onClick={onClose}>Fechar</button></div>
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
        {groups.map(g=><section key={g.code} className={"nsr-plat"+(full?" is-full":"")}><h2>{g.label}</h2>
          {[['SEM_VENDAS',g.semVendas],['PAROU',g.parou]].map(([sit,rows])=>rows.length>0&&<div key={sit}>
            <h3>{SITUATION_LABELS[sit]} <span>({groupListings(rows).length} anúncios)</span></h3><ListTable items={full?sortItems(groupListings(rows)):topLongest(groupListings(rows))}/>{!full&&groupListings(rows).length>SUMMARY_LIMIT&&<p className="nsr-more">Mostrando os {SUMMARY_LIMIT} há mais tempo sem vender, de {groupListings(rows).length} anúncios. Use "Ver lista completa" ou a planilha para todos.</p>}</div>)}</section>)}
        <footer className="nsr-foot">NISTI ID · Gestor de Anúncios — relatório gerado automaticamente; confira no painel antes de decidir pausar ou excluir um anúncio.</footer>
      </>}
    </article></div>,document.body);
}
