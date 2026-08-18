const WIREO_OPTIONS = [
  ['P', 'Preto'],
  ['B', 'Branco'],
  ['R', 'Rose Gold']
];

const ACCESSORY_OPTIONS = [
  ['P', 'Preto'],
  ['B', 'Branco'],
  ['A', 'Azul'],
  ['R', 'Rosa'],
  ['V', 'Verde'],
  ['L', 'Laranja']
];

const TASSEL_OPTIONS = [['X', 'Sem tassel'], ...ACCESSORY_OPTIONS];

let productsPromise = null;
let productsBySku = new Map();

function isAdmin() {
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function ensureStyles() {
  if (document.getElementById('nisti-finishing-editor-styles')) return;
  const style = document.createElement('style');
  style.id = 'nisti-finishing-editor-styles';
  style.textContent = `
    .nisti-finishing-editor{grid-column:1/-1;border:1px solid #e4e9ef;background:#f8fafc;border-radius:16px;padding:16px;display:grid;gap:12px}
    .nisti-finishing-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .nisti-finishing-head strong{display:block;color:#172033;font-size:14px}
    .nisti-finishing-head small{display:block;color:#6f7887;margin-top:3px;line-height:1.35}
    .nisti-finishing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .nisti-finishing-grid label{display:grid;gap:6px;color:#566173;font-size:12px;font-weight:800}
    .nisti-finishing-grid select{width:100%;border:1px solid #d9e0e7;border-radius:11px;background:#fff;color:#172033;padding:10px 11px;font:700 13px/1.2 Inter,system-ui,sans-serif;outline:none}
    .nisti-finishing-grid select:focus{border-color:#7FD0D1;box-shadow:0 0 0 3px rgba(127,208,209,.18)}
    .nisti-finishing-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .nisti-finishing-save{border:0;border-radius:11px;background:#7FD0D1;color:#172033;padding:10px 14px;font-weight:900;cursor:pointer}
    .nisti-finishing-save:disabled{opacity:.55;cursor:wait}
    .nisti-finishing-status{font-size:12px;color:#667085;font-weight:700}
    .nisti-finishing-status.ok{color:#24735a}.nisti-finishing-status.error{color:#b42318}
    @media(max-width:680px){.nisti-finishing-grid{grid-template-columns:1fr}.nisti-finishing-head{display:block}}
  `;
  document.head.appendChild(style);
}

function optionMarkup(options, selected) {
  return options.map(([value, label]) =>
    `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
  ).join('');
}

async function loadProducts(force = false) {
  if (!productsPromise || force) {
    productsPromise = fetch('/api/products', { credentials: 'same-origin' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Falha ao carregar produtos');
        productsBySku = new Map((data.products || []).map(product => [String(product.sku || '').trim().toUpperCase(), product]));
        return data.products || [];
      })
      .catch(error => {
        productsPromise = null;
        throw error;
      });
  }
  return productsPromise;
}

function getSkuFromArticle(article) {
  return String(article.querySelector('.product-copy strong')?.textContent || '').trim().toUpperCase();
}

async function mountEditor(editor) {
  if (!isAdmin() || editor.dataset.nistiFinishingMounted === '1') return;
  editor.dataset.nistiFinishingMounted = '1';

  const article = editor.closest('.catalog-product');
  if (!article) return;
  const sku = getSkuFromArticle(article);
  if (!sku) return;

  try {
    await loadProducts();
    const product = productsBySku.get(sku);
    if (!product) return;

    ensureStyles();
    const currentWireo = String(product.wireo_code || '').toUpperCase() || 'P';
    const currentTassel = String(product.tassel_code || '').toUpperCase() || 'X';
    const currentElastico = String(product.elastico_code || '').toUpperCase() || 'P';

    const block = document.createElement('div');
    block.className = 'nisti-finishing-editor';
    block.innerHTML = `
      <div class="nisti-finishing-head">
        <div><strong>Acabamento do produto</strong><small>Altere Wire-O, tassel e elástico. O SKU será sincronizado automaticamente.</small></div>
      </div>
      <div class="nisti-finishing-grid">
        <label>Wire-O<select data-field="wireo_code">${optionMarkup(WIREO_OPTIONS, currentWireo)}</select></label>
        <label>Tassel<select data-field="tassel_code">${optionMarkup(TASSEL_OPTIONS, currentTassel)}</select></label>
        <label>Elástico<select data-field="elastico_code">${optionMarkup(ACCESSORY_OPTIONS, currentElastico)}</select></label>
      </div>
      <div class="nisti-finishing-actions">
        <button type="button" class="nisti-finishing-save">Salvar acabamento</button>
        <span class="nisti-finishing-status"></span>
      </div>`;

    const actions = editor.querySelector('.mockup-actions');
    if (actions) editor.insertBefore(block, actions);
    else editor.appendChild(block);

    const button = block.querySelector('.nisti-finishing-save');
    const status = block.querySelector('.nisti-finishing-status');

    button.addEventListener('click', async () => {
      button.disabled = true;
      status.className = 'nisti-finishing-status';
      status.textContent = 'Salvando...';
      const body = {
        wireo_code: block.querySelector('[data-field="wireo_code"]').value,
        tassel_code: block.querySelector('[data-field="tassel_code"]').value,
        elastico_code: block.querySelector('[data-field="elastico_code"]').value
      };

      try {
        const response = await fetch(`/api/products/${product.id}/finishing`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar o acabamento');

        status.className = 'nisti-finishing-status ok';
        status.textContent = `Salvo · ${data.product.sku}`;
        await loadProducts(true).catch(() => null);
        setTimeout(() => window.location.reload(), 650);
      } catch (error) {
        status.className = 'nisti-finishing-status error';
        status.textContent = error?.message || 'Erro ao salvar';
        button.disabled = false;
      }
    });
  } catch {
    editor.dataset.nistiFinishingMounted = '';
  }
}

function scan() {
  if (!isAdmin()) return;
  document.querySelectorAll('.mockup-editor').forEach(editor => mountEditor(editor));
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nisti-access'] });
const root = document.getElementById('root');
if (root) observer.observe(root, { childList: true, subtree: true });

scan();
setTimeout(scan, 500);
setTimeout(scan, 1500);
