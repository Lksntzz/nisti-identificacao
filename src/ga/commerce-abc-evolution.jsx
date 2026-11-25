import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {scopeKey,isCurrentScope,matchesPlatform} from './commerce-platform-scope-logic.js';
import './commerce-abc-evolution.css';

// GA-015 — Evolução da Curva ABC por produto/SKU (SOMENTE LEITURA, só unidades). Não substitui nem altera a Curva ABC do Dashboard.
// A resposta é guardada com a chave conta|comparação|mês e descartada se conta, comparação ou mês não forem os escolhidos agora (GA-012).
const PLATFORMS=[{id:'SHOPEE',label:'Shopee'},{id:'ML_ANTIGO',label:'ML Antigo'},{id:'ML_NOVO',label:'ML Novo'}];
const MODES=[{id:'7d',label:'7 dias'},{id:'30d',label:'30 dias'},{id:'mensal',label:'Mensal'},{id:'anual',label:'Anual'}];
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const sg=v=>v==null?'—':(v>0?'+':'')+nf(v);
const pct=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const pp=v=>v==null?'—':(v>0?'+':'')+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' p.p.';
const br=d=>d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):'—';
const rg=p=>p?br(p.start)+' a '+br(p.end):'—';
const mesPt=k=>k?['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(k.slice(5,7))-1]+'/'+k.slice(2,4):'';
const STATUS={CONFIRMADO:'confirmado',NAO_COMPROVADO:'cobertura não comprovada',BLOQUEADO_DIVERGENTE:'bloqueado: unidades divergentes',BLOQUEADO_INDISPONIVEL:'bloqueado: conferência indisponível'};
const COV={COMPLETA:'comprovada',NAO_COMPROVADA:'não comprovada',NAO_VERIFICADA:'não verificada nesta consulta',PARCIAL:'parcial',INDISPONIVEL:'indisponível'};
const RECON_WHY={GA019_DIFERENTE:'o total difere da fonte diária de vendas (GA-019)',GA019_INDISPONIVEL:'a fonte diária de vendas (GA-019) está indisponível',
  GA021_NAO_EXPLICA:'a divisão por SKU (GA-021) não explica a diferença com resíduo zero',GA021_INDISPONIVEL:'a divisão por SKU (GA-021) está indisponível',
  GA021_OUTRAS_DATAS:'a divisão por SKU (GA-021) respondeu para outras datas',TOTAIS_INTERNOS:'os totais da função não fecham entre si',FUNCAO_SEM_TOTAIS:'a função de unidades por SKU não respondeu'};
const STATE_TEXT={
  SEM_PERIODO_ANTERIOR:'Não há período anterior equivalente com dados importados nesta conta.',
  PERIODOS_DIFERENTES:'Os dois períodos não têm o mesmo número de dias: não há comparação equivalente.',
  NAO_COMPROVADA:'A cobertura de vendas de um dos períodos não está comprovada: aparecem só as unidades; classes, posições e migrações ficam bloqueadas.',
  BLOQUEADA_DIVERGENTE:'As unidades divergem da conciliação (GA-019/GA-021): classes e migrações bloqueadas.',
  BLOQUEADA_INDISPONIVEL:'A conciliação (GA-019/GA-021) ou a fonte de unidades por SKU está indisponível: classes e migrações bloqueadas. Isto não significa que não houve vendas.'};
const GROWTH={UNIDADES_E_PARTICIPACAO_SOBEM:'Cresceu em unidades e em participação',UNIDADES_SOBEM_PARTICIPACAO_CAI:'Cresceu em unidades, mas perdeu participação',
  UNIDADES_SOBEM_PARTICIPACAO_ESTAVEL:'Cresceu em unidades; participação estável',UNIDADES_CAEM_PARTICIPACAO_SOBE:'Caiu em unidades, mas ganhou participação',
  UNIDADES_E_PARTICIPACAO_CAEM:'Caiu em unidades e em participação',UNIDADES_CAEM_PARTICIPACAO_ESTAVEL:'Caiu em unidades; participação estável',
  UNIDADES_ESTAVEIS_PARTICIPACAO_SOBE:'Unidades estáveis; participação subiu',UNIDADES_ESTAVEIS_PARTICIPACAO_CAI:'Unidades estáveis; participação caiu',ESTAVEL:'Estável'};
const VIEWS=[{id:'migracoes',label:'Migrações de classe'},{id:'top10',label:'Novos no top 10'},{id:'classeA',label:'Novos na classe A'},{id:'todos',label:'Todos os produtos'}];
const CLS_COLOR={A:'#2a78d6',B:'#8fb4e8',C:'#cbd5e1'};

function Badge({p}){return <span className={'nae-badge is-'+p.status.toLowerCase()} data-testid={'status-'+p.key}>{STATUS[p.status]||p.status}{p.incomplete&&' · mês incompleto'}</span>;}

function PeriodLine({label,p,tid}){
  if(!p)return null;
  return <li data-testid={tid}><b>{label}</b> {rg(p)} <small>({p.days} dias)</small> <Badge p={p}/>
    <small> · cobertura {COV[p.coverage]||p.coverage}</small>
    {p.reconciliation?.status!=='CONCILIADO'&&<small className="nae-why"> · {RECON_WHY[p.reconciliation?.reason]||'conciliação indisponível'}</small>}
    {p.reconciliation?.status==='CONCILIADO'&&<small> · conciliado{p.reconciliation.explained_by?' ('+p.reconciliation.explained_by+')':' (GA-019)'}</small>}</li>;
}

function BaseNote({p}){
  if(!p?.base)return null;
  return <p className="nae-muted" data-testid="base">Base dos percentuais: <b>{nf(p.base.ranked_units)}</b> unidades com SKU no período atual. Vendas sem SKU ({nf(p.base.no_sku_units)} un., {pct(p.base.no_sku_pct)} do total de {nf(p.base.total_units)}) ficam no total conciliado, mas fora do ranking.</p>;
}

function Cards({v,cmp,view,setView}){
  const cur=v.current,ok=cmp.state==='CONFIRMADA';
  const mc=cmp.migration_counts;
  return <div className="nae-cards" role="group" aria-label="Resumo">
    <div className="nae-card" data-testid="card-classes"><h3>Produtos por classe</h3>
      {cur.class_counts?<p className="nae-big">{['A','B','C'].map(c=><span key={c} className={'nae-cls is-'+c}><b data-testid={'count-class-'+c}>{cur.class_counts[c]}</b><small>{c}</small></span>)}</p>:<p className="nae-muted">Bloqueado</p>}
      <small>{cur.classes_confirmed?'Classes confirmadas.':'Classes não confirmadas.'}</small></div>
    <div className="nae-card" data-testid="card-concentration"><h3>Concentração</h3>
      {cur.concentration?<p className="nae-conc">{[['top1','Top 1'],['top3','Top 3'],['top5','Top 5'],['top10','Top 10']].map(([k,l])=><span key={k}><small>{l}</small><b data-testid={'conc-'+k}>{pct(cur.concentration[k])}</b></span>)}</p>:<p className="nae-muted">Indisponível sem confirmação</p>}
      <small>% das unidades com SKU. Concentração alta não prova redução do catálogo ativo.</small></div>
    <button type="button" className={'nae-card is-btn'+(view==='migracoes'?' is-active':'')} aria-pressed={view==='migracoes'} onClick={()=>setView('migracoes')} data-testid="card-migrations">
      <h3>Migrações</h3><p className="nae-big"><b data-testid="count-migrations">{ok?mc.total:'—'}</b></p><small>{ok?mc.relevant+' relevantes comercialmente · '+mc.up+' subiram · '+mc.down+' desceram':'bloqueadas'}</small></button>
    <button type="button" className={'nae-card is-btn'+(view==='top10'?' is-active':'')} aria-pressed={view==='top10'} onClick={()=>setView('top10')} data-testid="card-top10">
      <h3>Novos no top 10</h3><p className="nae-big"><b data-testid="count-top10">{ok?cmp.new_top10.length:'—'}</b></p></button>
    <button type="button" className={'nae-card is-btn'+(view==='classeA'?' is-active':'')} aria-pressed={view==='classeA'} onClick={()=>setView('classeA')} data-testid="card-classa">
      <h3>Novos na classe A</h3><p className="nae-big"><b data-testid="count-classa">{ok?cmp.new_class_a.length:'—'}</b></p></button>
  </div>;
}

function Table({cmp,view}){
  const ok=cmp.state==='CONFIRMADA';
  let rows;
  if(view==='top10')rows=cmp.new_top10;else if(view==='classeA')rows=cmp.new_class_a;else if(view==='migracoes')rows=cmp.migrations;else rows=cmp.entries;
  if(!ok&&view!=='todos')return <p className="nae-empty" role="status">Bloqueado: sem confirmação, o GA mostra apenas as unidades de cada produto (aba "Todos os produtos").</p>;
  if(!rows||rows.length===0)return <p className="nae-empty" role="status">{view==='migracoes'?'Nenhuma migração de classe entre os dois períodos.':'Nenhum produto nesta lista.'}</p>;
  if(view==='top10'||view==='classeA')return <div className="nae-scroll"><table className="nae-table"><thead><tr><th>SKU</th><th className="num">Posição atual</th><th className="num">Antes</th><th className="num">Unidades</th><th>Leitura</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.sku} data-testid={'row-'+r.sku}><td><b>{r.sku}</b></td><td className="num">{r.rank}º</td>
      <td className="num">{view==='top10'?(r.previous_rank?r.previous_rank+'º':'sem venda'):(r.previous_class?'classe '+r.previous_class:'sem venda')}</td><td className="num">{nf(r.units)}</td>
      <td>{r.from_outside_curve&&<em className="nae-kind">Entrou na curva (não é migração)</em>} {r.relevant?<em className="nae-rel">Relevante</em>:<em className="nae-low">Baixa relevância</em>}</td></tr>)}</tbody></table></div>;
  return <>
    <div className="nae-scroll"><table className="nae-table"><thead><tr><th>SKU</th><th className="num">Unidades</th>{ok&&<><th className="num">Participação</th><th className="num">Posição</th><th>Classe</th></>}<th>Leitura</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.sku} data-testid={'row-'+r.sku}>
        <td><b>{r.sku}</b></td>
        <td className="num">{nf(r.current_units)} <small>antes {nf(r.previous_units)}</small><small className={r.delta_units<0?'is-neg':r.delta_units>0?'is-pos':''}>{sg(r.delta_units)} un{r.delta_units_pct!=null&&' ('+sg(r.delta_units_pct)+'%)'}</small></td>
        {ok&&<><td className="num">{r.current?pct(r.current.share_pct):'—'} <small>antes {r.previous?pct(r.previous.share_pct):'—'}</small>{r.delta_share_pp!=null&&<small>{pp(r.delta_share_pp)}</small>}</td>
          <td className="num">{r.current?r.current.rank+'º':'—'} <small>antes {r.previous?r.previous.rank+'º':'—'}</small>{r.delta_rank!=null&&<small>{sg(r.delta_rank)} posições</small>}</td>
          <td>{r.previous?r.previous.class:'—'} → {r.current?r.current.class:'—'}{(r.current?.boundary_tie||r.previous?.boundary_tie)&&<small>empate na fronteira</small>}</td></>}
        <td>{r.kind==='MIGRACAO'&&<><em className="nae-kind">{r.direction==='SUBIU'?'Subiu':'Desceu'} de classe ({r.class_change.replace('>',' → ')})</em> {r.relevant?<em className="nae-rel">Relevante</em>:<em className="nae-low">Baixa relevância</em>}</>}
          {r.kind==='ENTRADA'&&<em className="nae-kind">Entrou na curva · não é migração</em>}{r.kind==='SAIDA'&&<em className="nae-kind">Saiu da curva · não é migração</em>}
          {r.growth&&<span className="nae-growth">{GROWTH[r.growth]}</span>}</td></tr>)}</tbody></table></div>
    {cmp.entries_truncated&&<p className="nae-muted" data-testid="limit-note">Mostrando {cmp.entries.length} de {nf(cmp.entries_total)} produtos; classes e contagens usam todos.</p>}
  </>;
}

