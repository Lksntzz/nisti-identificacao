import React,{useEffect,useState} from 'react';
import {fetchCommercialManager} from './commerce-manager-fetch.js';
import {maskMoney} from './commerce-privacy.js';
import {growth,pctText} from './commerce-annual-compare-helpers.js';
import {listingUrl} from './commerce-dashboard.jsx';
import {familyMetricTotals,canLinkFamilyProduct,familyDetailsByMonth} from './commerce-annual-families-helpers.js';
import './commerce-annual-families.css';

const MONTHS=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const PLATFORMS=[['SHOPEE','Shopee'],['MERCADO_LIVRE','Mercado Livre (duas contas)'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas']];
const num=value=>Number(value||0).toLocaleString('pt-BR');
const money=value=>maskMoney(Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const percent=(current,base)=>base==null||current==null?'Sem base':growth(current,base)==null?'Sem base':pctText(growth(current,base));
const initialYear=new Date().getFullYear();

async function postFamily(path,body){
  const response=await fetch('/api/admin/commerce/sales-compare/families'+path,{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'content-type':'application/json'},body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível salvar a alteração.');
  return data;
}

function PairChart({months,metric,year,base}){
  const key=metric==='revenue'?'revenue':'units';
  const values=months.flatMap(row=>[row['base_'+key],row['cur_'+key]]).filter(v=>v!=null).map(Number);
  const max=Math.max(1,...values);
  return <div className="gaf-chart" role="group" aria-label="Comparação mensal entre os dois anos">
    {months.map(row=>{
      const old=row['base_'+key],cur=row['cur_'+key];
      return <div className="gaf-month" key={row.month}>
        <div className="gaf-bars">
          {old!=null&&<span className="gaf-bar base" style={{height:Math.max(2,Number(old)/max*100)+'%'}} title={base+': '+(metric==='revenue'?money(old):num(old))}/>}
          {cur!=null&&<span className="gaf-bar current" style={{height:Math.max(2,Number(cur)/max*100)+'%'}} title={year+': '+(metric==='revenue'?money(cur):num(cur))}/>}
        </div>
        <span>{MONTHS[Number(row.month)-1]}</span>
      </div>;
    })}
  </div>;
}

function FamilyRegistry({catalog,selectedId,onSelected,onUpdated,search,setSearch}){
  const [form,setForm]=useState({name:'',model:'',format:'',category_id:''});
  const [evidence,setEvidence]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const selected=(catalog.families||[]).find(f=>Number(f.id)===Number(selectedId));
  const members=(catalog.members||[]).filter(m=>Number(m.family_id)===Number(selectedId));
  const candidates=(catalog.candidates||[]).filter(p=>!p.family_id);
  const submit=async event=>{
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const result=await postFamily('',{...form,category_id:Number(form.category_id)});
      setForm({name:'',model:'',format:'',category_id:''});
      onSelected(String(result.id));onUpdated();setNotice('Família cadastrada. Confira os produtos antes de vincular.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const changeMember=async(productId,assign)=>{
    setBusy(true);setError('');setNotice('');
    try{
      await postFamily('/member',{
        family_id:Number(selectedId),product_id:Number(productId),assign,
        confirmed,evidence:evidence.trim()
      });
      onUpdated();setEvidence('');setConfirmed(false);
      setNotice(assign?'Produto vinculado após confirmação.':'Vínculo removido; o histórico da alteração foi registrado.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="gaf-registry" aria-labelledby="gaf-registry-title">
    <div className="gaf-section-head"><div><h3 id="gaf-registry-title">Cadastro e revisão de famílias</h3><p>Modelo e formato são obrigatórios. Capas e SKUs diferentes continuam identificados individualmente.</p></div></div>
    <div className="gaf-registry-columns">
      <form className="gaf-form" onSubmit={submit}>
        <h4>Nova família comercial</h4>
        <label>Nome da família<input required minLength={3} maxLength={120} value={form.name} placeholder="Ex.: Agenda diária A5" onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
        <label>Modelo / miolo<input required minLength={2} maxLength={120} value={form.model} placeholder="Ex.: Agenda diária" onChange={e=>setForm(f=>({...f,model:e.target.value}))}/></label>
        <label>Formato físico<input required maxLength={60} value={form.format} placeholder="Ex.: A5" onChange={e=>setForm(f=>({...f,format:e.target.value}))}/></label>
        <label>Categoria<select required value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}>
          <option value="">Selecione uma categoria</option>
          {(catalog.categories||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <button className="gaf-primary" disabled={busy} type="submit">Cadastrar família</button>
      </form>
      <div className="gaf-review">
        <h4>Vinculação manual de Produtos Mestre</h4>
        <label>Família<select value={selectedId||''} onChange={e=>onSelected(e.target.value)}>
          <option value="">Selecione uma família</option>
          {(catalog.families||[]).map(f=><option key={f.id} value={f.id}>{f.name} · {f.format_name}</option>)}
        </select></label>
        {!selected?<p className="gaf-muted">Cadastre ou selecione uma família para revisar os produtos.</p>:<>
          <p className="gaf-muted">{selected.model_name} · {selected.format_name} · {selected.category_name}. {num(members.length)} produto(s) vinculados.</p>
          {members.length>0&&<div className="gaf-linked">{members.map(m=><div key={m.product_id} className="gaf-linked-row">
            <span><strong>{m.name}</strong><small>{m.edition_year?'Edição '+m.edition_year:'Edição não classificada'} · ID {m.product_id}</small></span>
            <button type="button" disabled={busy||!confirmed||evidence.trim().length<8} onClick={()=>changeMember(m.product_id,false)}>Desvincular</button>
          </div>)}</div>}
          <label>Buscar Produto Mestre pelo nome ou SKU<input value={search} maxLength={120} placeholder="Digite pelo menos 2 caracteres" onChange={e=>setSearch(e.target.value)}/></label>
          {search.trim().length>=2&&<div className="gaf-candidates">{candidates.length===0?<p className="gaf-muted">Nenhum produto disponível para esse termo.</p>:candidates.map(p=>{
            const mismatch=!canLinkFamilyProduct(selected,p);
            return <div className="gaf-candidate" key={p.id}><span><strong>{p.name}</strong><small>ID {p.id} · {(p.skus||[]).slice(0,2).join(', ')||'Sem SKU'}{mismatch?' · Categoria diferente':''}</small></span>
              <button type="button" disabled={busy||mismatch||!confirmed||evidence.trim().length<8} onClick={()=>changeMember(p.id,true)}>Vincular</button>
            </div>;
          })}</div>}
          <label>Justificativa da conferência<textarea rows={2} minLength={8} maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Ex.: Mesmo miolo e formato A5, capa diferente, conferido no catálogo"/></label>
          <label className="gaf-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Conferi o modelo e o formato. Confirmo esta alteração.</label>
        </>}
      </div>
    </div>
    {error&&<p role="alert" className="gaf-error">{error}</p>}
    {notice&&<p role="status" className="gaf-success">{notice}</p>}
  </section>;
}

export default function CommerceAnnualFamilies({refresh=0}){
  const [platform,setPlatform]=useState('SHOPEE');
  const [year,setYear]=useState(initialYear);
  const [familyId,setFamilyId]=useState('');
  const [detailMonth,setDetailMonth]=useState('');
  const [metric,setMetric]=useState('units');
  const [mode,setMode]=useState('report');
  const [search,setSearch]=useState('');
  const [revision,setRevision]=useState(0);
  const [catalog,setCatalog]=useState({families:[],categories:[],members:[],candidates:[]});
  const [catalogError,setCatalogError]=useState('');
  const [report,setReport]=useState(null);
  const [reportError,setReportError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>fetchCommercialManager('/api/admin/commerce/sales-compare/families/catalog?search='+encodeURIComponent(search),{signal:controller.signal})
      .then(data=>{setCatalog(data);setCatalogError('');})
      .catch(e=>{if(!controller.signal.aborted)setCatalogError(e.message);}),search?250:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,revision,refresh]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setReportError('');
    fetchCommercialManager('/api/admin/commerce/sales-compare/families/report?platform='+platform+'&year='+year+'&base='+(year-1)+(familyId?'&family_id='+familyId:''),{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){setReport(data);setLoading(false);}})
      .catch(e=>{if(!controller.signal.aborted){setReportError(e.message);setLoading(false);setReport(null);}});
    return()=>controller.abort();
  },[platform,year,familyId,revision,refresh]);
  const families=report?.families||[];
  const selected=families.find(f=>Number(f.id)===Number(familyId)&&familyId);
  const months=report?.months||[];
  const totals=familyMetricTotals(months,metric);
  const details=familyDetailsByMonth(report?.details,detailMonth);
  const format=value=>metric==='revenue'?money(value):num(value)+' un.';
  return <div className="gaf-root">
    <header className="gaf-heading"><div><span className="gaf-eyebrow">INTELIGÊNCIA COMERCIAL</span><h2>Comparação anual · Famílias e edições</h2>
      <p>Mesmo modelo e formato, independentemente da capa. Edição e ano da venda continuam separados.</p></div>
      <div className="gaf-switch"><button className={mode==='report'?'active':''} onClick={()=>setMode('report')}>Analisar vendas</button><button className={mode==='registry'?'active':''} onClick={()=>setMode('registry')}>Gerenciar famílias</button></div>
    </header>
    {mode==='registry'?<>
      {catalogError&&<p className="gaf-error" role="alert">{catalogError}</p>}
      <FamilyRegistry catalog={catalog} selectedId={familyId} onSelected={setFamilyId} onUpdated={()=>setRevision(n=>n+1)} search={search} setSearch={setSearch}/>
    </>:<>
      <div className="gaf-filters">
        <label>Ano em análise<select value={year} onChange={e=>setYear(Number(e.target.value))}>{Array.from({length:Math.max(2,initialYear-2024)},(_,i)=>initialYear-i).map(y=><option key={y} value={y}>{y} × {y-1}</option>)}</select></label>
        <label>Marketplace<select value={platform} onChange={e=>setPlatform(e.target.value)}>{PLATFORMS.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
        <label>Família<select value={familyId} onChange={e=>setFamilyId(e.target.value)}><option value="">Todas as famílias classificadas</option>{families.map(f=><option key={f.id} value={f.id}>{f.name} · {f.format_name}</option>)}</select></label>
        <label>Indicador<select value={metric} onChange={e=>setMetric(e.target.value)}><option value="units">Unidades vendidas</option><option value="revenue">Receita dos produtos</option></select></label>
      </div>
      {loading&&<p className="gaf-muted" role="status">Carregando vendas por família…</p>}
      {reportError&&<p role="alert" className="gaf-error">{reportError}</p>}
      {report&&!loading&&<>
        <div className="gaf-info">Dados até {report.as_of?String(report.as_of).split('-').reverse().join('/'):'data indisponível'} · Relatório somente de vínculos confirmados.
          {!report.base_available&&<strong> Sem cobertura de {year-1}; comparação indisponível.</strong>}
          {(report.platforms_not_comparable||[]).length>0&&<strong> Cobertura desigual entre os anos em: {report.platforms_not_comparable.join(', ')}. Confira cada marketplace separadamente antes de concluir a variação.</strong>}
          {(report.platform_coverage||[]).length>0&&<details className="gaf-coverage"><summary>Ver datas com vendas importadas por conta e ano</summary><ul>{report.platform_coverage.map(v=><li key={v.platform+':'+v.sales_year}>{v.platform} · {v.sales_year}: {String(v.first_date).split('-').reverse().join('/')} a {String(v.last_date).split('-').reverse().join('/')} ({num(v.days_present)} dia(s) com registros)</li>)}</ul><small>Essas datas indicam registros encontrados; não garantem que todas as vendas do período foram importadas.</small></details>}
        </div>
        <div className="gaf-kpis">
          <div><small>{year-1} · período equivalente</small><strong>{report.base_available?format(totals.base):'Sem base'}</strong></div>
          <div><small>{year} · período importado</small><strong>{report.current_available?format(totals.cur):'Sem dados'}</strong></div>
          <div><small>Variação anual</small><strong>{report.base_available&&report.current_available?percent(totals.cur,totals.base):'Sem base'}</strong></div>
          <div><small>Melhor mês {year}</small><strong>{report.current_available&&totals.best?MONTHS[Number(totals.best.month)-1]:'—'}</strong></div>
        </div>
        <section className="gaf-panel"><div className="gaf-section-head"><div><h3>Vendas por mês</h3><p>{selected?selected.name+' · '+selected.format_name:'Famílias já classificadas'} · {metric==='revenue'?'Receita de produtos':'Unidades'}</p></div>
          <div className="gaf-legend"><span><i className="base"/>{year-1}</span><span><i className="current"/>{year}</span></div></div>
          <PairChart months={months} metric={metric} year={year} base={year-1}/>
        </section>
        <section className="gaf-panel"><div className="gaf-section-head"><div><h3>Ranking das famílias</h3><p>Clique em uma família para detalhar edições, capas, SKUs e anúncios.</p></div></div>
          {families.length===0?<p className="gaf-muted">Nenhuma família cadastrada. Use “Gerenciar famílias” para iniciar a classificação.</p>:
            <div className="gaf-table-scroll"><table><thead><tr><th>Família / modelo</th><th>Formato</th><th>Categoria</th><th>{year-1} · un.</th><th>{year} · un.</th><th>Receita {year}</th><th>Variação</th></tr></thead><tbody>
              {families.map(f=><tr key={f.id} className={Number(familyId)===Number(f.id)?'selected':''}>
                <td><button className="gaf-family-link" onClick={()=>setFamilyId(String(f.id))}>{f.name}<small>{f.model_name} · {f.member_count} Produto(s) Mestre</small></button></td><td>{f.format_name}</td><td>{f.category}</td>
                <td>{report.base_available?num(f.base_units):'—'}</td><td>{report.current_available?num(f.cur_units):'—'}</td><td>{report.current_available?money(f.cur_revenue):'—'}</td>
                <td>{report.base_available&&report.current_available?percent(f.cur_units,f.base_units):'—'}</td>
              </tr>)}
            </tbody></table></div>}
          {report.current_available&&<p className="gaf-muted">Das vendas de {year}, {num(report.overall?.unclassified_cur_units)} unidades ainda estão fora das famílias: {num(report.overall?.without_family_cur_units)} têm Produto Mestre identificado, mas aguardam classificação; {num(report.overall?.unmapped_cur_units)} não possuem identificação segura de Produto Mestre. Essas vendas não são tratadas como zero nem atribuídas a outra família.</p>}
        </section>
        {selected&&<section className="gaf-panel"><div className="gaf-section-head"><div><h3>{selected.name} · edições e anúncios</h3><p>Compare o mesmo mês de cada ano, mantendo separadas as capas, os SKUs e os anúncios.</p></div><div className="gaf-detail-tools"><label>Período do detalhe<select value={detailMonth} onChange={e=>setDetailMonth(e.target.value)}><option value="">Ano inteiro</option>{MONTHS.map((m,i)=><option value={i+1} key={m}>{m} · {year-1} × {year}</option>)}</select></label><button className="gaf-secondary" onClick={()=>setFamilyId('')}>Todas as famílias</button></div></div>
          <div className="gaf-table-scroll"><table><thead><tr><th>Produto / capa</th><th>Edição</th><th>SKU</th><th>Marketplace / anúncio</th><th>{year-1} · un.</th><th>{year} · un.</th><th>Receita {year}</th></tr></thead><tbody>
            {details.map((row,i)=>{
              const url=listingUrl(row.platform==='SHOPEE'?'SHOPEE':'ML',row.listing_id);
              return <tr key={[row.product_id,row.sku,row.platform,row.listing_id,i].join(':')}>
                <td>{row.product_name}</td><td>{row.edition_year||'A revisar'}</td><td className="gaf-sku">{row.sku}</td>
                <td>{row.platform} · {url?<a href={url} target="_blank" rel="noopener noreferrer">{row.listing_id} ↗</a>:row.listing_id}</td>
                <td>{report.base_available?num(row.base_units):'—'}</td><td>{num(row.cur_units)}</td><td>{money(row.cur_revenue)}</td>
              </tr>;
            })}</tbody></table></div>
          {details.length===0&&<p className="gaf-muted">Nenhuma venda atribuída a essa família no período selecionado.</p>}
        </section>}
      </>}
    </>}
  </div>;
}
