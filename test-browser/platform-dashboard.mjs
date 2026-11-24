// GA-012 — Chromium real: seletor de plataformas do Dashboard Comercial com API SIMULADA (dados fictícios).
// Cobre troca rápida, respostas lentas e fora de ordem, retorno à conta inicial e preservação do período.
// NUNCA executar contra workers.dev, Supabase ou endpoints externos de produção.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.NISTI_HARNESS_BASE || 'http://127.0.0.1:4173';
const URL_OVERVIEW = BASE + '/test-browser/harness/platform-dashboard.html';
const URL_EXPLORER = URL_OVERVIEW + '?mode=explorer';
const UNITS = { TODAS: 666, SHOPEE: 111, ML_ANTIGO: 222, ML_NOVO: 333 }; // valores fictícios e distintos por conta
const LABEL = { TODAS: 'Consolidado', SHOPEE: 'Shopee', ML_ANTIGO: 'ML Antigo', ML_NOVO: 'ML Novo' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Cada pedido do dashboard principal pode ser SEGURADO até o teste liberar, para forçar respostas lentas e fora de ordem.
function createSimulator() {
  const calls = [];
  const opts = { zero: [], dqGap: false, problemsWindow: 0 };
  const holds = new Map(); // 'SHOPEE|30' -> { gate, release }
  const key = (platform, days) => platform + '|' + days;
  const hold = (platform, days = 30) => {
    let release; const gate = new Promise(r => { release = r; });
    holds.set(key(platform, days), { gate, release });
  };
  const release = (platform, days = 30) => holds.get(key(platform, days))?.release();
  const handler = async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ path: url.pathname, method: request.method(), query: Object.fromEntries(url.searchParams) });
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (request.method() !== 'GET') return json({ error: 'Escrita bloqueada no teste de navegador' }, 403);
    const platform = url.searchParams.get('platform') || 'TODAS';
    const days = Number(url.searchParams.get('days') || 30);
    const units = UNITS[platform];
    if (url.pathname === '/api/admin/commerce/sales-dashboard') {
      const h = holds.get(key(platform, days));
      if (h) await h.gate;
      return json({
        platform, last_day: '2026-11-20', current_start: '2026-10-22', previous_start: '2026-09-22',
        first_day: '2026-02-03',
        totals: opts.zero.includes(platform) ? { cur_units: 0, prev_units: 5, cur_rev: 0, prev_rev: 50 } : { cur_units: units, prev_units: units - 1, cur_rev: units * 10, prev_rev: units * 9 },
        items: [], drops: [], best: [], new: [], no_sales: [], alerts: []
      });
    }
    if (url.pathname === '/api/admin/commerce/sales-dashboard/overview') {
      return json({ platform, window_days_with_sales: 30, listings: {}, coverage: [], ads: { revenue: 99999 } });
    }
    if (url.pathname === '/api/admin/commerce/data-quality') {
      return json({
        platform, period: { start: url.searchParams.get('start'), end: url.searchParams.get('end'), today: '2026-11-21' },
        sales: { status: 'OK', freshness: 'ATUALIZADO', days_behind: 0, last_sale_day: '2026-11-20', last_import_at: '2026-11-21T08:00:00Z', reconciliation: {},
          requested_days: 30, days_without_information: opts.dqGap ? 3 : 0, days_with_records_unverified: 0,
          missing_ranges: opts.dqGap ? [{ start: '2026-11-01', end: '2026-11-03' }] : [] },
        reports: [], open_batches: [], price_stock: {}, catalog: {}
      });
    }
    // Demais leituras do painel: vazias e sem PII.
    if (url.pathname.endsWith('/problems/platforms') || url.pathname.endsWith('/problems/groups')) {
      // Simula resposta de OUTRA janela (60) que a pedida (30): o dashboard deve descartá-la.
      return json({ platforms: [], counts: {}, window: { days: opts.problemsWindow || Number(url.searchParams.get('days')) } });
    }
    return json({});
  };
  return { handler, calls, hold, release, opts };
}

