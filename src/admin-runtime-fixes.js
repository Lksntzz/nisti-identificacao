import './admin-runtime-fixes.css';

let pollTimer = null;
let applying = false;
let activeView = 'geral';

const VIEW_COPY = {
  geral: ['Dashboard', 'Visão rápida do catálogo e do estado do sistema.'],
  mockups: ['Mockups', 'Pesquise produtos, confira imagens e substitua mockups quando necessário.'],
  importacao: ['Importação', 'Atualize o catálogo por CSV ou cadastre um produto individualmente.'],
  administracao: ['Administração', 'Acompanhe banco de dados, armazenamento e consumo do Gemini.']
};

function isAdmin() {
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function setActiveTab(section) {
  document.querySelectorAll('.admin-section-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.section === section);
  });
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle('admin-view-visible', visible);
}

function closeToolPanels() {
  document.querySelectorAll('.admin-tool-panel').forEach(panel => {
    panel.classList.remove('tool-panel-visible');
    panel.hidden = true;
  });
}

function simplifyNavigation() {
  const tabs = document.querySelector('.admin-section-tabs');
  if (!tabs) return;

  tabs.querySelector('[data-section="produtos"]')?.remove();
  tabs.querySelector('[data-section="ferramentas"]')?.remove();

  const allowed = new Set(['geral', 'mockups', 'importacao', 'administracao']);
  tabs.querySelectorAll('.admin-section-tab').forEach(button => {
    if (!allowed.has(button.dataset.section)) button.remove();
  });
}

function ensureViewHeader() {
  const panel = document.querySelector('.admin-dashboard-panel');
  if (!panel) return null;
  let header = panel.querySelector(':scope > .admin-view-header');
  if (!header) {
    header = document.createElement('section');
    header.className = 'admin-view-header';
    header.innerHTML = '<div><span>NISTI PRINT</span><h2>Dashboard</h2><p>Visão rápida do catálogo e do estado do sistema.</p></div>';
    panel.prepend(header);
  }
  return header;
}

function ensureHealthSummary() {
  const grid = document.querySelector('.admin-kpi-grid');
  if (!grid) return null;
  let health = document.querySelector('.admin-health-summary');
  if (!health) {
    health = document.createElement('button');
    health.type = 'button';
    health.className = 'admin-health-summary';
    health.innerHTML = `
      <span class="health-icon" aria-hidden="true">⌁</span>
      <span class="health-copy">
        <small>Saúde do sistema</small>
        <strong>Verificando serviços...</strong>
        <em>D1 · R2 · Gemini</em>
      </span>
      <span class="health-state">Verificando</span>
      <span class="health-arrow" aria-hidden="true">›</span>
    `;
    grid.insertAdjacentElement('afterend', health);
  }
  return health;
}

function setCatalogMode() {
  const catalog = document.querySelector('.catalog-details');
  if (!catalog) return;
  catalog.classList.remove('catalog-products-mode');
  catalog.classList.add('catalog-mockups-mode');
  const summary = catalog.querySelector(':scope > summary');
  if (summary) summary.textContent = 'Biblioteca de mockups';
  const search = catalog.querySelector('.catalog-search');
  if (search) search.placeholder = 'Buscar por nome do produto ou SKU...';
}

