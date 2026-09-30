import { useEffect, useState } from 'react';

const transparentImageCache = new Map();
const transparentImageInflight = new Map();
const MAX_CACHE_ENTRIES = 80;
const MAX_RENDER_DIMENSION = 1800;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isBorderBackgroundCandidate(r, g, b, a) {
  if (a < 8) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const brightness = (r + g + b) / 3;
  return brightness >= 226 && chroma <= 30;
}

function connectedBackgroundAlpha(r, g, b) {
  const distance = Math.hypot(255 - r, 255 - g, 255 - b);
  if (distance <= 12) return 0;
  if (distance >= 58) return 255;
  return Math.round(((distance - 12) / 46) * 255);
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
    const originalAlpha = data[offset + 3];
    const backgroundAlpha = connectedBackgroundAlpha(data[offset], data[offset + 1], data[offset + 2]);
    data[offset + 3] = Math.min(originalAlpha, backgroundAlpha);

    const x = index % width;
    const y = Math.floor(index / width);
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
