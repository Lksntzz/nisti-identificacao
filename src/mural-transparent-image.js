import { useEffect, useState } from 'react';

const transparentImageCache = new Map();
const transparentImageInflight = new Map();
const transparentOutlineCache = new Map();
const transparentOutlineInflight = new Map();
const treatedProductImageCache = new Map();
const treatedProductImageInflight = new Map();
const MAX_CACHE_ENTRIES = 80;
const MAX_RENDER_DIMENSION = 1800;

// Structural mask normalized from the approved transparent planner outline
// reference (1254×1254). The reference is used only as geometry: it protects
// the physical body (cover + page block) independently of pixel color.
const PLANNER_STRUCTURE_REFERENCE = Object.freeze({
  // The approved reference has a physical silhouette aspect of ~0.709.
  // Keep the range deliberately tight so this exact mask is never applied to
  // unrelated products.
  aspectMin: .56,
  aspectMax: .86,
  outlinePolygon: Object.freeze([
    [0.980392, 0.013889],
    [0.800461, 0.000000],
    [0.083045, 0.050654],
    [0.064591, 0.058824],
    [0.063437, 0.089869],
    [0.002307, 0.099673],
    [0.006920, 0.125000],
    [0.063437, 0.129085],
    [0.064591, 0.142974],
    [0.006920, 0.150327],
    [0.001153, 0.173203],
    [0.063437, 0.181373],
    [0.064591, 0.196078],
    [0.006920, 0.203431],
    [0.001153, 0.225490],
    [0.065744, 0.236111],
    [0.063437, 0.251634],
    [0.013841, 0.254902],
    [0.001153, 0.273693],
    [0.017301, 0.286765],
    [0.065744, 0.288399],
    [0.064591, 0.303922],
    [0.013841, 0.308007],
    [0.002307, 0.325980],
    [0.013841, 0.338235],
    [0.065744, 0.341503],
    [0.068051, 0.672386],
    [0.010381, 0.679739],
    [0.004614, 0.700980],
    [0.068051, 0.712418],
    [0.066897, 0.726307],
    [0.011534, 0.732843],
    [0.005767, 0.754085],
    [0.068051, 0.764706],
    [0.069204, 0.778595],
    [0.012687, 0.785948],
    [0.005767, 0.805556],
    [0.069204, 0.819444],
    [0.068051, 0.833333],
    [0.016148, 0.838235],
    [0.006920, 0.856209],
    [0.019608, 0.868464],
    [0.068051, 0.871732],
    [0.069204, 0.886438],
    [0.013841, 0.892974],
    [0.008074, 0.915850],
    [0.068051, 0.925654],
    [0.076125, 0.959150],
    [0.913495, 0.999183],
    [0.937716, 0.983660],
    [0.997693, 0.979575]
  ])
});

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

function isStrongForegroundPixel(r, g, b, a) {
  if (a < 32) return false;
  const { chroma, brightness } = pixelMetrics(r, g, b);
  // Ignore pale studio shadows. Strong cover artwork, elastic and wire-o
  // remain as evidence for the real product body.
  return brightness < 218 || chroma > 30;
}

function isBorderBackgroundCandidate(r, g, b, a) {
  if (a < 8) return true;
  const { chroma, brightness } = pixelMetrics(r, g, b);
  // Conservative studio-background candidate. White/off-white product parts
  // are protected separately by the local edge barrier below.
  return brightness >= 242 && chroma <= 18;
}

function hasLocalProductEdge(data, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const offset = index * 4;
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];

  // A white agenda can have virtually the same RGB as the studio background.
  // The reliable signal is the physical edge: cover, pages, elastic and
  // wire-o create a local contrast transition even when the body itself is
  // white. Do not allow the outside flood-fill to cross that transition.
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const neighborOffset = (ny * width + nx) * 4;
      if (data[neighborOffset + 3] < 8) continue;
      const delta = Math.max(
        Math.abs(r - data[neighborOffset]),
        Math.abs(g - data[neighborOffset + 1]),
        Math.abs(b - data[neighborOffset + 2])
      );
      if (delta >= 14) return true;
    }
  }
  return false;
}