function prepareDashboard() {
  if (!isAdmin()) return;
  simplifyNavigation();

  const kpiGrid = document.querySelector('.admin-kpi-grid');
  if (kpiGrid) {
    const productCard = kpiGrid.querySelector('[data-kpi="products"]');
    const mockupCard = kpiGrid.querySelector('[data-kpi="mockups"]');
    const pendingCard = kpiGrid.querySelector('[data-kpi="pending"]');
    const progressCard = kpiGrid.querySelector('[data-kpi="progress"]');
    const dbCard = kpiGrid.querySelector('[data-kpi="database"], [data-system-kpi="database"]');
    const geminiCard = kpiGrid.querySelector('[data-kpi="gemini"], [data-system-kpi="gemini"]');

    if (dbCard) {
      dbCard.removeAttribute('data-kpi');
      dbCard.dataset.systemKpi = 'database';
      dbCard.hidden = true;
    }
    if (geminiCard) {
      geminiCard.removeAttribute('data-kpi');
      geminiCard.dataset.systemKpi = 'gemini';
      geminiCard.hidden = true;
    }

    const progressLabel = progressCard?.querySelector('small');
    if (progressLabel) progressLabel.textContent = 'Produção';
    const productLabel = productCard?.querySelector('small');
    if (productLabel) productLabel.textContent = 'Produtos cadastrados';
    const mockupLabel = mockupCard?.querySelector('small');
    if (mockupLabel) mockupLabel.textContent = 'Mockups';
    const pendingLabel = pendingCard?.querySelector('small');
    if (pendingLabel) pendingLabel.textContent = 'Pendentes';
  }

  document.querySelector('.admin-tools-section')?.setAttribute('hidden', '');

  const systemKpiGrid = document.querySelector('.admin-kpi-grid');
  if (systemKpiGrid && !document.querySelector('.admin-system-details')) {
    const details = document.createElement('section');
    details.className = 'admin-system-details';
    details.innerHTML = `
      <article class="system-detail-card" data-system-detail="database">
        <span class="system-detail-icon">DB</span>
        <div class="system-detail-copy"><strong>Banco de dados · Cloudflare D1</strong><b>Carregando...</b><span>Lendo o tamanho real do banco estruturado.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <article class="system-detail-card" data-system-detail="r2">
        <span class="system-detail-icon">R2</span>
        <div class="system-detail-copy"><strong>Mockups e imagens · Cloudflare R2</strong><b>Carregando...</b><span>Somando os arquivos armazenados.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <article class="system-detail-card" data-system-detail="gemini">
        <span class="system-detail-icon">✦</span>
        <div class="system-detail-copy"><strong>Gemini · identificação visual</strong><b>Carregando...</b><span>Lendo consultas e tokens medidos pelo NISTI.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <div class="system-measurement-note">D1 e R2 são medidos separadamente. O uso do Gemini representa as chamadas feitas por este aplicativo desde que a telemetria foi ativada.</div>
    `;
    systemKpiGrid.insertAdjacentElement('afterend', details);
  }

  ensureHealthSummary();
  ensureViewHeader();
}

function applyView(section, { scroll = false } = {}) {
  if (!isAdmin()) return;
  activeView = VIEW_COPY[section] ? section : 'geral';
  document.documentElement.dataset.adminView = activeView;
  setActiveTab(activeView);

  const header = ensureViewHeader();
  const [title, subtitle] = VIEW_COPY[activeView];
  if (header) {
    const heading = header.querySelector('h2');
    const copy = header.querySelector('p');
    if (heading) heading.textContent = title;
    if (copy) copy.textContent = subtitle;
  }

  const kpis = document.querySelector('.admin-kpi-grid');
  const health = document.querySelector('.admin-health-summary');
  const system = document.querySelector('.admin-system-details');
  const catalog = document.querySelector('.catalog-details');
  const tools = document.querySelector('.admin-tools-section');
  const importPanel = document.querySelector('.admin-tool-panel[data-tool-panel="importacao"]');
  const cadastroPanel = document.querySelector('.admin-tool-panel[data-tool-panel="cadastro"]');
  const manualPanel = document.querySelector('.admin-tool-panel[data-tool-panel="manual"]');
  const indexPanel = document.querySelector('.admin-tool-panel[data-tool-panel="indice"]');

  closeToolPanels();
  setVisible(kpis, activeView === 'geral');
  setVisible(health, activeView === 'geral');
  setVisible(system, activeView === 'administracao');
  setVisible(catalog, activeView === 'mockups');
  setVisible(tools, false);
  setVisible(importPanel, activeView === 'importacao');
  setVisible(cadastroPanel, activeView === 'importacao');
  setVisible(manualPanel, false);
  setVisible(indexPanel, false);

  if (activeView === 'importacao') {
    [importPanel, cadastroPanel].forEach(panel => {
      if (!panel) return;
      panel.hidden = false;
      panel.classList.add('tool-panel-visible');
    });
  }

  if (activeView === 'mockups') {
    if (catalog) catalog.open = true;
    setCatalogMode();
  }

  if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function handleAdminNavigation(event) {
  if (!isAdmin()) return;

  const tab = event.target.closest('.admin-section-tab');
  if (tab) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    applyView(tab.dataset.section, { scroll: true });
    return;
  }

  const health = event.target.closest('.admin-health-summary');
  if (health) {
    event.preventDefault();
    applyView('administracao', { scroll: true });
  }
}

document.addEventListener('click', handleAdminNavigation, true);

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function updateSystemDetail(key, value, description, state = 'Saudável', stateClass = '') {
  const card = document.querySelector(`[data-system-detail="${key}"]`);
  if (!card) return;
  const valueNode = card.querySelector('.system-detail-copy b');
  const descNode = card.querySelector('.system-detail-copy span');
  const status = card.querySelector('.system-status');
  if (valueNode) valueNode.textContent = value;
  if (descNode) descNode.textContent = description;
  if (status) {
    status.textContent = state;
    status.className = `system-status${stateClass ? ` ${stateClass}` : ''}`;
  }
}

