import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import './commerce-import-history.css';

const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)'],['ML_NOVO','Mercado Livre (Novo)']];
const PLATFORM_LABEL={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const STATUS_LABEL={COMMITTED:['Aplicada','ok'],STAGED:['Pendente · não aplicada','warn']};
const SOURCE_NOTE={
  FILENAME:'Período lido do nome do arquivo.',
  SUMMARY:'Período do resumo gravado na importação.',
  DAILY:'Período das vendas diárias gravadas por esta importação.'
};

export const fmtDate=v=>{
  if(!v)return '—';
  const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?m[3]+'/'+m[2]+'/'+m[1]:'—';
};
const fmtDateTime=v=>{
  if(!v)return '—';
  const d=new Date(v);
  return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
};
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const fileLabel=name=>{
  const text=String(name||'');
  return /^[A-Z0-9_]+$/.test(text)?text.replace(/_/g,' ').toLowerCase():text;
};
const part=name=>{const m=String(name||'').match(/part_(\d+)_of_(\d+)/);return m?'parte '+m[1]+' de '+m[2]:'';};

export default function CommerceImportHistory(){
  const [platform,setPlatform]=useState('TODAS');
  const [offset,setOffset]=useState(0);
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const limit=20;
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    fetchCommercialManager('/api/admin/commerce/sales/import-history?platform='+platform+'&limit='+limit+'&offset='+offset,{signal:controller.signal})
      .then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Não foi possível carregar o histórico.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[platform,offset]);
  const items=data?.items||[];
  const coverage=(data?.coverage||[]).filter(c=>platform==='TODAS'||c.platform_code===platform);
  const total=Number(data?.total||0);
  const pages=Math.max(1,Math.ceil(total/limit));
  return <section className="nih-root" aria-label="Histórico de importações de vendas">
    <div className="nih-coverage">
      {coverage.map(c=>{const gaps=Number(c.days_without_sales)>0;return <article key={c.platform_code} className="nih-cover-card">
        <header><h4>{PLATFORM_LABEL[c.platform_code]||c.platform_code}</h4>
          <span className={'nih-cover-status '+(gaps?'is-warn':'is-ok')}>
            {gaps?num(c.days_without_sales)+' dia(s) sem venda':'Sem dias faltando'}</span></header>
        <p className="nih-cover-range">{fmtDate(c.first_day)} <span>até</span> {fmtDate(c.last_day)}</p>
        <dl><div><dt>Unidades</dt><dd>{num(c.units)}</dd></div><div><dt>Faturamento</dt><dd>{money(c.revenue)}</dd></div></dl>
      </article>;})}
    </div>
    <div className="nih-toolbar">
      <label><span>Plataforma</span><select value={platform} onChange={e=>{setOffset(0);setPlatform(e.target.value);}}>
        {PLATFORMS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <small>{loading?'Consultando…':num(total)+' importações'}</small>
    </div>
    {error&&<p className="nih-error" role="alert">{error}</p>}
    <div className="nih-card"><div className="nih-scroll"><table className="nih-table"><thead><tr>
      <th>Plataforma</th><th>Arquivo</th><th>Período do relatório</th><th>Situação</th>
      <th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Faturamento</th>
      <th className="num">Anúncios c/ venda</th><th>Importado em</th></tr></thead><tbody>
      {items.map(i=>{const st=STATUS_LABEL[i.status]||[i.status,'muted'];return <tr key={i.batch_id}>
        <td data-label="Plataforma" className="nih-platform">{PLATFORM_LABEL[i.platform_code]||i.platform_code}</td>
        <td data-label="Arquivo" className="nih-file" title={i.source_filename}><strong>{fileLabel(i.source_filename)}</strong>
          <small>Lote {i.batch_id}{part(i.source_filename)?' · '+part(i.source_filename):''}</small></td>
        <td data-label="Período" className="nih-period" title={SOURCE_NOTE[i.period_source]||'Período não identificado.'}>
          {i.period_start?fmtDate(i.period_start)+' – '+fmtDate(i.period_end):'—'}</td>
        <td data-label="Situação"><span className={'nih-badge tone-'+st[1]}>{st[0]}</span></td>
        <td data-label="Pedidos" className="num">{num(i.orders)}</td>
        <td data-label="Unidades" className="num">{num(i.units)}</td>
        <td data-label="Faturamento" className="num">{money(i.revenue)}</td>
        <td data-label="Anúncios" className="num">{num(i.listings)}</td>
        <td data-label="Importado" title={i.created_by||''}>{fmtDateTime(i.committed_at||i.created_at)}</td>
      </tr>;})}
      {!loading&&!error&&items.length===0&&<tr><td colSpan={9} className="nih-empty">Nenhuma importação encontrada.</td></tr>}
      {loading&&<tr><td colSpan={9} className="nih-empty">Carregando…</td></tr>}
    </tbody></table></div></div>
    <footer className="nih-footer">
      <span>Página {Math.floor(offset/limit)+1} de {pages}</span>
      <div><button type="button" disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-limit))}>Anterior</button>
        <button type="button" disabled={loading||offset+limit>=total} onClick={()=>setOffset(v=>v+limit)}>Próxima</button></div>
    </footer>
    <p className="nih-note">Pedidos e anúncios com venda não existem em importações antigas gravadas só por vendas diárias (mostram “—”).
      “Pendente” é um arquivo lido mas ainda não aplicado; não entra nos números do sistema. Importações repetidas do mesmo arquivo aparecem como linhas separadas.</p>
  </section>;
}
