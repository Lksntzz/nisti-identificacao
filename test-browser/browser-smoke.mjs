// Testes E2E: Chromium real contra Vite LOCAL. A API e todas as gravações são simuladas.
// NUNCA executar contra workers.dev, Supabase ou endpoints externos de produção.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function createApiSimulator() {
  const calls = [];
  let unread = 2;
  const notifications = [
    { id: 101, title: 'Produto atualizado', message: 'SKU de teste alterado', source: 'catalog',
      severity: 'info', actor_name: 'Operador de teste', created_at: '2026-10-21T14:00:00Z', is_read: false },
    { id: 102, title: 'Expedição sincronizada', message: 'Teste local de notificações',
      source: 'admin', severity: 'info', created_at: '2026-10-21T14:01:00Z', is_read: false }
  ];
  const handler = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({ path: url.pathname, method });
    const json = payload => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });

    // Somente leituras e confirmações simuladas; nenhum POST chega ao servidor Vite ou à produção.
    if (url.pathname === '/api/products') return json({ products: [] });
    if (url.pathname === '/api/admin/commerce-sync/nisti-products/statuses') return json({ ok: true, statuses: [] });
    if (url.pathname === '/api/admin/system-notifications/unread-count') return json({ unread_count: unread });
    if (url.pathname === '/api/admin/system-notifications' && method === 'GET') {
      return json({ notifications, unread_count: unread });
    }
    if (/^\/api\/admin\/system-notifications\/\d+\/read$/.test(url.pathname) && method === 'POST') {
      const id = Number(url.pathname.split('/')[4]);
      const entry = notifications.find(item => item.id === id);
      if (entry && !entry.is_read) { entry.is_read = true; unread--; }
      return json({ ok: true, unread_count: unread });
    }
    if (url.pathname === '/api/admin/system-notifications/mark-all-read' && method === 'POST') {
      for (const entry of notifications) entry.is_read = true;
      unread = 0;
      return json({ ok: true, unread_count: 0 });
    }
    if (method !== 'GET') {
      return route.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: 'Escrita bloqueada no teste de navegador' }) });
    }
    // Mocks deliberadamente pequenos e sem PII: suficientes para o carregamento inicial do painel.
    return json({});
  };
  return { handler, calls };
}

async function openAdmin(browser, viewport = { width: 1365, height: 900 }) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo'
  });
  const simulator = createApiSimulator();
  await context.route('**/api/**', simulator.handler);
  // Sem chamadas para fontes externas durante os testes.
  await context.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('.admin-topbar-header').waitFor({ timeout: 20000 });
  return { page, context, simulator, errors };
}

async function assertVisible(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await locator.isVisible(), true, label);
}

test('painel ADM carrega em Chromium sem credenciais nem endpoints de produção', async browser => {
  const { page, context, simulator, errors } = await openAdmin(browser);
  try {
    await assertVisible(page.getByRole('heading', { name: 'Produtos NISTI', exact: true }), 'título do painel');
    assert.ok(simulator.calls.some(x => x.path === '/api/products'));
    assert.equal(simulator.calls.some(x => x.method !== 'GET'), false);
    assert.deepEqual(errors, [], 'erros JavaScript ao carregar admin');
  } finally { await context.close(); }
});

test('menu lateral expande Mural e Catálogo, com títulos e submenus verdadeiros', async browser => {
  const { page, context } = await openAdmin(browser);
  try {
    const muralToggle = page.getByRole('button', { name: 'Expandir Mural NISTI' });
    await muralToggle.click();
    await assertVisible(page.locator('.sidebar-submenu-item').filter({ hasText: 'Publicar' }));
    assert.equal(await page.getByRole('button', { name: 'Recolher Mural NISTI' }).getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: 'Recolher Mural NISTI' }).click();
    assert.equal(await page.locator('.sidebar-submenu-item').filter({ hasText: 'Publicar' }).count(), 0);

    await page.getByRole('button', { name: 'Expandir Painel Comercial' }).click();
    await assertVisible(page.locator('.sidebar-submenu-item').filter({ hasText: 'Pendências' }));
  } finally { await context.close(); }
});

