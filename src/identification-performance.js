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

    // Fotos pequenas já chegam em um tamanho adequado.
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

window.fetch = async function nistiOptimizedFetch(input, init = {}) {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input?.url || '';

  let nextInit = init;

  if (url.includes('/api/identify') && init?.body instanceof FormData) {
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

  return nativeFetch(input, nextInit);
};
