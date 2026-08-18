import './general-panel.css';
import './admin-layout.css';

const params = new URLSearchParams(window.location.search);
const adminRequested = params.get('nisti_admin') === '1';
let isAdminArea = false;
let adminAutoOpened = false;
let activeAdminTab = 'produtos';
let activeCatalogPlatform = '';
let catalogPage = 1;
let catalogPageSize = 12;
let catalogView = 'grid';
let metricsLoadedAt = 0;

document.documentElement.dataset.nistiAccess = 'general';

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function iconSvg(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    upload: '<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4h16v-4"/>',
    tools: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.6 2.6-3-3 2.6-2.6Z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    sparkles: '<path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3Z"/><path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13Z"/><path d="m6 14 .8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8L6 14Z"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    pencil: '<path d="m4 20 4.2-1 10-10-3.2-3.2-10 10L4 20Z"/><path d="m13.8 7 3.2 3.2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.box}</svg>`;
}

function legacyHeaderButtons(nav) {
  return Array.from(nav.querySelectorAll(':scope > button')).filter(button => !button.classList.contains('admin-section-tab'));
}

function setAdminTab(name) {
  activeAdminTab = name;
  document.querySelectorAll('.admin-section-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.section === name);
  });
}

function scrollToElement(element) {
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function classifyAdminPanels() {
  const panel = document.querySelector('.panel:not(.expedition)');
  if (!panel) return null;

  panel.classList.add('admin-dashboard-panel');
  const quick = panel.querySelector(':scope > .quick-workflow');
  if (quick) {
    quick.classList.add('admin-tool-panel');
    quick.dataset.toolPanel = 'manual';
  }

  for (const child of panel.querySelectorAll(':scope > .form, :scope > form.form')) {
    if (child === quick) continue;
    const text = normalizeSearch(child.querySelector('.panel-head')?.textContent || child.textContent);
    if (text.includes('importacao em massa')) {
      child.classList.add('admin-tool-panel');
      child.dataset.toolPanel = 'importacao';
    } else if (text.includes('indice visual das capas')) {
      child.classList.add('admin-tool-panel');
      child.dataset.toolPanel = 'indice';
    } else if (text.includes('cadastro manual de produto')) {
      child.classList.add('admin-tool-panel');
      child.dataset.toolPanel = 'cadastro';
    }
  }

  const details = panel.querySelector(':scope > .catalog-details');
  if (details) details.dataset.toolPanel = 'catalogo';
  return panel;
}

function closeToolPanels() {
  document.querySelectorAll('.admin-tool-panel').forEach(panel => panel.classList.remove('tool-panel-visible'));
}

function openAdminTool(name) {
  const panel = classifyAdminPanels();
  if (!panel) return;
  closeToolPanels();

  if (name === 'catalogo' || name === 'mockups') {
    const details = panel.querySelector('.catalog-details');
    if (details) details.open = true;
    setAdminTab(name === 'mockups' ? 'mockups' : 'produtos');
    scrollToElement(details);
    return;
  }

  const target = panel.querySelector(`[data-tool-panel="${name}"]`);
  if (target) {
    target.classList.add('tool-panel-visible');
    scrollToElement(target);
  }

  if (name === 'importacao') setAdminTab('importacao');
  else if (name === 'indice' || name === 'manual' || name === 'cadastro') setAdminTab('ferramentas');
}

function enhanceHeader() {
  const header = document.querySelector('main.shell > header');
  if (!header) return;

  header.classList.add('nisti-app-header');
  setText(header.querySelector('h1'), 'Identificação Visual');
  const nav = header.querySelector('nav');
  if (!nav) return;
  const buttons = legacyHeaderButtons(nav);

  if (isAdminArea) {
    header.classList.add('admin-header');
    nav.classList.add('admin-navigation');
    nav.classList.remove('general-navigation-hidden');
    nav.removeAttribute('aria-hidden');

    buttons.forEach(button => {
      button.classList.add('legacy-admin-switch');
      button.tabIndex = -1;
    });

    if (!header.querySelector('.nisti-brand-mark')) {
      const brand = document.createElement('div');
      brand.className = 'nisti-brand-mark';
      brand.innerHTML = '<strong>NP</strong><span>NISTI PRINT</span>';
      header.insertAdjacentElement('afterbegin', brand);
    }

    const title = header.querySelector(':scope > div:not(.nisti-brand-mark)');
    if (title) {
      title.classList.add('admin-title-block');
      setText(title.querySelector('.eyebrow'), 'NISTI PRINT');
    }

    let tabs = nav.querySelector('.admin-section-tabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'admin-section-tabs';
      const items = [
        ['geral', 'home', 'Geral'],
        ['produtos', 'box', 'Produtos'],
        ['mockups', 'image', 'Mockups'],
        ['importacao', 'upload', 'Importação'],
        ['ferramentas', 'tools', 'Ferramentas'],
        ['administracao', 'gear', 'Administração']
      ];
      tabs.innerHTML = items.map(([section, icon, label]) => `<button type="button" class="admin-section-tab${section === 'produtos' ? ' active' : ''}" data-section="${section}">${iconSvg(icon)}<span>${label}</span></button>`).join('');
      nav.prepend(tabs);

      tabs.addEventListener('click', event => {
        const button = event.target.closest('.admin-section-tab');
        if (!button) return;
        const section = button.dataset.section;
        if (section === 'geral') {
          buttons[0]?.click();
          return;
        }
        if (section === 'produtos') {
          closeToolPanels();
          setAdminTab('produtos');
          scrollToElement(document.querySelector('.catalog-details'));
          return;
        }
        if (section === 'mockups') return openAdminTool('mockups');
        if (section === 'importacao') return openAdminTool('importacao');
        if (section === 'ferramentas') {
          setAdminTab('ferramentas');
          scrollToElement(document.querySelector('.admin-tools-section'));
          return;
        }
        setAdminTab('administracao');
        scrollToElement(document.querySelector('.admin-kpi-grid'));
      });
    }

    if (!nav.querySelector('.admin-profile-chip')) {
      const profile = document.createElement('div');
      profile.className = 'admin-profile-chip';
      profile.innerHTML = '<strong>AD</strong><span><b>Administrador</b><small>Sessão protegida</small></span>';
      nav.appendChild(profile);
    }

    if (!nav.querySelector('.admin-logout')) {
      const logout = document.createElement('a');
      logout.className = 'admin-logout';
      logout.href = '/admin-logout';
      logout.innerHTML = '<span>↪</span> Sair';
      logout.setAttribute('aria-label', 'Encerrar sessão administrativa');
      nav.appendChild(logout);
    }

    setAdminTab(activeAdminTab);

    if (!adminAutoOpened && buttons[1] && !buttons[1].classList.contains('active')) {
      adminAutoOpened = true;
      queueMicrotask(() => buttons[1]?.click());
    }
  } else {
    header.classList.remove('admin-header');
    header.querySelector('.nisti-brand-mark')?.remove();
    nav.classList.add('general-navigation-hidden');
    nav.setAttribute('aria-hidden', 'true');
    buttons.forEach(button => { button.tabIndex = -1; });
    nav.querySelector('.admin-section-tabs')?.remove();
    nav.querySelector('.admin-profile-chip')?.remove();
    nav.querySelector('.admin-logout')?.remove();
  }
}

function enhanceGeneralPanel() {
  const panel = document.querySelector('.panel.expedition');
  if (!panel) return;
  panel.classList.add('general-panel');
  setText(panel.querySelector(':scope > .eyebrow'), 'PAINEL GERAL');
  const heading = panel.querySelector(':scope > h2');
  setText(heading, 'Identificação de produto');
  const intro = heading?.nextElementSibling;
  if (intro?.tagName === 'P') {
    setText(intro, 'Fotografe a capa do produto de frente. O sistema localiza a referência visual e retorna o SKU correspondente.');
  }
  const camera = panel.querySelector('.camera');
  if (camera) {
    camera.setAttribute('aria-label', 'Fotografar ou enviar imagem da capa');
    setText(camera.querySelector('strong'), 'Fotografar ou enviar capa');
    setText(camera.querySelector('small'), 'Use uma imagem frontal, nítida e com boa iluminação.');
  }
}

async function refreshAdminMetrics(force = false) {
  if (!isAdminArea) return;
  if (!force && Date.now() - metricsLoadedAt < 5000) return;
  const grid = document.querySelector('.admin-kpi-grid');
  if (!grid) return;
  metricsLoadedAt = Date.now();

  try {
    const [productsResponse, indexResponse] = await Promise.all([
      fetch('/api/products', { cache: 'no-store' }),
      fetch('/api/admin/cover-index', { cache: 'no-store' })
    ]);
    if (!productsResponse.ok || !indexResponse.ok) return;
    const productsData = await productsResponse.json();
    const indexData = await indexResponse.json();
    const products = productsData.products || [];
    const withImage = products.filter(product => product.image_url).length;
    const pending = products.length - withImage;
    const progress = products.length ? Math.round((withImage / products.length) * 100) : 0;

    const values = {
      products: [products.length, 'Total de SKUs no sistema'],
      mockups: [withImage, pending ? `${pending} sem imagem` : '100% com imagem'],
      pending: [pending, pending ? 'Precisam de mockup' : 'Nenhum pendente'],
      progress: [`${progress}%`, `${withImage} de ${products.length} concluídos`],
      database: ['Online', `${products.length} produtos · ${indexData.reference_covers || 0} referências`],
      gemini: ['Ativo', `${indexData.embedding_model || 'Embedding'} · Top-K ${indexData.top_k || 8}`]
    };

    for (const [key, [value, sub]] of Object.entries(values)) {
      const card = grid.querySelector(`[data-kpi="${key}"]`);
      setText(card?.querySelector('.kpi-value'), value);
      setText(card?.querySelector('.kpi-sub'), sub);
    }
  } catch {
    // Os cards mantêm estado neutro se a leitura falhar.
  }
}

function ensureAdminDashboard() {
  if (!isAdminArea) return;
  const panel = classifyAdminPanels();
  if (!panel) return;
  const panelHead = panel.querySelector(':scope > .panel-head');

  if (!panel.querySelector(':scope > .admin-kpi-grid')) {
    const grid = document.createElement('section');
    grid.className = 'admin-kpi-grid';
    grid.innerHTML = `
      <article class="admin-kpi kpi-blue" data-kpi="products"><span class="kpi-icon">${iconSvg('box')}</span><div><small>Produtos cadastrados</small><strong class="kpi-value">—</strong><span class="kpi-sub">Carregando...</span></div></article>
      <article class="admin-kpi kpi-orange" data-kpi="mockups"><span class="kpi-icon">${iconSvg('image')}</span><div><small>Mockups com imagem</small><strong class="kpi-value">—</strong><span class="kpi-sub">Carregando...</span></div></article>
      <article class="admin-kpi kpi-purple" data-kpi="pending"><span class="kpi-icon">${iconSvg('tools')}</span><div><small>Pendentes</small><strong class="kpi-value">—</strong><span class="kpi-sub">Carregando...</span></div></article>
      <article class="admin-kpi kpi-green" data-kpi="progress"><span class="kpi-icon">${iconSvg('check')}</span><div><small>Progresso do catálogo</small><strong class="kpi-value">—</strong><span class="kpi-sub">Carregando...</span></div></article>
      <article class="admin-kpi kpi-blue" data-kpi="database"><span class="kpi-icon">${iconSvg('database')}</span><div><small>Banco de dados</small><strong class="kpi-value">—</strong><span class="kpi-sub">Status do D1</span></div></article>
      <article class="admin-kpi kpi-purple" data-kpi="gemini"><span class="kpi-icon">${iconSvg('sparkles')}</span><div><small>Gemini</small><strong class="kpi-value">—</strong><span class="kpi-sub">Modelo de identificação</span></div></article>
    `;
    panelHead?.insertAdjacentElement('afterend', grid);
  }

  if (!panel.querySelector(':scope > .admin-tools-section')) {
    const tools = document.createElement('section');
    tools.className = 'admin-tools-section';
    tools.innerHTML = `
      <div class="admin-section-heading"><div><strong>Ferramentas</strong><span>Acesse as rotinas administrativas sem poluir a tela principal.</span></div></div>
      <div class="admin-tools-grid">
        <button type="button" class="admin-tool-card tool-blue" data-open-tool="catalogo"><span>${iconSvg('box')}</span><div><strong>Catálogo completo</strong><small>Visualize produtos e edite mockups.</small></div>${iconSvg('chevron')}</button>
        <button type="button" class="admin-tool-card tool-orange" data-open-tool="importacao"><span>${iconSvg('upload')}</span><div><strong>Importação em massa</strong><small>Atualize produtos por arquivo CSV.</small></div>${iconSvg('chevron')}</button>
        <button type="button" class="admin-tool-card tool-green" data-open-tool="cadastro"><span>${iconSvg('plus')}</span><div><strong>Cadastro manual</strong><small>Cadastre um SKU individualmente.</small></div>${iconSvg('chevron')}</button>
        <button type="button" class="admin-tool-card tool-purple" data-open-tool="mockups"><span>${iconSvg('pencil')}</span><div><strong>Editar mockup</strong><small>Localize e substitua imagens existentes.</small></div>${iconSvg('chevron')}</button>
        <button type="button" class="admin-tool-card tool-gold" data-open-tool="manual"><span>${iconSvg('tools')}</span><div><strong>Modo manual</strong><small>Use para pendências e correções pontuais.</small></div>${iconSvg('chevron')}</button>
        <button type="button" class="admin-tool-card tool-slate" data-open-tool="indice"><span>${iconSvg('sparkles')}</span><div><strong>Índice visual</strong><small>Consulte e atualize as referências da IA.</small></div>${iconSvg('chevron')}</button>
      </div>
    `;
    const grid = panel.querySelector(':scope > .admin-kpi-grid');
    grid?.insertAdjacentElement('afterend', tools);
    tools.addEventListener('click', event => {
      const card = event.target.closest('[data-open-tool]');
      if (card) openAdminTool(card.dataset.openTool);
    });
  }

  closeToolPanels();
  refreshAdminMetrics();
}

function platformFamily(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw === 'SEM PLATAFORMA') return 'SEM PLATAFORMA';
  if (raw.includes('MERCADO LIVRE')) return 'MERCADO LIVRE';
  if (raw.includes('SHOPEE')) return 'SHOPEE';
  if (raw.includes('AMAZON')) return 'AMAZON';
  if (raw.includes('B2W')) return 'B2W';
  return raw;
}