async function open(browser, url = URL_OVERVIEW, { viewport = { width: 1365, height: 900 }, sim = createSimulator(), storage = null } = {}) {
  const launched = browser;
  const context = await launched.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await context.route('**/api/**', sim.handler);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (storage) await page.addInitScript(s => { try { sessionStorage.setItem(s.k, s.v); } catch { /* ignora */ } }, storage);
  return { page, context, sim, errors, goto: () => page.goto(url, { waitUntil: 'domcontentloaded' }) };
}

const radio = (page, id) => page.locator('.ndb-scope-opt[data-scope="' + id + '"]');
async function unitsShown(page) {
  const card = page.locator('.ndb-kpi, .ndb-card').filter({ hasText: 'Unidades vendidas' }).first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  return (await card.innerText()).replace(/\D+/g, ' ').trim();
}
const waitUnits = (page, n) => page.waitForFunction(v => /Unidades vendidas/.test(document.body.innerText) && new RegExp('(^|\\D)' + v + '(\\D|$)').test((document.body.innerText.split('Unidades vendidas')[1] || '').slice(0, 40)), n, { timeout: 10000 });
const bodyHas = (page, n) => page.evaluate(v => new RegExp('Unidades vendidas[^0-9]{0,20}' + v + '(\\D|$)').test(document.body.innerText.replace(/\s+/g, ' ')), n);

