const previousFetch = window.fetch.bind(window);

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {}
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = error => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}

async function compactPhoto(file) {
  if (!(file instanceof File) || !String(file.type || '').startsWith('image/')) return file;

  try {
    const image = await decodeImage(file);
    const sourceWidth = image.width || image.naturalWidth || 0;
    const sourceHeight = image.height || image.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) return file;

    const maxSide = 1024;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    if (scale === 1 && file.size <= 650 * 1024) {
      image.close?.();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return file;

    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    image.close?.();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.80));
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

window.fetch = async function nistiCompactIdentificationUpload(input, init = {}) {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input?.url || '';

  if (!url.includes('/api/identify') || !(init?.body instanceof FormData)) {
    return previousFetch(input, init);
  }

  const original = init.body.get('image');
  if (!(original instanceof File)) return previousFetch(input, init);

  const compact = await compactPhoto(original);
  if (compact === original) return previousFetch(input, init);

  const body = new FormData();
  for (const [key, value] of init.body.entries()) {
    if (key === 'image') continue;
    body.append(key, value);
  }
  body.append('image', compact, compact.name);
  return previousFetch(input, { ...init, body });
};