function protectedSubjectCoverage(data, width, height, isProtectedSubjectPixel) {
  let expected = 0;
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isProtectedSubjectPixel(x, y)) continue;
      expected += 1;
      if (data[(y * width + x) * 4 + 3] >= 32) opaque += 1;
    }
  }
  return expected ? opaque / expected : 0;
}

function isDeepProtectedSubjectPixel(isProtectedSubjectPixel, width, height, x, y) {
  if (!isProtectedSubjectPixel(x, y)) return false;
  const margin = clamp(Math.round(Math.min(width, height) * .012), 3, 14);
  const points = [
    [x - margin, y],
    [x + margin, y],
    [x, y - margin],
    [x, y + margin],
    [x - margin, y - margin],
    [x + margin, y - margin],
    [x - margin, y + margin],
    [x + margin, y + margin]
  ];
  return points.every(([px, py]) => (
    px >= 0 && px < width && py >= 0 && py < height && isProtectedSubjectPixel(px, py)
  ));
}

function subjectProtectionBounds(isProtectedSubjectPixel, width, height) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isProtectedSubjectPixel(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const padX = Math.max(2, Math.round(width * .018));
  const padY = Math.max(2, Math.round(height * .012));
  return {
    minX:clamp(minX - padX, 0, width - 1),
    maxX:clamp(maxX + padX, 0, width - 1),
    minY:clamp(minY - padY, 0, height - 1),
    maxY:clamp(maxY + padY, 0, height - 1)
  };
}

function pointInsidePolygon(x, y, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [cx, cy] = polygon[current];
    const [px, py] = polygon[previous];
    const intersects = ((cy > y) !== (py > y))
      && (x < (px - cx) * (y - cy) / ((py - cy) || Number.EPSILON) + cx);
    if (intersects) inside = !inside;
  }
  return inside;
}

function buildPlannerStructureProtection(isProtectedSubjectPixel, width, height) {
  const bounds = subjectProtectionBounds(isProtectedSubjectPixel, width, height);
  if (!bounds) return null;

  const boxWidth = bounds.maxX - bounds.minX + 1;
  const boxHeight = bounds.maxY - bounds.minY + 1;
  const aspect = boxWidth / Math.max(1, boxHeight);
  if (aspect < PLANNER_STRUCTURE_REFERENCE.aspectMin || aspect > PLANNER_STRUCTURE_REFERENCE.aspectMax) {
    return null;
  }

  const polygon = PLANNER_STRUCTURE_REFERENCE.outlinePolygon.map(([nx, ny]) => ([
    bounds.minX + nx * boxWidth,
    bounds.minY + ny * boxHeight
  ]));

  // This is the complete outer contour extracted from the approved reference,
  // including the wire-o protrusions. It is intentionally a true silhouette,
  // not a rectangular/core protection area.
  return (x, y) => pointInsidePolygon(x + .5, y + .5, polygon);
}

function applyPlannerStructureMask(data, width, height, isPlannerPixel) {
  if (!isPlannerPixel) return 0;
  let removed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isPlannerPixel(x, y)) continue;
      const alphaOffset = (y * width + x) * 4 + 3;
      if (data[alphaOffset] > 0) removed += 1;
      data[alphaOffset] = 0;
    }
  }
  return removed;
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

