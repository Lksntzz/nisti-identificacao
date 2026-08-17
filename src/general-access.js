import './general-panel.css';

const isAdminArea = /^\/admin(?:\/|$)/i.test(window.location.pathname);
document.documentElement.dataset.nistiAccess = isAdminArea ? 'admin' : 'general';

function enhanceHeader() {
  const header = document.querySelector('main.shell > header');
  if (!header) return;

  header.classList.add('nisti-app-header');
  const title = header.querySelector('h1');
  if (title) title.textContent = 'Identificação Visual';

  const nav = header.querySelector('nav');
  if (!nav) return;

  const buttons = nav.querySelectorAll('button');
  if (isAdminArea) {
    nav.classList.add('admin-navigation');
    nav.classList.remove('general-navigation-hidden');
    if (buttons[0]) buttons[0].textContent = 'Geral';
    if (buttons[1]) buttons[1].textContent = 'Administração';

    if (!nav.querySelector('.admin-logout')) {
      const logout = document.createElement('a');
      logout.className = 'admin-logout';
      logout.href = '/admin-logout';
      logout.textContent = 'Sair';
      logout.setAttribute('aria-label', 'Encerrar sessão administrativa');
      nav.appendChild(logout);
    }
  } else {
    nav.classList.add('general-navigation-hidden');
    nav.setAttribute('aria-hidden', 'true');
    for (const button of buttons) button.tabIndex = -1;
  }
}

function enhanceGeneralPanel() {
  const panel = document.querySelector('.panel.expedition');
  if (!panel) return;

  panel.classList.add('general-panel');

  const eyebrow = panel.querySelector(':scope > .eyebrow');
  if (eyebrow) eyebrow.textContent = 'PAINEL GERAL';

  const heading = panel.querySelector(':scope > h2');
  if (heading) heading.textContent = 'Identificação de produto';

  const intro = heading?.nextElementSibling;
  if (intro?.tagName === 'P') {
    intro.textContent = 'Fotografe a capa do produto de frente. O sistema localiza a referência visual e retorna o SKU correspondente.';
  }

  const camera = panel.querySelector('.camera');
  if (camera) {
    camera.setAttribute('aria-label', 'Fotografar ou enviar imagem da capa');
    const strong = camera.querySelector('strong');
    const small = camera.querySelector('small');
    if (strong) strong.textContent = 'Fotografar ou enviar capa';
    if (small) small.textContent = 'Use uma imagem frontal, nítida e com boa iluminação.';
  }

  const action = Array.from(panel.children).find(
    element => element.tagName === 'BUTTON'
  );
  if (action && !action.disabled && /identificar produto/i.test(action.textContent || '')) {
    action.textContent = 'Identificar produto';
  }
}

function applyInterface() {
  enhanceHeader();
  enhanceGeneralPanel();
}

const root = document.getElementById('root');
if (root) {
  const observer = new MutationObserver(applyInterface);
  observer.observe(root, { childList: true, subtree: true });
}

applyInterface();
