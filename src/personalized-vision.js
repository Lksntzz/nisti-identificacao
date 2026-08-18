const MASK_X = 0.20;
const MASK_Y = 0.24;
const MASK_W = 0.60;
const MASK_H = 0.40;
const PATCH_SIDE = 14;

async function bitmapFromBlob(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}

function canvasBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao preparar imagem mascarada.')), type, quality);
  });
}

async function softenPersonalization(blob) {
  const bitmap = await bitmapFromBlob(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(bitmap, 0, 0);

    const x = Math.round(canvas.width * MASK_X);
    const y = Math.round(canvas.height * MASK_Y);
    const w = Math.max(1, Math.round(canvas.width * MASK_W));
    const h = Math.max(1, Math.round(canvas.height * MASK_H));

    // A inicial e o nome são variáveis entre clientes. Reduzimos essa área a
    // informação de baixa frequência, preservando bordas, wire-o, elástico,
    // título e demais elementos permanentes da capa.
    const patch = document.createElement('canvas');
    patch.width = PATCH_SIDE;
    patch.height = PATCH_SIDE;
    const patchCtx = patch.getContext('2d', { alpha: false });
    patchCtx.imageSmoothingEnabled = true;
    patchCtx.imageSmoothingQuality = 'high';
    patchCtx.drawImage(canvas, x, y, w, h, 0, 0, PATCH_SIDE, PATCH_SIDE);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(patch, 0, 0, PATCH_SIDE, PATCH_SIDE, x, y, w, h);

    patch.width = 1;
    patch.height = 1;
    const result = await canvasBlob(canvas, 'image/jpeg', 0.92);
    canvas.width = 1;
    canvas.height = 1;
    return result;
  } finally {
    bitmap.close?.();
  }
}

async function fetchCandidateBlob(candidate) {
  const response = await fetch(candidate.image_url, { cache: 'force-cache', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Referência visual indisponível (${response.status}).`);
  return response.blob();
}

export async function buildPersonalizationMaskedInput(photoFile, candidates) {
  const urls = [];
  const photo = await softenPersonalization(photoFile);
  const maskedCandidates = [];

  try {
    for (const candidate of candidates || []) {
      const source = await fetchCandidateBlob(candidate);
      const masked = await softenPersonalization(source);
      const url = URL.createObjectURL(masked);
      urls.push(url);
      maskedCandidates.push({ ...candidate, image_url: url });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {
      photo,
      candidates: maskedCandidates,
      cleanup() {
        for (const url of urls) URL.revokeObjectURL(url);
      }
    };
  } catch (error) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw error;
  }
}
