import React, {useEffect,useState} from 'react';
import ProductCutoutImage from './product-cutout-image.jsx';
import './commerce-sales-velocity.css';

const METRICS=[
  {code:'SOLD',key:'sold',label:'Com vendas',desc:'Produtos com pelo menos uma unidade vendida',icon:'↗'},
  {code:'ZERO',key:'zero',label:'Sem vendas',desc:'Produtos sem unidades vendidas no período',icon:'○'},
  {code:'LOW',key:'low',label:'Poucas vendas',desc:'Vendas abaixo da média dos produtos vendidos',icon:'↘'},
  {code:'RISING',key:'rising',label:'Em crescimento',desc:'Aumento de 20% ou mais, com 3+ unidades',icon:'↑'}
];
const count=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));

export default function CommerceSalesVelocity({platform='TODAS',days=30,month='',refresh=0}) {
  const [activeStatus,setActiveStatus]=useState('SOLD');
  const [offset,setOffset]=useState(0);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const statusMap={
    NO_IMPORT:'Sem importação de vendas.',
    DAILY_DATA_REQUIRED:'Sem cobertura diária suficiente neste período e plataforma.',
    GROWTH_HISTORY_REQUIRED:'Faltam dados do período anterior para medir crescimento.',
    PARTIAL_PLATFORMS:'Resultados apenas das plataformas com dados diários completos.',
    READY:''
  };

  useEffect(()=>{setOffset(0);},[days,month,platform,activeStatus]);

  useEffect(()=>{
    let cancelled=false;
    const params=new URLSearchParams({
      days:String(days),platform,status:activeStatus,limit:'15',offset:String(offset)
    });
    if(month)params.set('month',month);
    setLoading(true);setError('');
    fetch('/api/admin/commerce/sales/velocity?'+params,{credentials:'same-origin',cache:'no-store'})
      .then(async response=>{
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.error||'Não foi possível carregar o desempenho.');
        return body;
      }).then(result=>{if(!cancelled)setData(result);})
      .catch(e=>{if(!cancelled){setError(e.message||'Falha ao carregar desempenho.');setData(null);}})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[days,month,platform,activeStatus,offset,refresh]);

  const ready=Boolean(data?.current_ready);
  const prevReady=Boolean(data?.previous_ready);
  const metrics=data?.metrics||{};
  const rows=Array.isArray(data?.items)?data.items:[];
  const total=Number(data?.total||0);
  const pages=Math.max(1,Math.ceil(total/15));
  const page=Math.floor(offset/15)+1;
  const caveat=data?.status&&data.status!=='READY'?statusMap[data.status]||'Dados insuficientes.':'';

  return <section className="nisti-vl-section nisti-com-section">
    <header className="nisti-vl-head">
      <div>
        <h3>Desempenho dos produtos</h3>

      </div>
      <small className="nisti-vl-shared-filter">{days} dias · período do filtro geral</small>
    </header>
    <div className="nisti-vl-metrics">
      {METRICS.map(metric=>{
        const value=metrics[metric.key];
        const isAvailable=metric.code==='RISING'?ready&&prevReady:ready;
        return <button key={metric.code} type="button"
          className={'nisti-vl-metric metric-'+metric.key+(activeStatus===metric.code?' selected':'')}
          onClick={()=>setActiveStatus(metric.code)}
          aria-pressed={activeStatus===metric.code}
          aria-label={metric.label+': '+(isAvailable&&value!=null?count(value):'aguardando dados')}>
          <div className="nisti-vl-metric-top"><strong>{metric.label}</strong><span aria-hidden="true">{metric.icon}</span></div>
          <div className="nisti-vl-metric-count">{isAvailable&&value!=null?count(value):'—'}</div>
  
        </button>;
      })}
    </div>

    {caveat&&<div className="nisti-vl-caveat" role="status">
      <strong>{data?.status==='NO_IMPORT'?'Sem dados de vendas':'Cobertura de dados insuficiente'}</strong>
      <span>{caveat}</span>

    </div>}
    {false&&ready&&<p className="nisti-vl-criteria">
      Produtos com poucas vendas: unidades positivas abaixo da média do período.
      Em crescimento: pelo menos 3 unidades e aumento de 20% ou mais contra os {days} dias anteriores;
      de zero para 3+ unidades também conta como crescimento.
      Os números pertencem ao produto/SKU, não a cada ID de anúncio.
    </p>}
    {data?.catalog_unidentified>0&&<p className="nisti-vl-unknown">
      {count(data.catalog_unidentified)} grupos de anúncios sem SKU identificável não entram nos indicadores até serem relacionados corretamente.
    </p>}

    <div className="nisti-vl-list-heading">
      <strong>{METRICS.find(m=>m.code===activeStatus)?.label} — produtos e anúncios</strong>
      {ready&&<span>{count(total)} produtos identificados</span>}
    </div>
    {error&&<p role="alert" className="nisti-vl-error">{error}</p>}
    {loading&&<div className="nisti-vl-empty">Consultando desempenho e anúncios…</div>}
    {!loading&&!error&&!ready&&<div className="nisti-vl-empty">
      Sem vendas diárias suficientes para este filtro.
    </div>}
    {!loading&&!error&&ready&&activeStatus==='RISING'&&!prevReady&&
      <div className="nisti-vl-empty">O crescimento exige dados completos dos {days} dias anteriores.</div>}
    {!loading&&!error&&ready&&!(activeStatus==='RISING'&&!prevReady)&&rows.length===0&&
      <div className="nisti-vl-empty">Nenhum produto nesta classificação para o período escolhido.</div>}
    {!loading&&!error&&ready&&!(activeStatus==='RISING'&&!prevReady)&&rows.length>0&&
      <div className="nisti-vl-list">
        {rows.map(item=>{
          const ads=Array.isArray(item.ads)?item.ads:[];
          return <article className="nisti-vl-product" key={item.sku}>
            <div className="nisti-vl-product-head">
              <ProductCutoutImage src={item.image_url} alt={item.name||item.sku}
                className="nisti-vl-image"
                fallback={<span className="nisti-vl-image missing">Sem foto</span>}/>
              <div className="nisti-vl-product-info">
                <strong>{item.name||item.sku}</strong><code>{item.sku}</code>
                <small>{ads.length} {ads.length===1?'anúncio relacionado':'anúncios relacionados'}</small>
              </div>
              <div className="nisti-vl-product-kpis">
                <div><span>Unidades</span><strong>{count(item.units)}</strong></div>
                <div><span>Faturamento</span><strong>{money(item.revenue)}</strong></div>
                {prevReady&&<div><span>Anterior</span><strong>{count(item.previous_units)} un.</strong></div>}
                {prevReady&&item.growth_percent!=null&&
                  <div className={Number(item.growth_percent)>=20?'growing':''}>
                    <span>Variação</span><strong>{Number(item.growth_percent)>0?'+':''}{item.growth_percent}%</strong>
                  </div>}
                {prevReady&&item.previous_units===0&&item.units>=3&&
                  <span className="nisti-vl-new">Novas vendas</span>}
              </div>
            </div>
            {ads.length>0&&<div className="nisti-vl-ads">
              {ads.map(ad=><a key={ad.listing_id} href={ad.url||undefined}
                target="_blank" rel="noopener noreferrer"
                title={'Abrir anúncio '+ad.external_listing_id}
                aria-disabled={!ad.url}
                onClick={ad.url?undefined:e=>e.preventDefault()}>
                {ad.external_listing_id||'ID não informado'}
                {ad.url&&<span aria-hidden="true">↗</span>}
              </a>)}
            </div>}
            {activeStatus==='RISING'&&<p className="nisti-vl-warning">
              Crescimento confirmado para o SKU. Sem atribuição individual de vendas aos anúncios sem dados próprios.
            </p>}
          </article>;
        })}
      </div>}
    {ready&&total>15&&<div className="nisti-vl-pagination">
      <span>Página {page} de {pages}</span>
      <div>
        <button type="button" disabled={loading||offset===0}
          onClick={()=>setOffset(v=>Math.max(0,v-15))}>Anterior</button>
        <button type="button" disabled={loading||offset+15>=total}
          onClick={()=>setOffset(v=>v+15)}>Próxima</button>
      </div>
    </div>}
  </section>;
}
