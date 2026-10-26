import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {usePriceSignals,PriceSignalCell} from './commerce-price-signal.jsx';
import './commerce-dashboard.css';

const PLATFORMS=[['TODAS','Todas as plataformas'],['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)']];
const PLATFORM_LABEL={SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'};
const PERIODS=[7,30,60,90];
const CLASS_NOTE={A:'Até 80% do faturamento',B:'Dos 80% aos 95%',C:'Últimos 5%'};

const SOURCES={
  abc:'Vendas importadas (tabela de vendas diárias por anúncio, o mesmo dado do Histórico de importações). Soma o faturamento do período por SKU, ordena do maior para o menor e classifica: A = produtos que somam até 80% do faturamento, B = dos 80% aos 95%, C = o restante. Anúncios sem SKU vinculado entram sozinhos. Faturamento = valor dos produtos, sem frete.',
  drops:'Vendas importadas: compara os últimos N dias com os N dias imediatamente anteriores, por anúncio ATIVO. Entra quem tinha 5 ou mais unidades no período anterior e caiu 15% ou mais. A coluna “Preço × vendas” compara o preço médio realizado. A linha de causa vem dos relatórios de desempenho Shopee importados (impressões, cliques, conversão); sem esse relatório aparece só o preço. São sinais, não prova de causa.',
  top:'Vendas importadas: os 15 anúncios com maior faturamento no período, com a variação de unidades contra o período anterior de mesmo tamanho. Título e situação vêm do cadastro de anúncios do sistema.',
  kpi:'Vendas importadas no período escolhido, contra o período anterior de mesmo tamanho. O período termina no último dia com venda importada, não em hoje.',
  help:'Lista de dados que o sistema ainda não recebe e que ajudariam a explicar quedas.'
};
const HELP=[
  ['Relatório de desempenho do Mercado Livre','visitas e conversão por anúncio; hoje só a Shopee tem esse dado, então a causa das quedas do ML não aparece.'],
  ['Shopee: relatórios de desempenho de cada mês','quanto mais períodos importados, mais anúncios ganham a linha de causa (impressões, cliques, conversão).'],
  ['Gasto e retorno de anúncios pagos (Shopee Ads e Mercado Livre Publicidade)','muita queda é só verba reduzida ou campanha pausada.'],
  ['Estoque e dias sem disponibilidade','anúncio pausado ou sem estoque parece queda de demanda.'],
  ['Datas de mudanças no anúncio (título, fotos, preço, variações)','permite ligar a queda ao dia da alteração.'],
  ['Preço de concorrentes e posição na busca','mostra se perdeu espaço para outro vendedor.'],
  ['Notas e avaliações, reclamações, cancelamentos e devoluções','reputação baixa reduz a exibição.'],
  ['Calendário de promoções e campanhas (ex.: dias 10.10, 11.11)','explica picos e quedas de calendário.'],
  ['Custo do produto','permite mostrar margem e priorizar o que realmente dá lucro, não só o que vende.']
];

const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmtDay=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]:'—';};
const fmtDayFull=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:'—';};
const dayBefore=v=>{const d=new Date(String(v||'')+'T12:00:00Z');return Number.isNaN(d.getTime())?'':new Date(d.getTime()-86400000).toISOString().slice(0,10);};
export const changePct=(cur,prev)=>{
  const c=Number(cur),p=Number(prev);
  if(!Number.isFinite(c)||!Number.isFinite(p)||p<=0)return null;
  return Math.round((c-p)/p*1000)/10;
};
const pctText=v=>v==null?'novo':(v>0?'+':'')+String(v).replace('.',',')+'%';
const tone=v=>v==null?'neutral':v>=5?'good':v<=-5?'bad':'neutral';

export function InfoIcon({text,label}){
  return <span className="ndb-info" tabIndex={0} role="note" aria-label={'De onde vêm os dados: '+label}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>
    <span className="ndb-info-pop"><strong>De onde vêm os dados</strong>{text}</span>
  </span>;
}

function Card({title,source,children,aside}){
  return <section className="ndb-card"><header><h3>{title}</h3>{aside}<InfoIcon text={SOURCES[source]} label={title}/></header>{children}</section>;
}

function Delta({cur,prev}){
  const v=changePct(cur,prev);
  return <span className={'ndb-delta tone-'+tone(v)}>{pctText(v)}</span>;
}

