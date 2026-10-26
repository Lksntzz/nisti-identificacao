import React,{useState} from 'react';
import {readShopeePerformanceFile} from './commerce-shopee-performance-reader.js';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-ads-import.css';

const num=x=>new Intl.NumberFormat('pt-BR').format(Number(x||0));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(x||0));
const date=s=>String(s||'').split('-').reverse().join('/');

export default function CommerceShopeePerformanceImport(){
  const [file,setFile]=useState(null),[parsed,setParsed]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(null);
  async function choose(e){
    const value=e.target.files?.[0]||null;e.target.value='';
    setFile(value);setParsed(null);setError('');setSaved(null);
    if(!value)return;
    setBusy(true);
    try{setParsed(await readShopeePerformanceFile(value));}
    catch(err){setError(err.message||'Arquivo inválido.');}
    finally{setBusy(false);}
  }
  async function save(){
    if(!parsed||busy)return;
    setBusy(true);setError('');setSaved(null);
    try{
      setSaved(await commerceApi('/api/admin/commerce/shopee/performance/reports',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({report:parsed.report,rows:parsed.rows})
      }));
    }catch(err){setError(err.message||'Falha ao importar o desempenho.');}
    finally{setBusy(false);}
  }
  return <section className="shopee-ads-import" aria-label="Importação de desempenho dos anúncios Shopee">
    <header><h3>Desempenho dos anúncios · Shopee</h3>
      <p>Relatório de desempenho por produto da Central do Vendedor (arquivo <code>parentskudetail.AAAAMMDD_AAAAMMDD.xlsx</code>).
        Mostra impressões, cliques e pedidos de cada anúncio para explicar por que as vendas sobem ou caem. Não altera vendas, pedidos nem SKUs.</p>
    </header>
    <label className="shopee-ads-drop">Selecionar relatório (.xlsx)
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={choose}/>
      <small>{file?.name||'O período é lido do nome do arquivo. Prefira períodos de 7 a 31 dias.'}</small>
    </label>
    {busy&&<p role="status">Conferindo ou importando relatório…</p>}
    {error&&<p className="shopee-ads-error" role="alert">{error}</p>}
    {parsed&&<div className="shopee-ads-preview">
      <h4>Conferência antes da importação</h4>
      <div className="shopee-ads-facts">
        <span><small>Período</small><strong>{date(parsed.report.start)} a {date(parsed.report.end)}</strong></span>
        <span><small>Dias</small><strong>{parsed.days}</strong></span>
        <span><small>Anúncios</small><strong>{num(parsed.rows.length)}</strong></span>
        <span><small>Impressões</small><strong>{num(parsed.totals.impressions)}</strong></span>
        <span><small>Cliques</small><strong>{num(parsed.totals.clicks)}</strong></span>
        <span><small>Pedidos feitos</small><strong>{num(parsed.totals.orders)}</strong></span>
      </div>
      <p className="shopee-ads-warning">Este relatório conta pedidos feitos, incluindo os cancelados depois. Por isso as unidades podem ser maiores que as do histórico de vendas.
        Relatórios de 1 dia ou de dia ainda em andamento não são comparáveis: use períodos fechados.</p>
      <div className="shopee-ads-preview-scroll"><table><thead><tr>
        <th>Anúncio</th><th>ID</th><th>Impressões</th><th>Cliques</th><th>Pedidos</th><th>Faturamento</th>
      </tr></thead><tbody>{parsed.rows.slice(0,15).map(r=><tr key={r.item_id}>
        <td>{r.name}</td><td>{r.item_id}</td><td>{num(r.impressions)}</td><td>{num(r.clicks)}</td><td>{num(r.orders)}</td>
        <td>{r.revenue==null?'—':money(r.revenue)}</td></tr>)}</tbody></table></div>
      <button type="button" disabled={busy} onClick={save}>{busy?'Importando…':'Importar desempenho'}</button>
      {saved&&<p className="shopee-ads-success" role="status">
        {saved.created?'Relatório salvo.':'Este arquivo já estava importado; nenhuma duplicação realizada.'}
        {saved.created&&<>{' '}{num(saved.linked)} anúncio(s) ligados ao catálogo e {num(saved.unlinked)} sem ligação (anúncios que não estão ativos no sistema).</>}
      </p>}
    </div>}
  </section>;
}
