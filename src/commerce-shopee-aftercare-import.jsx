import React,{useState} from 'react';
import {readShopeeAftercareFile} from './commerce-shopee-aftercare-reader.js';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-aftercare.css';

const num=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const fmt=s=>String(s||'').split('-').reverse().join('/');
export default function CommerceShopeeAftercareImport(){
  const [file,setFile]=useState(null),[result,setResult]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState(null);
  async function choose(event){
    const selected=event.target.files?.[0]||null;event.target.value='';
    setFile(selected);setResult(null);setError('');setSaved(null);
    if(!selected)return;
    setLoading(true);
    try{setResult(await readShopeeAftercareFile(selected));}
    catch(err){setError(err.message||'Arquivo inválido.');}
    finally{setLoading(false);}
  }
  async function save(){
    if(!result||loading)return;
    setLoading(true);setError('');setSaved(null);
    try{
      const x=await commerceApi('/api/admin/commerce/shopee/aftercare/reports',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({report:result.report,requests:result.requests})
      });setSaved(x);
    }catch(e){setError(e.message||'Falha ao importar pós-venda.');}
    finally{setLoading(false);}
  }
  return <section className="shopee-aftercare-import" aria-label="Importação de pós-venda Shopee">
    <h3>Devoluções e reembolsos · Shopee</h3>
    <p>Relatório oficial Order.return_refund.xls ou .xlsx. Dados separados das vendas, sem substituir pedidos já importados.</p>
    <label>Selecionar relatório de devoluções/reembolsos
      <input type="file" accept=".xls,.xlsx" onChange={choose} disabled={loading}/>
      <small>{file?.name||'Exportado da Central do Vendedor Shopee'}</small>
    </label>
    {loading&&<p role="status">Conferindo dados da Shopee…</p>}
    {error&&<p role="alert" className="aftercare-error">{error}</p>}
    {result&&<div className="shopee-aftercare-preview">
      <strong>Prévia para conferência</strong>
      <div className="shopee-aftercare-facts">
        <span><small>Período do arquivo</small><b>{fmt(result.report.start)} a {fmt(result.report.end)}</b></span>
        <span><small>Solicitações únicas</small><b>{num(result.requests.length)}</b></span>
        <span><small>Linhas de produtos</small><b>{num(result.rowCount)}</b></span>
        <span><small>Aprovadas</small><b>{num(result.statuses.approved)}</b></span>
        <span><small>Solicitações retiradas</small><b>{num(result.statuses.withdrawn)}</b></span>
        <span><small>Devolução concluída no rastreio</small><b>{num(result.statuses.returnsDelivered)}</b></span>
      </div>
      <p>Os valores de reembolso são armazenados uma única vez por ID de devolução, mesmo quando a solicitação contém vários SKUs. Aprovação não comprova estorno pago.</p>
      <p>{result.privacy} Pedidos cancelados não são confundidos com solicitações de devolução canceladas.</p>
      <button type="button" disabled={loading} onClick={save}>
        {loading?'Importando…':'Importar pós-venda Shopee'}
      </button>
      {saved&&<p role="status" className="aftercare-success">
        {saved.created?'Importação concluída.':'Arquivo já registrado, nenhuma duplicação criada.'}
        {' '}{num(saved.requests)} solicitações; {num(saved.linked_items)} itens vinculados a anúncios por SKU único e {num(saved.unlinked_items)} sem vínculo confirmado.
      </p>}
    </div>}
  </section>;
}
