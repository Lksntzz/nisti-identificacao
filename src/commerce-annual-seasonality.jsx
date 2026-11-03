import React, { useEffect, useState } from 'react';
import { fetchCommercialManager } from './commerce-manager-fetch.js';

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
  return <div className="ga-y-scroll"><table className="ga-y-heat"><thead><tr><th>Anúncio</th><th>Ano</th>{MON.map(m => <th key={m}>{m}</th>)}</tr></thead>
    <tbody>{rows.flatMap(r => {
      const b = indexRow(r.months.map(m => Number(m.base)), 12), c = indexRow(r.months.map(m => Number(m.cur)), done);
      return [
        <tr key={r.id + 'b'}><th rowSpan={2} title={r.title}><span className="ga-y-adtitle">{r.title}</span><small>{r.id}</small></th><td>{base}</td>{b.idx.map((v, i) => <td key={i} className={'ga-y-hc' + heat(v)} title={MON[i] + '/' + base + ': ' + Number(r.months[i].base).toLocaleString('pt-BR') + ' un. (índice ' + (v ?? '—') + ')'}>{v != null && v >= 120 ? v : ''}</td>)}</tr>,
        <tr key={r.id + 'c'}><td>{year}</td>{c.idx.map((v, i) => <td key={i} className={'ga-y-hc' + heat(v)} title={MON[i] + '/' + year + ': ' + Number(r.months[i].cur).toLocaleString('pt-BR') + ' un. (índice ' + (v ?? 'mês incompleto') + ')'}>{v != null && v >= 120 ? v : (v == null ? '–' : '')}</td>)}</tr>
      ];
    })}</tbody></table></div>;
}

