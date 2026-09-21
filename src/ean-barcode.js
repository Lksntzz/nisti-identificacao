import { isValidGtin13 } from './gtin.js';

const LEFT_ODD = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const LEFT_EVEN = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const RIGHT = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function encodeEan13(gtin) {
  const value = String(gtin || '').trim();
  if (!isValidGtin13(value)) throw new Error('EAN-13 inválido para geração do código de barras.');
  const digits = value.split('').map(Number);
  const parity = PARITY[digits[0]];
  let modules = '101';
  for (let index = 1; index <= 6; index++) {
    modules += parity[index - 1] === 'L' ? LEFT_ODD[digits[index]] : LEFT_EVEN[digits[index]];
  }
  modules += '01010';
  for (let index = 7; index <= 12; index++) modules += RIGHT[digits[index]];
  return `${modules}101`;
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function safeBarcodeFilename(item) {
  return `EAN_${String(item?.gtin || '').replace(/\D/g, '')}_padrao_oficial.png`;
}

export function createEan13Svg(item) {
  const gtin = String(item?.gtin || '');
  const modules = encodeEan13(gtin);
  const width = 543;
  const height = 189;
  const moduleWidth = 4.35;
  const barcodeWidth = modules.length * moduleWidth;
  const barcodeX = (width - barcodeWidth) / 2;
  const barcodeY = 18;
  const normalHeight = 92;
  const guardHeight = 104;
  const bars = [];
  for (let index = 0; index < modules.length; index++) {
    if (modules[index] !== '1') continue;
    const guard = index < 3 || (index >= 45 && index < 50) || index >= 92;
    bars.push(`<rect x="${(barcodeX + index * moduleWidth).toFixed(2)}" y="${barcodeY}" width="${moduleWidth}" height="${guard ? guardHeight : normalHeight}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Código EAN ${escapeXml(gtin)}">
  <rect width="543" height="189" rx="18" fill="#fff"/>
  <g fill="#000" shape-rendering="crispEdges">${bars.join('')}</g>
  <text x="43" y="158" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="24" fill="#000">${gtin[0]}</text>
  <text x="169.28" y="158" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="24" letter-spacing="8" fill="#000">${gtin.slice(1, 7)}</text>
  <text x="373.73" y="158" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="24" letter-spacing="8" fill="#000">${gtin.slice(7)}</text>
</svg>`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function uint32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

export async function withPngDpiMetadata(pngBlob, dpi = 300) {
  const source = new Uint8Array(await pngBlob.arrayBuffer());
  const signature = source.slice(0, 8);
  const parts = [signature];
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  let offset = 8;
  let inserted = false;

  while (offset + 12 <= source.length) {
    const length = new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0, false);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > source.length) throw new Error('Arquivo PNG inválido.');
    const type = String.fromCharCode(...source.slice(offset + 4, offset + 8));
    if (type !== 'pHYs') parts.push(source.slice(offset, chunkEnd));
    if (type === 'IHDR' && !inserted) {
      const typeBytes = new TextEncoder().encode('pHYs');
      const data = new Uint8Array(9);
      const view = new DataView(data.buffer);
      view.setUint32(0, pixelsPerMeter, false);
      view.setUint32(4, pixelsPerMeter, false);
      data[8] = 1;
      const crcInput = joinBytes([typeBytes, data]);
      parts.push(uint32Bytes(data.length), typeBytes, data, uint32Bytes(crc32(crcInput)));
      inserted = true;
    }
    offset = chunkEnd;
  }
  return new Blob(parts, { type: 'image/png' });
}

export async function renderBarcodePngBlob(item) {
  const svg = createEan13Svg(item);
  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Não foi possível renderizar o código em PNG.'));
      image.src = sourceUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 543;
    canvas.height = 189;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível criar o arquivo PNG.');
    return withPngDpiMetadata(blob, 300);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function downloadBarcodePng(item) {
  downloadBlob(await renderBarcodePngBlob(item), safeBarcodeFilename(item));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(signature, size) {
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, signature, true);
  return bytes;
}

function joinBytes(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.data);
    const local = zipHeader(0x04034b50, 30);
    const localView = new DataView(local.buffer);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    locals.push(local, name, file.data);

    const central = zipHeader(0x02014b50, 46);
    const centralView = new DataView(central.buffer);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }

  const centralBytes = joinBytes(centrals);
  const end = zipHeader(0x06054b50, 22);
  const endView = new DataView(end.buffer);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, offset, true);
  return new Blob([...locals, centralBytes, end], { type: 'application/zip' });
}

export async function createBarcodeZip(items) {
  const files = [];
  for (const item of items) {
    const blob = await renderBarcodePngBlob(item);
    files.push({ name: safeBarcodeFilename(item), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return createStoredZip(files);
}

export async function downloadBarcodeZip(items, platform = '') {
  if (!items.length) throw new Error('Selecione pelo menos um produto.');
  const suffix = platform && platform !== 'all' ? `-${platform.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
  downloadBlob(await createBarcodeZip(items), `codigos-ean-nisti${suffix}.zip`);
}
