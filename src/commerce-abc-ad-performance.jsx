import React, {useEffect,useState} from 'react';
import ProductCutoutImage from './product-cutout-image.jsx';
import './commerce-abc-ad-performance.css';

const BR_NUMBER=new Intl.NumberFormat('pt-BR');
const BR_MONEY=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmtNumber=value=>BR_NUMBER.format(Number(value)||0);
const fmtMoney=value=>BR_MONEY.format(Number(value)||0);
const PAGE_SIZE=15;
const CLASS_NAMES={A:'Maior impacto',B:'Desempenho intermediário',C:'Menor impacto'};

async function loadCurveAds({curve,platform,basis,periodStart,periodEnd,offset}) {
  const params=new URLSearchParams({
    curve,platform,basis,limit:String(PAGE_SIZE),offset:String(offset)
  });
  if(periodStart)params.set('period_start',periodStart);
  if(periodEnd)params.set('period_end',periodEnd);
  const response=await fetch('/api/admin/commerce/sales/abc/advertisements?'+params,{
    credentials:'same-origin',cache:'no-store'
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível consultar os anúncios da curva.');
  return data;
}

function AdRecord({item}) {
  const variations=Array.isArray(item.variations)?item.variations:[];
  const hasImportedUnits=item.imported_units!==null&&item.imported_units!==undefined;
  const hasManualUnits=item.manual_units!==null&&item.manual_units!==undefined;
  return <div className="nisti-abc-ad-entry">
    <div className="nisti-abc-ad-entry-main">
      <div className="nisti-abc-ad-id">
        {item.url
          ? <a href={item.url} target="_blank" rel="noopener noreferrer"
              title={'Abrir anúncio '+item.id}>{item.id} <span aria-hidden="true">↗</span></a>
          : <strong>{item.id||'ID não informado'}</strong>}
        <span className="nisti-abc-ad-platform">{item.marketplace_name||item.marketplace_code}{item.account_code?' · '+item.account_code:''}</span>
      </div>
      {item.title&&<span className="nisti-abc-ad-title">{item.title}</span>}
      {variations.length>0&&<div className="nisti-abc-ad-variations">
        {variations.map(v=><span key={v.id||v.name}>{v.name||'Variação'}{v.id?' · '+v.id:''}</span>)}
      </div>}
    </div>
    <div className="nisti-abc-ad-individual">
      {hasImportedUnits
        ? <><strong>{fmtNumber(item.imported_units)} un. · {fmtMoney(item.imported_revenue)}</strong><small>Vendas importadas por ID de anúncio</small></>
        : <small>Venda importada por anúncio não disponível</small>}
      {hasManualUnits&&<small>{fmtNumber(item.manual_units)} un. · registro manual separado</small>}
    </div>
  </div>;
}

export default function CommerceAbcAdPerformance({
  curve,platform='TODAS',basis='REVENUE',
  periodStart='',periodEnd='',refresh=0,onShowInCatalog
}) {
  const [offset,setOffset]=useState(0);
  const [payload,setPayload]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{setOffset(0);},[curve,platform,basis,periodStart,periodEnd]);

  useEffect(()=>{
    let ignore=false;
    setLoading(true);setError('');
    loadCurveAds({curve,platform,basis,periodStart,periodEnd,offset})
      .then(data=>{if(!ignore)setPayload(data);})
      .catch(err=>{if(!ignore){setPayload(null);setError(err.message||'Erro ao carregar anúncios.');}})
      .finally(()=>{if(!ignore)setLoading(false);});
    return()=>{ignore=true;};
  },[curve,platform,basis,periodStart,periodEnd,offset,refresh]);

  const rows=Array.isArray(payload?.items)?payload.items:[];
  const total=Number(payload?.total)||0;
  const page=Math.floor(offset/PAGE_SIZE)+1;
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));

  return <section className={'nisti-abc-ad-panel class-'+String(curve).toLowerCase()} aria-live="polite">
    <div className="nisti-abc-ad-panel-intro">
      <span className="nisti-abc-ad-panel-class">{curve}</span>
      <div>
        <h4>Anúncios da Curva {curve}</h4>
        <p>{CLASS_NAMES[curve]} · classificados por {basis==='UNITS'?'unidades vendidas':'faturamento'}</p>
      </div>
      {payload?.has_sales&&<span className="nisti-abc-ad-total">{fmtNumber(total)} SKUs</span>}
    </div>

    <div className="nisti-abc-ad-explanation">
      <strong>Como ler o desempenho:</strong> unidades e faturamento importados pertencem ao <b>SKU</b>.
      Cada anúncio é listado com seu ID real. Vendas individuais aparecem apenas quando registradas especificamente por anúncio.
      Registros manuais não são somados ao faturamento importado.
    </div>

    {error&&<p role="alert" className="nisti-abc-ad-error">{error}</p>}
    {loading&&<div className="nisti-abc-ad-loading">Consultando produtos, anúncios e resultados…</div>}
    {!loading&&!error&&rows.length===0&&<div className="nisti-abc-ad-empty">
      {payload?.has_sales===false
        ? 'Ainda não há vendas importadas para classificar anúncios nesta curva. Utilize a Central de Importações.'
        : 'Nenhum SKU pertence a esta curva nos filtros selecionados.'}
    </div>}
    {!loading&&!error&&rows.length>0&&<div className="nisti-abc-ad-products">
      {rows.map((product,i)=>{
        const ads=Array.isArray(product.advertisements)?product.advertisements:[];
        return <article className="nisti-abc-ad-product" key={product.sku_norm}>
          <div className="nisti-abc-ad-product-main">
            <span className="nisti-abc-ad-product-index">{offset+i+1}</span>
            <ProductCutoutImage src={product.image_url}
              alt={product.product_name||product.sku_norm}
              className="nisti-abc-ad-thumb"
              fallback={<span className="nisti-abc-ad-thumb missing">Sem foto</span>}/>
            <div className="nisti-abc-ad-product-info">
              <strong>{product.product_name||product.sku_norm}</strong>
              <code>{product.sku_norm}</code>
              <small>{ads.length} {ads.length===1?'anúncio ativo relacionado':'anúncios ativos relacionados'}</small>
            </div>
            <div className="nisti-abc-ad-product-kpis">
              <div><span>Unidades vendidas · SKU</span><strong>{fmtNumber(product.units)}</strong></div>
              <div><span>Faturamento · SKU</span><strong>{fmtMoney(product.revenue)}</strong></div>
            </div>
          </div>
          {ads.length
            ? <div className="nisti-abc-ad-list">{ads.map(item=><AdRecord key={item.id} item={item}/>)}</div>
            : <div className="nisti-abc-ad-missing">Este SKU tem vendas registradas, mas nenhum anúncio ativo correspondente foi localizado no Catálogo.</div>}
          <div className="nisti-abc-ad-product-footer">
            <button type="button" onClick={()=>onShowInCatalog(product.sku_norm)}>Localizar SKU no Catálogo <span aria-hidden="true">↗</span></button>
          </div>
        </article>;
      })}
    </div>}

    {!loading&&!error&&total>PAGE_SIZE&&<div className="nisti-abc-ad-pagination">
      <span>Página {page} de {pages} · {fmtNumber(total)} SKUs classificados</span>
      <div>
        <button type="button" onClick={()=>setOffset(v=>Math.max(0,v-PAGE_SIZE))} disabled={offset===0}>Anterior</button>
        <button type="button" onClick={()=>setOffset(v=>v+PAGE_SIZE)} disabled={offset+PAGE_SIZE>=total}>Próxima</button>
      </div>
    </div>}
  </section>;
}
