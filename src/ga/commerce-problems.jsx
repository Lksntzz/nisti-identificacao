import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {Dropdown,InfoIcon,listingUrl} from './commerce-dashboard.jsx';
import {Card} from './commerce-why-stopped.jsx';
import {maskMoney} from './commerce-privacy.js';
import {causeOf} from './commerce-why-stopped-logic.js';
import {GROUPS,PROBLEM_PCT,PLATFORM_LABEL,headline,campaignWarning} from './commerce-problems-logic.js';
import './commerce-dashboard.css';
import './commerce-why-stopped.css';
import './commerce-problems.css';

const DAYS=[30,60,90];
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>maskMoney(v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}));
const dm=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?m[3]+'/'+m[2]:'—';};
const pct=(v,d=0)=>v==null?'—':(v>0?'+':'')+Number(v).toLocaleString('pt-BR',{maximumFractionDigits:d})+'%';
const DRIVER={IMPRESSIONS:'VISIBILIDADE',CTR:'CLIQUE',CONVERSION:'CONVERSAO'};
const TONE={PAROU:'bad',QUEDA:'bad',PIOR:'warn',NUNCA:'muted'};
const ICON={PAROU:'down',QUEDA:'money',PIOR:'cart',NUNCA:'eye'};
const FOOT={PAROU:'vendiam e estão sem venda há 90 dias',QUEDA:'ainda vendem, mas bem menos que antes',PIOR:'aparecem e quase ninguém compra',NUNCA:'sem venda desde jan/2025'};
const SRC='Só anúncios ATIVOS. Parou: já vendeu e não vendeu nada nos últimos 90 dias. Em queda: média por dia da janela 30% ou mais abaixo da média dos 3 meses completos anteriores (mínimo de 10 unidades nessa base). Pior performance (Shopee): 1.000 impressões, 100 visitantes e conversão abaixo da metade da média da loja, no relatório de desempenho mais recente. Nunca vendeu (Shopee): sem venda desde 01/01/2025 e visto em relatórios há mais de 90 dias; é sugestão para conferir, o GA não desativa nada. Cada anúncio fica em um só grupo, nessa ordem. O motivo (só Shopee) vem do relatório de desempenho: impressões = visibilidade, CTR = cliques, conversão = compra.';

