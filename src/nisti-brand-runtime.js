const BRAND_MARKUP = `
  <img src="/nisti-mark.svg" alt="" aria-hidden="true" />
  <span class="nisti-logo-copy"><b>NISTI PRINT</b><small>papelaria criativa</small></span>
`;

function isAdmin() {
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function decorateHeader() {
  const header = document.querySelector('main.shell > header');
  if (!header) return;

  if (isAdmin()) {
    const brand = header.querySelector('.nisti-brand-mark');
    if (brand && brand.dataset.nistiBrandReady !== '1') {
      brand.dataset.nistiBrandReady = '1';
      brand.innerHTML = BRAND_MARKUP;
      brand.setAttribute('aria-label', 'NISTI PRINT');
    }
    return;
  }

  let brand = header.querySelector('.nisti-public-brand');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'nisti-public-brand';
    brand.innerHTML = BRAND_MARKUP;
    brand.setAttribute('aria-label', 'NISTI PRINT');
    header.prepend(brand);
  }
}

function ensureBrandFooter() {
  const panel = document.querySelector('.admin-dashboard-panel');
  const catalog = panel?.querySelector('.catalog-details');
  if (!panel || !catalog) return;

  let footer = panel.querySelector(':scope > .nisti-brand-footer');
  if (!footer) {
    footer = document.createElement('section');
    footer.className = 'nisti-brand-footer';
    footer.innerHTML = `
      <div><span class="nisti-footer-icon">◉</span><p><strong>Identificação que conecta, valor que vende.</strong><span>Mockups consistentes deixam o catálogo mais rápido de consultar e corrigir.</span></p></div>
      <div><span class="nisti-footer-icon">◎</span><p><strong>Padronização</strong><span>Identidade visual consistente em todo o catálogo.</span></p></div>
      <div><span class="nisti-footer-icon">▥</span><p><strong>Performance</strong><span>Busca e edição de mockups em poucos cliques.</span></p></div>
      <div><span class="nisti-footer-icon">☆</span><p><strong>Produtividade</strong><span>Fluxo mais curto para cadastro e manutenção.</span></p></div>
      <div><span class="nisti-footer-icon">✦</span><p><strong>Dica NISTI</strong><span>Use a Administração para acompanhar D1, R2 e Gemini.</span></p></div>
    `;
    catalog.insertAdjacentElement('afterend', footer);
  }

  footer.hidden = document.documentElement.dataset.adminView !== 'geral';
}

function decorateIdentificationPanel() {
  const panel = document.querySelector('.general-panel');
  if (!panel) return;
  const eyebrow = panel.querySelector(':scope > .eyebrow');
  if (eyebrow) eyebrow.textContent = 'NISTI PRINT · IDENTIFICAÇÃO VISUAL';
}

function applyBrand() {
  document.title = 'NISTI PRINT · Identificação Visual';
  decorateHeader();
  decorateIdentificationPanel();
  if (isAdmin()) ensureBrandFooter();
}

let scheduled = false;
function scheduleBrand() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyBrand();
  });
}

const observer = new MutationObserver(scheduleBrand);
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['data-nisti-access', 'data-admin-view']
});

applyBrand();
