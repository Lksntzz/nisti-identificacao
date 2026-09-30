import { useEffect, useState } from 'react';

const transparentImageCache = new Map();
const transparentImageInflight = new Map();
const MAX_CACHE_ENTRIES = 80;
const MAX_RENDER_DIMENSION = 1800;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pixelMetrics(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return {
    chroma: max - min,
    brightness: (r + g + b) / 3
  };
}

function isBorderBackgroundCandidate(r, g, b, a) {
  if (a < 8) return true;
  const { chroma, brightness } = pixelMetrics(r, g, b);
  // Background removal must be deliberately conservative. The old threshold
  // accepted light cover artwork as "white background" and could erase the
  // cover together with the studio background.
  return brightness >= 242 && chroma <= 18;
}

function connectedBackgroundAlpha(r, g, b) {
  const distance = Math.hypot(255 - r, 255 - g, 255 - b);
  if (distance <= 8) return 0;
  if (distance >= 38) return 255;
  return Math.round(((distance - 8) / 30) * 255);
}

function hasExistingTransparency(data, total) {
  const sampleStep = Math.max(1, Math.floor(total / 50000));
  let sampled = 0;
  let transparent = 0;
  for (let index = 0; index < total; index += sampleStep) {
    sampled += 1;
    if (data[index * 4 + 3] < 245) transparent += 1;
  }
  return sampled > 0 && transparent / sampled >= 0.003;
}

function buildSubjectProtection(data, width, height) {
  const rowMin = new Int32Array(height);
  const rowMax = new Int32Array(height);
  const colMin = new Int32Array(width);
  const colMax = new Int32Array(width);
  rowMin.fill(width);
  rowMax.fill(-1);
  colMin.fill(height);
  colMax.fill(-1);

  let strongPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const a = data[offset + 3];
      if (a < 32) continue;
      const { chroma, brightness } = pixelMetrics(data[offset], data[offset + 1], data[offset + 2]);
      const strongForeground = brightness < 235 || chroma > 22;
      if (!strongForeground) continue;
      strongPixels += 1;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      if (y < colMin[x]) colMin[x] = y;
      if (y > colMax[x]) colMax[x] = y;
    }
  }

  if (strongPixels < Math.max(12, Math.round(width * height * 0.0015))) {
    return () => false;
  }

  const padX = Math.max(2, Math.round(width * 0.018));
  const padY = Math.max(2, Math.round(height * 0.018));
  const expandedRowMin = new Int32Array(height);
  const expandedRowMax = new Int32Array(height);
  const expandedColMin = new Int32Array(width);
  const expandedColMax = new Int32Array(width);
  expandedRowMin.fill(width);
  expandedRowMax.fill(-1);
  expandedColMin.fill(height);
  expandedColMax.fill(-1);

  for (let y = 0; y < height; y += 1) {
    const from = clamp(y - padY, 0, height - 1);
    const to = clamp(y + padY, 0, height - 1);
    for (let yy = from; yy <= to; yy += 1) {
      if (rowMax[yy] < 0) continue;
      expandedRowMin[y] = Math.min(expandedRowMin[y], rowMin[yy]);
      expandedRowMax[y] = Math.max(expandedRowMax[y], rowMax[yy]);
    }
  }

  for (let x = 0; x < width; x += 1) {
    const from = clamp(x - padX, 0, width - 1);
    const to = clamp(x + padX, 0, width - 1);
    for (let xx = from; xx <= to; xx += 1) {
      if (colMax[xx] < 0) continue;
      expandedColMin[x] = Math.min(expandedColMin[x], colMin[xx]);
      expandedColMax[x] = Math.max(expandedColMax[x], colMax[xx]);
    }
  }

  return (x, y) => {
    const rowProtected = expandedRowMax[y] >= 0
      && x >= expandedRowMin[y] - padX
      && x <= expandedRowMax[y] + padX;
    const colProtected = expandedColMax[x] >= 0
      && y >= expandedColMin[x] - padY
      && y <= expandedColMax[x] + padY;
    return rowProtected && colProtected;
  };
}

