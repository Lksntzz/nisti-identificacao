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
  // The subject mask protects the complete product. This threshold can then
  // remove the light studio background and its pale halo without cutting
  // white paper or white cover artwork inside the product silhouette.
  return brightness >= 222 && chroma <= 28;
}

function cross(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
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
  rowMin.fill(width);
  rowMax.fill(-1);

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
    }
  }

  if (strongPixels < Math.max(12, Math.round(width * height * 0.0015))) {
    return null;
  }

  const boundaryPoints = [];
  for (let y = 0; y < height; y += 1) {
    if (rowMax[y] < 0) continue;
    boundaryPoints.push({ x:rowMin[y], y });
    if (rowMax[y] !== rowMin[y]) boundaryPoints.push({ x:rowMax[y], y });
  }

  const hull = convexHull(boundaryPoints);
  if (hull.length < 3) return null;

  const minX = Math.min(...hull.map(point => point.x));
  const maxX = Math.max(...hull.map(point => point.x));
  const minY = Math.min(...hull.map(point => point.y));
  const maxY = Math.max(...hull.map(point => point.y));
  // A tiny isolated mark is not enough evidence for a safe automatic cutout.
  // Keeping the original is preferable to damaging a mostly white product.
  if (maxX - minX < width * .28 || maxY - minY < height * .28) return null;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const padX = Math.max(2, Math.round(width * .018));
  const padY = Math.max(2, Math.round(height * .018));
  const scaleX = 1 + padX / Math.max(1, (maxX - minX) / 2);
  const scaleY = 1 + padY / Math.max(1, (maxY - minY) / 2);
  const expandedHull = hull.map(point => ({
    x:clamp(centerX + (point.x - centerX) * scaleX, 0, width - 1),
    y:clamp(centerY + (point.y - centerY) * scaleY, 0, height - 1)
  }));

  const protectedMin = new Int32Array(height);
  const protectedMax = new Int32Array(height);
  protectedMin.fill(width);
  protectedMax.fill(-1);

  for (let y = 0; y < height; y += 1) {
    const scanY = y + .5;
    const intersections = [];
    for (let index = 0; index < expandedHull.length; index += 1) {
      const from = expandedHull[index];
      const to = expandedHull[(index + 1) % expandedHull.length];
      const lowY = Math.min(from.y, to.y);
      const highY = Math.max(from.y, to.y);
      if (from.y === to.y || scanY < lowY || scanY >= highY) continue;
      const progress = (scanY - from.y) / (to.y - from.y);
      intersections.push(from.x + (to.x - from.x) * progress);
    }
    if (intersections.length < 2) continue;
    protectedMin[y] = Math.max(0, Math.floor(Math.min(...intersections)));
    protectedMax[y] = Math.min(width - 1, Math.ceil(Math.max(...intersections)));
  }

  return (x, y) => protectedMax[y] >= 0 && x >= protectedMin[y] && x <= protectedMax[y];
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
  if (!isProtectedSubjectPixel) return src;
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
      // A binary cut avoids the translucent white fringe produced by the old
      // distance-based alpha and leaves a clean, linear product boundary.
      data[offset + 3] = 0;
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