function getCatalogPlatform(card) {
  const meta = String(card.querySelector('.product-copy small')?.textContent || '');
  const pieces = meta.split('·').map(value => value.trim()).filter(Boolean);
  return platformFamily(pieces.length > 1 ? pieces[pieces.length - 1] : 'SEM PLATAFORMA');
}

function catalogCards(list) {
  return Array.from(list?.querySelectorAll(':scope > .catalog-product') || []);
}

function refreshCatalogImageUrls(details) {
  if (!details) return;
  const stamp = Date.now().toString(36);
  for (const image of details.querySelectorAll('img')) {
    if (image.dataset.nistiCacheBusted === '1') continue;
    let parsed;
    try { parsed = new URL(image.getAttribute('src') || '', window.location.href); } catch { continue; }
    if (!/^\/api\/images\/\d+$/.test(parsed.pathname)) continue;
    parsed.searchParams.set('v', stamp);
    image.dataset.nistiCacheBusted = '1';
    image.src = `${parsed.pathname}${parsed.search}`;
  }
}

function syncPlatformControls(details) {
  const list = details?.querySelector('.catalog-edit-list');
  const select = details?.querySelector('.catalog-platform-filter');
  const chips = details?.querySelector('.catalog-platform-chips');
  if (!list || !select || !chips) return;

  const cards = catalogCards(list);
  const counts = new Map();
  cards.forEach(card => {
    const platform = getCatalogPlatform(card);
    counts.set(platform, (counts.get(platform) || 0) + 1);
  });
  const platforms = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const signature = platforms.map(name => `${name}:${counts.get(name)}`).join('|');
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;

  select.innerHTML = '<option value="">Todas as plataformas</option>' + platforms.map(platform => `<option value="${platform}">${platform}</option>`).join('');
  chips.innerHTML = `<button type="button" class="platform-chip${activeCatalogPlatform ? '' : ' active'}" data-platform="">Todos <b>${cards.length}</b></button>` + platforms.map(platform => `<button type="button" class="platform-chip${activeCatalogPlatform === platform ? ' active' : ''}" data-platform="${platform}">${platform} <b>${counts.get(platform)}</b></button>`).join('');
}

