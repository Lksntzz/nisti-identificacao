import './admin-runtime-fixes.css';

let pollTimer = null;
let applying = false;
let activeView = 'geral';
let activeToolPanel = '';

const VIEW_COPY = {
  geral: ['Dashboard', 'Visão geral do catálogo, mockups e serviços do sistema.'],
  produtos: ['Produtos', 'Pesquise, filtre e consulte todos os SKUs cadastrados.'],
  mockups: ['Mockups', 'Confira as imagens do catálogo e substitua mockups quando necessário.'],
  importacao: ['Importação', 'Atualize o catálogo por CSV ou cadastre um produto individualmente.'],
  ferramentas: ['Ferramentas', 'Rotinas de manutenção, índice visual e correções pontuais.'],
  administracao: ['Administração', 'Acompanhe banco de dados, armazenamento e consumo do Gemini.']
};

const NAV_ITEMS = [
  ['geral', 'home', 'Geral'],
  ['produtos', 'box', 'Produtos'],
  ['mockups', 'image', 'Mockups'],
  ['importacao', 'upload', 'Importação'],
  ['ferramentas', 'tools', 'Ferramentas'],
  ['administracao', 'gear', 'Administração']
];

function isAdmin() {
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function iconSvg(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    upload: '<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4h16v-4"/>',
    tools: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.6 2.6-3-3 2.6-2.6Z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.box}</svg>`;
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

function ensureFullNavigation() {
  const tabs = document.querySelector('.admin-section-tabs');
  if (!tabs) return;

  const current = Array.from(tabs.querySelectorAll('.admin-section-tab')).map(button => button.dataset.section).join('|');
  const expected = NAV_ITEMS.map(item => item[0]).join('|');
  if (current === expected) return;

  tabs.innerHTML = NAV_ITEMS.map(([section, icon, label]) => `
    <button type="button" class="admin-section-tab" data-section="${section}">
      ${iconSvg(icon)}<span>${label}</span>
    </button>
  `).join('');
}

function ensureViewHeader() {
  const panel = document.querySelector('.admin-dashboard-panel');
  if (!panel) return null;
  let header = panel.querySelector(':scope > .admin-view-header');
  if (!header) {
    header = document.createElement('section');
    header.className = 'admin-view-header';
    header.innerHTML = '<div><span>NISTI PRINT</span><h2>Dashboard</h2><p>Visão geral do catálogo, mockups e serviços do sistema.</p></div>';
    panel.prepend(header);
  }
  return header;
}

function ensureSystemDetails() {
  const grid = document.querySelector('.admin-kpi-grid');
  if (!grid || document.querySelector('.admin-system-details')) return;

  const details = document.createElement('section');
  details.className = 'admin-system-details';
  details.innerHTML = `
    <article class="system-detail-card" data-system-detail="database">
      <span class="system-detail-icon">DB</span>
      <div class="system-detail-copy"><strong>Banco de dados · Cloudflare D1</strong><b>Carregando...</b><span>Lendo o tamanho real do banco estruturado.</span><div class="system-progress"><i></i></div></div>
      <em class="system-status">Verificando</em>
    </article>
    <article class="system-detail-card" data-system-detail="r2">
      <span class="system-detail-icon">R2</span>
      <div class="system-detail-copy"><strong>Mockups e imagens · Cloudflare R2</strong><b>Carregando...</b><span>Somando os arquivos armazenados.</span><div class="system-progress"><i></i></div></div>
      <em class="system-status">Verificando</em>
    </article>
    <article class="system-detail-card" data-system-detail="gemini">
      <span class="system-detail-icon">✦</span>
      <div class="system-detail-copy"><strong>Gemini · identificação visual</strong><b>Carregando...</b><span>Lendo consultas e tokens medidos pelo NISTI.</span><div class="system-progress"><i></i></div></div>
      <em class="system-status">Verificando</em>
    </article>
    <div class="system-measurement-note">D1 e R2 são medidos separadamente. O Gemini mostra somente as chamadas registradas por este aplicativo desde que a telemetria foi ativada.</div>
  `;
  grid.insertAdjacentElement('afterend', details);
}

function prepareDashboard() {
  if (!isAdmin()) return;
  ensureFullNavigation();
  ensureViewHeader();
  ensureSystemDetails();

  const kpiGrid = document.querySelector('.admin-kpi-grid');
  if (kpiGrid) {
    const productCard = kpiGrid.querySelector('[data-kpi="products"]');
    const mockupCard = kpiGrid.querySelector('[data-kpi="mockups"]');
    const pendingCard = kpiGrid.querySelector('[data-kpi="pending"]');
    const progressCard = kpiGrid.querySelector('[data-kpi="progress"]');
    const dbCard = kpiGrid.querySelector('[data-system-kpi="database"]');
    const geminiCard = kpiGrid.querySelector('[data-system-kpi="gemini"]');

    if (dbCard && !dbCard.dataset.kpi) {
      dbCard.dataset.kpi = 'database';
      delete dbCard.dataset.systemKpi;
    }
    if (geminiCard && !geminiCard.dataset.kpi) {
      geminiCard.dataset.kpi = 'gemini';
      delete geminiCard.dataset.systemKpi;
    }

    const labels = [
      [productCard, 'Produtos cadastrados'],
      [mockupCard, 'Mockups com imagem'],
      [pendingCard, 'Pendentes'],
      [progressCard, 'Progresso do catálogo'],
      [kpiGrid.querySelector('[data-kpi="database"]'), 'Banco de dados'],
      [kpiGrid.querySelector('[data-kpi="gemini"]'), 'Uso Gemini']
    ];
    labels.forEach(([card, text]) => {
      const label = card?.querySelector('small');
      if (label) label.textContent = text;
      if (card) card.hidden = false;
    });
  }
}

function setCatalogMode(mode) {
  const catalog = document.querySelector('.catalog-details');
  if (!catalog) return;
  catalog.classList.toggle('catalog-products-mode', mode === 'products');
  catalog.classList.toggle('catalog-mockups-mode', mode === 'mockups');
  const summary = catalog.querySelector(':scope > summary');
  if (summary) summary.textContent = mode === 'mockups' ? 'Biblioteca de mockups' : 'Catálogo de produtos';
  const search = catalog.querySelector('.catalog-search');
  if (search) search.placeholder = 'Buscar por nome do produto ou SKU...';
}

function hideAllToolPanels() {
  document.querySelectorAll('.admin-tool-panel').forEach(panel => {
    panel.classList.remove('tool-panel-visible');
    panel.hidden = true;
  });
}

function showToolPanel(name) {
  activeToolPanel = name || '';
  hideAllToolPanels();
  const panel = document.querySelector(`.admin-tool-panel[data-tool-panel="${activeToolPanel}"]`);
  if (panel) {
    panel.hidden = false;
    panel.classList.add('tool-panel-visible');
  }
}

function applyView(section, { scroll = false } = {}) {
  if (!isAdmin()) return;
  activeView = VIEW_COPY[section] ? section : 'geral';
  document.documentElement.dataset.adminView = activeView;
  prepareDashboard();
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

  setVisible(kpis, activeView === 'geral');
  setVisible(health, false);
  setVisible(system, activeView === 'administracao');
  setVisible(catalog, activeView === 'produtos' || activeView === 'mockups');
  setVisible(tools, activeView === 'geral' || activeView === 'ferramentas');

  hideAllToolPanels();

  if (activeView === 'produtos') {
    if (catalog) catalog.open = true;
    setCatalogMode('products');
  } else if (activeView === 'mockups') {
    if (catalog) catalog.open = true;
    setCatalogMode('mockups');
  } else if (activeView === 'importacao') {
    [importPanel, cadastroPanel].forEach(panel => {
      if (!panel) return;
      panel.hidden = false;
      panel.classList.add('tool-panel-visible');
    });
  } else if (activeView === 'ferramentas' && activeToolPanel) {
    showToolPanel(activeToolPanel);
  }

  if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function openToolFromCard(name) {
  if (name === 'catalogo') return applyView('produtos', { scroll: true });
  if (name === 'mockups') return applyView('mockups', { scroll: true });
  if (name === 'importacao' || name === 'cadastro') return applyView('importacao', { scroll: true });
  if (name === 'manual' || name === 'indice') {
    activeToolPanel = name;
    applyView('ferramentas', { scroll: true });
  }
}

function handleAdminNavigation(event) {
  if (!isAdmin()) return;

  const tab = event.target.closest('.admin-section-tab');
  if (tab) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    activeToolPanel = '';
    applyView(tab.dataset.section, { scroll: true });
    return;
  }

  const tool = event.target.closest('[data-open-tool]');
  if (tool) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openToolFromCard(tool.dataset.openTool);
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

function updateDashboardKpi(key, value, description) {
  const card = document.querySelector(`.admin-kpi[data-kpi="${key}"]`);
  if (!card) return;
  const valueNode = card.querySelector('.kpi-value');
  const descNode = card.querySelector('.kpi-sub');
  if (valueNode) valueNode.textContent = value;
  if (descNode) descNode.textContent = description;
}

function updateSystemDetail(key, value, description, state = 'Saudável', stateClass = '', percent = 0) {
  const card = document.querySelector(`[data-system-detail="${key}"]`);
  if (!card) return;
  const valueNode = card.querySelector('.system-detail-copy b');
  const descNode = card.querySelector('.system-detail-copy span');
  const status = card.querySelector('.system-status');
  const progress = card.querySelector('.system-progress i');
  if (valueNode) valueNode.textContent = value;
  if (descNode) descNode.textContent = description;
  if (progress) progress.style.width = `${Math.min(100, Math.max(0, Number(percent || 0)))}%`;
  if (status) {
    status.textContent = state;
    status.className = `system-status${stateClass ? ` ${stateClass}` : ''}`;
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
    updateDashboardKpi('database', dbUsed, `${freePercent.toFixed(freePercent < 1 ? 2 : 1)}% do limite Free de referência`);
    updateSystemDetail(
      'database',
      `${dbUsed} no D1`,
      'Banco estruturado usado pelo catálogo e índice visual.',
      dbState[0],
      dbState[1],
      freePercent
    );

    if (storageResponse.ok) {
      const r2Used = formatBytes(r2.used_bytes);
      const r2Percent = Number(r2.percent_of_free_included_storage || 0);
      updateSystemDetail(
        'r2',
        `${r2Used} · ${formatNumber(r2.object_count)} arquivo(s)`,
        'Mockups e imagens de referência armazenados no R2.',
        r2Percent >= 90 ? 'Atenção' : 'Saudável',
        r2Percent >= 90 ? 'warning' : '',
        r2Percent
      );
    } else {
      updateSystemDetail('r2', 'Falha na leitura', 'Não foi possível medir o bucket de imagens.', 'Erro', 'error', 100);
    }

    const requests = Number(today.identify_requests || 0);
    const tokens = Number(today.total_tokens || 0);
    const average = Number(gemini.average_tokens_per_identification_today || 0);
    updateDashboardKpi('gemini', formatNumber(tokens), `${formatNumber(requests)} identificação(ões) hoje`);
    updateSystemDetail(
      'gemini',
      `${formatNumber(tokens)} tokens hoje`,
      `${formatNumber(requests)} identificação(ões)${average ? ` · média ${formatNumber(average)} tokens/consulta` : ''} · ${gemini.model || 'Gemini'}.`,
      gemini.configured ? 'Ativo' : 'Sem chave',
      gemini.configured ? '' : 'error',
      0
    );
  } catch {
    updateDashboardKpi('database', 'Erro', 'Não foi possível medir o D1');
    updateDashboardKpi('gemini', 'Erro', 'Não foi possível ler a telemetria');
    updateSystemDetail('database', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error', 100);
    updateSystemDetail('r2', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error', 100);
    updateSystemDetail('gemini', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error', 100);
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
