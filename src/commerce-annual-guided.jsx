import React, { useEffect, useMemo, useState } from 'react';
import { fetchCommercialManager } from './commerce-manager-fetch.js';
import { Dropdown } from './commerce-dashboard.jsx';
import { maskMoney } from './commerce-privacy.js';
import { growth, indexOf, weekHighlights } from './commerce-annual-compare-helpers.js';
import './commerce-annual-guided.css';

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PLATFORMS = [['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre antigo'],['ML_NOVO','Mercado Livre novo'],['TODAS','Todas as plataformas']];
const fmt = value => Number(value).toLocaleString('pt-BR');
const amount = value => maskMoney(Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + fmt(Math.abs(value));
const percent = (current, base) => {
  if (current == null || base == null || Number(base) <= 0) return null;
  const n = growth(Number(current),Number(base));
  return n == null ? null : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%';
};
const hasValue = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const daysInMonth = (year,month) => new Date(year,month,0).getDate();
const deltaClass = (current,base) => Number(current)>=Number(base) ? 'is-up' : 'is-down';

function Trend({cur,base,neutral=false}) {
  if (!hasValue(base) || Number(base) <= 0) return <span className="ga-y-neutral">Sem base</span>;
  return <span className={'ga-y-delta ' + (neutral ? 'is-neutral' : deltaClass(cur,base))}>{percent(cur,base)}</span>;
}

function annualCovered(data,platform) {
  const coverage = data?.coverage;
  if (!Array.isArray(coverage) || !coverage.length) return false;
  const platforms = platform === 'TODAS' ? ['SHOPEE','ML_ANTIGO','ML_NOVO'] : [platform];
  return platforms.every(p=>{
    const current=coverage.find(c=>c.platform===p && Number(c.year)===Number(data.year));
    const previous=coverage.find(c=>c.platform===p && Number(c.year)===Number(data.base_year));
    return !current || Number(current.units)===0 || (previous && Number(previous.units)>0);
  });
}

function Figure({label,value,reference,base,cur,neutral=false,onClick}) {
  return <button className="ga-y-kpi" type="button" onClick={onClick} aria-label={label+', '+value+', abrir detalhes'}>
    <span className="ga-y-kpi-label">{label}</span>
    <strong>{value}</strong>
    <span className="ga-y-kpi-reference">{reference}</span>
    <Trend cur={cur} base={base} neutral={neutral}/>
  </button>;
}

function MonthRows({periods,mode,year,baseYear,baseAvailable,selected,onSelect,asOf}) {
  const max = Math.max(1,...periods.flatMap(p=>[Number(p.base)||0,Number(p.cur)||0]));
  const rows = periods.map(p=>({...p,month:Number(p.key),part:Number(p.key)===Number((asOf||'').slice(5,7))}));
  if(mode==='chart') return <div className="ga-y-chart" role="group" aria-label="Gráfico de comparação mensal">
    {rows.map(p=><button type="button" key={p.month} className={'ga-y-chart-month'+(selected===p.month?' is-selected':'')} onClick={()=>onSelect(p.month)} aria-label={MONTHS[p.month-1]+', '+baseYear+' '+fmt(p.base)+', '+year+' '+fmt(p.cur)}>
      <span className="ga-y-chart-pair">
        <span className="ga-y-chart-bar is-base" style={{height:Math.max(2,100*(Number(p.base)||0)/max)+'%'}}/>
        <span className="ga-y-chart-bar is-current" style={{height:Math.max(2,100*(Number(p.cur)||0)/max)+'%'}}/>
      </span>
      <span>{MONTHS[p.month-1]?.slice(0,3)}</span>
    </button>)}
  </div>;
  return <div className="ga-y-month-list" role="list" aria-label="Comparação mensal">
    <div className={'ga-y-month-heading'+(mode==='table'?' is-table':'')}>
      <span>Mês</span>{mode==='bars'&&<span>Barras comparativas</span>}
      <span>{baseYear}</span><span>{year}</span><span>Diferença</span><span>Variação</span>
    </div>
    {rows.map(p=>{
      const diff=Number(p.cur)-Number(p.base);
      return <button role="listitem" type="button" className={'ga-y-month-row'+(selected===p.month?' is-selected':'')+(mode==='table'?' is-table':'')} key={p.month} onClick={()=>onSelect(p.month)} aria-pressed={selected===p.month}>
        <span className="ga-y-month-name"><strong>{MONTHS[p.month-1]?.slice(0,3)}</strong>{p.part&&<small>Parcial</small>}</span>
        {mode==='bars'&&<span className="ga-y-bar-pair" aria-hidden="true"><i className="is-base" style={{width:100*Number(p.base||0)/max+'%'}}/><i className="is-current" style={{width:100*Number(p.cur||0)/max+'%'}}/></span>}
        <span className="ga-y-num is-base-number">{baseAvailable?fmt(p.base):'—'}</span>
        <span className="ga-y-num is-current-number">{fmt(p.cur)}</span>
        <span className={'ga-y-num '+(baseAvailable?(diff>=0?'is-up':'is-down'):'')}>{baseAvailable?signed(diff):'—'}</span>
        <span className="ga-y-num">{baseAvailable?<Trend cur={p.cur} base={p.base}/>:<span className="ga-y-neutral">Sem base</span>}</span>
      </button>;
    })}
  </div>;
}

function DailyTable({data,loading,error,onRetry,selectedDay,setSelectedDay,week,platform,DayProducts}) {
  if (loading) return <p className="ga-y-muted" role="status">Consultando dados diários…</p>;
  if (error) return <div className="ga-y-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Tentar novamente</button></div>;
  if (!Array.isArray(data?.days)) return <p className="ga-y-muted">Dados diários indisponíveis para o período.</p>;
  const filtered = data.days.filter(d=>Number(d.day)>=(week-1)*7+1 && Number(d.day)<=week*7);
  return <div className="ga-y-daily">
    <table><thead><tr><th>Dia</th><th>{data.base_year}</th><th>{data.year}</th><th>Variação</th></tr></thead>
      <tbody>{filtered.map(d=><tr key={d.day} className={selectedDay===d.day?'is-selected':''}>
        <td><button type="button" onClick={()=>setSelectedDay(selectedDay===d.day?null:d.day)} aria-pressed={selectedDay===d.day}>{String(d.day).padStart(2,'0')}/{String(data.month).padStart(2,'0')}</button></td>
        <td>{d.base==null?'—':fmt(d.base)}</td><td>{d.cur==null?'—':fmt(d.cur)}</td><td>{d.cur!=null&&d.base!=null?<Trend cur={d.cur} base={d.base}/>:<span className="ga-y-neutral">Sem dados</span>}</td>
      </tr>)}</tbody></table>
    {selectedDay!=null&&(()=>{
      const day=filtered.find(d=>d.day===selectedDay);
      if(!day)return null;
      return <div className="ga-y-day-info">
        <strong>Dia {String(selectedDay).padStart(2,'0')}</strong>
        <span>{day.base_date} × {day.cur_date}</span>
        <span>{day.base==null||day.cur==null?'Sem cobertura diária comprovada nas duas datas':'Diferença: '+signed(day.cur-day.base)+' unidades'}</span>
      </div>;
    })()}
    {selectedDay!=null&&(()=>{const day=filtered.find(d=>d.day===selectedDay);
      return day&&day.cur_date&&day.base_date&&DayProducts?<DayProducts platform={platform} curDate={day.cur_date} baseDate={day.base_date} year={data.year} base={data.base_year}/>:null;})()}
    <p className="ga-y-note">Comparação por mesma data do calendário. “—” indica ausência de registro diário confirmado, não zero vendas.</p>
  </div>;
}

export default function GuidedAnnualCompare({
  data, monthData, filters, setFilters, refresh=0, onKpiOpen,
  WeeksCard, Champions, PeriodSummary, PeriodDetails, useAnnualCompare, DayProducts
}) {
  const [display,setDisplay]=useState('bars');
  const [week,setWeek]=useState(1);
  const [showDaily,setShowDaily]=useState(false);
  const [selectedDay,setSelectedDay]=useState(null);
  const [dailyRevision,setDailyRevision]=useState(0);
  const [dailyState,setDailyState]=useState({loading:false,error:'',data:null});
  const [advanced,setAdvanced]=useState('products');
  const [mobileSeries,setMobileSeries]=useState('week');
  const current=Number((data?.as_of||'').slice(5,7))||1;
  const defaultMonth=Math.max(1,current>1?current-1:1);
  const selectedMonth=Number(filters.month)||defaultMonth;
  const year=Number(data.year),baseYear=Number(data.base_year);
  const period=(data.periods||[]).find(p=>Number(p.key)===selectedMonth);
  const baseAvailable=annualCovered(data,filters.platform);
  const validMonthData=monthData && Number(monthData.year)===year &&
    monthData.platform===filters.platform && (!monthData.month || Number(monthData.month)===selectedMonth);
  const monthInfo=useMemo(()=>validMonthData?weekHighlights(monthData.months||[]).find(m=>Number(m.month)===selectedMonth):null,[monthData,validMonthData,selectedMonth]);
  const weekly=monthInfo?.weeks?.filter(w=>w.n<=Math.ceil(daysInMonth(year,selectedMonth)/7))||[];
  const displayedDays=Math.max(0,Math.min(7,daysInMonth(year,selectedMonth)-(week-1)*7));
  const isCurrentMonth=selectedMonth===current;
  const partial=isCurrentMonth && Number((data.as_of||'').slice(8,10))<daysInMonth(year,selectedMonth);
  const isValidWeek=weekly.some(w=>w.n===week);
  const chosenWeek=weekly.find(w=>w.n===week);
  const updateFilters=patch=>setFilters(prev=>({...prev,...patch}));
  const selectMonth=m=>updateFilters({month:String(m)});
  useEffect(()=>{setWeek(1);setShowDaily(false);setSelectedDay(null);setAdvanced('products');},[selectedMonth,filters.platform,year]);
  useEffect(()=>{
    if(!showDaily||!isValidWeek)return;
    const controller=new AbortController();
    setDailyState({loading:true,error:'',data:null});
    const url='/api/admin/commerce/sales-compare/annual-days?platform='+encodeURIComponent(filters.platform)
      +'&month='+selectedMonth+'&week='+week+'&year='+year+'&base='+baseYear;
    fetchCommercialManager(url,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setDailyState({loading:false,error:'',data:result});})
      .catch(err=>{if(!controller.signal.aborted)setDailyState({loading:false,error:err?.message||'Não foi possível carregar o período.',data:null});});
    return ()=>controller.abort();
  },[showDaily,isValidWeek,selectedMonth,week,year,baseYear,filters.platform,dailyRevision,refresh]);
  const k=data.kpi||{};
  const priceCur=Number(k.cur)>0?Number(k.cur_rev)/Number(k.cur):null;
  const priceBase=Number(k.base)>0?Number(k.base_rev)/Number(k.base):null;
  const unitsOf=(p,y)=>Number((data.coverage||[]).find(c=>c.platform===p&&Number(c.year)===Number(y))?.units||0);
  const needsBase=p=>unitsOf(p,baseYear)<=0;
  const NO_BASE='Sem vendas de '+baseYear+' importadas: não dá para comparar';
  const platformOptions=PLATFORMS.map(([id,label])=>[id,label,
    (id==='TODAS'?['SHOPEE','ML_ANTIGO','ML_NOVO'].some(needsBase):needsBase(id))?NO_BASE:null]);
  const selectedBlocked=Boolean(platformOptions.find(o=>o[0]===filters.platform)?.[2]);
  useEffect(()=>{if(selectedBlocked)setFilters(prev=>({...prev,platform:'SHOPEE'}));},[selectedBlocked]);
  const yearChoices=[...new Set((data.coverage||[]).map(c=>Number(c.year)).filter(n=>n>=2021&&n<=2100).concat([year]))].sort((a,b)=>b-a);
  return <div className="ga-y-guided">
    <div className="ga-y-toolbar">
      <Dropdown label="Plataforma" value={filters.platform} options={platformOptions} onChange={v=>updateFilters({platform:v})}/>
      <Dropdown label="Comparação" value={String(year)} options={yearChoices.map(y=>[String(y),y+' × '+(y-1)])} onChange={v=>updateFilters({year:Number(v),base:Number(v)-1,month:''})}/>
      <Dropdown label="Mês" value={filters.month||''} options={[['','Último mês completo'],...MONTHS.map((m,i)=>[String(i+1),m,i>=current?'Mês ainda sem dados':null])]} onChange={v=>updateFilters({month:v})}/>
      <div className="ga-y-view-controls" role="group" aria-label="Visualização mensal">
        {['bars','table','chart'].map((mode,i)=><button type="button" key={mode} className={display===mode?'is-active':''} onClick={()=>setDisplay(mode)} aria-pressed={display===mode}>{['Barras','Tabela','Gráfico'][i]}</button>)}
      </div>
      <span className="ga-y-asof">Dados até {String(data.as_of||'').split('-').reverse().join('/')}</span>
    </div>
    {!baseAvailable&&<p className="ga-y-error" role="note">Sem referência importada suficiente para uma ou mais plataformas em {baseYear}. As diferenças não são apresentadas como crescimento comprovado.</p>}
    <div className="ga-y-kpis">
      <Figure label="Unidades no ano" value={hasValue(k.cur)?fmt(k.cur):'—'} reference={baseYear+': '+(baseAvailable?fmt(k.base||0):'sem base')} cur={k.cur} base={baseAvailable?k.base:null} onClick={()=>onKpiOpen('units')}/>
      <Figure label="Últimos 28 dias" value={hasValue(k.cur28)?fmt(k.cur28):'—'} reference={baseYear+': '+(baseAvailable?fmt(k.base28||0):'sem base')} cur={k.cur28} base={baseAvailable?k.base28:null} onClick={()=>onKpiOpen('l28')}/>
      <Figure label={'Projeção de '+year} value={hasValue(k.projection)?fmt(k.projection):'—'} reference="Estimativa pelo ritmo dos últimos 28 dias" cur={k.projection} base={baseAvailable?k.base_full:null} onClick={()=>onKpiOpen('proj')}/>
      <Figure label="Preço médio por unidade" value={priceCur!=null?amount(priceCur):'—'} reference={baseYear+': '+(priceBase!=null&&baseAvailable?amount(priceBase):'sem base')} cur={priceCur} base={baseAvailable?priceBase:null} neutral onClick={()=>onKpiOpen('price')}/>
    </div>
    <div className="ga-y-body">
      <div className="ga-y-left">
      <section className="ga-y-main" aria-label="Comparação mensal">
        <header><div><h3>Comparação mensal</h3><p>{baseYear} versus {year} · unidades vendidas</p></div>
          <div className="ga-y-legend"><span><i className="is-base"/>{baseYear}</span><span><i className="is-current"/>{year}</span></div></header>
        <MonthRows periods={data.periods||[]} mode={display} year={year} baseYear={baseYear} baseAvailable={baseAvailable} selected={selectedMonth} onSelect={selectMonth} asOf={data.as_of}/>
        <p className="ga-y-note">Selecione um mês para analisar semanas e dias. Os valores seguem os dados importados no GA.</p>
      </section>
      {advanced==='products'&&<Champions month={selectedMonth} monthData={validMonthData&&Number(monthData.month)===selectedMonth?monthData:{top:[],up:[],down:[]}} loading={!(validMonthData&&Number(monthData.month)===selectedMonth)} year={year} base={baseYear}/>}
      {advanced==='mobile'&&<MobilePeriods platform={filters.platform} gran={mobileSeries} onGran={setMobileSeries} year={year} baseYear={baseYear} useAnnualCompare={useAnnualCompare} PeriodSummary={PeriodSummary} PeriodDetails={PeriodDetails}/>}
      </div>
      <aside className="ga-y-investigation" aria-label="Investigação do mês">
        <header><h3>Investigação</h3><p>{MONTHS[selectedMonth-1]} · {PLATFORMS.find(p=>p[0]===filters.platform)?.[1]} · {year} × {baseYear}</p></header>
        <div className="ga-y-result">
          <div><small>Resultado do mês</small><strong>{period?fmt(period.cur):'—'} un.</strong><span>{baseYear}: {baseAvailable&&period?fmt(period.base):'—'} unidades</span></div>
          <div className="ga-y-result-trend">{period&&baseAvailable?<><Trend cur={period.cur} base={period.base}/><small>{signed(Number(period.cur)-Number(period.base))} unidades</small></>:<span className="ga-y-neutral">Sem base</span>}</div>
        </div>
        {partial&&<p className="ga-y-warning">Parcial até {String(data.as_of).split('-').reverse().join('/')}; referência do ano anterior cortada na data equivalente.</p>}
        <div className="ga-y-section-head"><h4>Semanas do mês</h4>{showDaily&&<button type="button" onClick={()=>{setShowDaily(false);setSelectedDay(null);}}>Voltar às semanas</button>}</div>
        {!validMonthData?<p className="ga-y-muted">Carregando análise semanal…</p>:
          weekly.length===0?<p className="ga-y-muted">Sem registros semanais neste mês.</p>:
          <div className="ga-y-week-list">
            <div className="ga-y-week-head"><span>Semana</span><span>{baseYear}</span><span>{year}</span><span>Diferença</span><span>Variação</span></div>
            {weekly.map(w=><button key={w.n} type="button" className={'ga-y-week-row'+(week===w.n?' is-selected':'')} onClick={()=>{setWeek(w.n);setShowDaily(true);setSelectedDay(null);}} aria-pressed={week===w.n}>
              <span>{w.n===5?'29+':String((w.n-1)*7+1).padStart(2,'0')+'–'+Math.min(w.n*7,daysInMonth(year,selectedMonth))}{w.n===5?<small>Faixa curta</small>:null}</span>
              <span>{baseAvailable?fmt(w.base):'—'}</span><span>{fmt(w.cur)}</span>
              <span className={baseAvailable?(Number(w.cur)>=Number(w.base)?'is-up':'is-down'):''}>{baseAvailable?signed(Number(w.cur)-Number(w.base)):'—'}</span>
              <span>{baseAvailable?<><Trend cur={w.cur} base={w.base}/>{week===w.n&&indexOf(w.cur,w.base)!=null&&<em className="ga-y-idx" title="100 = igual ao ano anterior">Índice {indexOf(w.cur,w.base)}</em>}</>:<span className="ga-y-neutral">—</span>}</span>
            </button>)}
          </div>}
        {showDaily&&isValidWeek&&<div className="ga-y-daily-section">
          <div className="ga-y-section-head"><h4>Comparação diária</h4><small>{displayedDays} dia(s) · {MONTHS[selectedMonth-1]}</small></div>
          <DailyTable data={dailyState.data && Number(dailyState.data.month)===selectedMonth && Number(dailyState.data.week)===week && Number(dailyState.data.year)===year && dailyState.data.platform===filters.platform ? dailyState.data : null} loading={dailyState.loading} error={dailyState.error} onRetry={()=>setDailyRevision(v=>v+1)} selectedDay={selectedDay} setSelectedDay={setSelectedDay} week={week} platform={filters.platform} DayProducts={DayProducts}/>
        </div>}
        <div className="ga-y-advanced-actions">
          <button type="button" onClick={()=>setAdvanced(advanced==='products'?'':'products')}>{advanced==='products'?'Ocultar':'Ver'} campeões do mês</button>
          <button type="button" onClick={()=>setAdvanced(advanced==='mobile'?'':'mobile')}>{advanced==='mobile'?'Ocultar':'Ver'} série móvel</button>
        </div>
      </aside>
    </div>
  </div>;
}
function MobilePeriods({platform,gran,onGran,year,baseYear,useAnnualCompare,PeriodSummary,PeriodDetails}) {
  const {loading,error,data}=useAnnualCompare({platform,gran,year,base:baseYear});
  return <section className="ga-y-mobile-series">
    <div className="ga-y-section-head"><h3>Séries móveis</h3>
      <div className="ga-y-view-controls">{[['week','Últimas 12 semanas'],['day','Últimos 30 dias']].map(([id,text])=><button type="button" className={gran===id?'is-active':''} key={id} onClick={()=>onGran(id)}>{text}</button>)}</div>
    </div>
    <p className="ga-y-note">Comparação com 364 dias antes para manter o mesmo dia da semana. Não equivale às semanas de 1–7 dentro do mês.</p>
    {loading&&<p role="status">Carregando série móvel…</p>}
    {error&&<p role="alert">{error}</p>}
    {data&&<div className="ga-y-mobile-grid"><PeriodSummary data={data}/><PeriodDetails data={data}/></div>}
  </section>;
}
