import React,{useState} from 'react';
import {readShopeeAdsCsvFile} from './commerce-shopee-ads-csv-reader.js';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-ads-import.css';

const num=x=>new Intl.NumberFormat('pt-BR').format(Number(x||0));
export default function CommerceShopeeAdsImport(){
  const [file,setFile]=useState(null),[parsed,setParsed]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(null);
  async function choose(e) {
    const value=e.target.files?.[0]||null;
    setFile(value);setParsed(null);setError('');setSaved(null);
    if(!value)return;
    setBusy(true);
    try{setParsed(await readShopeeAdsCsvFile(value));}
    catch(err){setError(err.message);}
    finally{setBusy(false);e.target.value='';}
  }
  async function save(){
    if(!parsed||busy)return;
    setBusy(true);setError('');setSaved(null);
    try{
      const result=await commerceApi('/api/admin/commerce/shopee-ads/reports',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({report:parsed.report,rows:parsed.rows})
      });
      setSaved(result);
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  const linked=parsed?.rows?.filter(x=>x.product_id)?.length||0;
  return <section className="shopee-ads-import" aria-label="Importação de publicidade Shopee">
    <header><h3>Shopee Ads · Desempenho de publicidade</h3>
      <p>Importe relatórios CSV CPC separados das vendas e do catálogo. A importação não altera pedidos ou SKUs.</p>
    </header>
    <label className="shopee-ads-drop">Selecionar relatório CSV (.csv)
      <input type="file" accept=".csv,text/csv" disabled={busy} onChange={choose}/>
      <small>{file?.name||'Aceita Dados Gerais de Anúncios e Palavra-chave/Localização exportados pela Shopee'}</small>
    </label>
    {busy&&<p role="status">Conferindo ou importando relatório…</p>}
    {error&&<p className="shopee-ads-error" role="alert">{error}</p>}
    {parsed&&<div className="shopee-ads-preview">
      <h4>Conferência antes da importação</h4>
      <div className="shopee-ads-facts">
        <span><small>Tipo</small><strong>{parsed.report.kind==='GENERAL'?'Dados gerais':'Segmentação / palavras-chave'}</strong></span>
        <span><small>Período acumulado</small><strong>{parsed.report.start} a {parsed.report.end}</strong></span>
        <span><small>Dias</small><strong>{parsed.days}</strong></span>
        <span><small>Linhas</small><strong>{parsed.rows.length}</strong></span>
        <span><small>Com ID de produto</small><strong>{linked}</strong></span>
        <span><small>Sem ID de produto</small><strong>{parsed.rows.length-linked}</strong></span>
      </div>
      {parsed.report.kind==='TARGETING'&&!parsed.hasExplicitKeywords&&
        <p className="shopee-ads-warning">Este arquivo não lista termos de busca individuais. O campo de seleção automática não comprova quais palavras-chave geraram resultados.</p>}
      <p className="shopee-ads-warning">Dados acumulados: não serão repartidos artificialmente em 7, 30, 60 ou 90 dias. 
        Relatórios gerais e de segmentação podem conter os mesmos resultados e nunca são somados.</p>
      <div className="shopee-ads-preview-scroll"><table><thead><tr>
        <th>Anúncio / campanha</th><th>ID do produto</th><th>Impressões</th><th>Cliques</th><th>Conversões</th><th>Despesas</th>
      </tr></thead><tbody>{parsed.rows.slice(0,20).map((r,i)=><tr key={i}>
        <td>{r.name}</td><td>{r.product_id||'Grupo · sem ID'}</td>
        <td>{num(r.impressions)}</td><td>{num(r.clicks)}</td><td>{num(r.conversions)}</td>
        <td>{r.spend==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(r.spend)}</td>
      </tr>)}</tbody></table></div>
      <button type="button" disabled={busy} onClick={save}>{busy?'Importando…':'Importar dados de publicidade'}</button>
      {saved&&<p className="shopee-ads-success" role="status">
        {saved.created?'Relatório salvo.':'Este arquivo já estava importado; nenhuma duplicação realizada.'}
        {' '}{num(saved.linked_products)} produto(s) vinculados, {num(saved.non_product_or_unlinked)} linha(s) sem anúncio exclusivo.
      </p>}
    </div>}
  </section>;
}
