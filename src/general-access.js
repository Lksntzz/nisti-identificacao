import './general-panel.css';

const isAdminArea = /^\/admin(?:\/|$)/i.test(window.location.pathname);
document.documentElement.dataset.nistiAccess = isAdminArea ? 'admin' : 'general';

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function enhanceHeader() {
  const header = document.querySelector('main.shell > header');
  if (!header) return;

  if (!header.classList.contains('nisti-app-header')) header.classList.add('nisti-app-header');
  setText(header.querySelector('h1'), 'Identificação Visual');

  const nav = header.querySelector('nav');
  if (!nav) return;

  const buttons = nav.querySelectorAll('button');
  if (isAdminArea) {
    if (!nav.classList.contains('admin-navigation')) nav.classList.add('admin-navigation');
    if (nav.classList.contains('general-navigation-hidden')) nav.classList.remove('general-navigation-hidden');
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
  } else {
    if (!nav.classList.contains('general-navigation-hidden')) nav.classList.add('general-navigation-hidden');
    if (nav.getAttribute('aria-hidden') !== 'true') nav.setAttribute('aria-hidden', 'true');
    for (const button of buttons) {
      if (button.tabIndex !== -1) button.tabIndex = -1;
    }
  }
}

function enhanceGeneralPanel() {
  const panel = document.querySelector('.panel.expedition');
  if (!panel) return;

  if (!panel.classList.contains('general-panel')) panel.classList.add('general-panel');

  setText(panel.querySelector(':scope > .eyebrow'), 'PAINEL GERAL');
  const heading = panel.querySelector(':scope > h2');
  setText(heading, 'Identificação de produto');

  const intro = heading?.nextElementSibling;
  if (intro?.tagName === 'P') {
    setText(intro, 'Fotografe a capa do produto de frente. O sistema localiza a referência visual e retorna o SKU correspondente.');
  }

  const camera = panel.querySelector('.camera');
  if (camera) {
    if (camera.getAttribute('aria-label') !== 'Fotografar ou enviar imagem da capa') {
      camera.setAttribute('aria-label', 'Fotografar ou enviar imagem da capa');
    }
    setText(camera.querySelector('strong'), 'Fotografar ou enviar capa');
    setText(camera.querySelector('small'), 'Use uma imagem frontal, nítida e com boa iluminação.');
  }

  const action = Array.from(panel.children).find(element => element.tagName === 'BUTTON');
  if (action && !action.disabled && /identificar produto/i.test(action.textContent || '')) {
    setText(action, 'Identificar produto');
  }
}

function applyInterface() {
  enhanceHeader();
  enhanceGeneralPanel();
}

const root = document.getElementById('root');
if (root) {
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
}

applyInterface();