function hasUsableTransparentBorder(data, width, height) {
  let sampled = 0;
  let transparent = 0;

  const sample = index => {
    sampled += 1;
    if (data[index * 4 + 3] < 245) transparent += 1;
  };

  for (let x = 0; x < width; x += 1) {
    sample(x);
    if (height > 1) sample((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(y * width);
    if (width > 1) sample(y * width + width - 1);
  }

  return sampled > 0 && transparent / sampled >= 0.18;
}

function maskStats(mask, width, height) {
  let area = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let touches = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (minX <= 0) touches += 1;
  if (maxX >= width - 1) touches += 1;
  if (minY <= 0) touches += 1;
  if (maxY >= height - 1) touches += 1;

  return { area, minX, maxX, minY, maxY, touches, ratio:area / Math.max(1, width * height) };
}

function buildDominantForegroundGrid(data, width, height) {
  const columns = clamp(Math.round(width / 20), 48, 96);
  const rows = clamp(Math.round(height / 20), 48, 96);
  const cellCount = columns * rows;
  const activity = new Uint32Array(cellCount);

  for (let y = 0; y < height; y += 1) {
    const cellY = Math.min(rows - 1, Math.floor(y * rows / height));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!isStrongForegroundPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) continue;
      const cellX = Math.min(columns - 1, Math.floor(x * columns / width));
      activity[cellY * columns + cellX] += 1;
    }
  }

  const approximateCellArea = Math.max(1, (width / columns) * (height / rows));
  const minimumActivity = Math.max(2, Math.round(approximateCellArea * .008));
  let connected = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index += 1) {
    if (activity[index] >= minimumActivity) connected[index] = 1;
  }

  // Bridge artwork, elastic and wire-o that belong to the same agenda while
  // leaving a detached corner logo as a separate, much smaller component.
  for (let pass = 0; pass < 2; pass += 1) {
    const expanded = connected.slice();
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const index = y * columns + x;
        if (!connected[index]) continue;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(rows - 1, y + 1); yy += 1) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(columns - 1, x + 1); xx += 1) {
            expanded[yy * columns + xx] = 1;
          }
        }
      }
    }
    connected = expanded;
  }

  const labels = new Int32Array(cellCount);
  labels.fill(-1);
  const queue = new Int32Array(cellCount);
  let label = 0;
  let dominantLabel = -1;
  let dominantWeight = 0;

  for (let start = 0; start < cellCount; start += 1) {
    if (!connected[start] || labels[start] >= 0) continue;
    let head = 0;
    let tail = 0;
    let weight = 0;
    labels[start] = label;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      weight += activity[index];
      const x = index % columns;
      const y = Math.floor(index / columns);
      const push = next => {
        if (next < 0 || next >= cellCount || !connected[next] || labels[next] >= 0) return;
        labels[next] = label;
        queue[tail++] = next;
      };
      if (x > 0) push(index - 1);
      if (x + 1 < columns) push(index + 1);
      if (y > 0) push(index - columns);
      if (y + 1 < rows) push(index + columns);
    }

    if (weight > dominantWeight) {
      dominantWeight = weight;
      dominantLabel = label;
    }
    label += 1;
  }

  if (dominantLabel < 0 || dominantWeight < Math.max(12, Math.round(width * height * .001))) return null;
  return { columns, rows, labels, dominantLabel };
}

function buildSubjectProtection(data, width, height) {
  const dominant = buildDominantForegroundGrid(data, width, height);
  if (!dominant) return null;
  const rowMin = new Int32Array(height);
  const rowMax = new Int32Array(height);
  rowMin.fill(width);
  rowMax.fill(-1);

  let strongPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!isStrongForegroundPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) continue;
      const cellX = Math.min(dominant.columns - 1, Math.floor(x * dominant.columns / width));
      const cellY = Math.min(dominant.rows - 1, Math.floor(y * dominant.rows / height));
      if (dominant.labels[cellY * dominant.columns + cellX] !== dominant.dominantLabel) continue;
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
  const padX = Math.max(2, Math.round(width * .022));
  const padY = Math.max(2, Math.round(height * .022));
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

function clearOutsideSubject(data, width, height, isProtectedSubjectPixel) {
  let removed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isProtectedSubjectPixel(x, y)) continue;
      const alphaOffset = (y * width + x) * 4 + 3;
      if (data[alphaOffset] > 0) removed += 1;
      data[alphaOffset] = 0;
    }
  }
  return removed;
}