function remember(src, url) {
  if (transparentImageCache.has(src)) transparentImageCache.delete(src);
  transparentImageCache.set(src, url);
  while (transparentImageCache.size > MAX_CACHE_ENTRIES) {
    const oldest = transparentImageCache.entries().next().value;
    if (!oldest) break;
    const [key, oldUrl] = oldest;
    transparentImageCache.delete(key);
    if (oldUrl?.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
  }
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Não foi possível preparar a imagem do produto.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function buildTransparentProductImage(src) {
  const response = await fetch(src, { credentials:'same-origin' });
  if (!response.ok) throw new Error(`Falha ao carregar imagem do produto (${response.status}).`);

  const blob = await response.blob();
  const bitmap = await loadBitmap(blob);
  const sourceWidth = Number(bitmap.width || bitmap.naturalWidth || 0);
  const sourceHeight = Number(bitmap.height || bitmap.naturalHeight || 0);
  if (!sourceWidth || !sourceHeight) throw new Error('Imagem do produto sem dimensões válidas.');

  const scale = Math.min(1, MAX_RENDER_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently:true });
  if (!context) throw new Error('Canvas indisponível para preparar transparência.');

  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const total = width * height;

  // A PNG that already contains transparency is already a prepared cutout.
  // Running the white-background flood fill again can damage pale cover art.
  if (hasExistingTransparency(data, total)) return src;

  const isProtectedSubjectPixel = buildSubjectProtection(data, width, height);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = index => {
    if (index < 0 || index >= total || visited[index]) return;
    const offset = index * 4;
    if (!isBorderBackgroundCandidate(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const offset = index * 4;
    const x = index % width;
    const y = Math.floor(index / width);

    // Preserve light/white artwork that sits inside the detected product
    // silhouette. We still walk through it so the outer background remains
    // reachable, but we never make the cover itself transparent.
    if (!isProtectedSubjectPixel(x, y)) {
      const originalAlpha = data[offset + 3];
      const backgroundAlpha = connectedBackgroundAlpha(data[offset], data[offset + 1], data[offset + 2]);
      data[offset + 3] = Math.min(originalAlpha, backgroundAlpha);
    }

    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  context.putImageData(imageData, 0, 0);

  const outputBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Falha ao converter produto para PNG transparente.')), 'image/png');
  });

  return URL.createObjectURL(outputBlob);
}

export async function transparentProductImageUrl(src) {
  const normalized = String(src || '').trim();
  if (!normalized || typeof document === 'undefined') return normalized;
  if (transparentImageCache.has(normalized)) return transparentImageCache.get(normalized);
  if (transparentImageInflight.has(normalized)) return transparentImageInflight.get(normalized);

  const promise = buildTransparentProductImage(normalized)
    .then(url => {
      remember(normalized, url);
      transparentImageInflight.delete(normalized);
      return url;
    })
    .catch(() => {
      transparentImageInflight.delete(normalized);
      return normalized;
    });

  transparentImageInflight.set(normalized, promise);
  return promise;
}

export function useTransparentProductImage(src, enabled = true) {
  const normalized = String(src || '').trim();
  const cached = normalized && transparentImageCache.get(normalized);
  const [resolvedSrc, setResolvedSrc] = useState(() => cached || normalized);

  useEffect(() => {
    let active = true;
    if (!enabled || !normalized) {
      setResolvedSrc(normalized);
      return () => { active = false; };
    }

    const existing = transparentImageCache.get(normalized);
    if (existing) {
      setResolvedSrc(existing);
      return () => { active = false; };
    }

    setResolvedSrc(normalized);
    transparentProductImageUrl(normalized).then(url => {
      if (active) setResolvedSrc(url || normalized);
    });
    return () => { active = false; };
  }, [normalized, enabled]);

  return resolvedSrc;
}
