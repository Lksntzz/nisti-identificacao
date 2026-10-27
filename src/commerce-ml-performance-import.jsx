import React,{useState} from 'react';
import {readMlPerformanceFile} from './commerce-ml-performance-reader.js';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-ads-import.css';

const num=x=>new Intl.NumberFormat('pt-BR').format(Number(x||0));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(x||0));
const date=s=>String(s||'').split('-').reverse().join('/');

export default function CommerceMlPerformanceImport(){
  const [account,setAccount]=useState('NOVO');
  const [file,setFile]=useState(null),[parsed,setParsed]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(null);
  async function read(value,acc){
    setParsed(null);setError('');setSaved(null);
    if(!value)return;
    setBusy(true);
    try{setParsed(await readMlPerformanceFile(value,acc));}
    catch(err){setError(err.message||'Arquivo inválido.');}
    finally{setBusy(false);}
  }
  function choose(e){
    const value=e.target.files?.[0]||null;e.target.value='';
    setFile(value);read(value,account);
  }
  function changeAccount(acc){
    setAccount(acc);
    if(file)read(file,acc);
  }
  async function save(){
    if(!parsed||busy)return;
    setBusy(true);setError('');setSaved(null);
    try{
      setSaved(await commerceApi('/api/admin/commerce/ml/performance/reports',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({report:parsed.report,rows:parsed.rows})
      }));
    }catch(err){setError(err.message||'Falha ao importar o desempenho.');}
    finally{setBusy(false);}
  }
  return <section className="shopee-ads-import" aria-label="Importação de desempenho dos anúncios do Mercado Livre">
    <header><h3>Desempenho dos anúncios · Mercado Livre</h3>
      <p>Relatório de desempenho das publicações (arquivo <code>Relatorio_desempenho_publicacoes_AAAA_MM_DD-AAAA_MM_DD.xlsx</code>).
        Mostra visitas, vendas, conversão e qualidade de cada anúncio. Não altera vendas, pedidos nem SKUs.</p>
    </header>
    <fieldset className="ml-perf-account" disabled={busy}>
      <legend>De qual conta é este relatório?</legend>
      <label><input type="radio" name="ml-perf-account" checked={account==='NOVO'} onChange={()=>changeAccount('NOVO')}/> Mercado Livre Novo</label>{' '}
      <label><input type="radio" name="ml-perf-account" checked={account==='ANTIGO'} onChange={()=>changeAccount('ANTIGO')}/> Mercado Livre Antigo</label>
    </fieldset>
    <label className="shopee-ads-drop">Selecionar relatório (.xlsx)
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={choose}/>
      <small>{file?.name||'O período é lido do nome do arquivo.'}</small>
    </label>
    {busy&&<p role="status">Conferindo ou importando relatório…</p>}
    {error&&<p className="shopee-ads-error" role="alert">{error}</p>}
    {parsed&&<div className="shopee-ads-preview">
      <h4>Conferência antes da importação · conta {account==='NOVO'?'Novo':'Antigo'}</h4>
      <div className="shopee-ads-facts">
        <span><small>Período</small><strong>{date(parsed.report.start)} a {date(parsed.report.end)}</strong></span>
        <span><small>Anúncios</small><strong>{num(parsed.totals.listings)}</strong></span>
        <span><small>Linhas (variações)</small><strong>{num(parsed.rows.length)}</strong></span>
        <span><small>Visitas únicas</small><strong>{num(parsed.totals.visits)}</strong></span>
        <span><small>Vendas</small><strong>{num(parsed.totals.sales)}</strong></span>
        <span><small>Unidades</small><strong>{num(parsed.totals.units)}</strong></span>
        <span><small>Vendas brutas</small><strong>{money(parsed.totals.gross)}</strong></span>
      </div>
      <p className="shopee-ads-warning">Este relatório é um total do período inteiro, não tem dia a dia. As vendas brutas são arredondadas em reais e diferem da receita do Dashboard (receita por produtos): não some os dois.
        Para acompanhar a evolução, importe um relatório novo de tempos em tempos; cada um fica guardado com a sua data.</p>
      <div className="shopee-ads-preview-scroll"><table><thead><tr>
        <th>Anúncio</th><th>ID</th><th>Variação</th><th>Visitas</th><th>Vendas</th><th>Unidades</th><th>Bruto</th>
      </tr></thead><tbody>{parsed.rows.slice(0,15).map((r,i)=><tr key={r.listing_id+i}>
        <td>{r.title}</td><td>{r.listing_id}</td><td>{r.variation||'—'}</td><td>{num(r.visits)}</td><td>{num(r.sales)}</td><td>{num(r.units)}</td>
        <td>{r.gross==null?'—':money(r.gross)}</td></tr>)}</tbody></table></div>
      <button type="button" disabled={busy||saved?.created===false} onClick={save}>{busy?'Importando…':'Importar desempenho'}</button>
      {saved&&<p className="shopee-ads-success" role="status">
        {saved.created?'Relatório salvo.':'Este arquivo já estava importado; nenhuma duplicação realizada.'}
        {saved.created&&<>{' '}{num(saved.linked)} linha(s) ligadas ao catálogo e {num(saved.unlinked)} sem ligação (anúncios que não estão no catálogo).</>}
      </p>}
    </div>}
  </section>;
}
