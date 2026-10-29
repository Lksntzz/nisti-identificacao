import React, { useEffect, useState } from 'react';
import { fetchCommercialManager } from './commerce-manager-fetch.js';
import { productLabel } from './commerce-annual-compare-helpers.js';

const MON = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const ddmmyy = iso => String(iso||'').slice(8,10)+'/'+String(iso||'').slice(5,7)+'/'+String(iso||'').slice(0,4);

function useFetch(path, deps) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    const c = new AbortController();
    setState({ loading: true, error: '', data: null });
    fetchCommercialManager(path, { signal: c.signal })
      .then(data => { if (!c.signal.aborted) setState({ loading: false, error: '', data }); })
      .catch(e => { if (!c.signal.aborted) setState({ loading: false, error: e?.message || 'Não foi possível carregar.', data: null }); });
    return () => c.abort();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

const qs = (platform, year, base) => 'platform=' + encodeURIComponent(platform) + '&year=' + year + '&base=' + base;

// Índice 100 = média dos meses COMPLETOS do mesmo ano. Só meses completos entram na média e no destaque.
function indexRow(values, done) {
  const full = values.slice(0, done);
  const avg = full.length ? full.reduce((a, b) => a + b, 0) / full.length : 0;
  return { avg, idx: values.map((v, i) => (avg > 0 && i < done ? Math.round(100 * v / avg) : null)) };
}
const heat = i => (i == null ? '' : i >= 150 ? ' h4' : i >= 120 ? ' h3' : i >= 90 ? ' h2' : ' h1');

function HeatRows({ rows, year, base, done }) {
  return <div className="ga-y-scroll"><table className="ga-y-heat"><thead><tr><th>Categoria</th><th>Ano</th>{MON.map(m => <th key={m}>{m}</th>)}</tr></thead>
    <tbody>{rows.flatMap(r => {
      const b = indexRow(r.months.map(m => Number(m.base)), 12), c = indexRow(r.months.map(m => Number(m.cur)), done);
      return [
        <tr key={r.name + 'b'}><th rowSpan={2}>{r.name}</th><td>{base}</td>{b.idx.map((v, i) => <td key={i} className={'ga-y-hc' + heat(v)} title={MON[i] + '/' + base + ': ' + Number(r.months[i].base).toLocaleString('pt-BR') + ' un.'}>{v ?? '—'}</td>)}</tr>,
        <tr key={r.name + 'c'}><td>{year}</td>{c.idx.map((v, i) => <td key={i} className={'ga-y-hc' + heat(v)} title={MON[i] + '/' + year + ': ' + Number(r.months[i].cur).toLocaleString('pt-BR') + ' un.'}>{v ?? '—'}</td>)}</tr>
      ];
    })}</tbody></table></div>;
}

function PeakList({ title, list, fmt }) {
  return <div className="ga-y-peaks"><h5>{title}</h5>
    {list.length === 0 ? <p className="ga-y-muted">Nenhum dia muito acima do normal.</p> :
      <ul>{list.map(d => <li key={d.date}>
        <div><strong>{ddmmyy(d.date)}</strong> <span>{fmt(d.units)} un. (normal ≈ {fmt(Math.round(d.avg))})</span></div>
        <small>{(d.top || []).map(t => productLabel(t.name, t.sku).title + ' (' + fmt(t.units) + ')').join(' · ')}</small>
      </li>)}</ul>}
  </div>;
}