function buildProductComponentsMask(data, width, height) {
  const total = width * height;
  const labels = new Int32Array(total);
  labels.fill(-1);
  const queue = new Int32Array(total);
  const components = [];
  let largestSize = 0;
  let largestLabel = -1;

  const isOpaque = index => data[index * 4 + 3] >= 32;

  for (let start = 0; start < total; start += 1) {
    if (labels[start] >= 0 || !isOpaque(start)) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const label = components.length;
    labels[start] = label;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      count += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const push = next => {
        if (next < 0 || next >= total || labels[next] >= 0 || !isOpaque(next)) return;
        labels[next] = label;
        queue[tail++] = next;
      };

      if (x > 0) push(index - 1);
      if (x + 1 < width) push(index + 1);
      if (y > 0) push(index - width);
      if (y + 1 < height) push(index + width);
      if (x > 0 && y > 0) push(index - width - 1);
      if (x + 1 < width && y > 0) push(index - width + 1);
      if (x > 0 && y + 1 < height) push(index + width - 1);
      if (x + 1 < width && y + 1 < height) push(index + width + 1);
    }

    components.push({ count, minX, maxX, minY, maxY });
    if (count > largestSize) {
      largestSize = count;
      largestLabel = label;
    }
  }

  if (largestLabel < 0 || largestSize < Math.max(20, Math.round(total * .002))) return null;

  const main = components[largestLabel];
  const maximumGapX = Math.max(2, Math.round(width * .035));
  const maximumGapY = Math.max(2, Math.round(height * .035));
  const minimumDetailSize = Math.max(6, Math.round(total * .000003));
  const included = new Uint8Array(components.length);
  included[largestLabel] = 1;

  for (let label = 0; label < components.length; label += 1) {
    if (label === largestLabel) continue;
    const component = components[label];
    if (component.count < minimumDetailSize) continue;
    const gapX = Math.max(0, main.minX - component.maxX - 1, component.minX - main.maxX - 1);
    const gapY = Math.max(0, main.minY - component.maxY - 1, component.minY - main.maxY - 1);
    const closeToMainProduct = gapX <= maximumGapX && gapY <= maximumGapY;
    const anotherLargeProduct = component.count >= largestSize * .12;
    if (closeToMainProduct || anotherLargeProduct) included[label] = 1;
  }

  // Keep the agenda body, nearby detached wire-o rings and any other large
  // product in a collection composition. A small corner logo remains out.
  const mask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (labels[index] >= 0 && included[labels[index]]) mask[index] = 1;
  }

  return mask;
}

function fillMaskInteriorHoles(mask, width, height) {
  const total = width * height;
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = index => {
    if (index < 0 || index >= total || outside[index] || mask[index]) return;
    outside[index] = 1;
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
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const solid = mask.slice();
  for (let index = 0; index < total; index += 1) {
    if (!mask[index] && !outside[index]) solid[index] = 1;
  }
  return solid;
}

function dilateMask(mask, width, height, radius) {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = current.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (current[index]) continue;
        let found = false;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1) && !found; yy += 1) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
            if (current[yy * width + xx]) {
              found = true;
              break;
            }
          }
        }
        if (found) next[index] = 1;
      }
    }
    current = next;
  }
  return current;
}

async function buildProductOutlineImage(src) {
  const cutoutSrc = await transparentProductImageUrl(src);
  if (!cutoutSrc) return '';

  const response = await fetch(cutoutSrc, { credentials:'same-origin' });
  if (!response.ok) return '';
  const blob = await response.blob();
  const bitmap = await loadBitmap(blob);
  const width = Number(bitmap.width || bitmap.naturalWidth || 0);
  const height = Number(bitmap.height || bitmap.naturalHeight || 0);
  if (!width || !height) return '';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently:true });
  if (!context) return '';

  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const total = width * height;

  if (!hasExistingTransparency(data, total)) return '';

  const mainMask = buildProductComponentsMask(data, width, height);
  if (!mainMask) return '';

  // Safety guard: a mask that occupies nearly the entire canvas or touches
  // three/four edges is the old image background, not the agenda itself.
  // In that case we draw no outline instead of producing a white slab.
  const stats = maskStats(mainMask, width, height);
  if (stats.ratio > .82 || stats.touches >= 3) return '';

  const solidMask = fillMaskInteriorHoles(mainMask, width, height);
  const radius = clamp(Math.round(Math.max(width, height) * .0028), 2, 5);
  const expandedMask = dilateMask(solidMask, width, height, radius);

  const outlineData = context.createImageData(width, height);
  for (let index = 0; index < total; index += 1) {
    // The white layer is only the EXTERNAL RING. Never paint white beneath
    // the body of the agenda. This prevents internal transparency, artwork
    // gaps or a printed/logo mark from revealing white "cuts" inside it.
    if (!expandedMask[index] || solidMask[index]) continue;
    const offset = index * 4;
    outlineData.data[offset] = 255;
    outlineData.data[offset + 1] = 255;
    outlineData.data[offset + 2] = 255;
    outlineData.data[offset + 3] = 255;
  }

  context.clearRect(0, 0, width, height);
  context.putImageData(outlineData, 0, 0);
  const outputBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Falha ao gerar o contorno do produto.')), 'image/png');
  });
  return URL.createObjectURL(outputBlob);
}