function ProblemCard({r,diag,store}){
  const [open,setOpen]=useState(false);
  const g=r.group,url=listingUrl(r.platform,r.external_listing_id);
  const shopee=r.platform==='SHOPEE';
  const d=diag&&diag[String(r.listing_id)];
  const cause=causeOf(d&&d.driver&&DRIVER[d.driver]?DRIVER[d.driver]:'SEM_SINAL');
  const chips=d?[['Impressões',d.impressions_pct,'IMPRESSIONS'],['CTR',d.ctr_pct,'CTR'],['Conversão',d.conversion_pct,'CONVERSION']]:[];
  const big=g==='PAROU'?'parou':g==='QUEDA'?pct(-Number(r.drop_pct)):g==='PIOR'?pct(r.conv_pct,1).replace('+','')+' conv.':'sem venda';
  const sales=g==='PAROU'?num(Math.round(Number(r.units_base)))+' un. esperadas no período → 0'+(r.last_sale?' · última venda '+dm(r.last_sale):'')
    :g==='QUEDA'?num(Math.round(Number(r.units_base)))+' → '+num(r.units_cur)+' un.'
    :g==='PIOR'?num(r.impressions)+' impressões · '+num(r.visitors)+' visitantes · loja converte '+String(store).replace('.',',')+'%'
    :'sem venda desde jan/2025 · no relatório há '+num(r.age_days_min)+'+ dias';
  const why=g==='NUNCA'?'Candidato a desativar':g==='PIOR'?'Aparece, mas não converte'
    :shopee?cause.label:'Queda só nas vendas (sem relatório de desempenho do ML)';
  return <article className={'nwy-item tone-'+TONE[g]}>
    <header>
      <div className="nwy-item-title">
        <span className={'nwy-kind '+(g==='PAROU'?'is-stop':'is-fall')}>{GROUPS.find(x=>x[0]===g)[1].toUpperCase()}</span>
        {url?<a href={url} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a>:<b title={r.title}>{r.title}</b>}
      </div>
      <span className="nwy-drop">{big}</span>
    </header>
    <p className="nwy-sales">{sales}{Number(r.lost_revenue)>0&&<> · <b>{money(r.lost_revenue)}</b> a menos</>}</p>
    <div className="nwy-why"><span className="nwy-dot" aria-hidden="true"/><strong>{why}</strong>
      <span className="nwy-tag">{PLATFORM_LABEL[r.platform]}</span>
      {r.also_low_conv&&<span className="nwy-tag">também converte mal</span>}
      {d&&Number(d.price_pct)>=10&&<span className="nwy-tag is-price">Preço {pct(d.price_pct)}</span>}
      {d&&d.driver==='INSUFFICIENT'&&<span className="nwy-tag">pouco volume</span>}
    </div>
    {chips.length>0&&<ul className="nwy-chips" aria-label="Variação por etapa">
      {chips.map(([n,v,k])=><li key={k} className={(v!=null&&v<=-10?'is-bad':'')+(d.driver===k?' is-main':'')}><span>{n}</span><b>{pct(v)}</b></li>)}
    </ul>}
    <button type="button" className="nwy-more" onClick={()=>setOpen(o=>!o)} aria-expanded={open}>{open?'Esconder detalhes':'Ver detalhes e o que conferir'}</button>
    {open&&<div className="nwy-detail">
      {g==='NUNCA'&&<p>Nenhuma venda desde o início dos dados (jan/2025) e o anúncio já aparece em relatórios há mais de 90 dias. Confira na Shopee antes de desativar: o GA só sugere.</p>}
      {g==='PIOR'&&<p>{cause.check.length?'Confira: ':''}{causeOf('CONVERSAO').check.join(' · ')}</p>}
      {(g==='PAROU'||g==='QUEDA')&&shopee&&<p>{cause.why} <b>O que conferir:</b> {cause.check.join(' · ')}</p>}
      {(g==='PAROU'||g==='QUEDA')&&!shopee&&<p>O GA mostra quanto e quando caiu, mas não o motivo: ainda não existe relatório de desempenho do Mercado Livre no sistema.</p>}
    </div>}
  </article>;
}

