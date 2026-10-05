const OPENCV_SCRIPT_URL = 'https://docs.opencv.org/4.13.0/opencv.js';
const MAX_RENDER_DIMENSION = 1280;
const OUTLINE_SCALE = 8 / 1024;
let openCvPromise = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function resolveOpenCvRuntime(candidate) {
  let cv = candidate;
  if (cv && typeof cv.then === 'function') cv = await cv;
  if (cv?.Mat && typeof cv.grabCut === 'function') return cv;

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    cv = globalThis.cv;
    if (cv && typeof cv.then === 'function') cv = await cv;
    if (cv?.Mat && typeof cv.grabCut === 'function') return cv;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('OpenCV não inicializou para o novo recorte.');
}

export async function loadOpenCvForGrabCut() {
  if (typeof document === 'undefined') {
    throw new Error('O novo recorte só pode ser executado no navegador.');
  }
  if (globalThis.cv) return resolveOpenCvRuntime(globalThis.cv);
  if (openCvPromise) return openCvPromise;

  openCvPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-nisti-opencv-grabcut="1"]');
    if (existing) {
      resolveOpenCvRuntime(globalThis.cv).then(resolve, reject);
      return;
    }

    const script = document.createElement('script');
    script.src = OPENCV_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.dataset.nistiOpencvGrabcut = '1';
    script.onload = () => resolveOpenCvRuntime(globalThis.cv).then(resolve, reject);
    script.onerror = () => reject(new Error('Não foi possível carregar o motor OpenCV do novo recorte.'));
    document.head.appendChild(script);
  }).catch(error => {
    openCvPromise = null;
    throw error;
  });

  return openCvPromise;
}

async function imageBitmapFromUrl(src) {
  const response = await fetch(String(src || ''), {
    credentials:'same-origin',
    cache:'no-store'
  });
  if (!response.ok) throw new Error('Não foi possível abrir a imagem original.');
  const blob = await response.blob();
  if (!blob.size) throw new Error('A imagem original está vazia.');
  return createImageBitmap(blob);
}

function sourceCanvasFromBitmap(bitmap) {
  const sourceWidth = Number(bitmap.width || 0);
  const sourceHeight = Number(bitmap.height || 0);
  if (!sourceWidth || !sourceHeight) throw new Error('Dimensões inválidas na imagem original.');

  const scale = Math.min(1, MAX_RENDER_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently:true });
  if (!context) throw new Error('Canvas indisponível para o novo recorte.');
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return { canvas, context, width, height };
}

function componentGap(component, main) {
  const dx = component.maxX < main.minX
    ? main.minX - component.maxX
    : main.maxX < component.minX
      ? component.minX - main.maxX
      : 0;
  const dy = component.maxY < main.minY
    ? main.minY - component.maxY
    : main.maxY < component.minY
      ? component.minY - main.maxY
      : 0;
  return Math.hypot(dx, dy);
}

function keepPhysicalComponents(binaryMask, width, height) {
  const total = width * height;
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  const components = [];
  let label = 0;

  for (let start = 0; start < total; start += 1) {
    if (!binaryMask[start] || labels[start]) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const index = queue[head++];
      area += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || labels[next] || !binaryMask[next]) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        labels[next] = label;
        queue[tail++] = next;
      }
    }

    components.push({ label, area, minX, minY, maxX, maxY });
  }

  if (!components.length) return binaryMask;
  components.sort((a, b) => b.area - a.area);
  const main = components[0];
  const nearDistance = Math.max(6, Math.round(Math.min(width, height) * .07));
  const minimumDetailArea = Math.max(4, Math.round(main.area * .00012));
  const keepLabels = new Uint8Array(label + 1);
  keepLabels[main.label] = 1;

  for (let index = 1; index < components.length; index += 1) {
    const component = components[index];
    if (
      component.area >= Math.max(minimumDetailArea, Math.round(main.area * .035))
      || (component.area >= minimumDetailArea && componentGap(component, main) <= nearDistance)
    ) {
      keepLabels[component.label] = 1;
    }
  }

  const cleaned = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (labels[index] && keepLabels[labels[index]]) cleaned[index] = 1;
  }
  return cleaned;
}

function maskStats(mask, width, height) {
  let area = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    area += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    area,
    ratio:area / Math.max(1, width * height),
    minX,
    minY,
    maxX,
    maxY,
    width:maxX >= minX ? maxX - minX + 1 : 0,
    height:maxY >= minY ? maxY - minY + 1 : 0
  };
}

function assertSafeMask(mask, width, height) {
  const stats = maskStats(mask, width, height);
  if (
    stats.ratio < .045
    || stats.ratio > .88
    || stats.width < width * .20
    || stats.height < height * .20
  ) {
    throw new Error('O GrabCut não encontrou uma silhueta confiável. Nenhuma imagem foi salva.');
  }
  return stats;
}