test('modo celular abre e fecha painel lateral pelo botão e pelo backdrop', async browser => {
  const { page, context } = await openAdmin(browser, { width: 390, height: 844 });
  try {
    await page.getByRole('button', { name: 'Alternar menu lateral' }).click();
    await assertVisible(page.locator('.admin-sidebar.open'));
    await assertVisible(page.locator('.sidebar-mobile-backdrop'));
    await page.locator('.sidebar-mobile-backdrop').click({ position: { x: 5, y: 40 } });
    await page.locator('.admin-sidebar.open').waitFor({ state: 'hidden', timeout: 10000 });
  } finally { await context.close(); }
});

test('atividades do sistema: abrir, marcar uma, marcar todas e fechar com Escape', async browser => {
  const { page, context, simulator } = await openAdmin(browser);
  try {
    await page.getByRole('button', { name: /Atividades do sistema \(2 não lidas\)/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Atividades do Sistema' });
    await assertVisible(dialog);
    assert.equal(await dialog.locator('.notification-card.unread').count(), 2);
    await dialog.locator('.notification-card.unread').first().click();
    await dialog.locator('.notification-card.unread').first().waitFor({ state: 'visible' });
    assert.equal(await dialog.locator('.notification-card.unread').count(), 1);
    assert.equal(await page.locator('.topbar-bell-badge').innerText(), '1');
    await dialog.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    assert.equal(await dialog.locator('.notification-card.unread').count(), 0);
    assert.equal(await dialog.locator('.notification-card.read').count(), 2);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(simulator.calls.some(c => c.path === '/api/admin/system-notifications/101/read' && c.method === 'POST'));
    assert.ok(simulator.calls.some(c => c.path === '/api/admin/system-notifications/mark-all-read' && c.method === 'POST'));
  } finally { await context.close(); }
});

test('cadastro com alterações não salvas pede confirmação e permite continuar ou descartar', async browser => {
  const { page, context, simulator } = await openAdmin(browser);
  try {
    await page.getByRole('button', { name: /\+ Cadastrar Produto/ }).click();
    await assertVisible(page.getByRole('heading', { name: 'Cadastrar Novo Produto com Variações' }));
    await page.getByPlaceholder('Ex: Agenda 2026 Personalizada').fill('Agenda fictícia sem salvar');
    await page.getByRole('button', { name: 'Fechar cadastro' }).click();
    const confirm = page.getByRole('dialog', { name: 'Cadastro ainda não foi salvo' });
    await assertVisible(confirm);
    await confirm.getByRole('button', { name: /Continuar cadastrando/ }).click();
    await confirm.waitFor({ state: 'hidden' });
    assert.equal(await page.getByPlaceholder('Ex: Agenda 2026 Personalizada').inputValue(), 'Agenda fictícia sem salvar');
    await page.getByRole('button', { name: 'Fechar cadastro' }).click();
    await page.getByRole('dialog', { name: 'Cadastro ainda não foi salvo' }).getByRole('button', { name: 'Descartar cadastro' }).click();
    await page.getByRole('heading', { name: 'Cadastrar Novo Produto com Variações' }).waitFor({ state: 'hidden' });
    assert.equal(simulator.calls.some(c => c.method !== 'GET'), false, 'nunca envia rascunhos aos APIs');
  } finally { await context.close(); }
});

test('modo PC muda URL e visualização sem gravar no servidor', async browser => {
  const { page, context, simulator } = await openAdmin(browser);
  try {
    await page.getByRole('button', { name: 'Visualizar como computador' }).click();
    await page.waitForURL(url => url.searchParams.get('desktop') === '1');
    await assertVisible(page.locator('.admin-layout-root.admin-desktop-preview'));
    await page.getByRole('button', { name: 'Voltar para visualização do celular' }).click();
    await page.waitForURL(url => !url.searchParams.has('desktop'));
    await assertVisible(page.locator('.admin-layout-root:not(.admin-desktop-preview)'));
    assert.equal(simulator.calls.some(c => c.method !== 'GET'), false);
  } finally { await context.close(); }
});

const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const { name, fn } of tests) {
    const started = Date.now();
    try {
      await fn(browser);
      console.log('PASS', name, '(' + (Date.now() - started) + 'ms)');
    } catch (error) {
      failures++;
      console.error('FAIL', name, '-', error.stack || error.message);
    }
  }
} finally {
  await browser.close();
}
console.log('Browser Smoke:', tests.length - failures + '/' + tests.length + ' passaram.');
if (failures) process.exitCode = 1;