export default function CommerceProblems(){
  const [days,setDays]=useState(30);const [platform,setPlatform]=useState('TODAS');const [group,setGroup]=useState(null);
  const [data,setData]=useState(null);const [plats,setPlats]=useState(null);const [diag,setDiag]=useState({});
  const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [limit,setLimit]=useState(20);
  useEffect(()=>{
    const c=new AbortController();setLoading(true);setLimit(20);
    Promise.all([
      fetchCommercialManager('/api/admin/commerce/problems/groups?days='+days,{signal:c.signal}),
      fetchCommercialManager('/api/admin/commerce/problems/platforms?days='+days,{signal:c.signal})
    ]).then(([g,p])=>{setError('');setData(g);setPlats(p);setLoading(false);})
      .catch(e=>{if(!c.signal.aborted){setError(e.message||'Não foi possível carregar o painel.');setLoading(false);}});
    return()=>c.abort();
  },[days]);
  useEffect(()=>{
    const ids=(data?.items||[]).filter(i=>i.platform==='SHOPEE'&&(i.group==='PAROU'||i.group==='QUEDA')&&i.listing_id).map(i=>i.listing_id).slice(0,200);
    if(!ids.length){setDiag({});return;}
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/listings/manager/performance-diagnosis?ids='+ids.join(','),{signal:c.signal})
      .then(d=>setDiag(d?.diagnosis||{})).catch(()=>{if(!c.signal.aborted)setDiag({});});
    return()=>c.abort();
  },[data]);
  const report=data?.report,reportAge=report?Number(report.age_days):null;
  const hidePior=!!report&&report.age_days>90;
  const groups=GROUPS.filter(([k])=>!(k==='PIOR'&&hidePior));
  const counts=useMemo(()=>{
    const out={PAROU:0,QUEDA:0,PIOR:0,NUNCA:0,EM_TESTE:0,SEM_IDADE:0};
    for(const [p,c] of Object.entries(data?.counts||{}))
      if(platform==='TODAS'||platform===p)for(const k of Object.keys(out))out[k]+=Number(c[k])||0;
    return out;
  },[data,platform]);
  const current=group&&groups.some(([k])=>k===group)?group:(groups.find(([k])=>counts[k]>0)||groups[0])[0];
  const rows=useMemo(()=>(data?.items||[]).filter(i=>i.group===current&&(platform==='TODAS'||i.platform===platform)),[data,current,platform]);
  const w=data?.window,warn=w?campaignWarning(w.start,w.end):null;
  const plist=(plats?.platforms||[]);
  return <section className="nwy-root" aria-label="Anúncios com problema">
    <header className="ndb-head">
      <div className="ndb-head-title"><div><p>{w?'Janela '+dm(w.start)+' a '+dm(w.end)+' · comparada com a média de '+dm(w.base_start)+' a '+dm(w.base_end):'Anúncios ativos que pararam, caíram, convertem mal ou nunca venderam'}</p></div></div>
      <div className="ndb-head-filters">
        <Dropdown label="Comparar" value={String(days)} options={DAYS.map(d=>[String(d),'Últimos '+d+' dias'])} onChange={v=>setDays(Number(v))}/>
        <InfoIcon text={SRC} label="Como o GA decide"/>
        <Dropdown label="Plataforma" value={platform} options={[['TODAS','Todas'],...Object.entries(PLATFORM_LABEL)]} onChange={setPlatform}/>
      </div>
    </header>
    {error&&<p className="ndb-error" role="alert">{error}</p>}
    {loading&&!data&&<p className="ndb-empty">Consultando…</p>}
    {data&&<>
      {warn&&<p className="ndb-warn">{warn}</p>}
      {!report&&<p className="ndb-warn">Nenhum relatório de desempenho da Shopee importado: sem ele não há motivo nem "Pior performance". Importe pela Central de Importações.</p>}
      {report&&report.age_days>=30&&<p className="ndb-warn">O relatório de desempenho da Shopee termina em {dm(report.end)} (há {reportAge} dias): motivo e "Pior performance" podem estar antigos.{hidePior?' Pior performance ficou oculto.':''}</p>}
      <div className="npr-plats">
        {plist.map(p=>{const bad=p.base_ok&&Number(p.var_pct)<=PROBLEM_PCT;return <button type="button" key={p.platform} className={'npr-plat'+(bad?' is-bad':'')+(platform===p.platform?' is-active':'')} aria-pressed={platform===p.platform} onClick={()=>setPlatform(cur=>cur===p.platform?'TODAS':p.platform)}>
          <strong>{PLATFORM_LABEL[p.platform]}</strong><b>{p.base_ok?pct(p.var_pct,1):'—'}</b>
          <span>{headline(p)}</span>
          {p.ly_ok&&p.var_ly_pct!=null&&<small>vs. mesmo período de 2025: {pct(p.var_ly_pct,1)}</small>}
        </button>;})}
      </div>
      <div className="ndb-kpis nwy-kpis">
        {GROUPS.map(([k,label])=>hidePior&&k==='PIOR'?null:<Card key={k} icon={ICON[k]} label={label} value={num(counts[k])} foot={FOOT[k]} tone={TONE[k]} active={current===k} onClick={()=>{setGroup(k);setLimit(20);}} info={SRC}/>)}
      </div>
      {platform!=='SHOPEE'&&(counts.SEM_IDADE>0)&&<p className="nwy-note npr-note">{num(counts.SEM_IDADE)} anúncios ativos do ML sem nenhuma venda: sem data de criação não dá para saber se são candidatos a desativar.</p>}
      {counts.EM_TESTE>0&&current==='NUNCA'&&<p className="nwy-note npr-note">Mais {num(counts.EM_TESTE)} anúncios da Shopee sem venda são recentes (menos de 90 dias ou idade desconhecida): em teste, aguardar.</p>}
      <div className="nwy-list">
        {rows.slice(0,limit).map(r=><ProblemCard key={r.platform+r.external_listing_id} r={r} diag={diag} store={data.store_conv_pct}/>)}
        {!rows.length&&<p className="ndb-empty">Nenhum anúncio neste grupo{platform==='TODAS'?'':' para esta plataforma'}.</p>}
      </div>
      {rows.length>limit&&<button type="button" className="nwy-more npr-more" onClick={()=>setLimit(l=>l+20)}>Ver mais {Math.min(20,rows.length-limit)} de {rows.length-limit} restantes</button>}
    </>}
  </section>;
}