for (const [mode, url] of [['overview', URL_OVERVIEW], ['explorer', URL_EXPLORER]]) {
  test('seletor segmentado com as 4 opções no modo ' + mode + ', Consolidado como padrão e sem lista suspensa de plataforma', async browser => {
    const { page, context, errors, goto } = await open(browser, url);
    try {
      await goto();
      const group = page.getByRole('radiogroup', { name: 'Plataforma' });
      await group.waitFor({ state: 'visible', timeout: 15000 });
      const labels = await group.getByRole('radio').allInnerTexts();
      assert.deepEqual(labels.map(t => t.trim()), ['Consolidado', 'Shopee', 'ML Antigo', 'ML Novo']);
      assert.equal(await radio(page, 'TODAS').getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('label, .ndb-dd', { hasText: /^Plataforma$/ }).count(), 0, 'sem Dropdown "Plataforma"');
      assert.equal(await page.locator('.ndb-quality, .ndb-qstrip').count(), 0, 'sem resumo de qualidade no Consolidado');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('trocar de conta mostra só a conta escolhida e o resumo GA-018 dela, sem atrasar o dashboard', async browser => {
  const { page, context, sim, errors, goto } = await open(browser);
  try {
    await goto();
    await waitUnits(page, 666);
    for (const id of ['SHOPEE', 'ML_ANTIGO', 'ML_NOVO']) {
      await radio(page, id).click();
      await waitUnits(page, UNITS[id]);
      assert.equal(await radio(page, id).getAttribute('aria-checked'), 'true');
      const strip = page.locator('.ndb-qstrip[data-quality-platform="' + id + '"]');
      await strip.waitFor({ state: 'visible', timeout: 10000 });
      assert.match(await strip.innerText(), /Última venda/);
      for (const other of Object.keys(UNITS).filter(k => k !== id)) assert.equal(await bodyHas(page, UNITS[other]), false, 'vazou ' + other + ' em ' + id);
    }
    await radio(page, 'TODAS').click();
    await waitUnits(page, 666);
    assert.equal(await page.locator('.ndb-qstrip').count(), 0);
    // O resumo GA-018 só é pedido depois do dashboard principal e por conta (nunca consolidado).
    const q = sim.calls.filter(c => c.path === '/api/admin/commerce/data-quality');
    assert.ok(q.length >= 3 && q.every(c => c.query.platform !== 'TODAS'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('resposta lenta: ao trocar de conta os valores da conta anterior somem na hora', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    await goto();
    await waitUnits(page, 666);
    sim.hold('SHOPEE');
    await radio(page, 'SHOPEE').click();
    await page.getByText(/Consultando Shopee/).waitFor({ timeout: 10000 });
    assert.equal(await bodyHas(page, 666), false, 'valor do Consolidado ainda na tela durante a espera');
    assert.equal(await page.locator('section[aria-label="Dashboard comercial"]').getAttribute('aria-busy'), 'true');
    sim.release('SHOPEE');
    await waitUnits(page, 111);
    assert.equal(await page.locator('section[aria-label="Dashboard comercial"]').getAttribute('aria-busy'), 'false');
  } finally { await context.close(); }
});

test('respostas fora de ordem: a mais antiga chega por último e é descartada', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    await goto();
    await waitUnits(page, 666);
    sim.hold('SHOPEE'); sim.hold('ML_ANTIGO');
    await radio(page, 'SHOPEE').click();
    await radio(page, 'ML_ANTIGO').click();
    sim.release('ML_ANTIGO');           // a escolha mais nova responde primeiro
    await waitUnits(page, 222);
    sim.release('SHOPEE');              // a antiga responde depois: não pode entrar
    await page.waitForTimeout(600);
    assert.equal(await bodyHas(page, 111), false, 'resposta atrasada da Shopee apareceu em ML Antigo');
    assert.equal(await bodyHas(page, 222), true);
    assert.equal(await radio(page, 'ML_ANTIGO').getAttribute('aria-checked'), 'true');
  } finally { await context.close(); }
});

test('A→B→A: voltar à conta inicial não aceita a resposta atrasada da conta intermediária', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    await goto();
    await waitUnits(page, 666);
    sim.hold('ML_NOVO');
    await radio(page, 'ML_NOVO').click();
    await radio(page, 'TODAS').click();
    await waitUnits(page, 666);
    sim.release('ML_NOVO');
    await page.waitForTimeout(600);
    assert.equal(await bodyHas(page, 333), false, 'ML Novo vazou para o Consolidado');
    assert.equal(await bodyHas(page, 666), true);
    assert.equal(await page.locator('.ndb-qstrip').count(), 0);
  } finally { await context.close(); }
});

test('o período escolhido é preservado ao trocar de plataforma e vai em todas as consultas', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    await goto();
    await waitUnits(page, 666);
    await page.getByRole('button', { name: /^Período/ }).click();
    await page.getByRole('button', { name: 'Últimos 60 dias' }).click();
    await waitUnits(page, 666);
    sim.calls.length = 0;
    await radio(page, 'ML_ANTIGO').click();
    await waitUnits(page, 222);
    const main = sim.calls.filter(c => c.path === '/api/admin/commerce/sales-dashboard');
    assert.ok(main.length >= 1 && main.every(c => c.query.platform === 'ML_ANTIGO' && c.query.days === '60'), JSON.stringify(main));
  } finally { await context.close(); }
});

test('falha do resumo de qualidade não derruba o dashboard, e privacidade não expõe valores no seletor', async browser => {
  const sim = createSimulator();
  const base = sim.handler;
  const { page, context, goto } = await open(browser, URL_OVERVIEW, { sim: { ...sim, handler: async route => {
    if (new URL(route.request().url()).pathname === '/api/admin/commerce/data-quality') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' });
    return base(route);
  } } });
  try {
    await goto();
    await waitUnits(page, 666);
    await radio(page, 'SHOPEE').click();
    await waitUnits(page, 111);
    await page.getByText(/indisponível agora/).waitFor({ timeout: 10000 });
    assert.equal(await bodyHas(page, 111), true, 'dashboard continua visível');
    assert.doesNotMatch(await page.locator('.ndb-scope-row').innerText(), /R\$|\d{3}\.\d{3}/, 'seletor/resumo sem valores monetários');
  } finally { await context.close(); }
});

test('zero vendas só aparece com cobertura comprovada pela GA-018 do mesmo período', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    sim.opts.zero = ['ML_NOVO'];
    await goto();
    await waitUnits(page, 666);
    await radio(page, 'ML_NOVO').click();
    const zero = page.locator('[data-notice="ZERO"]');
    await zero.waitFor({ state: 'visible', timeout: 10000 });
    assert.match(await zero.innerText(), /Zero vendas no período/);
  } finally { await context.close(); }
});

