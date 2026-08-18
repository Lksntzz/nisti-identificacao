const nativeFetch = window.fetch.bind(window);

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {}
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = error => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    img.src = url;
  });
}

async function optimizeIdentificationPhoto(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) return file;

  try {
    const bitmap = await loadBitmap(file);
    const sourceWidth = bitmap.width || bitmap.naturalWidth || 0;
    const sourceHeight = bitmap.height || bitmap.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) return file;

    const MAX_SIDE = 1280;
    const scale = Math.min(1, MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    if (scale === 1 && file.size <= 900 * 1024) {
      if (typeof bitmap.close === 'function') bitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return file;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    if (!blob || blob.size >= file.size) return file;

    const baseName = String(file.name || 'capa').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  } catch {
    return file;
  }
}

function ensureSelectionStyles() {
  if (document.getElementById('nisti-sku-selection-styles')) return;
  const style = document.createElement('style');
  style.id = 'nisti-sku-selection-styles';
  style.textContent = `
    .nisti-sku-overlay{position:fixed;inset:0;z-index:13000;background:rgba(23,32,51,.48);display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box;backdrop-filter:blur(3px)}
    .nisti-sku-sheet{width:min(620px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:26px 26px 18px 18px;padding:22px;box-shadow:0 24px 80px rgba(23,32,51,.28);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033}
    .nisti-sku-kicker{margin:0 0 5px;color:#50777d;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .nisti-sku-sheet h3{margin:0 0 8px;font-size:24px;line-height:1.15}
    .nisti-sku-explain{margin:0 0 17px;color:#667085;font-size:14px;line-height:1.45}
    .nisti-sku-list{display:grid;gap:12px}
    .nisti-sku-choice{appearance:none;width:100%;border:1px solid #dbe5ea;background:#fff;border-radius:18px;padding:12px;text-align:left;display:grid;grid-template-columns:92px minmax(0,1fr);gap:13px;align-items:center;cursor:pointer;color:inherit;box-shadow:0 5px 18px rgba(46,62,80,.06)}
    .nisti-sku-choice:active{transform:scale(.995)}
    .nisti-sku-thumb{width:92px;height:112px;border-radius:13px;background:#f5f7fa;overflow:hidden;display:grid;place-items:center;border:1px solid #edf1f4}
    .nisti-sku-thumb img{width:100%;height:100%;object-fit:contain;display:block}
    .nisti-sku-thumb span{font-size:11px;color:#98a2b3;font-weight:800}
    .nisti-sku-info{min-width:0;display:flex;flex-direction:column;gap:5px}
    .nisti-sku-code{font-size:16px;font-weight:900;overflow-wrap:anywhere}
    .nisti-sku-name{font-size:13px;font-weight:700;line-height:1.35;color:#344054}
    .nisti-sku-meta{font-size:12px;color:#667085;line-height:1.35}
    .nisti-sku-select{margin-top:4px;display:inline-flex;align-items:center;justify-content:center;min-height:36px;border-radius:10px;background:linear-gradient(135deg,#7FD0D1,#C7EAFE);font-size:12px;font-weight:900;color:#253042;padding:0 12px;width:max-content;max-width:100%}
    .nisti-sku-cancel{margin-top:14px;width:100%;min-height:44px;border:1px solid #e3e8ef;border-radius:12px;background:#fff;color:#667085;font-weight:800;cursor:pointer}
    @media(min-width:700px){.nisti-sku-overlay{align-items:center}.nisti-sku-sheet{border-radius:24px}}
  `;
  document.head.appendChild(style);
}

function productDisplayName(product) {
  return product?.nome || product?.variacao || `Produto ${product?.capa_code || ''}`;
}