function outsideBackground(mask, width, height) {
  const total = width * height;
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const push = index => {
    if (index < 0 || index >= total || mask[index] || outside[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    if (height > 1) push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    push(y * width);
    if (width > 1) push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }
  return outside;
}

function externalOutlineMask(mask, width, height, radius) {
  const total = width * height;
  const outside = outsideBackground(mask, width, height);
  const distance = new Uint16Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const hasProductNeighbor = index => {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (mask[ny * width + nx]) return true;
      }
    }
    return false;
  };

  for (let index = 0; index < total; index += 1) {
    if (!outside[index] || !hasProductNeighbor(index)) continue;
    distance[index] = 1;
    queue[tail++] = index;
  }

  while (head < tail) {
    const index = queue[head++];
    const current = distance[index];
    if (current >= radius) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!outside[next] || distance[next]) continue;
        distance[next] = current + 1;
        queue[tail++] = next;
      }
    }
  }

  const outline = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (distance[index] > 0 && distance[index] <= radius) outline[index] = 1;
  }
  return outline;
}

async function canvasPngBlob(canvas, errorMessage) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob?.size ? resolve(blob) : reject(new Error(errorMessage)),
      'image/png'
    );
  });
}

async function binaryMaskPng(mask, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas indisponível para gerar a máscara.');
  const imageData = context.createImageData(width, height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const value = mask[index] ? 255 : 0;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvasPngBlob(canvas, 'Falha ao gerar a máscara GrabCut.');
}

async function treatedPngFromMask(sourceCanvas, sourceContext, mask, width, height) {
  const imageData = sourceContext.getImageData(0, 0, width, height);
  for (let index = 0; index < mask.length; index += 1) {
    imageData.data[index * 4 + 3] = mask[index] ? 255 : 0;
  }

  const productCanvas = document.createElement('canvas');
  productCanvas.width = width;
  productCanvas.height = height;
  const productContext = productCanvas.getContext('2d');
  if (!productContext) throw new Error('Canvas indisponível para aplicar a máscara.');
  productContext.putImageData(imageData, 0, 0);

  const outlineRadius = clamp(Math.round(Math.max(width, height) * OUTLINE_SCALE), 6, 11);
  const outline = externalOutlineMask(mask, width, height, outlineRadius);
  const padding = outlineRadius + 2;
  const output = document.createElement('canvas');
  output.width = width + padding * 2;
  output.height = height + padding * 2;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Canvas indisponível para gerar o PNG tratado.');

  const outlineData = outputContext.createImageData(output.width, output.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = y * width + x;
      if (!outline[sourceIndex]) continue;
      const targetIndex = (y + padding) * output.width + (x + padding);
      const offset = targetIndex * 4;
      outlineData.data[offset] = 255;
      outlineData.data[offset + 1] = 255;
      outlineData.data[offset + 2] = 255;
      outlineData.data[offset + 3] = 255;
    }
  }
  outputContext.putImageData(outlineData, 0, 0);
  outputContext.drawImage(productCanvas, padding, padding);
  return canvasPngBlob(output, 'Falha ao gerar o PNG tratado com GrabCut.');
}

export async function grabCutProductArtifacts(src) {
  const normalized = String(src || '').trim();
  if (!normalized) throw new Error('Produto sem imagem original.');

  const [cv, bitmap] = await Promise.all([
    loadOpenCvForGrabCut(),
    imageBitmapFromUrl(normalized)
  ]);

  let rgba = null;
  let rgb = null;
  let grabMask = null;
  let bgdModel = null;
  let fgdModel = null;

  try {
    const { canvas, context, width, height } = sourceCanvasFromBitmap(bitmap);
    const insetX = clamp(Math.round(width * .012), 2, Math.max(2, Math.floor(width * .08)));
    const insetY = clamp(Math.round(height * .012), 2, Math.max(2, Math.floor(height * .08)));
    const rectWidth = width - insetX * 2;
    const rectHeight = height - insetY * 2;
    if (rectWidth < 8 || rectHeight < 8) throw new Error('Imagem pequena demais para o GrabCut.');

    rgba = cv.imread(canvas);
    rgb = new cv.Mat();
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB, 0);
    grabMask = new cv.Mat();
    bgdModel = new cv.Mat();
    fgdModel = new cv.Mat();

    const rect = new cv.Rect(insetX, insetY, rectWidth, rectHeight);
    cv.grabCut(rgb, grabMask, rect, bgdModel, fgdModel, 5, cv.GC_INIT_WITH_RECT);

    const binary = new Uint8Array(width * height);
    const labels = grabMask.data;
    for (let index = 0; index < binary.length; index += 1) {
      const value = labels[index];
      if (value === cv.GC_FGD || value === cv.GC_PR_FGD || value === 1 || value === 3) {
        binary[index] = 1;
      }
    }

    const cleanedMask = keepPhysicalComponents(binary, width, height);
    const stats = assertSafeMask(cleanedMask, width, height);
    const [maskBlob, imageBlob] = await Promise.all([
      binaryMaskPng(cleanedMask, width, height),
      treatedPngFromMask(canvas, context, cleanedMask, width, height)
    ]);

    return {
      imageBlob,
      maskBlob,
      width,
      height,
      stats,
      engine:'opencv-grabcut-4.13'
    };
  } finally {
    try { bitmap.close?.(); } catch {}
    try { rgba?.delete(); } catch {}
    try { rgb?.delete(); } catch {}
    try { grabMask?.delete(); } catch {}
    try { bgdModel?.delete(); } catch {}
    try { fgdModel?.delete(); } catch {}
  }
}

export const __grabCutExperimentInternals = {
  OPENCV_SCRIPT_URL,
  keepPhysicalComponents,
  maskStats,
  outsideBackground,
  externalOutlineMask
};