export function Seasonality({ platform, year, base, refresh, fmt, amount }) {
  const { loading, error, data } = useFetch('/api/admin/commerce/sales-compare/annual-seasonality?' + qs(platform, year, base), [platform, year, base, refresh]);
  if (loading) return <p className="ga-y-muted" role="status">Calculando picos e sazonalidade…</p>;
  if (error) return <div className="ga-y-error" role="alert"><span>{error}</span></div>;
  const done = Number(data.complete_months) || 0;
  const months = data.months || [];
  const maxM = Math.max(1, ...months.flatMap(m => [Number(m.base), Number(m.cur)]));
  const seas = data.seasonal_products || [];
  const same = seas.filter(s => s.same);
  const others = seas.filter(s => !s.same).slice(0, 6);
  return <div className="ga-y-season">
    <section className="ga-y-main" aria-label="Meses de maior venda">
      <header><div><h3>Meses de maior venda</h3><p>Unidades por mês · {base} × {year}</p></div></header>
      <div className="ga-y-monthbars" role="list">
        {months.map(m => {
          const partial = Number(m.cur_days) > 0 && Number(m.cur_days) < new Date(year, Number(m.m), 0).getDate();
          return <div role="listitem" key={m.m} className="ga-y-mb">
            <span className="ga-y-mb-bars" aria-hidden="true"><i className="is-base" style={{ height: 100 * Number(m.base) / maxM + '%' }} /><i className="is-current" style={{ height: 100 * Number(m.cur) / maxM + '%' }} /></span>
            <b>{MON[m.m - 1]}</b>
            <small>{fmt(m.base)}</small><small>{Number(m.cur) > 0 ? fmt(m.cur) : '—'}{partial ? '*' : ''}</small>
          </div>;
        })}
      </div>
      <p className="ga-y-note">Barra clara = {base}; barra escura = {year}. * mês em andamento ({year}). Novembro e dezembro de {year} ainda não aconteceram: só dá para confirmar o pico do fim do ano quando eles fecharem.</p>
    </section>

    <section className="ga-y-main" aria-label="Calendário de picos por categoria">
      <header><div><h3>Calendário de picos por categoria</h3><p>Índice 100 = mês médio da própria categoria no ano (só meses completos em {year}). Passe o mouse para ver as unidades.</p></div></header>
      {(data.categories || []).length === 0 ? <p className="ga-y-muted">Sem categorias com volume suficiente.</p> : <HeatRows rows={data.categories} year={year} base={base} done={done} />}
      <p className="ga-y-note">Quanto mais forte a cor, mais o mês está acima do mês médio. Compare a linha de {base} com a de {year}: o mesmo mês forte nas duas linhas indica sazonalidade.</p>
    </section>

    <section className="ga-y-main" aria-label="Dias de pico">
      <header><div><h3>Dias de pico</h3><p>Dias bem acima das 4 semanas anteriores e os produtos que puxaram</p></div></header>
      <div className="ga-y-peaks-grid">
        <PeakList title={String(base)} list={(data.peak_days?.base) || []} fmt={fmt} />
        <PeakList title={String(year)} list={(data.peak_days?.cur) || []} fmt={fmt} />
      </div>
      <p className="ga-y-note">Picos em dias de data dupla (ex.: 7/7, 8/8, 9/9) costumam ser campanhas da plataforma. Confirme com o calendário de campanhas antes de tratar como demanda natural.</p>
    </section>

    <section className="ga-y-main" aria-label="Produtos sazonais">
      <header><div><h3>Produtos sazonais</h3><p>Mesmo mês forte (±1 mês) em {base} e {year}, com volume relevante</p></div></header>
      {same.length === 0 ? <p className="ga-y-muted">Nenhum produto repetiu o pico no mesmo mês com volume relevante (meses completos até {MON[done - 1] || '—'}).</p> :
        <div className="ga-y-scroll"><table className="ga-y-table"><thead><tr><th>Produto</th><th>Pico {base}</th><th>Pico {year}</th><th>Total {base}</th><th>Total {year}</th></tr></thead>
          <tbody>{same.map(s => <tr key={s.family}><td><span title={s.name}>{productLabel(s.name, s.sku).title}</span></td>
            <td>{MON[s.base_peak_month - 1]} · {fmt(s.base_peak_units)} un.</td><td>{MON[s.cur_peak_month - 1]} · {fmt(s.cur_peak_units)} un.</td>
            <td>{fmt(s.base_total)}</td><td>{fmt(s.cur_total)}</td></tr>)}</tbody></table></div>}
      {others.length > 0 && <details className="ga-y-details"><summary>Produtos com pico em meses diferentes ({others.length})</summary>
        <ul>{others.map(s => <li key={s.family}>{productLabel(s.name, s.sku).title}: pico em {MON[s.base_peak_month - 1]} de {base} e em {MON[s.cur_peak_month - 1]} de {year}.</li>)}</ul></details>}
      {(data.pending_peaks || []).length > 0 && <details className="ga-y-details"><summary>Picos de {base} ainda por acontecer em {year} ({data.pending_peaks.length})</summary>
        <ul>{data.pending_peaks.map(s => <li key={s.family}>{productLabel(s.name, s.sku).title}: foi mais forte em {MON[s.peak_month - 1]} de {base} ({fmt(s.peak_units)} un.). Vale preparar estoque.</li>)}</ul></details>}
      <p className="ga-y-note">Agrupamos variações do mesmo SKU (ex.: troca de ano no código). Só dois anos de história: dois picos no mesmo mês sugerem sazonalidade, mas não provam; campanhas e lançamentos também geram picos.</p>
    </section>
  </div>;
}