function History({history}){
  const W=720,H=200,pad=34,bw=Math.max(10,Math.min(34,(W-pad*2)/history.length-8));
  const max=Math.max(1,...history.map(h=>h.class_counts?h.class_counts.A+h.class_counts.B+h.class_counts.C:0));
  const x=i=>pad+i*((W-pad*2)/history.length)+((W-pad*2)/history.length-bw)/2;
  const conc=['top1','top3','top5','top10'];
  const concColor={top1:'#0f172a',top3:'#2a78d6',top5:'#7b4fd4',top10:'#eb6834'};
  const cy=v=>H-24-(v/100)*(H-50);
  return <div className="nae-hist" data-testid="history">
    <figure><figcaption>Produtos por classe, por mês <small>(listras = cobertura não comprovada; meses bloqueados ficam vazios)</small></figcaption>
      <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label="Quantidade de produtos por classe em cada mês">
        <defs><pattern id="nae-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" strokeWidth="3"/></pattern></defs>
        {history.map((h,i)=>{
          if(!h.class_counts)return <text key={h.key} x={x(i)+bw/2} y={H-30} textAnchor="middle" fontSize="10" fill="#94a3b8">—</text>;
          let y=H-24;const scale=(H-50)/max;
          return <g key={h.key} data-testid={'bar-'+h.key} opacity={h.status==='CONFIRMADO'?1:0.8}>{['C','B','A'].map(c=>{const hh=h.class_counts[c]*scale;y-=hh;
            return <rect key={c} x={x(i)} y={y} width={bw} height={Math.max(0,hh-1.5)} rx="3" fill={h.status==='CONFIRMADO'?CLS_COLOR[c]:'url(#nae-hatch)'} stroke={CLS_COLOR[c]} strokeWidth={h.status==='CONFIRMADO'?0:1.5}/>;})}</g>;})}
        {history.map((h,i)=><text key={'l'+h.key} x={x(i)+bw/2} y={H-8} textAnchor="middle" fontSize="10" fill="#475569">{mesPt(h.key)}{h.incomplete?'*':''}</text>)}
      </svg>
      <p className="nae-legend">{['A','B','C'].map(c=><span key={c}><i style={{background:CLS_COLOR[c]}}/>Classe {c}</span>)}<span>* mês incompleto (até o último dia completo)</span></p></figure>
    <figure><figcaption>Concentração das unidades (top 1, 3, 5 e 10) <small>— não prova redução do catálogo ativo</small></figcaption>
      <svg viewBox={'0 0 '+W+' '+H} role="img" aria-label="Concentração das vendas nos principais produtos">
        {[0,25,50,75,100].map(g=><g key={g}><line x1={pad} x2={W-pad} y1={cy(g)} y2={cy(g)} stroke="#e2e8f0"/><text x={pad-4} y={cy(g)+3} textAnchor="end" fontSize="9" fill="#64748b">{g}%</text></g>)}
        {conc.map(k=>{const pts=history.map((h,i)=>({i,v:(h.concentration||h.concentration_provisional)?.[k],ok:h.status==='CONFIRMADO'})).filter(p=>p.v!=null);
          return <g key={k} data-testid={'line-'+k}><polyline fill="none" stroke={concColor[k]} strokeWidth="2" points={pts.map(p=>(x(p.i)+bw/2)+','+cy(p.v)).join(' ')}/>
            {pts.map(p=><circle key={p.i} cx={x(p.i)+bw/2} cy={cy(p.v)} r="3" fill={p.ok?concColor[k]:'#fff'} stroke={concColor[k]} strokeWidth="1.5"/>)}</g>;})}
        {history.map((h,i)=><text key={'c'+h.key} x={x(i)+bw/2} y={H-8} textAnchor="middle" fontSize="10" fill="#475569">{mesPt(h.key)}</text>)}
      </svg>
      <p className="nae-legend">{conc.map(k=><span key={k}><i style={{background:concColor[k]}}/>{k.replace('top','Top ')}</span>)}<span>círculo vazio = não confirmado</span></p></figure>
    <details className="nae-recon"><summary>Ver os números do histórico em tabela</summary>
      <div className="nae-scroll"><table className="nae-table" data-testid="history-table"><thead><tr><th>Mês</th><th>Situação</th><th className="num">A</th><th className="num">B</th><th className="num">C</th><th className="num">Top 1</th><th className="num">Top 3</th><th className="num">Top 5</th><th className="num">Top 10</th></tr></thead>
        <tbody>{history.map(h=>{const c=h.concentration||h.concentration_provisional;return <tr key={h.key}><td>{mesPt(h.key)}{h.incomplete&&' (incompleto)'}</td><td>{STATUS[h.status]}</td>
          {['A','B','C'].map(k=><td key={k} className="num">{h.class_counts?h.class_counts[k]:'—'}</td>)}{conc.map(k=><td key={k} className="num">{c?pct(c[k]):'—'}</td>)}</tr>;})}</tbody></table></div></details>
  </div>;
}

