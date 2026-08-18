import './admin-runtime-fixes.css';

let pollTimer = null;
let applying = false;
let activeView = 'geral';

const VIEW_COPY = {
  geral: ['Visão geral', 'Resumo do catálogo e saúde do sistema.'],
  produtos: ['Produtos', 'Consulte o catálogo, pesquise SKUs e visualize os dados dos produtos.'],
  mockups: ['Mockups', 'Localize produtos pela imagem e substitua mockups quando necessário.'],
  importacao: ['Importação', 'Atualize produtos em massa por arquivo CSV.'],
  ferramentas: ['Ferramentas', 'Ações administrativas disponíveis para manutenção do catálogo.'],
  administracao: ['Administração', 'Acompanhe banco de dados, armazenamento, Gemini e estado técnico do sistema.']
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

function ensureViewHeader() {
  const panel = document.querySelector('.admin-dashboard-panel');
  if (!panel) return null;
  let header = panel.querySelector(':scope > .admin-view-header');
  if (!header) {
    header = document.createElement('section');
    header.className = 'admin-view-header';
    header.innerHTML = '<div><span>ADMIN</span><h2>Visão geral</h2><p>Resumo do catálogo e saúde do sistema.</p></div>';
    panel.prepend(header);
  }
  return header;
}

function setCatalogMode(mode) {
  const catalog = document.querySelector('.catalog-details');
  if (!catalog) return;
  catalog.classList.toggle('catalog-products-mode', mode === 'produtos');
  catalog.classList.toggle('catalog-mockups-mode', mode === 'mockups');
  const summary = catalog.querySelector(':scope > summary');
  if (summary) summary.textContent = mode === 'mockups' ? 'Galeria de mockups' : 'Catálogo de produtos';
  const search = catalog.querySelector('.catalog-search');
  if (search) search.placeholder = mode === 'mockups' ? 'Buscar mockup por nome ou SKU...' : 'Buscar por nome do produto ou SKU...';

  const wantedView = mode === 'mockups' ? 'grid' : 'list';
  const viewButton = catalog.querySelector(`.catalog-view-button[data-view="${wantedView}"]`);
  if (viewButton && !viewButton.classList.contains('active')) viewButton.click();
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
  const system = document.querySelector('.admin-system-details');
  const tools = document.querySelector('.admin-tools-section');
  const catalog = document.querySelector('.catalog-details');
  const importPanel = document.querySelector('.admin-tool-panel[data-tool-panel="importacao"]');
  const cadastroPanel = document.querySelector('.admin-tool-panel[data-tool-panel="cadastro"]');
  const manualPanel = document.querySelector('.admin-tool-panel[data-tool-panel="manual"]');
  const indexPanel = document.querySelector('.admin-tool-panel[data-tool-panel="indice"]');

  closeToolPanels();
  setVisible(kpis, activeView === 'geral');
  setVisible(system, activeView === 'geral' || activeView === 'administracao');
  setVisible(tools, activeView === 'ferramentas');
  setVisible(catalog, activeView === 'produtos' || activeView === 'mockups');
  setVisible(importPanel, activeView === 'importacao');
  setVisible(cadastroPanel, false);
  setVisible(manualPanel, false);
  setVisible(indexPanel, false);

  if (activeView === 'importacao' && importPanel) {
    importPanel.hidden = false;
    importPanel.classList.add('tool-panel-visible');
  }

  if (activeView === 'produtos' || activeView === 'mockups') {
    if (catalog) catalog.open = true;
    setCatalogMode(activeView);
  }

  if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function showTool(name) {
  if (name === 'catalogo') return applyView('produtos', { scroll: true });
  if (name === 'mockups') return applyView('mockups', { scroll: true });
  if (name === 'importacao') return applyView('importacao', { scroll: true });
  if (name === 'system') return applyView('administracao', { scroll: true });

  applyView('ferramentas', { scroll: true });
  const target = document.querySelector(`.admin-tool-panel[data-tool-panel="${name}"]`);
  if (!target) return;
  target.hidden = false;
  target.classList.add('tool-panel-visible');
  target.scrollIntoView({ behavior: 'auto', block: 'start' });
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

  const tool = event.target.closest('.admin-tool-card[data-open-tool]');
  if (tool) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showTool(tool.dataset.openTool);
    return;
  }

  const system = event.target.closest('.admin-tool-card[data-open-system="1"]');
  if (system) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showTool('system');
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

function prepareDashboard() {
  if (!isAdmin()) return;

  const dbKpi = document.querySelector('.admin-kpi[data-kpi="database"], .admin-kpi[data-system-kpi="database"]');
  const geminiKpi = document.querySelector('.admin-kpi[data-kpi="gemini"], .admin-kpi[data-system-kpi="gemini"]');
  if (dbKpi) {
    dbKpi.removeAttribute('data-kpi');
    dbKpi.dataset.systemKpi = 'database';
  }
  if (geminiKpi) {
    geminiKpi.removeAttribute('data-kpi');
    geminiKpi.dataset.systemKpi = 'gemini';
  }

  const tools = document.querySelector('.admin-tools-grid');
  if (tools) {
    tools.querySelector('[data-open-tool="manual"]')?.remove();
    tools.querySelector('[data-open-tool="indice"]')?.remove();

    if (!tools.querySelector('[data-open-system="1"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-tool-card tool-slate';
      button.dataset.openSystem = '1';
      button.innerHTML = '<span>◉</span><div><strong>Dados do sistema</strong><small>D1, R2 e consumo medido do Gemini.</small></div><b>›</b>';
      tools.appendChild(button);
    }
  }

  const kpiGrid = document.querySelector('.admin-kpi-grid');
  if (kpiGrid && !document.querySelector('.admin-system-details')) {
    const details = document.createElement('section');
    details.className = 'admin-system-details';
    details.innerHTML = `
      <article class="system-detail-card" data-system-detail="database">
        <span class="system-detail-icon">DB</span>
        <div class="system-detail-copy"><strong>Banco de dados · Cloudflare D1</strong><b>Carregando...</b><span>Lendo tamanho real do banco.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <article class="system-detail-card" data-system-detail="r2">
        <span class="system-detail-icon">R2</span>
        <div class="system-detail-copy"><strong>Mockups e imagens · Cloudflare R2</strong><b>Carregando...</b><span>Somando os arquivos armazenados no bucket.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <article class="system-detail-card" data-system-detail="gemini">
        <span class="system-detail-icon">✦</span>
        <div class="system-detail-copy"><strong>Gemini · identificação visual</strong><b>Carregando...</b><span>Lendo consultas e tokens medidos pelo sistema.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <div class="system-measurement-note">D1 e R2 são medidos separadamente porque o banco estruturado e as imagens ficam em serviços diferentes. O consumo do Gemini mostra somente as chamadas feitas por este app desde que a telemetria foi ativada.</div>
    `;
    kpiGrid.insertAdjacentElement('afterend', details);
  }

  ensureViewHeader();
}

function updateKpi(card, value, sub) {
  if (!card) return;
  const valueNode = card.querySelector('.kpi-value');
  const subNode = card.querySelector('.kpi-sub');
  if (valueNode) valueNode.textContent = value;
  if (subNode) subNode.textContent = sub;
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
    const dbSub = database.configured_limit_bytes
      ? `${Number(database.configured_percent || 0).toFixed(2)}% do limite configurado`
      : `${freePercent.toFixed(freePercent < 1 ? 3 : 1)}% de 500 MB Free · Paid 10 GB`;

    updateKpi(
      document.querySelector('.admin-kpi[data-system-kpi="database"]'),
      dbUsed,
      `D1 online · ${dbSub}`
    );

    const dbState = freePercent >= 90 ? ['Atenção', 'warning'] : ['Saudável', ''];
    updateSystemDetail(
      'database',
      `${dbUsed} no D1`,
      `Tamanho real do banco estruturado. Limite por banco: Workers Free 500 MB; Workers Paid 10 GB.`,
      dbState[0],
      dbState[1]
    );

    if (storageResponse.ok) {
      const r2Used = formatBytes(r2.used_bytes);
      const r2Percent = Number(r2.percent_of_free_included_storage || 0);
      updateSystemDetail(
        'r2',
        `${r2Used} · ${formatNumber(r2.object_count)} arquivo(s)`,
        `${r2Percent.toFixed(r2Percent < 1 ? 3 : 1)}% dos 10 GB-mês incluídos no nível gratuito Standard. O bucket não tem limite fixo de armazenamento; acima da franquia há cobrança por uso.`,
        'Saudável',
        ''
      );
    } else {
      updateSystemDetail('r2', 'Falha na leitura', 'Não foi possível medir o bucket de imagens.', 'Erro', 'error');
    }

    const requests = Number(today.identify_requests || 0);
    const tokens = Number(today.total_tokens || 0);
    const average = Number(gemini.average_tokens_per_identification_today || 0);
    updateKpi(
      document.querySelector('.admin-kpi[data-system-kpi="gemini"]'),
      `${formatNumber(requests)} consulta${requests === 1 ? '' : 's'}`,
      `${formatNumber(tokens)} tokens hoje${average ? ` · média ${formatNumber(average)}/consulta` : ''}`
    );

    updateSystemDetail(
      'gemini',
      `${formatNumber(tokens)} tokens medidos hoje`,
      `${formatNumber(requests)} identificação(ões) hoje · ${gemini.model || 'Gemini'} · estes números vêm das respostas da API usada pelo próprio NISTI. RPM/TPM/RPD do projeto são consultados no AI Studio.`,
      gemini.configured ? 'Ativo' : 'Sem chave',
      gemini.configured ? '' : 'error'
    );
  } catch {
    updateKpi(document.querySelector('.admin-kpi[data-system-kpi="database"]'), 'Erro', 'Não foi possível ler o D1');
    updateKpi(document.querySelector('.admin-kpi[data-system-kpi="gemini"]'), 'Erro', 'Não foi possível ler a telemetria');
    updateSystemDetail('database', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
    updateSystemDetail('r2', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
    updateSystemDetail('gemini', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
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