async function productOutlineUrl(src) {
  const normalized = String(src || '').trim();
  if (!normalized || typeof document === 'undefined') return '';
  if (transparentOutlineCache.has(normalized)) return transparentOutlineCache.get(normalized);
  if (transparentOutlineInflight.has(normalized)) return transparentOutlineInflight.get(normalized);

  const promise = buildProductOutlineImage(normalized)
    .then(url => {
      transparentOutlineInflight.delete(normalized);
      transparentOutlineCache.set(normalized, url);
      while (transparentOutlineCache.size > MAX_CACHE_ENTRIES) {
        const oldest = transparentOutlineCache.entries().next().value;
        if (!oldest) break;
        const [key, oldUrl] = oldest;
        transparentOutlineCache.delete(key);
        if (oldUrl?.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
      }
      return url;
    })
    .catch(() => {
      transparentOutlineInflight.delete(normalized);
      return '';
    });

  transparentOutlineInflight.set(normalized, promise);
  return promise;
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

  // Only skip processing when transparency is actually present on the outer
  // border. A tiny transparent logo/mark inside the image is not a prepared
  // product cutout and must not disable background cleanup.
  if (hasExistingTransparency(data, total) && hasUsableTransparentBorder(data, width, height)) return src;

  // We still require strong product evidence before attempting any automatic
  // cutout, but we no longer keep an opaque convex-hull "plate" behind the
  // product. The previous hull clipping was the source of the white slab.
  const subjectEvidence = buildSubjectProtection(data, width, height);
  if (!subjectEvidence) return src;
  const plannerStructureProtection = buildPlannerStructureProtection(subjectEvidence, width, height);

  // For a planner matching the approved reference, do not guess by color at
  // all. Preserve every pixel inside the exact physical silhouette and clear
  // every pixel outside it. This keeps white covers intact and eliminates the
  // white rectangular plate seen in the Mural.
  if (plannerStructureProtection) {
    applyPlannerStructureMask(data, width, height, plannerStructureProtection);
    const plannerMask = buildProductComponentsMask(data, width, height);
    if (!plannerMask) return src;
    const plannerStats = maskStats(plannerMask, width, height);
    if (
      plannerStats.ratio < .12
      || plannerStats.ratio > .78
      || plannerStats.touches >= 3
    ) return src;

    context.putImageData(imageData, 0, 0);
    const outputBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Falha ao converter planner para PNG transparente.')),
        'image/png'
      );
    });
    return URL.createObjectURL(outputBlob);
  }

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = index => {
    if (index < 0 || index >= total || visited[index]) return;
    const offset = index * 4;
    if (!isBorderBackgroundCandidate(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) return;
    const x = index % width;
    const y = Math.floor(index / width);
    // Never let a near-white background flood enter the geometric core of the
    // product. This is the decisive guard for white/off-white covers: color may
    // match the studio background, but the interior belongs to the product.
    if (isDeepProtectedSubjectPixel(subjectEvidence, width, height, x, y)) return;
    if (hasLocalProductEdge(data, width, height, index)) return;
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

    // Remove only smooth near-white pixels connected to the outer canvas.
    // Local physical edges are barriers, so a white/off-white cover is never
    // traversed merely because its color resembles the background.
    data[offset + 3] = 0;

    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  // Second safety gate: compare the surviving opaque body with the geometric
  // product evidence detected before removal. If a leak ever eats a light
  // cover, coverage collapses and we return the untouched original.
  const subjectCoverage = protectedSubjectCoverage(data, width, height, subjectEvidence);
  if (subjectCoverage < .82) return src;

  const productMask = buildProductComponentsMask(data, width, height);
  if (!productMask) return src;
  const productStats = maskStats(productMask, width, height);
  const productWidth = productStats.maxX - productStats.minX + 1;
  const productHeight = productStats.maxY - productStats.minY + 1;

  // Never publish an aggressive/corrupted cutout. In particular, if a white
  // cover were accidentally eaten by the flood, the remaining artwork would
  // be too small and this safety gate returns the untouched original image.
  if (
    productStats.ratio < .055
    || productStats.ratio > .82
    || productWidth < width * .25
    || productHeight < height * .25
    || productStats.touches >= 3
  ) return src;

  // Remove only detached material (for example an export logo in a corner).
  // Nearby wire-o rings and other physical product parts are retained by
  // buildProductComponentsMask().
  const keepMask = dilateMask(productMask, width, height, 1);
  for (let index = 0; index < total; index += 1) {
    if (keepMask[index]) continue;
    data[index * 4 + 3] = 0;
  }

  context.putImageData(imageData, 0, 0);

  const outputBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('Falha ao converter produto para PNG transparente.')), 'image/png');
  });

  return URL.createObjectURL(outputBlob);
}

