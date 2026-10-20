import React,{useEffect,useState} from 'react';
import {commerceApi} from './commerce-admin-api.js';
import './commerce-shopee-aftercare.css';

const num=x=>new Intl.NumberFormat('pt-BR').format(Number(x||0));
const money=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(x||0));
const date=x=>x?new Date(x).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'—';
export default function CommerceShopeeAftercare({listingId}){
  const [result,setResult]=useState(null),[error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const ctrl=new AbortController();
    setLoading(true);setError('');setResult(null);
    commerceApi('/api/admin/commerce/listings/manager/'+listingId+'/aftercare',
      {signal:ctrl.signal,cache:'no-store'})
      .then(x=>{if(!ctrl.signal.aborted)setResult(x);})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e.message||'Falha ao carregar pós-venda.');})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[listingId]);
  if(loading)return <p className="nim-detail-hint" role="status">Consultando devoluções e reembolsos…</p>;
  if(error)return <p className="nim-detail-hint" role="alert">{error}</p>;
  const counts=result?.counts||{},items=Array.isArray(result?.items)?result.items:[];
  const any=(Number(counts.requests)||0)>0;
  return <section className="shopee-aftercare-detail" aria-label="Devoluções e reembolsos Shopee">
    <header><h4>Devoluções e reembolsos</h4>
      <small>{result?.coverage?.start?date(result.coverage.start)+' a '+date(result.coverage.end):'Sem relatório vinculado'}</small>
    </header>
    {any?<><div className="shopee-aftercare-facts">
      <span><small>Solicitações identificadas</small><b>{num(counts.requests)}</b></span>
      <span><small>Aprovadas</small><b>{num(counts.approved)}</b></span>
      <span><small>Retiradas pelo comprador</small><b>{num(counts.withdrawn)}</b></span>
      <span><small>Devolução concluída no rastreio</small><b>{num(counts.returned_to_carrier)}</b></span>
      <span><small>Outros status</small><b>{num(counts.other)}</b></span>
      <span><small>Valores aprovados atribuíveis</small><b>{money(counts.approved_requested_value)}</b></span>
    </div>
      <p className="aftercare-disclaimer">As solicitações são consolidadas por ID de devolução. O valor aprovado não comprova que o estorno foi pago. Pedidos de devolução retirados não são vendas canceladas.</p>
      {Number(counts.mixed_or_unlinked)>0&&<p className="aftercare-disclaimer">{num(counts.mixed_or_unlinked)} solicitação(ões) contêm itens sem vínculo exclusivo com este anúncio: valores compartilhados não foram atribuídos artificialmente.</p>}
      <h4>Solicitações recentes</h4>
      <div className="aftercare-table"><table><thead><tr><th>Solicitação</th><th>Status</th><th>Motivo</th><th>Valor</th></tr></thead><tbody>
        {items.map(x=><tr key={x.return_id}>
          <td><strong>{x.return_id}</strong><small>{date(x.requested_at)}</small></td>
          <td>{x.status}</td><td>{x.reason||'Não informado'}</td>
          <td>{x.amount_attribution&&x.refund_requested!=null?money(x.refund_requested):'—'}</td>
        </tr>)}
      </tbody></table></div>
      <p className="aftercare-disclaimer">Exibidas até 40 solicitações mais recentes. Cobertura restrita às planilhas importadas; ausência de registros não demonstra ausência de ocorrências.</p>
    </>:<p className="aftercare-disclaimer">Nenhuma devolução/reembolso foi vinculada a este anúncio nas planilhas importadas. Não representa zero de ocorrências. Importe o relatório oficial na Central de Importações → Pós-venda Shopee.</p>}
  </section>;
}
