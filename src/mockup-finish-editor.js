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
let productPromise = null;

function isAdmin() {
  return document.documentElement.dataset.nistiAccess === 'admin';
}

function ensureStyles() {
  if (document.getElementById('nisti-finish-editor-styles')) return;
  const style = document.createElement('style');
  style.id = 'nisti-finish-editor-styles';
  style.textContent = `
    .nisti-finish-editor{grid-column:1/-1;margin-top:8px;padding:16px;border:1px solid #e7e9ef;border-radius:16px;background:#f8fafc}
    .nisti-finish-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
    .nisti-finish-editor-head strong{display:block;font-size:14px;color:#172033}
    .nisti-finish-editor-head small{display:block;margin-top:3px;color:#747c8d;line-height:1.35}
    .nisti-finish-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .nisti-finish-fields label{display:grid;gap:6px;font-size:12px;font-weight:800;color:#4b5563}
    .nisti-finish-fields select{width:100%;min-height:42px;border:1px solid #d8dde7;border-radius:11px;background:#fff;padding:0 11px;color:#172033;font:inherit}
    .nisti-finish-save{margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .nisti-finish-save button{border:0;border-radius:11px;padding:11px 15px;background:#7FD0D1;color:#172033;font-weight:900;cursor:pointer}
    .nisti-finish-save button:disabled{opacity:.55;cursor:wait}
    .nisti-finish-status{font-size:12px;font-weight:700;color:#657082}
    .nisti-finish-status.ok{color:#087f5b}.nisti-finish-status.error{color:#b42318}
    @media(max-width:680px){.nisti-finish-fields{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

async function loadProducts() {
  if (!productPromise) {
    productPromise = fetch('/api/products', { credentials: 'same-origin' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os produtos.');
        return data.products || [];
      })
      .catch(error => {
        productPromise = null;
        throw error;
      });
  }
  return productPromise;
}

function optionsHtml(options, selected) {
  return options.map(([value, label]) =>
    `<option value="${value}"${String(selected) === value ? ' selected' : ''}>${label}</option>`
  ).join('');
}

function findSku(article) {
  const candidates = Array.from(article.querySelectorAll('strong'));
  return candidates.map(node => String(node.textContent || '').trim().toUpperCase())
    .find(text => /^[^_\s]+_[^_\s]+_[A-Z]{3}$/.test(text)) || '';
}

async function enhanceEditor(editor) {
  if (!isAdmin() || editor.dataset.nistiFinishEnhanced === '1') return;
  editor.dataset.nistiFinishEnhanced = '1';

  const article = editor.closest('.catalog-product, article');
  if (!article) return;
  const sku = findSku(article);
  if (!sku) return;

  try {
    const products = await loadProducts();
    const product = products.find(item => String(item.sku || '').trim().toUpperCase() === sku);
    if (!product) return;

    ensureStyles();
    const block = document.createElement('div');
    block.className = 'nisti-finish-editor';
    block.innerHTML = `
      <div class="nisti-finish-editor-head">
        <div><strong>Acabamento do produto</strong><small>Altere Wire-O, tassel ou elástico. Ao salvar, o SKU também será atualizado automaticamente.</small></div>
      </div>
      <div class="nisti-finish-fields">
        <label>Wire-O<select data-finish="wireo">${optionsHtml(WIREO_OPTIONS, product.wireo_code)}</select></label>
        <label>Tassel<select data-finish="tassel">${optionsHtml(TASSEL_OPTIONS, product.tassel_code)}</select></label>
        <label>Elástico<select data-finish="elastico">${optionsHtml(ACCESSORY_OPTIONS, product.elastico_code)}</select></label>
      </div>
      <div class="nisti-finish-save">
        <button type="button">Salvar acabamento</button>
        <span class="nisti-finish-status"></span>
      </div>`;

    const actions = editor.querySelector('.mockup-actions');
    if (actions) editor.insertBefore(block, actions);
    else editor.appendChild(block);

    const button = block.querySelector('button');
    const status = block.querySelector('.nisti-finish-status');
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.className = 'nisti-finish-status';
      status.textContent = 'Salvando...';
      try {
        const response = await fetch(`/api/products/${product.id}/finish`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            wireo_code: block.querySelector('[data-finish="wireo"]').value,
            tassel_code: block.querySelector('[data-finish="tassel"]').value,
            elastico_code: block.querySelector('[data-finish="elastico"]').value
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o acabamento.');
        status.className = 'nisti-finish-status ok';
        status.textContent = `Salvo. Novo SKU: ${data.product.sku}`;
        product.sku = data.product.sku;
        product.wireo_code = data.product.wireo_code;
        product.tassel_code = data.product.tassel_code;
        product.elastico_code = data.product.elastico_code;
        setTimeout(() => location.reload(), 900);
      } catch (error) {
        status.className = 'nisti-finish-status error';
        status.textContent = error?.message || 'Erro ao salvar.';
        button.disabled = false;
      }
    });
  } catch {
    editor.dataset.nistiFinishEnhanced = '';
  }
}

function scan() {
  if (!isAdmin()) return;
  document.querySelectorAll('.mockup-editor').forEach(enhanceEditor);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-nisti-access'] });
scan();
setTimeout(scan, 500);
setTimeout(scan, 1500);
