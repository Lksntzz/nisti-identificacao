import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {DECISION_PLATFORMS,DECISION_DAYS} from './commerce-decision-logic.js';
import {scopeKey,isCurrentScope,matchesPlatform} from './commerce-platform-scope-logic.js';
import './commerce-decision-center.css';

// GA-014 — Central de decisões comerciais (SOMENTE LEITURA). Só unidades; nenhum botão altera anúncio.
// A resposta é guardada com a chave conta|período e descartada se conta OU dias não forem os escolhidos agora (GA-012).
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const sgn=v=>v==null?'—':(v>0?'+':'')+nf(v);
const TIERS=[
  {id:'alta',label:'Prioridades altas',hint:'Perda de unidades confirmada pela cobertura de vendas, em anúncio com último estado cadastrado ativo.'},
  {id:'revisao',label:'Precisam de revisão',hint:'Perda menor, ou variação confirmada em anúncio cujo último estado cadastrado não é ativo.'},
  {id:'oportunidade',label:'Oportunidades',hint:'Aumento de unidades comprovado pela cobertura (inclui saída de zero ou de base pequena). Fatos, não hipóteses.'},
  {id:'hipotese_conversao',label:'Hipóteses de conversão',hint:'Conversão baixa segundo um relatório recente da mesma conta. É hipótese, não fato, e não projeta vendas.'},
  {id:'insuficiente',label:'Dados insuficientes',hint:'Há um possível sinal, mas falta cobertura de vendas ou a situação cadastrada. Nada aqui é confirmado.'},
  {id:'sem_prioridade',label:'Sem prioridade comercial',hint:'Sem sinal relevante nos dados importados: variação pequena ou volume baixo. Não é falta de informação.'}
];
const KIND={QUEDA:'Queda',PAROU:'Parou de vender',CRESCIMENTO:'Crescimento',NOVA_OU_RETOMADA:'Saiu de zero ou de base pequena',POSSIVEL_QUEDA:'Possível queda',
  POSSIVEL_PARADA:'Possível parada',POSSIVEL_OPORTUNIDADE:'Possível oportunidade',CONVERSAO_BAIXA:'Conversão baixa (hipótese)',SEM_SINAL:'Sem sinal',SEM_SINAL_NAO_COMPROVADO:'Sem sinal (não comprovado)',SEM_VENDAS_COMPROVADO:'Sem vendas nos dois períodos',ATRIBUICAO_AMBIGUA:'Atribuição ambígua'};
const RULE={PERCENTUAL:'queda percentual',ABSOLUTA:'perda absoluta',BASE_PEQUENA:'base pequena'};
const SRC_STATE={OK:'ok',INDISPONIVEL:'indisponível',DESATUALIZADO:'desatualizado',RESPOSTA_INVALIDA:'resposta inválida',SEM_DADOS:'sem dados',ULTIMO_ESTADO_CADASTRADO:'último estado cadastrado'};
const PART_PT={units:'unidades por anúncio',dashboard:'Dashboard',quality:'cobertura de vendas',split:'divisão por SKU'};

function Row({r,open,onToggle}){
  return <>
    <tr className={'ndc-row'+(open?' is-open':'')}>
      <td><button type="button" className="ndc-link" aria-expanded={open} onClick={onToggle}><b>{r.title||'Anúncio '+r.external_id}</b></button><small>{r.external_id}</small></td>
      <td className="num">{nf(r.units_current)} <small>antes {nf(r.units_previous)}</small></td>
      <td className={'num ndc-impact'+(r.impact_units<0?' is-neg':r.impact_units>0?' is-pos':'')}>{sgn(r.impact_units)} un{r.pct_change!=null&&<small>{sgn(r.pct_change)}%</small>}</td>
      <td><em className="ndc-kind">{KIND[r.kind]||r.kind}</em>{r.rules?.length>0&&<small> ({r.rules.map(x=>RULE[x]||x).join(' + ')})</small>}<span className="ndc-reason">{r.reason}</span></td>
    </tr>
    {open&&<tr className="ndc-detail"><td colSpan={4} data-testid={'detail-'+r.external_id}>
      <div className="ndc-cols">
        <section><h4>Fatos <small>comprovados</small></h4><ul>{r.facts.map((f,i)=><li key={i}>{f}</li>)}</ul></section>
        <section><h4>Hipóteses <small>não confirmadas</small></h4>{r.hypotheses.length===0?<p className="ndc-muted">Nenhuma hipótese com evidência suficiente.</p>
          :<ul>{r.hypotheses.map((h,i)=><li key={i}>{h.text}</li>)}</ul>}</section>
        <section><h4>Indisponível</h4><ul>{r.unavailable.map((u,i)=><li key={i}>{u.text}</li>)}</ul>
          {r.missing?.length>0&&<p className="ndc-muted">Falta para confirmar: {r.missing.map(m=>({PERIODO_ATUAL:'cobertura do período atual',PERIODO_ANTERIOR:'cobertura do período anterior',SITUACAO_CADASTRADA:'situação cadastrada',ATRIBUICAO:'atribuição do anúncio'}[m]||m)).join(', ')}.</p>}</section>
        <section><h4>O que conferir <small>manualmente, no painel do marketplace</small></h4>{r.investigation.length===0?<p className="ndc-muted">Sem investigação sugerida.</p>
          :<ul>{r.investigation.map((t,i)=><li key={i}>{t}</li>)}</ul>}</section>
      </div></td></tr>}
  </>;
}

