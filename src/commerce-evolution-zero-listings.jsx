import React from 'react';
import CommercialIcon from './vendor/CommercialIcon.jsx';

const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const platformName=s=>s==='SHOPEE'?'Shopee':s==='ML_NOVO'?'Mercado Livre Novo':
  s==='ML_ANTIGO'?'Mercado Livre Antigo':s==='AMAZON'?'Amazon':s==='TIKTOK'?'TikTok Shop':s||'Plataforma';

export default function CommerceEvolutionZeroListings({items=[],periodStart,periodEnd}){
  return <div className="nim-evolution-zero-listings" aria-label="Anúncios inteiros sem vendas confirmadas">
    <div className="nim-evolution-zero-columns" aria-hidden="true">
      <span>Nome do anúncio</span><span>Plataforma</span><span>ID do anúncio</span>
      <span>Vendas no período</span><span>Variações</span>
    </div>
    {items.map(item=><article key={item.id} className="nim-evolution-zero-listing">
      <div className="nim-evolution-zero-title">
        <CommercialIcon name="package" size={19}/>
        <div>
          <strong>{item.title||'Anúncio sem título'}</strong>
          <small>Conferido no intervalo {periodStart} a {periodEnd}</small>
        </div>
      </div>
      <span className="nim-evolution-zero-platform">{platformName(item.source)}</span>
      <div className="nim-evolution-zero-id">
        <strong>{item.external_listing_id}</strong>
        {item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer">
          Abrir anúncio <span aria-hidden="true">↗</span>
        </a>}
      </div>
      <strong className="nim-evolution-zero-units">
        <CommercialIcon name="package" size={16}/> 0 un.
      </strong>
      <span className="nim-evolution-zero-variations">
        {number(item.total_variations)} cadastrada(s)
      </span>
    </article>)}
  </div>;
}
