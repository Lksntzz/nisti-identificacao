import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {Dropdown,InfoIcon,listingUrl} from './commerce-dashboard.jsx';
import {Card} from './commerce-why-stopped.jsx';
import {maskMoney} from './commerce-privacy.js';
import {causeOf} from './commerce-why-stopped-logic.js';
import {GROUPS,PROBLEM_PCT,PLATFORM_LABEL,headline,windowWarning} from './commerce-problems-logic.js';
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
const FOOT={PAROU:days=>'vendiam e estão sem venda há '+days+' dias',QUEDA:'ainda vendem, mas bem menos que antes',PIOR:'aparecem e quase ninguém compra',NUNCA:'sem venda desde jan/2025'};
const SRC='Só anúncios ATIVOS. Parou: já vendeu e não vendeu nada na janela escolhida (30, 60 ou 90 dias). Em queda: média por dia da janela 30% ou mais abaixo da média dos 3 meses completos anteriores (mínimo de 10 unidades nessa base). Pior performance (Shopee): 1.000 impressões, 100 visitantes e conversão abaixo da metade da média da loja, no relatório de desempenho mais recente. Nunca vendeu (Shopee): sem venda desde 01/01/2025 e visto em relatórios há mais de 90 dias; é sugestão para conferir, o GA não desativa nada. Cada anúncio fica em um só grupo, nessa ordem. O motivo (só Shopee) vem do relatório de desempenho: impressões = visibilidade, CTR = cliques, conversão = compra.';

function ProblemCard({r,diag,store}){
  const [open,setOpen]=useState(false);
  const g=r.group,url=listingUrl(r.platform,r.external_listing_id);
  const shopee=r.platform==='SHOPEE';
  const d=diag&&diag[String(r.listing_id)];
  const cause=causeOf(d&&d.driver&&DRIVER[d.driver]?DRIVER[d.driver]:'SEM_SINAL');
  const chips=d?[['Impressões',d.impressions_pct,'IMPRESSIONS'],['CTR',d.ctr_pct,'CTR'],['Conversão',d.conversion_pct,'CONVERSION']]:[];
  const sales=g==='PAROU'?num(Math.round(Number(r.units_base)))+' → 0'
    :g==='QUEDA'?num(Math.round(Number(r.units_base)))+' → '+num(r.units_cur)+' ('+pct(-Number(r.drop_pct))+')'
    :g==='PIOR'?pct(r.conv_pct,1).replace('+','')+' conv.'
    :'0 vendas';
  const why=g==='NUNCA'?'Desativar?':g==='PIOR'?'Converte mal':shopee?cause.label:'—';
  const detail=g==='PAROU'?'Última venda '+(r.last_sale?dm(r.last_sale):'—')+'. '
    :g==='PIOR'?num(r.impressions)+' impressões · '+num(r.visitors)+' visitantes · a loja converte '+String(store).replace('.',',')+'%. '
    :g==='NUNCA'?'Sem venda desde jan/2025 · no relatório há '+num(r.age_days_min)+'+ dias. ':'';
  return <li className={'npr-row tone-'+TONE[g]}>
    <div className="npr-line">
      {url?<a className="npr-title" href={url} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a>:<b className="npr-title" title={r.title}>{r.title}</b>}
      <span className="npr-plat-tag">{PLATFORM_LABEL[r.platform]}</span>
      <span className="npr-sales">{sales}</span>
      <b className="npr-loss">{Number(r.lost_revenue)>0?money(r.lost_revenue):'—'}</b>
      <span className="npr-why" title={why}>{why}</span>
      <button type="button" className="npr-toggle" onClick={()=>setOpen(o=>!o)} aria-expanded={open} aria-label={(open?'Esconder':'Ver')+' detalhes: '+r.title}>{open?'▴':'▾'}</button>
    </div>
    {open&&<div className="npr-detail">
      <p>{detail}{r.also_low_conv&&'Também converte mal. '}{d&&Number(d.price_pct)>=10&&'Preço '+pct(d.price_pct)+'. '}{d&&d.driver==='INSUFFICIENT'&&'Pouco volume para concluir. '}</p>
      {chips.length>0&&<ul className="nwy-chips" aria-label="Variação por etapa">
        {chips.map(([n,v,k])=><li key={k} className={(v!=null&&v<=-10?'is-bad':'')+(d.driver===k?' is-main':'')}><span>{n}</span><b>{pct(v)}</b></li>)}
      </ul>}
      {g==='NUNCA'&&<p>Confira na Shopee antes de desativar: o GA só sugere.</p>}
      {g==='PIOR'&&<p><b>O que conferir:</b> {causeOf('CONVERSAO').check.join(' · ')}</p>}
      {(g==='PAROU'||g==='QUEDA')&&shopee&&<p>{cause.why} <b>O que conferir:</b> {cause.check.join(' · ')}</p>}
      {(g==='PAROU'||g==='QUEDA')&&!shopee&&<p>O GA mostra quanto e quando caiu, mas não o motivo: ainda não existe relatório de desempenho do Mercado Livre no sistema.</p>}
    </div>}
  </li>;
}