export default function CommerceDashboard(){
  const [platform,setPlatform]=useState('TODAS');
  const [days,setDays]=useState(30);
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [cls,setCls]=useState('A');
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    fetchCommercialManager('/api/admin/commerce/sales-dashboard?platform='+platform+'&days='+days,{signal:controller.signal})
      .then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Não foi possível carregar o dashboard.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[platform,days]);
  const drops=data?.drops?.items||[];
  const top=data?.top||[];
  const signalRows=useMemo(()=>{
    const seen=new Map();
    [...drops,...top].forEach(r=>{if(r.listing_id)seen.set(r.listing_id,{id:r.listing_id});});
    return [...seen.values()];
  },[data]);
  const {signals,diagnosis}=usePriceSignals(signalRows,days);
  const totals=data?.totals||{};
  const classes=data?.abc?.classes||[];
  const items=(data?.abc?.items||[]).filter(i=>i.class===cls);
  const hasData=data&&data.last_day;
  return <section className="ndb-root" aria-label="Dashboard comercial">
    <div className="ndb-toolbar">
      <label><span>Plataforma</span><select value={platform} onChange={e=>setPlatform(e.target.value)}>
        {PLATFORMS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <div className="ndb-periods" role="group" aria-label="Período">
        {PERIODS.map(p=><button key={p} type="button" className={p===days?'is-active':''} aria-pressed={p===days} onClick={()=>setDays(p)}>{p} dias</button>)}
      </div>
      <small>{loading?'Consultando…':hasData?'Período '+fmtDayFull(data.current_start)+' a '+fmtDayFull(data.last_day)+' · comparado com '+fmtDayFull(data.previous_start)+' a '+fmtDayFull(dayBefore(data.current_start))+' · vendas importadas até '+fmtDayFull(data.last_day):''}</small>
    </div>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {hasData&&data.previous_complete===false&&<p className="ndb-warn">Não há vendas importadas para todo o período anterior; as variações podem estar incompletas.</p>}
    {hasData&&<div className="ndb-kpis">
      <article><span>Faturamento<InfoIcon text={SOURCES.kpi} label="Faturamento"/></span><strong>{money(totals.cur_rev)}</strong><small><Delta cur={totals.cur_rev} prev={totals.prev_rev}/> vs. período anterior ({money(totals.prev_rev)})</small></article>
      <article><span>Unidades<InfoIcon text={SOURCES.kpi} label="Unidades"/></span><strong>{num(totals.cur_units)}</strong><small><Delta cur={totals.cur_units} prev={totals.prev_units}/> vs. período anterior ({num(totals.prev_units)})</small></article>
      <article><span>Anúncios com venda<InfoIcon text={SOURCES.kpi} label="Anúncios com venda"/></span><strong>{num(totals.listings_selling)}</strong><small>no período selecionado</small></article>
    </div>}
    <div className="ndb-grid">
      <Card title="Curva ABC de produtos" source="abc">
        <div className="ndb-abc">{classes.map(c=><button type="button" key={c.class} className={'ndb-abc-box c-'+c.class+(c.class===cls?' is-active':'')} onClick={()=>setCls(c.class)} aria-pressed={c.class===cls}>
          <b>{c.class}</b><strong>{num(c.products)} produtos</strong><span>{String(c.revenue_pct).replace('.',',')}% do faturamento</span><small>{CLASS_NOTE[c.class]} · {money(c.revenue)}</small></button>)}</div>
        <div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Produto (SKU)</th><th className="num">Unid.</th><th className="num">Faturamento</th><th className="num">% acum.</th></tr></thead><tbody>
          {items.map(i=><tr key={i.key}><td title={i.title||''}><strong>{i.key}</strong><small>{i.title||'—'}</small></td><td className="num">{num(i.units)}</td><td className="num">{money(i.revenue)}</td><td className="num">{String(i.cum_pct).replace('.',',')}%</td></tr>)}
          {!loading&&items.length===0&&<tr><td colSpan={4} className="ndb-empty">Sem produtos nesta classe.</td></tr>}
        </tbody></table></div>
        <p className="ndb-note">Mostra até os 120 maiores produtos por faturamento.</p>
      </Card>
      <Card title="Anúncios em queda" source="drops">
        {hasData&&<p className="ndb-sum"><strong>{num(data.drops?.total)}</strong> anúncios ativos caíram 15% ou mais · <strong>{money(data.drops?.lost_revenue)}</strong> a menos de faturamento nesses anúncios. Abaixo, os 20 de maior perda.</p>}
        <div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>Anúncio</th><th className="num">Unid. antes → agora</th><th className="num">Faturamento perdido</th><th>Preço × vendas e causa</th></tr></thead><tbody>
          {drops.map(r=><tr key={r.platform+r.external_id}><td title={r.title||''}><strong>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform} · {r.external_id}</small></td>
            <td className="num">{num(r.units_previous)} → {num(r.units)} <Delta cur={r.units} prev={r.units_previous}/></td>
            <td className="num bad">{money(r.lost_revenue)}</td>
            <td><PriceSignalCell signal={signals[r.listing_id]} window={days} diagnosis={diagnosis[r.listing_id]}/></td></tr>)}
          {!loading&&drops.length===0&&<tr><td colSpan={4} className="ndb-empty">Nenhum anúncio ativo em queda neste período.</td></tr>}
        </tbody></table></div>
      </Card>
      <Card title="Top 15 anúncios por faturamento" source="top">
        <div className="ndb-scroll"><table className="ndb-table"><thead><tr><th>#</th><th>Anúncio</th><th className="num">Unidades</th><th className="num">Faturamento</th><th className="num">Preço médio</th><th className="num">Unid. vs. anterior</th></tr></thead><tbody>
          {top.map((r,i)=><tr key={r.platform+r.external_id}><td className="num">{i+1}</td>
            <td title={r.title||''}><strong>{r.title||r.external_id}</strong><small>{PLATFORM_LABEL[r.platform]||r.platform} · {r.external_id}{r.status&&r.status!=='ACTIVE'?' · inativo':''}</small></td>
            <td className="num">{num(r.units)}</td><td className="num">{money(r.revenue)}</td><td className="num">{money(r.price)}</td>
            <td className="num"><Delta cur={r.units} prev={r.units_previous}/></td></tr>)}
          {!loading&&top.length===0&&<tr><td colSpan={6} className="ndb-empty">Sem vendas no período.</td></tr>}
        </tbody></table></div>
      </Card>
      <Card title="Dados que ajudariam a explicar as quedas" source="help">
        <ul className="ndb-help">{HELP.map(([t,d])=><li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
      </Card>
    </div>
  </section>;
}
