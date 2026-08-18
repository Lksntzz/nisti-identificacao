import './general-panel.css';
import './admin-layout.css';

const params = new URLSearchParams(window.location.search);
const adminRequested = params.get('nisti_admin') === '1';
let isAdminArea = false;
let adminAutoOpened = false;

document.documentElement.dataset.nistiAccess = 'general';

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function enhanceHeader() {
  const header = document.querySelector('main.shell > header');
  if (!header) return;

  header.classList.add('nisti-app-header');
  setText(header.querySelector('h1'), 'Identificação Visual');

  const nav = header.querySelector('nav');
  if (!nav) return;

  const buttons = nav.querySelectorAll('button');
  if (isAdminArea) {
    nav.classList.add('admin-navigation');
    nav.classList.remove('general-navigation-hidden');
    nav.removeAttribute('aria-hidden');
    for (const button of buttons) button.tabIndex = 0;
    setText(buttons[0], 'Geral');
    setText(buttons[1], 'Administração');

    if (!nav.querySelector('.admin-logout')) {
      const logout = document.createElement('a');
      logout.className = 'admin-logout';
      logout.href = '/admin-logout';
      logout.textContent = 'Sair';
      logout.setAttribute('aria-label', 'Encerrar sessão administrativa');
      nav.appendChild(logout);
    }

    if (!adminAutoOpened && buttons[1] && !buttons[1].classList.contains('active')) {
      adminAutoOpened = true;
      queueMicrotask(() => buttons[1]?.click());
    }
  } else {
    nav.classList.add('general-navigation-hidden');
    nav.setAttribute('aria-hidden', 'true');
    for (const button of buttons) button.tabIndex = -1;
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

  const action = Array.from(panel.children).find(element => element.tagName === 'BUTTON');
  if (action && !action.disabled && /identificar produto/i.test(action.textContent || '')) {
    setText(action, 'Identificar produto');
  }
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getCatalogPlatform(card) {
  const meta = String(card.querySelector('.product-copy small')?.textContent || '');
  const pieces = meta.split('·').map(value => value.trim()).filter(Boolean);
  return pieces.length > 1 ? pieces[pieces.length - 1] : 'SEM PLATAFORMA';
}

function catalogCards(list) {
  return Array.from(list?.querySelectorAll(':scope > .catalog-product') || []);
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
  const platform = platformFilter?.value || '';
  let visible = 0;

  for (const card of cards) {
    const sku = normalizeSearch(card.querySelector('.product-copy strong')?.textContent);
    const name = normalizeSearch(card.querySelector('.product-copy span')?.textContent);
    const meta = normalizeSearch(card.querySelector('.product-copy small')?.textContent);
    const cardPlatform = getCatalogPlatform(card);
    const matchesText = !query || sku.includes(query) || name.includes(query) || meta.includes(query);
    const matchesPlatform = !platform || cardPlatform === platform;
    const show = matchesText && matchesPlatform;
    card.hidden = !show;
    if (show) visible += 1;
  }

  if (count) count.textContent = `${visible} de ${cards.length}`;
  if (empty) empty.hidden = visible !== 0;
}

function syncPlatformOptions(details) {
  const list = details?.querySelector('.catalog-edit-list');
  const select = details?.querySelector('.catalog-platform-filter');
  if (!list || !select) return;

  const selected = select.value;
  const platforms = [...new Set(catalogCards(list).map(getCatalogPlatform).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const signature = platforms.join('|');
  if (select.dataset.signature === signature) return;

  select.dataset.signature = signature;
  select.replaceChildren();

  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Todas as plataformas';
  select.appendChild(all);

  for (const platform of platforms) {
    const option = document.createElement('option');
    option.value = platform;
    option.textContent = platform;
    select.appendChild(option);
  }

  if (platforms.includes(selected)) select.value = selected;
}

function enhanceCatalog() {
  if (!isAdminArea) return;

  const details = document.querySelector('.catalog-details');
  const list = details?.querySelector('.catalog-edit-list');
  const summary = details?.querySelector(':scope > summary');
  if (!details || !list || !summary) return;

  const countMatch = String(summary.textContent || '').match(/\((\d+)\s*SKUs?\)/i);
  if (countMatch) setText(summary, `Catálogo de produtos (${countMatch[1]} SKUs)`);

  let tools = details.querySelector(':scope > .catalog-tools');
  if (!tools) {
    tools = document.createElement('div');
    tools.className = 'catalog-tools';
    tools.innerHTML = `
      <label class="catalog-search-field">
        <span>Buscar produto</span>
        <div class="catalog-search-wrap">
          <input type="search" class="catalog-search" placeholder="Nome ou SKU" autocomplete="off" />
          <button type="button" class="catalog-search-clear">Limpar</button>
        </div>
      </label>
      <label class="catalog-platform-field">
        <span>Plataforma</span>
        <select class="catalog-platform-filter">
          <option value="">Todas as plataformas</option>
        </select>
      </label>
      <div class="catalog-filter-count" aria-live="polite">0 de 0</div>
    `;
    summary.insertAdjacentElement('afterend', tools);

    const empty = document.createElement('div');
    empty.className = 'catalog-empty-state';
    empty.hidden = true;
    empty.innerHTML = '<strong>Nenhum produto encontrado.</strong><span>Tente outro nome, SKU ou plataforma.</span>';
    list.insertAdjacentElement('beforebegin', empty);
  }

  syncPlatformOptions(details);

  if (!tools.dataset.bound) {
    tools.dataset.bound = '1';
    const search = tools.querySelector('.catalog-search');
    const platformFilter = tools.querySelector('.catalog-platform-filter');
    const clear = tools.querySelector('.catalog-search-clear');

    search?.addEventListener('input', () => applyCatalogFilter(details));
    platformFilter?.addEventListener('change', () => applyCatalogFilter(details));
    clear?.addEventListener('click', () => {
      if (search) {
        search.value = '';
        search.focus();
      }
      applyCatalogFilter(details);
    });
  }

  applyCatalogFilter(details);
}

function applyInterface() {
  enhanceHeader();
  enhanceGeneralPanel();
  enhanceCatalog();
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