export default function CommerceProblems({initialFilter=null}={}){
  const [days,setDays]=useState(DAYS.includes(initialFilter?.days)?initialFilter.days:30);
  const [platform,setPlatform]=useState(initialFilter?.platform||'TODAS');
  const [group,setGroup]=useState(initialFilter?.group||null);
  const filtered=days!==30||platform!=='TODAS'||group!=null;
  const clearFilters=()=>{setDays(30);setPlatform('TODAS');setGroup(null);};
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
  const w=data?.window,warn=windowWarning(w);
  const plist=(plats?.platforms||[]);
  return <section className="nwy-root" aria-label="Anúncios com problema">
    <header className="ndb-head">
      <div className="ndb-head-title"><div><p>{w?'Janela '+dm(w.start)+' a '+dm(w.end)+' · comparada com a média de '+dm(w.base_start)+' a '+dm(w.base_end):'Anúncios ativos que pararam, caíram, convertem mal ou nunca venderam'}</p></div></div>
      <div className="ndb-head-filters">
        <Dropdown label="Comparar" value={String(days)} options={DAYS.map(d=>[String(d),'Últimos '+d+' dias'])} onChange={v=>setDays(Number(v))}/>
        <InfoIcon text={SRC} label="Como o GA decide"/>
        <Dropdown label="Plataforma" value={platform} options={[['TODAS','Todas'],...Object.entries(PLATFORM_LABEL)]} onChange={setPlatform}/>
        {filtered&&<button type="button" className="ndb-link" onClick={clearFilters}>Limpar filtros</button>}
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
        {GROUPS.map(([k,label])=>hidePior&&k==='PIOR'?null:<Card key={k} icon={ICON[k]} label={label} value={num(counts[k])} foot={typeof FOOT[k]==='function'?FOOT[k](days):FOOT[k]} tone={TONE[k]} active={current===k} onClick={()=>{setGroup(k);setLimit(20);}} info={SRC}/>)}
      </div>
      {platform!=='SHOPEE'&&current==='NUNCA'&&(counts.SEM_IDADE>0)&&<p className="nwy-note npr-note">{num(counts.SEM_IDADE)} anúncios ativos do ML sem nenhuma venda: sem data de criação não dá para saber se são candidatos a desativar.</p>}
      {counts.EM_TESTE>0&&current==='NUNCA'&&<p className="nwy-note npr-note">Mais {num(counts.EM_TESTE)} anúncios da Shopee sem venda são recentes (menos de 90 dias ou idade desconhecida): em teste, aguardar.</p>}
      {rows.length>0&&<div className="npr-table" role="table" aria-label="Anúncios do grupo">
        <div className="npr-head" role="row"><span>Anúncio</span><span>Plataforma</span><span>{current==='PIOR'?'Conversão':current==='NUNCA'?'Vendas':'Esperado → agora'}</span><span>Perdeu</span><span>Motivo</span><span/></div>
        <ul>{rows.slice(0,limit).map(r=><ProblemCard key={r.platform+r.external_listing_id} r={r} diag={diag} store={data.store_conv_pct}/>)}</ul>
      </div>}
      {!rows.length&&<p className="ndb-empty">Nenhum anúncio neste grupo{platform==='TODAS'?'':' para esta plataforma'}.</p>}
      {rows.some(r=>r.platform!=='SHOPEE')&&(current==='PAROU'||current==='QUEDA')&&<p className="nwy-note npr-note">Motivo indisponível no ML: sem relatório de desempenho do ML no sistema, aparece só quanto caiu.</p>}
      {rows.length>limit&&<button type="button" className="nwy-more npr-more" onClick={()=>setLimit(l=>l+20)}>Ver mais {Math.min(20,rows.length-limit)} de {rows.length-limit} restantes</button>}
    </>}
  </section>;
}