function TierTable({t}){
  const [openKey,setOpenKey]=useState(null);
  if(t.total===0)return <p className="ndc-empty" role="status">Nenhum anúncio nesta faixa.</p>;
  return <>
    <div className="ndc-scroll"><table className="ndc-table"><thead><tr><th>Anúncio</th><th className="num">Unidades</th><th className="num">Impacto</th><th>Motivo</th></tr></thead>
      <tbody>{t.rows.map(r=><Row key={r.key} r={r} open={openKey===r.key} onToggle={()=>setOpenKey(openKey===r.key?null:r.key)}/>)}</tbody></table></div>
    {t.limit_note&&<p className="ndc-muted" data-testid="limit-note">{t.limit_note}</p>}
  </>;
}

export default function CommerceDecisionCenter(){
  const [platform,setPlatform]=useState('SHOPEE');
  const [days,setDays]=useState(7);
  const [entry,setEntry]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const [tierPick,setTierPick]=useState(null);
  const key=scopeKey({platform,days});
  useEffect(()=>{
    setEntry(null);setError('');setLoading(true);setTierPick(null);
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/decision-center?platform='+platform+'&days='+days,{signal:c.signal})
      .then(d=>{if(!c.signal.aborted)setEntry({key,data:d});})
      .catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível carregar a Central de decisões.');})
      .finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[key,tick]);
  const current=isCurrentScope(entry,key)?entry.data:null;
  const v=current&&matchesPlatform(current,platform)&&Number(current.days)===days?current:null;
  const wrong=Boolean(current&&!v);
  // Abre na primeira faixa que tem anúncios (a ordem já é a da prioridade); a escolha do usuário vale até trocar conta ou período.
  const tier=tierPick||(v&&TIERS.find(t=>v.summary?.counts?.[t.id]>0)?.id)||'alta';
  const active=TIERS.find(t=>t.id===tier);
  const essential=(v?.notices||[]).filter(n=>n.essential);
  const down=v?Object.entries(v.parts||{}).filter(([,s])=>s==='INDISPONIVEL'||s==='RESPOSTA_INVALIDA'):[];
  return <div className="ndc" data-testid="decision-center">
    <header className="ndc-head">
      <div><h1>Central de decisões</h1><p>Prioridades por conta, ordenadas pelo impacto em <b>unidades</b>. Somente leitura: o GA não altera anúncios.</p></div>
      <div className="ndc-controls">
        <div className="ndc-seg" role="group" aria-label="Conta">{DECISION_PLATFORMS.map(p=><button key={p.id} type="button" aria-pressed={platform===p.id}
          className={platform===p.id?'is-active':''} onClick={()=>setPlatform(p.id)}>{p.label}</button>)}</div>
        <div className="ndc-seg" role="group" aria-label="Período">{DECISION_DAYS.map(d=><button key={d} type="button" aria-pressed={days===d}
          className={days===d?'is-active':''} onClick={()=>setDays(d)}>{d} dias</button>)}</div>
      </div>
    </header>
    {loading&&!v&&<p className="ndc-loading" role="status">Carregando…</p>}
    {error&&<p className="ndc-error" role="alert">{error} <button type="button" className="ndc-link" onClick={()=>setTick(x=>x+1)}>Tentar de novo</button></p>}
    {wrong&&<p className="ndc-error" role="alert">A resposta recebida não é da conta ou do período escolhidos e foi descartada.</p>}
    {v&&<>
      <p className="ndc-periods" data-testid="periods">{v.periods?<>Atual: {v.periods.current.start} a {v.periods.current.end} · Anterior: {v.periods.previous.start} a {v.periods.previous.end}</>:'Períodos indisponíveis'}</p>
      <ul className="ndc-sources" aria-label="Fontes">{(v.sources||[]).map(s=><li key={s.name} className={'is-'+String(s.state).toLowerCase()}><b>{s.label}</b>
        {s.until&&<> até {s.until}</>}{s.period&&<> {s.period.start} a {s.period.end}</>}{s.current&&<> · atual {s.current==='COMPROVADA'?'comprovada':'não comprovada'}, anterior {s.previous==='COMPROVADA'?'comprovada':'não comprovada'}</>}
        <small> {SRC_STATE[s.state]||s.state}</small></li>)}</ul>
      {essential.map(n=><p key={n.kind} className="ndc-notice" role="status" data-testid={'notice-'+n.kind}>{n.text}</p>)}
      {down.length>0&&<p className="ndc-error" role="status" data-testid="parts-down">Consulta indisponível: {down.map(([k])=>PART_PT[k]||k).join(', ')}. Isto não significa que não existam anúncios.</p>}
      {v.status==='OK'&&<>
        <p className="ndc-summary" data-testid="summary">{nf(v.summary.listings_with_sales)} anúncios com venda · {nf(v.summary.units.current)} un no período atual · {nf(v.summary.units.previous)} no anterior{v.summary.proven_no_sales_current>0&&<> · <span data-testid="proven-absence">{nf(v.summary.proven_no_sales_current)} anúncio(s) sem vendas no período atual (ausência comprovada; o impacto contra o anterior não é confirmado)</span></>}</p>
        <div className="ndc-tabs" role="tablist" aria-label="Faixas de prioridade">{TIERS.map(t=><button key={t.id} type="button" role="tab" aria-selected={tier===t.id} data-tier={t.id}
          className={(tier===t.id?'is-active ':'')+'is-'+t.id} onClick={()=>setTierPick(t.id)}>{t.label} <b data-testid={'count-'+t.id}>{v.summary.counts[t.id]}</b></button>)}</div>
        <p className="ndc-hint">{active.hint}</p>
        <TierTable key={tier+'|'+key} t={v.tiers[tier]}/>
        <details className="ndc-recon"><summary>Conciliação das unidades{v.blocked_confirmations?' — divergência: classificações bloqueadas':''}</summary>
          <p data-testid="recon-dashboard">Soma por anúncio: {nf(v.reconciliation.dashboard.decision?.current)} un (atual) e {nf(v.reconciliation.dashboard.decision?.previous)} (anterior) · Dashboard: {nf(v.reconciliation.dashboard.dashboard?.current)} e {nf(v.reconciliation.dashboard.dashboard?.previous)} · <b>{v.reconciliation.dashboard.status.toLowerCase()}</b></p>
          {v.reconciliation.breakdown&&<p data-testid="recon-breakdown">Fonte do banco (atual / anterior): vendas sem ID de anúncio {nf(v.reconciliation.breakdown.current.units_without_id)} / {nf(v.reconciliation.breakdown.previous.units_without_id)} · de anúncios sem cadastro {nf(v.reconciliation.breakdown.current.units_unregistered)} / {nf(v.reconciliation.breakdown.previous.units_unregistered)} · resíduo não explicado {nf(v.reconciliation.breakdown.current.unexplained_units)} / {nf(v.reconciliation.breakdown.previous.unexplained_units)}</p>}
          {v.reconciliation.shopee&&<p data-testid="recon-shopee">Shopee por SKU (atual / anterior): total {nf(v.reconciliation.shopee.current?.total)} / {nf(v.reconciliation.shopee.previous?.total)}, vinculado a anúncios {nf(v.reconciliation.shopee.current?.linked)} / {nf(v.reconciliation.shopee.previous?.linked)}, sem vínculo {nf(v.reconciliation.shopee.current?.unlinked)} / {nf(v.reconciliation.shopee.previous?.unlinked)} ({String(v.reconciliation.shopee.status).toLowerCase()}). {v.reconciliation.shopee.note}</p>}
          <p className="ndc-muted">{v.evidence?.latest?.text}</p>
        </details>
      </>}
    </>}
  </div>;
}
