import React,{useEffect,useMemo,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {STRATEGIC_PLATFORMS,STRATEGIC_DAYS} from './commerce-strategic-logic.js';
import {scopeKey,isCurrentScope,matchesPlatform} from './commerce-platform-scope-logic.js';
import {LineChart,BarChart} from './commerce-strategic-chart.jsx';
import './commerce-strategic-view.css';

// GA-013/GA-013A — Visão estratégica por conta (somente leitura). Só unidades: nada de valores financeiros nem ticket.
// Cinco áreas: Resumo comercial · Situação dos anúncios · Evolução comercial · Desempenho · Qualidade e conciliação.
// GA-012: a resposta fica guardada com a chave conta|período e é descartada se conta OU dias não forem os escolhidos agora.
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const pct=v=>v==null?'—':(v>0?'+':'')+String(v).replace('.',',')+'%';
const varPct=(cur,prev)=>cur==null||prev==null||!(prev>0)?null:Math.round((cur-prev)/prev*1000)/10;
const LABEL={CRESCIMENTO:'Crescimento',QUEDA:'Queda',ESTAVEL:'Estável',POUCO_VOLUME:'Pouco volume',PAROU:'Parou',
  SEM_VENDA_HISTORICO_IMPORTADO:'Sem venda no histórico importado',
  SEM_VENDAS_HISTORICO_NAO_VERIFICADO:'Sem venda nos dados importados (histórico não verificado)',
  SEM_VENDA_NO_PERIODO:'Sem venda no período',SEM_CLASSIFICACAO:'Não classificado'};
const REASON={PERIODO_ATUAL_NAO_COMPROVADO:'cobertura do período atual não comprovada',PERIODO_ANTERIOR_NAO_COMPROVADO:'cobertura do período anterior não comprovada',
  HISTORICO_NAO_COMPROVADO:'histórico não verificado'};
const BASIS={ANUNCIOS_VINCULADOS:'vendas dos anúncios vinculados',POR_ANUNCIO:'vendas por anúncio',TOTAL_POR_SKU:'total por SKU (inclui SKU sem vínculo)'};
const PART_PT={dashboard:'Dashboard',overview:'resumo de anúncios',monthly:'evolução mensal',series:'evolução diária',categories:'categorias',split:'divisão por SKU',quality:'cobertura',performance:'visitas e impressões'};
const COV_TEXT={OK:'comprovada',COMPROVADA:'comprovada',SEM_INFORMACAO:'sem informação',COM_LACUNA:'com dias sem informação',NAO_VERIFICADO:'não verificada',NAO_VERIFICADA:'não verificada'};
const COV_REASON={NAO_COMPROVADA:'cobertura incompleta',INDISPONIVEL:'consulta indisponível',SEM_INFORMACAO:'sem informação de vendas'};
const ESSENTIAL=new Set(['SEM_INFORMACAO','PERIODO_ATUAL_NAO_COMPROVADO','PERIODO_ANTERIOR_NAO_COMPROVADO','BASE_UNIDADES_DIVERGENTE']);
const GROUPS=[
  {id:'growth',short:['Crescimento','Possível crescimento'],prev:true},
  {id:'drops',short:['Queda','Possível queda'],prev:true},
  {id:'stopped',short:['Parados','Possíveis parados'],prev:false},
  {id:'never',short:['Sem vendas registradas','Sem vendas registradas'],prev:false}
];

function Traffic({t}){
  if(!t||(t.visits==null&&t.impressions==null&&t.conversion_pct==null))return <span className="nsv-muted">—</span>;
  return <span className="nsv-traffic">{t.visits!=null&&<>Visitas {nf(t.visits)}</>}{t.impressions!=null&&<> · Impr. {nf(t.impressions)}</>}
    {t.conversion_pct!=null&&<> · Conv. {String(t.conversion_pct).replace('.',',')}%</>}
    {t.period&&<small className="nsv-traffic-period" data-testid="traffic-period">relatório de {t.period.start} a {t.period.end}</small>}</span>;
}
function Tag({r}){
  if(!r.label)return null;
  return <em className={'nsv-tag is-'+r.label.toLowerCase()} title={REASON[r.reason]||''}>{LABEL[r.label]||r.label}</em>;
}
function Kpi({label,value,sub,tone,testid,subTestid}){
  return <div className={'nsv-kpi'+(tone?' is-'+tone:'')}><span>{label}</span><strong data-testid={testid}>{value}</strong>{sub&&<small data-testid={subTestid} className={tone==='warn'?'nsv-unv':''}>{sub}</small>}</div>;
}
function Section({n,title,hint,children,id}){
  return <section className="nsv-sec" aria-labelledby={'nsv-h-'+id}><header><h2 id={'nsv-h-'+id}><b>{n}</b>{title}</h2>{hint&&<p>{hint}</p>}</header>{children}</section>;
}
const Tabs=({items,value,onChange,label})=>
  <div className="nsv-tabs" role="tablist" aria-label={label}>{items.map(t=><button key={t.id} type="button" role="tab" aria-selected={value===t.id}
    className={value===t.id?'is-active':''} onClick={()=>onChange(t.id)}>{t.label}</button>)}</div>;

function ListingTable({g,showPrev,query,partName}){
  const [all,setAll]=useState(false);
  if(!g.available)return <p className="nsv-error" role="status">Consulta indisponível no momento ({PART_PT[partName]||partName}): isto não significa que não existam anúncios.</p>;
  const q=query.trim().toLowerCase();
  const rows=q?g.items.filter(r=>(r.title||'').toLowerCase().includes(q)||String(r.external_id||'').toLowerCase().includes(q)):g.items;
  if(g.items.length===0)return <p className="nsv-empty">Nenhum anúncio nesta lista.</p>;
  if(rows.length===0)return <p className="nsv-empty">Nenhum anúncio corresponde à busca (entre os {g.items.length} carregados).</p>;
  const shown=all?rows:rows.slice(0,12);
  return <>
    <div className="nsv-scroll"><table className="nsv-table"><thead><tr><th>Anúncio</th><th className="num">Un.</th>{showPrev&&<th className="num">Anterior</th>}
      {!showPrev&&<th>Última venda importada</th>}<th>Situação</th><th>Tráfego</th></tr></thead>
      <tbody>{shown.map(r=><tr key={r.listing_id||r.external_id}><td><b>{r.title||r.external_id||'Anúncio'}</b>{r.external_id&&<small>{r.external_id}</small>}</td>
        <td className="num">{nf(r.units)}</td>{showPrev&&<td className="num">{nf(r.units_previous)}</td>}
        {!showPrev&&<td>{r.last_sale?r.last_sale+(r.last_sale_verified===false?' (não verificada)':''):'—'}</td>}
        <td><Tag r={r}/></td><td><Traffic t={r.traffic}/></td></tr>)}</tbody></table></div>
    {rows.length>12&&<button type="button" className="nsv-link" onClick={()=>setAll(x=>!x)}>{all?'Mostrar menos':'Mostrar todos os '+rows.length+' carregados'}</button>}
  </>;
}

export default function CommerceStrategicView(){
  const [platform,setPlatform]=useState('SHOPEE');
  const [days,setDays]=useState(7);
  const [entry,setEntry]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const [group,setGroup]=useState('drops');
  const [query,setQuery]=useState('');
  const [evo,setEvo]=useState('daily');
  const [perf,setPerf]=useState('listings');
  const [qOpen,setQOpen]=useState(false);
  const key=scopeKey({platform,days});
  useEffect(()=>{
    setEntry(null);setError('');setLoading(true);setQuery('');
    const c=new AbortController();
    fetchCommercialManager('/api/admin/commerce/strategic-view?platform='+platform+'&days='+days,{signal:c.signal})
      .then(d=>{if(!c.signal.aborted)setEntry({key,data:d});})
      .catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível carregar a visão estratégica.');})
      .finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[key,tick]);
  const current=isCurrentScope(entry,key)?entry.data:null;
  // Conta E período devolvidos precisam ser os escolhidos agora; qualquer outra resposta é descartada.
  const v=current&&matchesPlatform(current,platform)&&Number(current.days)===days?current:null;
  const wrong=Boolean(current)&&!v;
  const mv=v?.movements;
  const bad=v?Object.entries(v.parts).filter(([,s])=>s==='INDISPONIVEL'||s==='RESPOSTA_INVALIDA'):[];
  const essential=v?v.notices.filter(n=>ESSENTIAL.has(n.kind)):[];
  const bothProven=Boolean(v&&v.coverage.current.proven&&v.coverage.previous.proven);

  const dailyPoints=useMemo(()=>v?v.evolution.daily.map(d=>({label:d.day.slice(5).split('-').reverse().join('/'),full:d.day,units:d.units,previous:d.units_previous,state:d.state,previous_state:d.previous_state,previous_day:d.previous_day})):[],[v]);
  const monthPoints=useMemo(()=>v?v.evolution.months.map(m=>({label:m.month.slice(5)+'/'+m.month.slice(2,4)+(m.incomplete?'*':''),full:m.month,units:m.units,previous:m.previous.units,previousInfo:m.previous,state:m.coverage,
    incomplete:m.incomplete,incomplete_until:m.incomplete_until,incomplete_from:m.incomplete_from})):[],[v]);
  const collections=useMemo(()=>v?.categories?v.categories.items.flatMap(c=>c.collections.map(x=>({...x,category:c.name}))):[],[v]);

  const active=GROUPS.find(x=>x.id===group)||GROUPS[1];
  const ag=mv?mv[active.id]:null;
  const catVerified=v?.categories?.verified.current&&v?.categories?.verified.base;

  return <section className="nsv-root" aria-label="Visão estratégica">
    <div className="nsv-toolbar">
      <div className="nsv-seg" role="radiogroup" aria-label="Conta">
        {STRATEGIC_PLATFORMS.map(p=><button key={p.id} type="button" role="radio" aria-checked={platform===p.id} className={platform===p.id?'is-active':''}
          style={{'--c':p.color}} onClick={()=>setPlatform(p.id)}><i/>{p.label}</button>)}
      </div>
      <div className="nsv-seg" role="radiogroup" aria-label="Período">
        {STRATEGIC_DAYS.map(d=><button key={d} type="button" role="radio" aria-checked={days===d} className={days===d?'is-active':''} onClick={()=>setDays(d)}>{d} dias</button>)}
      </div>
      <button type="button" className="nsv-refresh" onClick={()=>setTick(t=>t+1)}>Atualizar</button>
      {v?.periods&&<span className="nsv-periods" data-testid="periods">Atual: {v.periods.current.start} a {v.periods.current.end} · anterior: {v.periods.previous.start} a {v.periods.previous.end}</span>}
    </div>
    {error&&<p className="nsv-error" role="alert">{error}</p>}
    {wrong&&<p className="nsv-error" role="alert">A resposta recebida não corresponde à conta ou ao período escolhidos e foi descartada.</p>}
    {loading&&<p className="nsv-note" role="status">Carregando…</p>}
    {v&&<>
      {(essential.length>0||bad.length>0)&&<div className="nsv-alerts">
        {essential.map(n=><p key={n.kind} className="nsv-warn" role="status" data-notice={n.kind}>{n.text}</p>)}
        {bad.length>0&&<p className="nsv-warn" role="status" data-testid="parts-down">Partes indisponíveis ou descartadas: {bad.map(([k,s])=>(PART_PT[k]||k)+(s==='RESPOSTA_INVALIDA'?' (resposta inválida)':'')).join(', ')}. O restante da tela continua válido.</p>}
        <button type="button" className="nsv-link" onClick={()=>{setQOpen(true);document.getElementById('nsv-quality')?.scrollIntoView({behavior:'smooth',block:'start'});}}>Ver detalhes de qualidade</button>
      </div>}
      {v.status==='SEM_INFORMACAO'?<p className="nsv-empty">Sem informação de vendas para esta conta.</p>:<>

      <Section n="1" id="resumo" title="Resumo comercial" hint={'Unidades · '+BASIS[v.units.basis]}>
        <div className="nsv-kpis">
          <Kpi label="Unidades vendidas" value={nf(v.units.current)} testid="units-current" sub={v.units.verified.current?'período atual':'período atual · não verificado'} tone={v.units.verified.current?null:'warn'}/>
          <Kpi label="Período anterior" value={nf(v.units.previous)} sub={v.units.verified.previous?'mesma base':'mesma base · não verificado'} tone={v.units.verified.previous?null:'warn'}/>
          <Kpi label="Variação" value={pct(v.units.change_pct)} sub={v.units.change_pct==null?'exige os dois períodos verificados':'contra o período anterior'}/>
          <Kpi label="Anúncios ativos" value={nf(v.listings.active)} sub={nf(v.listings.inactive)+' inativos (fora desta contagem)'}/>
          <Kpi label="Com vendas no período" value={nf(v.listings.with_sales)} testid="with-sales-value" subTestid="with-sales-note" sub={v.listings.with_sales_note+(v.listings.coverage_verified?'':' · não verificado')} tone={v.listings.coverage_verified?null:'warn'}/>
          <Kpi label="Sem vendas registradas" value={nf(v.listings.active_without_sales)} testid="no-sales-value" subTestid="no-sales-card"
            sub={v.listings.active_without_sales_label} tone={v.listings.coverage_verified?null:'warn'}/>
        </div>
        {v.units.sku_total&&<p className="nsv-note" data-testid="sku-total">Outra base, não somar: total por SKU no período atual = {nf(v.units.sku_total.current)} un. (inclui {nf(v.units.sku_total.unlinked)} de SKU sem vínculo).</p>}
      </Section>

      <Section n="2" id="situacao" title="Situação dos anúncios" hint="Escolha um grupo para consultar os anúncios.">
        <div className="nsv-chips" role="tablist" aria-label="Grupo de anúncios">
          {GROUPS.map(gr=>{const g=mv[gr.id];const cand=g.kind==='CANDIDATO';
            return <button key={gr.id} type="button" role="tab" aria-selected={group===gr.id} data-group={gr.id}
              className={'nsv-chip'+(group===gr.id?' is-active':'')+(cand?' is-cand':'')} onClick={()=>setGroup(gr.id)}>
              <span>{gr.short[cand?1:0]}</span>
              <strong>{g.available?nf(g.total??g.shown):'—'}{g.available&&g.total==null&&g.shown>=g.limit?'+':''}</strong>
              <small>{!g.available?'indisponível':g.total==null?'maiores ganhos exibidos':cand?'não confirmado':'total'}</small></button>;})}
        </div>
        <div className="nsv-filterbar">
          <label>Buscar anúncio<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="título ou código"/></label>
          <div className="nsv-gnotes" data-testid="group-notes"><b>{ag.title}</b>
            {ag.count_label&&<span>{ag.count_label}</span>}
            {ag.kind==='CANDIDATO'&&<span>Candidatos pelos dados importados: a cobertura de vendas não comprova o período, então ainda não é uma classificação confirmada.</span>}
            {ag.ordering_note&&<span>{ag.ordering_note}</span>}{ag.note&&<span>{ag.note}</span>}{ag.limit_note&&<span>{ag.limit_note}</span>}</div>
        </div>
        <ListingTable g={ag} showPrev={active.prev} query={query} partName={active.id==='drops'?'dashboard':'overview'} key={active.id+key}/>
      </Section>

      <Section n="3" id="evolucao" title="Evolução comercial" hint={'Unidades · '+BASIS[v.evolution.basis]}>
        <Tabs label="Visão do gráfico" value={evo} onChange={setEvo} items={[{id:'daily',label:'Diária'},{id:'monthly',label:'Mensal'}]}/>
        {!v.evolution.available.months&&!v.evolution.available.daily?<p className="nsv-error" role="status">Evolução indisponível no momento.</p>
          :evo==='daily'?(v.evolution.daily.length===0?<p className="nsv-empty">Sem dados diários.</p>:<>
            {!v.evolution.verified.daily&&<p className="nsv-note" data-testid="daily-note">Cobertura do período atual não comprovada: dias marcados (círculo vazado) não provam ausência de vendas.</p>}
            {!v.evolution.verified.daily_previous&&<p className="nsv-note">Valores do período anterior não verificados.</p>}
            <LineChart points={dailyPoints} currentLabel="Período atual" previousLabel="Período anterior"/></>)
          :(v.evolution.months.length===0?<p className="nsv-empty">Sem dados mensais.</p>:<>
            {!v.evolution.verified.months&&<p className="nsv-note" data-testid="months-note">Soma dos dias importados: meses hachurados têm dias sem informação ou sem verificação; um valor baixo ali não prova ausência de vendas.</p>}
            <p className="nsv-note">Cada mês é comparado com o mês de calendário imediatamente anterior; mês ausente da série aparece como "ausente", nunca como zero. * = mês incompleto (em andamento ou com dados só a partir de uma data).</p>
            <BarChart points={monthPoints} currentLabel="Mês" previousLabel="Mês anterior"/></>)}
        <details className="nsv-details"><summary>Ver tabela dos valores</summary>
          <div className="nsv-scroll">{evo==='daily'
            ?<table className="nsv-table" data-testid="evo-table-daily"><thead><tr><th>Dia</th><th className="num">Un.</th><th>Cobertura</th><th>Dia correspondente anterior</th><th className="num">Un. anterior</th><th>Cobertura do anterior</th></tr></thead>
              <tbody>{dailyPoints.map(p=><tr key={p.full}><td>{p.full}</td><td className="num">{p.units!=null?nf(p.units):p.state==='SEM_INFORMACAO'?'sem informação':'—'}</td><td>{COV_TEXT[p.state]}</td>
                <td>{p.previous_day||'—'}</td><td className="num">{p.previous!=null?nf(p.previous):p.previous_state==='SEM_INFORMACAO'?'sem informação':'—'}</td><td>{COV_TEXT[p.previous_state]}</td></tr>)}</tbody></table>
            :<table className="nsv-table" data-testid="evo-table-monthly"><thead><tr><th>Mês</th><th className="num">Un.</th><th>Situação do mês</th><th>Mês anterior</th><th className="num">Un. anterior</th><th>Situação do anterior</th></tr></thead>
              <tbody>{monthPoints.map(p=><tr key={p.full}><td>{p.full}</td><td className="num">{nf(p.units)}</td>
                <td>{p.incomplete?'incompleto'+(p.incomplete_until?' (até '+p.incomplete_until+')':'')+(p.incomplete_from?' (desde '+p.incomplete_from+')':'')+' · ':''}{COV_TEXT[p.state]}</td>
                <td>{p.previousInfo.month}</td><td className="num">{p.previousInfo.absent?'ausente da série':nf(p.previous)}</td>
                <td>{p.previousInfo.absent?'—':(p.previousInfo.incomplete?'incompleto · ':'')+COV_TEXT[p.previousInfo.coverage]}</td></tr>)}</tbody></table>}</div>
        </details>
      </Section>

      <Section n="4" id="desempenho" title="Desempenho dos anúncios, categorias e coleções">
        <Tabs label="Tabela" value={perf} onChange={setPerf} items={[{id:'listings',label:'Anúncios'},{id:'categories',label:'Categorias'},{id:'collections',label:'Coleções'}]}/>
        {perf==='listings'?<>
          <p className="nsv-note">{v.champions_limit?'Até '+v.champions_limit+' anúncios, por unidades vendidas no período atual.':''} {v.champions_note}</p>
          {!v.champions_available?<p className="nsv-error" role="status">Consulta indisponível no momento.</p>:v.champions.length===0?<p className="nsv-empty">Sem dados.</p>
            :<div className="nsv-scroll"><table className="nsv-table"><thead><tr><th>Anúncio</th><th className="num">Un.</th><th className="num">Anterior</th><th className="num">Variação</th><th>Tráfego</th></tr></thead>
              <tbody>{v.champions.map(r=><tr key={r.listing_id||r.external_id}><td><b>{r.title||r.external_id}</b>{r.external_id&&<small>{r.external_id}</small>}</td>
                <td className="num">{nf(r.units)}</td><td className="num">{nf(r.units_previous)}</td>
                <td className="num">{bothProven?pct(varPct(r.units,r.units_previous)):'—'}</td><td><Traffic t={r.traffic}/></td></tr>)}</tbody></table></div>}
          {!v.traffic_available&&<p className="nsv-note">Visitas, impressões e conversão: sem relatório importado desta conta.</p>}</>
        :!v.categories?<p className={v.parts.categories==='SEM_DADOS'?'nsv-empty':'nsv-error'} role="status">{v.parts.categories==='SEM_DADOS'?'Sem dados.':'Categorias indisponíveis no momento.'}</p>
        :<>
          <p className="nsv-note" data-testid="cat-note">Unidades · {BASIS[v.categories.basis]}. Comparação anual: {v.categories.period.current.start} a {v.categories.period.current.end} contra o mesmo período do ano anterior ({v.categories.period.base.start} a {v.categories.period.base.end}).
            {!v.categories.aligned&&' Este período não é o mesmo das demais seções.'}{!catVerified&&' Valores não verificados (cobertura não comprovada): variação não calculada.'}
            {perf==='collections'&&' Até 8 coleções por categoria.'}</p>
          {(perf==='categories'?v.categories.items:collections).length===0?<p className="nsv-empty">Sem dados.</p>
          :<div className="nsv-scroll"><table className="nsv-table"><thead><tr><th>{perf==='categories'?'Categoria':'Coleção'}</th>{perf==='collections'&&<th>Categoria</th>}<th className="num">Un.</th><th className="num">Ano anterior</th><th className="num">Variação</th></tr></thead>
            <tbody>{(perf==='categories'?v.categories.items:collections).map((c,i)=><tr key={c.name+i}><td><b>{c.name}</b></td>{perf==='collections'&&<td>{c.category}</td>}
              <td className="num">{nf(c.units)}</td><td className="num">{nf(c.base)}</td><td className="num">{catVerified?pct(varPct(c.units,c.base)):'—'}</td></tr>)}</tbody></table></div>}
        </>}
      </Section>
      </>}

      <section className="nsv-sec nsv-quality" id="nsv-quality">
        <details open={qOpen} onToggle={e=>setQOpen(e.currentTarget.open)}>
          <summary><h2><b>5</b>Qualidade e conciliação</h2><span>detalhes técnicos de cobertura, conferência e origem dos dados</span></summary>
          <div className="nsv-qbody" data-testid="quality-body">
            <h3>Cobertura de vendas (GA-018)</h3>
            <dl className="nsv-dl">{[['Período atual','current'],['Período anterior','previous'],['Histórico importado','history']].map(([l,k])=>
              <div key={k}><dt>{l}{v.periods&&' ('+v.periods[k].start+' a '+v.periods[k].end+')'}</dt><dd>{v.coverage[k].proven?'comprovada':'não comprovada'+(COV_REASON[v.coverage[k].reason]?' · '+COV_REASON[v.coverage[k].reason]:'')}</dd></div>)}</dl>
            <h3>Avisos</h3>
            <ul className="nsv-ul">{v.notices.length===0?<li>Nenhum aviso.</li>:v.notices.map(n=><li key={n.kind} data-notice={n.kind}>{n.text}</li>)}</ul>
            {v.sales_split&&<><h3>Vendas sem vínculo e resíduo</h3>
              {v.sales_split.kind==='SHOPEE'
                ?(v.sales_split.total==null?<p className={v.sales_split.status==='INDISPONIVEL'||v.sales_split.status==='RESPOSTA_INVALIDA'?'nsv-error':'nsv-empty'} role="status">{v.sales_split.status==='SEM_INFORMACAO'?'Sem informação para este período.':'Consulta indisponível no momento.'}</p>
                  :<dl className="nsv-dl"><div><dt>Total por SKU</dt><dd>{nf(v.sales_split.total)}</dd></div><div><dt>Com vínculo a anúncio</dt><dd>{nf(v.sales_split.linked)}</dd></div>
                    <div><dt>Sem vínculo</dt><dd>{nf(v.sales_split.unlinked)}</dd></div><div><dt>Outras causas explicadas</dt><dd>{nf(v.sales_split.other_explained)}</dd></div>
                    <div><dt>Resíduo não explicado</dt><dd>{nf(v.sales_split.residual)}</dd></div></dl>)
                :<p>{nf(v.sales_split.unlinked_listings)} anúncio(s) vendendo sem SKU vinculado.</p>}
              {v.sales_split.status==='INCONSISTENTE'&&<p className="nsv-warn">Os números não fecham entre si: conferir antes de usar.</p>}</>}
            <h3>Conferência das respostas</h3>
            <ul className="nsv-ul">{Object.entries(v.parts).map(([k,s])=><li key={k}>{PART_PT[k]||k}: {s==='OK'?'ok'+(v.validation.levels[k]==='NAO_CONFIRMAVEL'?' (sem conferência independente)':''):s.toLowerCase().replace(/_/g,' ')}</li>)}</ul>
            {v.validation.limitations.length>0&&<p className="nsv-note" data-testid="limitations">Conferência de origem limitada: {v.validation.limitations.join(' ')}</p>}
            <h3>Origem dos dados</h3>
            <p className="nsv-note" data-testid="sources">{v.sources.note}{v.sources.elapsed_ms!=null&&' Montada em '+nf(v.sources.elapsed_ms)+' ms.'}</p>
          </div>
        </details>
      </section>
    </>}
  </section>;
}