async function buildTreatedProductImage(src) {
  const cutoutSrc = await transparentProductImageUrl(src);
  if (!cutoutSrc) return src;

  const response = await fetch(cutoutSrc, { credentials:'same-origin' });
  if (!response.ok) return cutoutSrc;
  const blob = await response.blob();
  const bitmap = await loadBitmap(blob);
  const width = Number(bitmap.width || bitmap.naturalWidth || 0);
  const height = Number(bitmap.height || bitmap.naturalHeight || 0);
  if (!width || !height) return cutoutSrc;

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently:true });
  if (!sourceContext) return cutoutSrc;
  sourceContext.clearRect(0, 0, width, height);
  sourceContext.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const imageData = sourceContext.getImageData(0, 0, width, height);
  const { data } = imageData;
  const total = width * height;

  // If the source could not be safely separated from its background, leave it
  // untouched. This is intentionally safer than cutting a white cover.
  if (!hasExistingTransparency(data, total) || !hasUsableTransparentBorder(data, width, height)) {
    return cutoutSrc;
  }

  const productMask = buildProductComponentsMask(data, width, height);
  if (!productMask) return cutoutSrc;
  const stats = maskStats(productMask, width, height);
  const productWidth = stats.maxX - stats.minX + 1;
  const productHeight = stats.maxY - stats.minY + 1;
  if (
    stats.ratio < .055
    || stats.ratio > .82
    || productWidth < width * .25
    || productHeight < height * .25
    || stats.touches >= 3
  ) return cutoutSrc;

  // Remove disconnected logos/watermarks from the final visible product while
  // keeping nearby detached physical pieces such as wire-o loops.
  const keepMask = dilateMask(productMask, width, height, 1);
  for (let index = 0; index < total; index += 1) {
    if (keepMask[index]) continue;
    data[index * 4 + 3] = 0;
  }
  sourceContext.putImageData(imageData, 0, 0);

  const solidMask = fillMaskInteriorHoles(productMask, width, height);
  // 8 px at 1024 px, proportional at other resolutions: within the requested
  // visual band of roughly 6–10 px per 1024 px.
  const outlineRadius = clamp(Math.round(Math.max(width, height) * (8 / 1024)), 2, 16);
  const expandedMask = dilateMask(solidMask, width, height, outlineRadius);
  const padding = outlineRadius + 2;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width + padding * 2;
  outputCanvas.height = height + padding * 2;
  const outputContext = outputCanvas.getContext('2d', { willReadFrequently:true });
  if (!outputContext) return cutoutSrc;

  const outlineData = outputContext.createImageData(outputCanvas.width, outputCanvas.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = y * width + x;
      if (!expandedMask[sourceIndex] || solidMask[sourceIndex]) continue;
      const targetIndex = (y + padding) * outputCanvas.width + (x + padding);
      const offset = targetIndex * 4;
      outlineData.data[offset] = 255;
      outlineData.data[offset + 1] = 255;
      outlineData.data[offset + 2] = 255;
      outlineData.data[offset + 3] = 255;
    }
  }

  outputContext.putImageData(outlineData, 0, 0);
  outputContext.drawImage(sourceCanvas, padding, padding);

  const outputBlob = await new Promise((resolve, reject) => {
    outputCanvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Falha ao gerar imagem tratada do produto.')),
      'image/png'
    );
  });
  return URL.createObjectURL(outputBlob);
}

