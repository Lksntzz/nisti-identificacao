import './admin-runtime-fixes.css';

let pollTimer = null;
let applying = false;

function isAdmin() {
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function setActiveTab(section) {
  document.querySelectorAll('.admin-section-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.section === section);
  });
}

function closeToolPanels() {
  document.querySelectorAll('.admin-tool-panel').forEach(panel => {
    panel.classList.remove('tool-panel-visible');
  });
}

function showTool(name) {
  closeToolPanels();
  const target = document.querySelector(`.admin-tool-panel[data-tool-panel="${name}"]`);
  if (!target) return;
  target.classList.add('tool-panel-visible');
  target.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function openCatalog(section = 'produtos') {
  closeToolPanels();
  const catalog = document.querySelector('.catalog-details');
  if (!catalog) return;
  catalog.open = true;
  setActiveTab(section);
  catalog.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function handleAdminNavigation(event) {
  if (!isAdmin()) return;

  const tab = event.target.closest('.admin-section-tab');
  if (tab) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const section = tab.dataset.section;

    if (section === 'geral') {
      closeToolPanels();
      setActiveTab('geral');
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    if (section === 'produtos') return openCatalog('produtos');
    if (section === 'mockups') return openCatalog('mockups');
    if (section === 'importacao') {
      setActiveTab('importacao');
      showTool('importacao');
      return;
    }
    if (section === 'ferramentas') {
      closeToolPanels();
      setActiveTab('ferramentas');
      document.querySelector('.admin-tools-section')?.scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }
    if (section === 'administracao') {
      closeToolPanels();
      setActiveTab('administracao');
      document.querySelector('.admin-system-details')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
    return;
  }

  const tool = event.target.closest('.admin-tool-card[data-open-tool]');
  if (tool) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const name = tool.dataset.openTool;
    if (name === 'catalogo') return openCatalog('produtos');
    if (name === 'mockups') return openCatalog('mockups');
    if (name === 'importacao') setActiveTab('importacao');
    else setActiveTab('ferramentas');
    showTool(name);
    return;
  }

  const system = event.target.closest('.admin-tool-card[data-open-system="1"]');
  if (system) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    setActiveTab('administracao');
    document.querySelector('.admin-system-details')?.scrollIntoView({ behavior: 'auto', block: 'start' });
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

  // O painel geral do ADM permanece dentro do dashboard; não troca para a câmera pública.
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
      button.innerHTML = '<span>◉</span><div><strong>Dados do sistema</strong><small>Veja banco D1 e consumo real do Gemini.</small></div><b>›</b>';
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
      <article class="system-detail-card" data-system-detail="gemini">
        <span class="system-detail-icon">✦</span>
        <div class="system-detail-copy"><strong>Gemini · identificação visual</strong><b>Carregando...</b><span>Lendo consultas e tokens medidos pelo sistema.</span></div>
        <em class="system-status">Verificando</em>
      </article>
      <div class="system-measurement-note">Os números de consumo do Gemini começam a ser registrados a partir desta versão. O histórico anterior não pode ser reconstruído pela API key.</div>
    `;
    kpiGrid.insertAdjacentElement('afterend', details);
  }
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
    const response = await fetch('/api/admin/system-metrics', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const database = data.database || {};
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
      `${dbUsed} usados`,
      `Banco online. Limite por banco: Workers Free 500 MB; Workers Paid 10 GB. O plano da conta não é informado ao Worker.`,
      dbState[0],
      dbState[1]
    );

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
      `${formatNumber(tokens)} tokens hoje`,
      `${formatNumber(requests)} consulta(s) hoje · ${gemini.model || 'Gemini'} · limites ativos RPM/TPM/RPD precisam ser conferidos no AI Studio.`,
      gemini.configured ? 'Ativo' : 'Sem chave',
      gemini.configured ? '' : 'error'
    );
  } catch {
    updateKpi(document.querySelector('.admin-kpi[data-system-kpi="database"]'), 'Erro', 'Não foi possível ler o D1');
    updateKpi(document.querySelector('.admin-kpi[data-system-kpi="gemini"]'), 'Erro', 'Não foi possível ler a telemetria');
    updateSystemDetail('database', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
    updateSystemDetail('gemini', 'Falha na leitura', 'Atualize a página depois do deploy.', 'Erro', 'error');
  }
}

function applyFixes() {
  if (applying || !isAdmin()) return;
  applying = true;
  try {
    prepareDashboard();
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