function PeakList({ title, list, fmt }) {
  return <div className="ga-y-peaks"><h5>{title}</h5>
    {list.length === 0 ? <p className="ga-y-muted">Nenhum dia muito acima do normal.</p> :
      <ul>{list.map(d => <li key={d.date}>
        <div><strong>{ddmmyy(d.date)}</strong> <span>{fmt(d.units)} un. · {(Number(d.units) / Number(d.avg)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× o normal</span></div>
        <small>{(d.top || []).map(t => t.title + ' (' + fmt(t.units) + ')').join(' · ')}</small>
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
  const seas = data.seasonal_listings || [];
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

    <section className="ga-y-main" aria-label="Calendário de picos por anúncio">
      <header><div><h3>Calendário de picos por anúncio</h3><p>Os 12 anúncios que mais venderam. Índice 100 = mês médio do próprio anúncio no ano (só meses completos em {year}). Passe o mouse para ver as unidades.</p></div></header>
      {(data.listings || []).length === 0 ? <p className="ga-y-muted">Sem anúncios com volume suficiente.</p> : <HeatRows rows={data.listings} year={year} base={base} done={done} />}
      <p className="ga-y-note">Cor mais escura = mês mais acima do mês médio do anúncio; o número aparece só nos meses fortes (índice 120 ou mais) e o valor de cada mês está na dica ao passar o mouse. “–” = mês ainda sem fechar. Mesmo mês forte nas duas linhas sugere sazonalidade.</p>
    </section>

    <section className="ga-y-main" aria-label="Dias de pico">
      <header><div><h3>Dias de pico</h3><p>Dias bem acima das 4 semanas anteriores e os produtos que puxaram</p></div></header>
      <div className="ga-y-peaks-grid">
        <PeakList title={String(base)} list={(data.peak_days?.base) || []} fmt={fmt} />
        <PeakList title={String(year)} list={(data.peak_days?.cur) || []} fmt={fmt} />
      </div>
      <p className="ga-y-note">Picos em dias de data dupla (ex.: 7/7, 8/8, 9/9) costumam ser campanhas da plataforma. Confirme com o calendário de campanhas antes de tratar como demanda natural.</p>
    </section>

    <section className="ga-y-main" aria-label="Anúncios sazonais">
      <header><div><h3>Anúncios sazonais</h3><p>Mesmo mês forte (±1 mês) em {base} e {year}, com volume relevante</p></div></header>
      {same.length === 0 ? <p className="ga-y-muted">Nenhum anúncio repetiu o pico no mesmo mês com volume relevante (meses completos até {MON[done - 1] || '—'}).</p> :
        <div className="ga-y-scroll"><table className="ga-y-table"><thead><tr><th>Anúncio</th><th>Pico {base}</th><th>Pico {year}</th><th>Total {base}</th><th>Total {year}</th></tr></thead>
          <tbody>{same.map(s => <tr key={s.id}><td><span title={s.title}>{s.title}</span><small>{s.id}</small></td>
            <td>{MON[s.base_peak_month - 1]} · {fmt(s.base_peak_units)} un.</td><td>{MON[s.cur_peak_month - 1]} · {fmt(s.cur_peak_units)} un.</td>
            <td>{fmt(s.base_total)}</td><td>{fmt(s.cur_total)}</td></tr>)}</tbody></table></div>}
      {others.length > 0 && <details className="ga-y-details"><summary>Anúncios com pico em meses diferentes ({others.length})</summary>
        <ul>{others.map(s => <li key={s.id}>{s.title} ({s.id}): pico em {MON[s.base_peak_month - 1]} de {base} e em {MON[s.cur_peak_month - 1]} de {year}.</li>)}</ul></details>}
      {(data.pending_peaks || []).length > 0 && <details className="ga-y-details"><summary>Picos de {base} ainda por acontecer em {year} ({data.pending_peaks.length})</summary>
        <ul>{data.pending_peaks.map(s => <li key={s.id}>{s.title} ({s.id}): foi mais forte em {MON[s.peak_month - 1]} de {base} ({fmt(s.peak_units)} un.). Vale preparar estoque.</li>)}</ul></details>}
      <p className="ga-y-note">Cada linha é um anúncio (pelo número), somando todas as variações dele. Só dois anos de história: dois picos no mesmo mês sugerem sazonalidade, mas não provam; campanhas e lançamentos também geram picos.</p>
    </section>
  </div>;
}

export function Launches({ platform, year, base, refresh, fmt, amount }) {
  const { loading, error, data } = useFetch('/api/admin/commerce/sales-compare/annual-launches?' + qs(platform, year, base), [platform, year, base, refresh]);
  const [open, setOpen] = useState(null);
  if (loading) return <p className="ga-y-muted" role="status">Carregando lançamentos…</p>;
  if (error) return <div className="ga-y-error" role="alert"><span>{error}</span></div>;
  const s = data.summary || {}, t = data.total || {};
  const pct = Number(t.units) > 0 ? (100 * Number(s.units) / Number(t.units)).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '0';
  const rows = data.listings || [];
  return <div className="ga-y-season">
    <section className="ga-y-main" aria-label="Resumo dos lançamentos">
      <header><div><h3>Anúncios novos de {year}</h3><p>Anúncios (pelo número) sem nenhuma venda em {base} inteiro</p></div></header>
      <div className="ga-y-kpis">
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Anúncios novos</span><strong>{fmt(s.count || 0)}</strong><span className="ga-y-kpi-reference">{fmt(s.variations || 0)} variações vendidas</span></div>
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Unidades vendidas</span><strong>{fmt(s.units || 0)}</strong><span className="ga-y-kpi-reference">{pct}% das vendas do ano</span></div>
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Receita</span><strong>{amount(s.revenue || 0)}</strong></div>
        <div className="ga-y-kpi"><span className="ga-y-kpi-label">Últimos 28 dias</span><strong>{fmt(s.units_28d || 0)}</strong></div>
      </div>
      {(data.by_month || []).length > 0 && <p className="ga-y-note">Estreias por mês: {data.by_month.map(m => MON[m.m - 1] + ' ' + m.count + ' (' + fmt(m.units) + ' un.)').join(' · ')}.</p>}
    </section>
    <section className="ga-y-main" aria-label="Lista de anúncios novos">
      <header><div><h3>Anúncios novos que mais venderam</h3><p>Clique no anúncio para ver as variações dele</p></div></header>
      <div className="ga-y-scroll"><table className="ga-y-table"><thead><tr><th>Anúncio</th><th>1ª venda</th><th>Unidades</th><th>Receita</th><th>Últ. 28 dias</th></tr></thead>
        <tbody>{rows.flatMap(r => {
          const isOpen = open === r.id;
          const head = <tr key={r.id} className="ga-y-adrow" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
            <td><button type="button" className="ga-y-adbtn" aria-expanded={isOpen}><i aria-hidden="true">{isOpen ? '▾' : '▸'}</i><span title={r.title}>{r.title}</span></button><small>Anúncio {r.id} · {(r.variations || []).length} variação(ões)</small></td>
            <td>{ddmmyy(r.first_sale)}</td><td>{fmt(r.units)}</td><td>{amount(r.revenue)}</td><td>{fmt(r.units_28d)}</td></tr>;
          if (!isOpen) return [head];
          return [head, ...(r.variations || []).map(v => <tr key={r.id + v.sku} className="ga-y-varrow">
            <td><span className="ga-y-var">↳ {v.label || v.sku}</span><small>{v.sku}</small></td>
            <td>{ddmmyy(v.first_sale)}</td><td>{fmt(v.units)}</td><td>{amount(v.revenue)}</td><td>{fmt(v.units_28d)}</td></tr>)];
        })}
          {rows.length === 0 && <tr><td colSpan={5} className="ga-y-muted">Nenhum anúncio novo no período.</td></tr>}</tbody></table></div>
      <p className="ga-y-note">“Novo” = o número do anúncio não tem nenhuma venda em {base}. Um anúncio apagado e recriado ganha número novo e aparece aqui. Mostramos até as 15 variações que mais venderam.</p>
    </section>
  </div>;
}

// Anúncios que já vendiam no ano-base, mês a mês nos dois anos. Anúncio novo (sem venda no ano-base) fica fora.
export function ListingMonths({ platform, year, base, refresh, fmt }) {
  const { loading, error, data } = useFetch('/api/admin/commerce/sales-compare/annual-listing-months?' + qs(platform, year, base), [platform, year, base, refresh]);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('loss');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  if (loading) return <p className="ga-y-muted" role="status">Montando a tabela de anúncios por mês…</p>;
  if (error) return <div className="ga-y-error" role="alert"><span>{error}</span></div>;
  const cmon = Number(data.current_month) || 12;
  const all = (data.listings || []).map(l => {
    const ms = (l.months || []).map(m => ({ m: Number(m.m), base: Number(m.base), cur: Number(m.cur) }));
    const cell = ms.map(m => {
      const past = m.m <= cmon;
      const loss = past && m.base >= 20 && m.cur <= 0.5 * m.base;
      const gain = past && m.cur >= 20 && m.cur >= 1.5 * m.base;
      return { ...m, past, loss, zero: loss && m.cur === 0, gain };
    });
    const drops = cell.filter(c => c.past).map(c => ({ m: c.m, d: c.base - c.cur })).filter(x => x.d > 0).sort((a, b) => b.d - a.d);
    const lost = drops.reduce((a, x) => a + x.d, 0);
    const baseYtd = cell.filter(c => c.past).reduce((a, c) => a + c.base, 0);
    const curYtd = cell.filter(c => c.past).reduce((a, c) => a + c.cur, 0);
    const peak = [...cell].sort((a, b) => b.base - a.base)[0];
    return { ...l, cell, peak, baseYtd, curYtd, hasLoss: cell.some(c => c.loss), lost, worst: drops[0] || null };
  });
  const q = query.trim().toLowerCase();
  let rows = all.filter(l => (!q || String(l.title).toLowerCase().includes(q) || String(l.id).includes(q))
    && (filter === 'all' || (filter === 'loss' && l.hasLoss) || (filter === 'gain' && l.cell.some(c => c.gain))));
  rows = [...rows].sort((a, b) => sort === 'loss' ? b.lost - a.lost : Number(b.base_total) - Number(a.base_total));
  const hn = data.hidden_new || { count: 0, units: 0 };
  const pct = (c, b) => (Number(b) > 0 ? Math.round(100 * (Number(c) - Number(b)) / Number(b)) : null);
  return <section className="ga-y-main ga-y-lm" aria-label="Anúncios mês a mês">
    <header><div><h3>Anúncios mês a mês</h3>
      <p>Só anúncios que já vendiam em {base}. Barras de cada mês: cinza = {base}, azul = {year}. Clique num anúncio para ver os números.</p></div></header>
    <p className="ga-y-lm-sum"><b>{fmt(data.old_count)}</b> anúncios já vendiam em {base} (mostrando os {all.length} que mais venderam). Fora da tabela: <b>{fmt(hn.count)}</b> anúncios novos de {year} ({fmt(hn.units)} un.), que não têm base de comparação.</p>
    <div className="ga-y-lm-tools">
      <div className="ga-y-segs" role="group" aria-label="Filtro">
        {[['all', 'Todos'], ['loss', 'Caíram bastante'], ['gain', 'Cresceram']].map(([id, t]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{t}</button>)}
      </div>
      <div className="ga-y-segs" role="group" aria-label="Ordem">
        {[['base', 'Mais vendidos em ' + base], ['loss', 'Maior perda']].map(([id, t]) => <button key={id} type="button" className={sort === id ? 'is-active' : ''} aria-pressed={sort === id} onClick={() => setSort(id)}>{t}</button>)}
      </div>
      <input type="search" placeholder="Buscar nome ou número" value={query} onChange={e => setQuery(e.target.value)} maxLength={80} aria-label="Buscar anúncio" />
    </div>
    {rows.length === 0 ? <p className="ga-y-muted">Nenhum anúncio neste filtro.</p> :
      <div className="ga-y-lml" role="list">
        <div className="ga-y-lml-head" aria-hidden="true"><span>Anúncio</span><span className="ga-y-lml-months">{MON.map(m => <i key={m}>{m[0]}</i>)}</span><span>Pico de {base} → {year}</span><span>Jan–{MON[cmon - 1]}</span></div>
        {rows.map(l => {
          const max = Math.max(1, ...l.cell.flatMap(c => [c.base, c.past ? c.cur : 0]));
          const pk = l.peak && l.peak.base > 0 ? l.peak : null;
          const pkPast = pk && pk.past;
          const pkPct = pkPast ? pct(pk.cur, pk.base) : null;
          const t = pct(l.curYtd, l.baseYtd);
          const isOpen = open === l.id;
          return <div role="listitem" key={l.id} className={'ga-y-lml-item' + (isOpen ? ' is-open' : '')}>
            <button type="button" className="ga-y-lml-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)}>
              <span className="ga-y-lml-name"><span className="ga-y-adtitle" title={l.title}>{l.title}</span><small>{l.id}</small></span>
              <span className="ga-y-lml-months" aria-hidden="true">{l.cell.map(c => <span key={c.m} className="ga-y-lml-m">
                <i className="is-base" style={{ height: Math.max(c.base ? 3 : 0, Math.round(100 * c.base / max)) + '%' }} />
                <i className={'is-cur' + (c.past ? '' : ' is-future')} style={{ height: Math.max(c.past && c.cur ? 3 : 0, Math.round(100 * (c.past ? c.cur : 0) / max)) + '%' }} />
              </span>)}</span>
              <span className="ga-y-lml-peak">{pk ? <><b>{MON[pk.m - 1]}</b> {fmt(pk.base)} un. → {pkPast ? <em className={pkPct != null && pkPct <= -50 ? 'is-down' : pkPct != null && pkPct >= 50 ? 'is-up' : ''}>{fmt(pk.cur)} un.{pkPct != null ? ' (' + (pkPct > 0 ? '+' : '') + pkPct + '%)' : ''}</em> : <em>ainda não chegou</em>}</> : '—'}</span>
              <span className="ga-y-lml-tot"><b>{fmt(l.curYtd)}</b> <small>vs {fmt(l.baseYtd)}</small>{t != null && <em className={l.curYtd >= l.baseYtd ? 'is-up' : 'is-down'}>{t > 0 ? '+' : ''}{t}%</em>}</span>
            </button>
            {isOpen && <div className="ga-y-scroll ga-y-lml-detail"><table className="ga-y-table"><thead><tr><th></th>{MON.map((m, i) => <th key={m}>{m}</th>)}</tr></thead>
              <tbody><tr><th>{base}</th>{l.cell.map(c => <td key={c.m}>{c.base ? fmt(c.base) : '–'}</td>)}</tr>
              <tr><th>{year}</th>{l.cell.map(c => <td key={c.m} className={c.loss ? 'is-down' : c.gain ? 'is-up' : ''}><b>{c.past ? fmt(c.cur) : ''}</b></td>)}</tr></tbody></table></div>}
          </div>;
        })}
      </div>}
    <p className="ga-y-note">O pico é o mês que mais vendeu em {base}; em vermelho quando {year} caiu pela metade ou mais nesse mês. Meses que ainda não aconteceram mostram só a barra cinza.</p>
  </section>;
}