export async function treatedProductImageUrl(src) {
  const normalized = String(src || '').trim();
  if (!normalized || typeof document === 'undefined') return normalized;
  if (treatedProductImageCache.has(normalized)) return treatedProductImageCache.get(normalized);
  if (treatedProductImageInflight.has(normalized)) return treatedProductImageInflight.get(normalized);

  const promise = buildTreatedProductImage(normalized)
    .then(url => {
      treatedProductImageInflight.delete(normalized);
      treatedProductImageCache.set(normalized, url || normalized);
      while (treatedProductImageCache.size > MAX_CACHE_ENTRIES) {
        const oldest = treatedProductImageCache.entries().next().value;
        if (!oldest) break;
        const [key, oldUrl] = oldest;
        treatedProductImageCache.delete(key);
        if (oldUrl?.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
      }
      return url || normalized;
    })
    .catch(() => {
      treatedProductImageInflight.delete(normalized);
      return normalized;
    });

  treatedProductImageInflight.set(normalized, promise);
  return promise;
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


export function useTransparentProductOutline(src, enabled = true) {
  const normalized = String(src || '').trim();
  const cached = normalized && transparentOutlineCache.get(normalized);
  const [outlineSrc, setOutlineSrc] = useState(() => cached || '');

  useEffect(() => {
    let active = true;
    if (!enabled || !normalized) {
      setOutlineSrc('');
      return () => { active = false; };
    }

    const existing = transparentOutlineCache.get(normalized);
    if (existing) {
      setOutlineSrc(existing);
      return () => { active = false; };
    }

    setOutlineSrc('');
    productOutlineUrl(normalized).then(url => {
      if (active) setOutlineSrc(url || '');
    });
    return () => { active = false; };
  }, [normalized, enabled]);

  return outlineSrc;
}

export function useTreatedProductImage(src, enabled = true) {
  const normalized = String(src || '').trim();
  const cached = normalized && treatedProductImageCache.get(normalized);
  const [resolvedSrc, setResolvedSrc] = useState(() => cached || normalized);

  useEffect(() => {
    let active = true;
    if (!enabled || !normalized) {
      setResolvedSrc(normalized);
      return () => { active = false; };
    }

    const existing = treatedProductImageCache.get(normalized);
    if (existing) {
      setResolvedSrc(existing);
      return () => { active = false; };
    }

    setResolvedSrc(normalized);
    treatedProductImageUrl(normalized).then(url => {
      if (active) setResolvedSrc(url || normalized);
    });
    return () => { active = false; };
  }, [normalized, enabled]);

  return resolvedSrc;
}

export const __muralTransparentImageInternals = {
  buildSubjectProtection,
  clearOutsideSubject,
  buildProductComponentsMask,
  hasUsableTransparentBorder,
  hasLocalProductEdge,
  protectedSubjectCoverage,
  isDeepProtectedSubjectPixel,
  subjectProtectionBounds,
  buildPlannerStructureProtection,
  applyPlannerStructureMask,
  pointInsidePolygon,
  buildTreatedProductImage
};