function updateHealthSummary({ database, r2, gemini, storageOk }) {
  const health = document.querySelector('.admin-health-summary');
  if (!health) return;

  const dbUsed = formatBytes(database?.used_bytes);
  const r2Used = storageOk ? formatBytes(r2?.used_bytes) : 'R2 indisponível';
  const requests = Number(gemini?.today?.identify_requests || 0);
  const tokens = Number(gemini?.today?.total_tokens || 0);
  const freePercent = Number(database?.percent_of_free_limit || 0);
  const healthy = gemini?.configured !== false && freePercent < 90 && storageOk;

  const strong = health.querySelector('.health-copy strong');
  const em = health.querySelector('.health-copy em');
  const state = health.querySelector('.health-state');
  if (strong) strong.textContent = healthy ? 'Tudo operacional' : 'Verificar sistema';
  if (em) em.textContent = `D1 ${dbUsed} · R2 ${r2Used} · Gemini ${formatNumber(requests)} consulta(s) / ${formatNumber(tokens)} tokens hoje`;
  if (state) {
    state.textContent = healthy ? 'Saudável' : 'Atenção';
    state.className = `health-state${healthy ? '' : ' warning'}`;
  }
}

async function refreshRealMetrics() {
  if (!isAdmin()) return;
  prepareDashboard();

  try {
    const [systemResponse, storageResponse] = await Promise.all([
      fetch('/api/admin/system-metrics', { cache: 'no-store' }),
      fetch('/api/admin/storage-metrics', { cache: 'no-store' })
    ]);
    if (!systemResponse.ok) throw new Error(`system HTTP ${systemResponse.status}`);

    const data = await systemResponse.json();
    const storageData = storageResponse.ok ? await storageResponse.json() : {};
    const database = data.database || {};
    const r2 = storageData.r2 || {};
    const gemini = data.gemini || {};
    const today = gemini.today || {};

    const dbUsed = formatBytes(database.used_bytes);
    const freePercent = Number(database.percent_of_free_limit || 0);
    const dbState = freePercent >= 90 ? ['Atenção', 'warning'] : ['Saudável', ''];

    updateSystemDetail(
      'database',
      `${dbUsed} no D1`,
      `Tamanho real do banco estruturado. Referência de limite por banco: Workers Free 500 MB; Workers Paid 10 GB.`,
      dbState[0],
      dbState[1]
    );

    if (storageResponse.ok) {
      const r2Used = formatBytes(r2.used_bytes);
      const r2Percent = Number(r2.percent_of_free_included_storage || 0);
      updateSystemDetail(
        'r2',
        `${r2Used} · ${formatNumber(r2.object_count)} arquivo(s)`,
        `${r2Percent.toFixed(r2Percent < 1 ? 3 : 1)}% dos 10 GB-mês incluídos no nível gratuito Standard.`,
        'Saudável',
        ''
      );
    } else {
      updateSystemDetail('r2', 'Falha na leitura', 'Não foi possível medir o bucket de imagens.', 'Erro', 'error');
    }

    const requests = Number(today.identify_requests || 0);
    const tokens = Number(today.total_tokens || 0);
    const average = Number(gemini.average_tokens_per_identification_today || 0);
    updateSystemDetail(
      'gemini',
      `${formatNumber(tokens)} tokens hoje`,
      `${formatNumber(requests)} identificação(ões) hoje${average ? ` · média ${formatNumber(average)} tokens/consulta` : ''} · ${gemini.model || 'Gemini'}.`,
      gemini.configured ? 'Ativo' : 'Sem chave',
      gemini.configured ? '' : 'error'
    );

    updateHealthSummary({ database, r2, gemini, storageOk: storageResponse.ok });
  } catch {
    updateSystemDetail('database', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
    updateSystemDetail('r2', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
    updateSystemDetail('gemini', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
    const health = document.querySelector('.admin-health-summary');
    const strong = health?.querySelector('.health-copy strong');
    const state = health?.querySelector('.health-state');
    if (strong) strong.textContent = 'Não foi possível consultar os serviços';
    if (state) {
      state.textContent = 'Atenção';
      state.className = 'health-state warning';
    }
  }
}

function applyFixes() {
  if (applying || !isAdmin()) return;
  applying = true;
  try {
    prepareDashboard();
    applyView(activeView);
    if (!pollTimer) {
      refreshRealMetrics();
      pollTimer = setInterval(refreshRealMetrics, 15000);
    }
  } finally {
    applying = false;
  }
}

const observer = new MutationObserver(() => requestAnimationFrame(applyFixes));
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-nisti-access'] });
applyFixes();
