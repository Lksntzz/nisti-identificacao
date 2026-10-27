import React,{useState} from 'react';
import CommerceShopeePerformanceImport from './commerce-shopee-performance-import.jsx';
import CommerceMlPerformanceImport from './commerce-ml-performance-import.jsx';
import './commerce-shopee-ads-import.css';

// Tela unica de "Desempenho": primeiro escolhe a plataforma (e a conta, no Mercado Livre), depois envia o relatorio.
// Nada e assumido: enquanto a plataforma nao for escolhida, o envio do arquivo nao aparece.
const PLATFORMS=[
  {value:'SHOPEE',label:'Shopee',hint:'Arquivo parentskudetail.AAAAMMDD_AAAAMMDD.xlsx'},
  {value:'ML_NOVO',label:'Mercado Livre — Conta Nova',hint:'Relatório de desempenho das publicações'},
  {value:'ML_ANTIGO',label:'Mercado Livre — Conta Antiga',hint:'Relatório de desempenho das publicações'}
];
export default function CommercePerformanceImport(){
  const [platform,setPlatform]=useState('');
  const current=PLATFORMS.find(p=>p.value===platform);
  return <section className="shopee-ads-import" aria-label="Importação de desempenho dos anúncios">
    <fieldset className="ml-perf-account">
      <legend>1. De qual plataforma é o relatório?</legend>
      {PLATFORMS.map(p=><label key={p.value} style={{display:'block'}}>
        <input type="radio" name="performance-platform" checked={platform===p.value} onChange={()=>setPlatform(p.value)}/> {p.label}
      </label>)}
      {current&&<small>{current.hint}</small>}
    </fieldset>
    {!platform&&<p>Escolha a plataforma para liberar o envio do arquivo.</p>}
    {platform==='SHOPEE'&&<CommerceShopeePerformanceImport key="shopee"/>}
    {platform==='ML_NOVO'&&<CommerceMlPerformanceImport key="ml-novo" account="NOVO"/>}
    {platform==='ML_ANTIGO'&&<CommerceMlPerformanceImport key="ml-antigo" account="ANTIGO"/>}
  </section>;
}