function renderCatalogPagination(details, totalMatches) {
  const pagination = details.querySelector('.catalog-pagination');
  if (!pagination) return;
  const pages = Math.max(1, Math.ceil(totalMatches / catalogPageSize));
  catalogPage = Math.min(Math.max(1, catalogPage), pages);
  const numbers = [];
  for (let page = 1; page <= pages; page++) {
    if (pages <= 7 || page === 1 || page === pages || Math.abs(page - catalogPage) <= 1) numbers.push(page);
    else if (numbers[numbers.length - 1] !== '…') numbers.push('…');
  }
  pagination.innerHTML = `
    <button type="button" data-page="prev" ${catalogPage <= 1 ? 'disabled' : ''}>‹</button>
    ${numbers.map(value => value === '…' ? '<span>…</span>' : `<button type="button" data-page="${value}" class="${value === catalogPage ? 'active' : ''}">${value}</button>`).join('')}
    <button type="button" data-page="next" ${catalogPage >= pages ? 'disabled' : ''}>›</button>
  `;
}

function applyCatalogFilter(details) {
  const list = details?.querySelector('.catalog-edit-list');
  const tools = details?.querySelector(':scope > .catalog-tools');
  if (!list || !tools) return;

  const search = tools.querySelector('.catalog-search');
  const platformFilter = tools.querySelector('.catalog-platform-filter');
  const count = tools.querySelector('.catalog-filter-count');
  const empty = details.querySelector(':scope > .catalog-empty-state');
  const cards = catalogCards(list);
  const query = normalizeSearch(search?.value);
  const dropdownPlatform = platformFilter?.value || '';
  const platform = activeCatalogPlatform || dropdownPlatform;

  const matching = cards.filter(card => {
    const sku = normalizeSearch(card.querySelector('.product-copy strong')?.textContent);
    const name = normalizeSearch(card.querySelector('.product-copy span')?.textContent);
    const meta = normalizeSearch(card.querySelector('.product-copy small')?.textContent);
    const cardPlatform = getCatalogPlatform(card);
    return (!query || sku.includes(query) || name.includes(query) || meta.includes(query)) && (!platform || cardPlatform === platform);
  });

  const pages = Math.max(1, Math.ceil(matching.length / catalogPageSize));
  catalogPage = Math.min(catalogPage, pages);
  const start = (catalogPage - 1) * catalogPageSize;
  const visibleSet = new Set(matching.slice(start, start + catalogPageSize));
  cards.forEach(card => { card.hidden = !visibleSet.has(card); });

  const shownStart = matching.length ? start + 1 : 0;
  const shownEnd = Math.min(start + catalogPageSize, matching.length);
  if (count) count.textContent = `Mostrando ${shownStart} a ${shownEnd} de ${matching.length} produtos`;
  if (empty) empty.hidden = matching.length !== 0;
  details.dataset.catalogView = catalogView;
  details.querySelectorAll('.catalog-view-button').forEach(button => button.classList.toggle('active', button.dataset.view === catalogView));
  renderCatalogPagination(details, matching.length);
}