function chooseAmbiguousProduct(data) {
  const products = Array.isArray(data?.products) ? data.products.filter(Boolean) : [];
  if (products.length <= 1) return Promise.resolve(products[0] || null);

  ensureSelectionStyles();
  document.getElementById('nisti-sku-overlay')?.remove();

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'nisti-sku-overlay';
    overlay.className = 'nisti-sku-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'nisti-sku-sheet';

    const kicker = document.createElement('p');
    kicker.className = 'nisti-sku-kicker';
    kicker.textContent = 'Capa identificada';

    const title = document.createElement('h3');
    title.textContent = `${data.capa_code || 'Capa'} tem ${products.length} SKUs`;

    const explain = document.createElement('p');
    explain.className = 'nisti-sku-explain';
    explain.textContent = 'A arte da capa é a mesma. Confira o produto e toque no SKU correto para continuar.';

    const list = document.createElement('div');
    list.className = 'nisti-sku-list';

    const finish = selected => {
      overlay.remove();
      resolve(selected || null);
    };

    for (const product of products) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'nisti-sku-choice';
      choice.setAttribute('aria-label', `Selecionar SKU ${product.sku || ''}`);

      const thumb = document.createElement('div');
      thumb.className = 'nisti-sku-thumb';
      if (product.image_url) {
        const img = document.createElement('img');
        img.src = product.image_url;
        img.alt = `Mockup do SKU ${product.sku || ''}`;
        thumb.appendChild(img);
      } else {
        const noImage = document.createElement('span');
        noImage.textContent = 'SEM FOTO';
        thumb.appendChild(noImage);
      }

      const info = document.createElement('div');
      info.className = 'nisti-sku-info';

      const code = document.createElement('div');
      code.className = 'nisti-sku-code';
      code.textContent = product.sku || 'SKU';

      const name = document.createElement('div');
      name.className = 'nisti-sku-name';
      name.textContent = productDisplayName(product);

      const meta = document.createElement('div');
      meta.className = 'nisti-sku-meta';
      const details = [];
      if (product.miolo_code) details.push(`Miolo: ${product.miolo_code}`);
      if (product.acabamento_code) details.push(`Acabamento: ${product.acabamento_code}`);
      if (product.platform) details.push(product.platform);
      meta.textContent = details.join(' · ');

      const select = document.createElement('span');
      select.className = 'nisti-sku-select';
      select.textContent = 'Selecionar este SKU';

      info.append(code, name, meta, select);
      choice.append(thumb, info);
      choice.addEventListener('click', () => finish(product));
      list.appendChild(choice);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'nisti-sku-cancel';
    cancel.textContent = 'Cancelar e tirar outra foto';
    cancel.addEventListener('click', () => finish(null));

    sheet.append(kicker, title, explain, list, cancel);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  });
}

function rewrittenJsonResponse(response, data, status = response.status) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === response.status ? response.statusText : '',
    headers
  });
}

window.fetch = async function nistiOptimizedFetch(input, init = {}) {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input?.url || '';

  const isIdentification = url.includes('/api/identify');
  let nextInit = init;

  if (isIdentification && init?.body instanceof FormData) {
    const original = init.body.get('image');
    if (original instanceof File) {
      const optimized = await optimizeIdentificationPhoto(original);
      if (optimized !== original) {
        const body = new FormData();
        for (const [key, value] of init.body.entries()) {
          if (key === 'image') continue;
          body.append(key, value);
        }
        body.append('image', optimized, optimized.name);
        nextInit = { ...init, body };
      }
    }
  }

  const response = await nativeFetch(input, nextInit);
  if (!isIdentification || !response.ok) return response;

  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;

  const data = await response.clone().json().catch(() => null);
  if (!data?.needs_selection || !Array.isArray(data.products)) return response;

  const selected = await chooseAmbiguousProduct(data);
  if (!selected) {
    return rewrittenJsonResponse(response, {
      error: 'Seleção cancelada. Tire outra foto para identificar o produto.',
      performance: data.performance || null
    }, 422);
  }

  return rewrittenJsonResponse(response, {
    ...data,
    needs_selection: false,
    selected_manually: true,
    product: selected
  }, 200);
};
