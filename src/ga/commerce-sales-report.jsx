import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {groupReport,periodLabel,topLongest,SUMMARY_LIMIT,reportToCsv,groupListings,sortItems,PERIOD_CHOICES,filterStalled,PLATFORM_LABELS,SCOPE_LABELS,SITUATION_LABELS} from './commerce-sales-report-logic.js';
import './commerce-sales-report.css';

const dateBr=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const nowBr=v=>{const d=new Date(v||Date.now());return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});};

function ListTable({items}){
  return <table className="nsr-list"><thead><tr><th>Tipo</th><th>ID</th><th>Anúncio</th><th>SKU</th><th className="num">Última venda há (dias)</th></tr></thead>
    <tbody>{items.map(g=><tr key={g.key}>
      <td><span className={'nsr-badge '+(g.scope==='VARIACAO'?'is-var':'is-all')}>{g.scope==='VARIACAO'?'VARIAÇÃO':'ANÚNCIO TODO'}</span></td>
      <td className="nsr-id">{g.url?<a href={g.url} target="_blank" rel="noreferrer">{g.external_id}</a>:g.external_id}</td>
      <td className="nsr-name">{g.title||'(sem título)'}{g.vars.length>0&&<small>{g.vars.length===1?'Variação sem vender: ':g.vars.length+' variações sem vender: '}{g.vars.join(', ')}</small>}</td>
      <td className="nsr-sku">{g.skus.length?g.skus.join(', '):'—'}</td>
      <td className="num">{g.days_since==null?'nunca':g.days_since}</td></tr>)}</tbody></table>;
}
function download(rows){
  const blob=new Blob([reportToCsv(rows)],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='anuncios-sem-vendas.csv';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

export default function SalesReport({platform,days:daysProp,onClose}){
  const [pick,setPick]=useState([7,30,60,90].includes(Number(daysProp))?String(daysProp):'90');
  const days=Number(pick);
  const [wide,setWide]=useState(false);
  const [full,setFull]=useState(false);const [data,setData]=useState(null);const [error,setError]=useState('');
  useEffect(()=>{
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/sales-dashboard/report-no-sales?platform='+platform+'&days='+days,{signal:c.signal})
      .then(setData).catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível gerar o relatório.');});
    document.body.classList.add('nsr-printing');
    return()=>{c.abort();document.body.classList.remove('nsr-printing');};
  },[platform,days]);
  const groups=data?groupReport(filterStalled(data.rows,days,wide)):[];
  const total=data?.counts?.rows||0;
  return createPortal(<div className="nsr-overlay" role="dialog" aria-label="Relatório de anúncios sem vendas">
    <div className="nsr-toolbar"><label className="nsr-period">Período <select value={pick} onChange={e=>{setData(null);setError('');setPick(e.target.value);}}>{PERIOD_CHOICES.map(([d,l])=><option key={d} value={String(d)}>{l}</option>)}</select></label><button type="button" onClick={()=>setFull(v=>!v)} disabled={!data}>{full?'Ver resumo':'Ver lista completa'}</button><button type="button" onClick={()=>download(data.rows)} disabled={!data}>Baixar planilha (Excel)</button><button type="button" onClick={()=>window.print()} disabled={!data}>Imprimir / salvar PDF</button><button type="button" onClick={onClose}>Fechar</button></div>
    <article className="nsr-page">
      <header className="nsr-head"><p>NISTI ID · Gestor de Anúncios</p><h1>Relatório de anúncios sem vendas</h1>
        <dl><div><dt>Período</dt><dd>{periodLabel(days)}</dd></div>
          <div><dt>Plataforma</dt><dd>{platform==='TODAS'?'Todas':PLATFORM_LABELS[platform]}</dd></div>
          <div><dt>Dados até</dt><dd>{dateBr(data?.data_until)}</dd></div>
          <div><dt>Gerado em</dt><dd>{nowBr(data?.generated_at)}</dd></div></dl></header>
      {error&&<p className="nsr-error" role="alert">{error}</p>}
      {!data&&!error&&<p>Gerando relatório…</p>}
      {data&&<>
        <section className="nsr-summary"><h2>Resumo</h2>
          <p className="nsr-explain">Somente anúncios <strong>ativos</strong> com <strong>nenhuma venda nos últimos {days} dias</strong>. {wide?'Mostrando todos, inclusive os parados há muito tempo e os que nunca venderam.':'Mostrando só quem acabou de completar '+days+' dias sem vender (última venda há '+days+' a '+(days+6)+' dias). Quem nunca vendeu e quem parou há mais tempo fica de fora.'} <strong>Variação</strong>: o anúncio vende, mas uma variação cadastrada dele ficou sem vender no mesmo prazo.</p>
          <label className="nsr-wide"><input type="checkbox" checked={wide} onChange={e=>setWide(e.target.checked)}/> Mostrar todos os parados há mais de {days} dias e os que nunca venderam</label>
          <table className="nsr-table nsr-sum"><thead><tr><th>Plataforma</th><th>Anúncios sem nenhuma venda</th><th>Variações sem venda (anúncio vende)</th></tr></thead>
            <tbody>{groups.map(g=><tr key={g.code}><td>{g.label}</td><td><strong>{groupListings(g.zero).length}</strong></td><td>{groupListings(g.vars).length}</td></tr>)}
              {!groups.length&&<tr><td colSpan="3">Nenhum anúncio encontrado com esse filtro.</td></tr>}</tbody></table>
          {total>=3000&&<p className="nsr-warn">Atenção: a lista foi limitada a 3.000 linhas; refine por plataforma ou período.</p>}
        </section>
        {groups.map(g=><section key={g.code} className={"nsr-plat"+(full?" is-full":"")}><h2>{g.label}</h2>
          {[['Anúncios sem nenhuma venda nos últimos '+days+' dias',g.zero],['Variações sem venda (o anúncio vende, a variação não)',g.vars]].map(([label,rows])=>{const it=groupListings(rows);return it.length>0&&<div key={label}>
            <h3>{label} <span>({it.length})</span></h3><ListTable items={full?sortItems(it):topLongest(it)}/>{!full&&it.length>SUMMARY_LIMIT&&<p className="nsr-more">Mostrando os {SUMMARY_LIMIT} há mais tempo sem vender, de {it.length}. Use "Ver lista completa" ou a planilha para todos.</p>}</div>;})}</section>)}
        <footer className="nsr-foot nsr-noprint">NISTI ID · Gestor de Anúncios — relatório gerado automaticamente; confira no painel antes de decidir pausar ou excluir um anúncio.</footer>
      </>}
    </article></div>,document.body);
}