export default function CommerceAbcEvolution(){
  const [platform,setPlatform]=useState('SHOPEE');
  const [mode,setMode]=useState('7d');
  const [month,setMonth]=useState('');
  const [entry,setEntry]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [tick,setTick]=useState(0);
  const [view,setView]=useState('migracoes');
  const monthOn=mode==='mensal'||mode==='anual';
  const key=scopeKey({platform,days:mode,month:monthOn?month:''});
  useEffect(()=>{
    setEntry(null);setError('');setLoading(true);
    const c=new AbortController();
    const q='platform='+platform+'&mode='+mode+(monthOn&&month?'&month='+month:'');
    fetchCommercialManager('/api/admin/commerce/abc-evolution?'+q,{signal:c.signal})
      .then(d=>{if(!c.signal.aborted)setEntry({key,data:d});})
      .catch(e=>{if(!c.signal.aborted)setError(e.message||'Não foi possível carregar a Evolução ABC.');})
      .finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[key,tick]);
  const cur=isCurrentScope(entry,key)?entry.data:null;
  const monthOk=!(monthOn&&month)||(cur?.current?.start||'').startsWith(month);
  const v=cur&&matchesPlatform(cur,platform)&&cur.mode===mode&&monthOk?cur:null;
  const wrong=Boolean(cur&&!v);
  const cmp=v?.comparison;
  const confirmed=cmp?.state==='CONFIRMADA';
  const activeView=confirmed?view:'todos';
  return <div className="nae" data-testid="abc-evolution">
    <header className="nae-head">
      <div><h1>Evolução ABC por produto</h1><p>Curva ABC por <b>unidades vendidas</b> em cada conta, por SKU. Somente leitura. A Curva ABC do Dashboard continua como está.</p></div>
      <div className="nae-controls">
        <div className="nae-seg" role="group" aria-label="Conta">{PLATFORMS.map(p=><button key={p.id} type="button" aria-pressed={platform===p.id} className={platform===p.id?'is-active':''} onClick={()=>setPlatform(p.id)}>{p.label}</button>)}</div>
        <div className="nae-seg" role="group" aria-label="Comparação">{MODES.map(m=><button key={m.id} type="button" aria-pressed={mode===m.id} className={mode===m.id?'is-active':''} onClick={()=>setMode(m.id)}>{m.label}</button>)}</div>
        {monthOn&&<label className="nae-month">Mês <select value={month} aria-label="Mês" onChange={e=>setMonth(e.target.value)}><option value="">Mês corrente</option>
          {(v?.history||[]).slice().reverse().map(h=><option key={h.key} value={h.key}>{mesPt(h.key)}{h.incomplete?' (incompleto)':''}</option>)}</select></label>}
      </div>
    </header>
    {loading&&!v&&<p className="nae-loading" role="status">Carregando…</p>}
    {error&&<p className="nae-error" role="alert">{error} <button type="button" className="nae-link" onClick={()=>setTick(x=>x+1)}>Tentar de novo</button></p>}
    {wrong&&<p className="nae-error" role="alert">A resposta recebida não é da conta ou da comparação escolhidas e foi descartada.</p>}
    {v&&v.status!=='OK'&&<p className="nae-error" role="status" data-testid="unavailable">Evolução indisponível agora ({v.reason==='SEM_ULTIMO_DIA_COMPLETO'?'não há dia completo comprovado pela cobertura de vendas':v.reason==='JANELA_INDISPONIVEL'?'a cobertura de vendas não respondeu':v.reason==='MES_SEM_DADOS_COMPLETOS'?'esse mês ainda não tem dias completos':v.reason}). Isto não significa que não houve vendas.</p>}
    {v&&v.status==='OK'&&<>
      <div className="nae-periods" data-testid="periods">
        <p data-testid="window-dates">Último dia completo comprovado: <b>{br(v.last_complete_day)}</b>{v.window?.last_import_day&&<> · última data importada: {br(v.window.last_import_day)}</>}
          {v.window?.skipped?.length>0&&<> · fora da análise por não estarem completos: {v.window.skipped.map(x=>br(x.day)+' ('+({PARCIAL:'parcial',COM_REGISTROS:'só com registros',SEM_INFORMACAO:'sem informação'}[x.state]||x.state)+')').join(', ')}</>}</p>
        <ul className="nae-plist"><PeriodLine label="Atual" p={v.current} tid="period-current"/><PeriodLine label="Anterior" p={v.previous} tid="period-previous"/></ul>
        {v.note&&<p className="nae-notice" role="status" data-testid="plan-note">{v.note}</p>}
        <p className="nae-muted" data-testid="coverage-note">Só os períodos com cobertura de vendas comprovada (GA-018) e conciliados (GA-019/GA-021) têm classe confirmada. Histórico sem essa prova é histórico importado, não verificado: nunca vira classe C nem "zero vendas".</p>
      </div>
      {v.failed?.length>0&&<p className="nae-error" role="status" data-testid="parts-down">Consulta indisponível: {v.failed.map(f=>({units:'unidades por SKU',source:'fonte diária de vendas',quality:'cobertura de vendas',split:'divisão por SKU',window:'último dia completo'}[f]||f)).join(', ')}. Isto não significa que não existam vendas.</p>}
      {STATE_TEXT[cmp.state]&&<p className="nae-notice" role="status" data-testid={'state-'+cmp.state}>{STATE_TEXT[cmp.state]}</p>}
      {cmp.entries&&!cmp.state.startsWith('BLOQUEADA')&&<>
        <BaseNote p={v.current}/>
        {confirmed&&!cmp.relevance.relevant&&<p className="nae-notice" role="status" data-testid="low-volume">Volume baixo na conta (menos de {cmp.relevance.min_units} unidades em um dos períodos): as classes são calculadas, mas as mudanças têm baixa relevância comercial.</p>}
        <Cards v={v} cmp={cmp} view={activeView} setView={setView}/>
        <div className="nae-tabs" role="tablist" aria-label="Listas">{VIEWS.map(t=><button key={t.id} type="button" role="tab" aria-selected={activeView===t.id} className={activeView===t.id?'is-active':''} disabled={!confirmed&&t.id!=='todos'} onClick={()=>setView(t.id)}>{t.label}</button>)}</div>
        <Table cmp={cmp} view={activeView}/>
      </>}
      <h2 className="nae-h2">Histórico mensal</h2>
      <History history={v.history}/>
    </>}
  </div>;
}