test('total zero com buracos de importação NÃO vira zero vendas', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    sim.opts.zero = ['ML_NOVO']; sim.opts.dqGap = true;
    await goto();
    await waitUnits(page, 666);
    await radio(page, 'ML_NOVO').click();
    const n = page.locator('[data-notice="SEM_VENDAS_IMPORTADAS"]');
    await n.waitFor({ state: 'visible', timeout: 10000 });
    assert.match(await n.innerText(), /não é possível afirmar/);
    await page.locator('.ndb-qstrip[data-quality-platform="ML_NOVO"] .ndb-qpill').first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-notice="ZERO"]').count(), 0);
  } finally { await context.close(); }
});

test('a faixa GA-018 usa o mesmo período do dashboard, inclusive em todo o histórico', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    await goto();
    await waitUnits(page, 666);
    await radio(page, 'SHOPEE').click();
    const label = page.locator('[data-quality-period]');
    await label.waitFor({ state: 'visible', timeout: 10000 });
    assert.match(await label.innerText(), /22\/10\/2026 a 20\/11\/2026/);
    await page.locator('.ndb-qpill').first().waitFor({ timeout: 10000 });
    let q = sim.calls.filter(c => c.path === '/api/admin/commerce/data-quality').pop();
    assert.deepEqual([q.query.start, q.query.end], ['2026-10-22', '2026-11-20']); // não é "hoje - 29 dias"
    assert.equal(await page.locator('.ndb-qstrip').getAttribute('data-quality-differs'), '0');
    // Todo o histórico: o resumo cobre do primeiro ao último dia analisado e diz isso.
    await page.getByRole('button', { name: /^Período/ }).click();
    await page.getByRole('button', { name: /todo o histórico/i }).click();
    await page.waitForFunction(() => /todo o histórico, 03\/02\/2026 a 20\/11\/2026/.test(document.querySelector('[data-quality-period]')?.innerText || ''), null, { timeout: 10000 });
    q = sim.calls.filter(c => c.path === '/api/admin/commerce/data-quality').pop();
    assert.deepEqual([q.query.start, q.query.end], ['2026-02-03', '2026-11-20']);
  } finally { await context.close(); }
});

test('consulta de problemas de outra janela é descartada em vez de ser exibida', async browser => {
  const { page, context, sim, goto } = await open(browser);
  try {
    sim.opts.problemsWindow = 60; // o dashboard pede 30 dias
    await goto();
    await waitUnits(page, 666);
    await page.getByText('Consulta indisponível agora').first().waitFor({ state: 'visible', timeout: 10000 });
  } finally { await context.close(); }
});

const launchOptions = { headless: true };
if (process.env.NISTI_CHROMIUM_PATH) launchOptions.executablePath = process.env.NISTI_CHROMIUM_PATH;
const browser = await chromium.launch(launchOptions);
let failures = 0;
try {
  for (const { name, fn } of tests) {
    const started = Date.now();
    try { await fn(browser); console.log('PASS', name, '(' + (Date.now() - started) + 'ms)'); }
    catch (error) { failures++; console.error('FAIL', name, '-', error.stack || error.message); }
  }
} finally { await browser.close(); }
console.log('Platform dashboard:', tests.length - failures + '/' + tests.length + ' passaram.');
if (failures) process.exitCode = 1;