export function Launches({ platform, year, base, refresh, fmt, amount }) {
  const { loading, error, data } = useFetch('/api/admin/commerce/sales-compare/annual-launches?' + qs(platform, year, base), [platform, year, base, refresh]);
  if (loading) return <p className="ga-y-muted" role="status">Carregando lançamentos…</p>;
  if (error) return <div className="ga-y-error" role="alert"><span>{error}</span></div>;
  const s = data.summary || {}, t = data.total || {};
  const pct = Number(t.units) > 0 ? (100 * Number(s.units) / Number(t.units)).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '0';
  const rows = data.products || [];
  return <div className="ga-y-season">
    <section className="ga-y-main" aria-label="Resumo dos lançamentos">
      <header><div><h3>Lançamentos de {year}</h3><p>Produtos sem nenhuma venda em {base} inteiro</p></div></header>
      <div className="ga-y-kpis">
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Produtos novos</span><strong>{fmt(s.count || 0)}</strong></div>
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Unidades vendidas</span><strong>{fmt(s.units || 0)}</strong><span className="ga-y-kpi-reference">{pct}% das vendas do ano</span></div>
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Receita</span><strong>{amount(s.revenue || 0)}</strong></div>
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Últimos 28 dias</span><strong>{fmt(s.units_28d || 0)}</strong></div>
      </div>
      {(data.by_month || []).length > 0 && <p className="ga-y-note">Estreias por mês: {data.by_month.map(m => MON[m.m - 1] + ' ' + m.count + ' (' + fmt(m.units) + ' un.)').join(' · ')}.</p>}
    </section>
    <section className="ga-y-main" aria-label="Lista de lançamentos">
      <header><div><h3>Os 60 lançamentos que mais venderam</h3><p>Ordenado por unidades em {year}</p></div></header>
      <div className="ga-y-scroll"><table className="ga-y-table"><thead><tr><th>Produto</th><th>1ª venda</th><th>Unidades</th><th>Receita</th><th>Últ. 28 dias</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.sku}><td><span title={r.name}>{productLabel(r.name, r.sku).title}</span><small>{r.category ? r.category + ' · ' : ''}{r.sku}</small></td>
          <td>{ddmmyy(r.first_sale)}</td><td>{fmt(r.units)}</td><td>{amount(r.revenue)}</td><td>{fmt(r.units_28d)}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={5} className="ga-y-muted">Nenhum lançamento no período.</td></tr>}</tbody></table></div>
      <p className="ga-y-note">“Lançamento” = SKU sem venda importada em {base}. Se você trocou o SKU de um anúncio antigo, ele aparece aqui mesmo sendo antigo; só o ID do anúncio resolve isso e o relatório de vendas da Shopee não traz esse ID.</p>
    </section>
  </div>;
}