function enhanceCatalog() {
  if (!isAdminArea) return;
  const details = document.querySelector('.catalog-details');
  const list = details?.querySelector('.catalog-edit-list');
  const summary = details?.querySelector(':scope > summary');
  if (!details || !list || !summary) return;

  details.open = true;
  details.classList.add('admin-catalog');
  const countMatch = String(summary.textContent || '').match(/\((\d+)\s*SKUs?\)/i);
  setText(summary, `Catálogo de produtos${countMatch ? ` (${countMatch[1]})` : ''}`);
  if (!summary.dataset.locked) {
    summary.dataset.locked = '1';
    summary.addEventListener('click', event => event.preventDefault());
  }

  let tools = details.querySelector(':scope > .catalog-tools');
  if (!tools) {
    tools = document.createElement('div');
    tools.className = 'catalog-tools';
    tools.innerHTML = `
      <div class="catalog-main-controls">
        <label class="catalog-search-field"><span class="catalog-search-icon">${iconSvg('search')}</span><input type="search" class="catalog-search" placeholder="Buscar por nome do produto ou SKU..." autocomplete="off" /></label>
        <select class="catalog-platform-filter"><option value="">Todas as plataformas</option></select>
        <div class="catalog-view-toggle" aria-label="Modo de visualização">
          <button type="button" class="catalog-view-button active" data-view="grid" title="Visualização em grade">${iconSvg('grid')}</button>
          <button type="button" class="catalog-view-button" data-view="list" title="Visualização em lista">${iconSvg('list')}</button>
        </div>
      </div>
      <div class="catalog-platform-chips"></div>
    `;
    summary.insertAdjacentElement('afterend', tools);

    const empty = document.createElement('div');
    empty.className = 'catalog-empty-state';
    empty.hidden = true;
    empty.innerHTML = '<strong>Nenhum produto encontrado.</strong><span>Tente outro nome, SKU ou plataforma.</span>';
    list.insertAdjacentElement('beforebegin', empty);

    const footer = document.createElement('div');
    footer.className = 'catalog-footer';
    footer.innerHTML = '<span class="catalog-filter-count">0 produtos</span><div class="catalog-pagination"></div><label><select class="catalog-page-size"><option value="12">12 por página</option><option value="24">24 por página</option><option value="48">48 por página</option></select></label>';
    list.insertAdjacentElement('afterend', footer);
  }

  refreshCatalogImageUrls(details);
  syncPlatformControls(details);

  if (!tools.dataset.bound) {
    tools.dataset.bound = '1';
    const search = tools.querySelector('.catalog-search');
    const platformFilter = tools.querySelector('.catalog-platform-filter');
    search?.addEventListener('input', () => { catalogPage = 1; applyCatalogFilter(details); });
    platformFilter?.addEventListener('change', () => {
      activeCatalogPlatform = '';
      catalogPage = 1;
      tools.querySelectorAll('.platform-chip').forEach(chip => chip.classList.toggle('active', !chip.dataset.platform));
      applyCatalogFilter(details);
    });
    tools.addEventListener('click', event => {
      const chip = event.target.closest('.platform-chip');
      if (chip) {
        activeCatalogPlatform = chip.dataset.platform || '';
        platformFilter.value = '';
        catalogPage = 1;
        tools.querySelectorAll('.platform-chip').forEach(item => item.classList.toggle('active', item === chip));
        applyCatalogFilter(details);
        return;
      }
      const view = event.target.closest('.catalog-view-button');
      if (view) {
        catalogView = view.dataset.view || 'grid';
        applyCatalogFilter(details);
      }
    });

    const footer = details.querySelector('.catalog-footer');
    footer?.addEventListener('click', event => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      const value = button.dataset.page;
      if (value === 'prev') catalogPage -= 1;
      else if (value === 'next') catalogPage += 1;
      else catalogPage = Number(value) || 1;
      applyCatalogFilter(details);
      scrollToElement(details);
    });
    footer?.querySelector('.catalog-page-size')?.addEventListener('change', event => {
      catalogPageSize = Number(event.target.value) || 12;
      catalogPage = 1;
      applyCatalogFilter(details);
    });
  }

  applyCatalogFilter(details);
}

function applyInterface() {
  enhanceHeader();
  enhanceGeneralPanel();
  if (isAdminArea) {
    ensureAdminDashboard();
    enhanceCatalog();
  }
}

function startObserver() {
  const root = document.getElementById('root');
  if (!root) return;
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyInterface();
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  applyInterface();
}

async function initializeAccess() {
  if (adminRequested) {
    try {
      const response = await fetch('/api/admin/session', { cache: 'no-store' });
      isAdminArea = response.ok;
    } catch {
      isAdminArea = false;
    }
    if (!isAdminArea) history.replaceState(null, '', '/');
  }
  document.documentElement.dataset.nistiAccess = isAdminArea ? 'admin' : 'general';
  startObserver();
}

initializeAccess();
