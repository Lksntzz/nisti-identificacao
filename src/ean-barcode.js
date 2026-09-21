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

export function safeBarcodeFilename(item, extension = 'svg') {
  const base = `${item?.sku || 'produto'}_${item?.gtin || 'ean'}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${base || 'codigo-ean'}.${extension}`;
}

export function createEan13Svg(item, options = {}) {
  const gtin = String(item?.gtin || '');
  const modules = encodeEan13(gtin);
  const width = 520;
  const height = 250;
  const moduleWidth = 4;
  const barcodeX = 70;
  const barcodeY = 78;
  const normalHeight = 104;
  const guardHeight = 116;
  const platform = options.platform && options.platform !== 'all' ? options.platform : '';
  const bars = [];
  for (let index = 0; index < modules.length; index++) {
    if (modules[index] !== '1') continue;
    const guard = index < 3 || (index >= 45 && index < 50) || index >= 92;
    bars.push(`<rect x="${barcodeX + index * moduleWidth}" y="${barcodeY}" width="${moduleWidth}" height="${guard ? guardHeight : normalHeight}"/>`);
  }

  const productName = String(item?.nome || 'Produto NISTI').slice(0, 56);
  const variation = String(item?.variacao || '').slice(0, 42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Código EAN ${escapeXml(gtin)}">
  <rect width="520" height="250" rx="18" fill="#fff"/>
  <rect x="1" y="1" width="518" height="248" rx="17" fill="none" stroke="#dbe3ef" stroke-width="2"/>
  <text x="28" y="32" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#64748b">NISTI PRINT${platform ? ` · ${escapeXml(platform)}` : ''}</text>
  <text x="28" y="54" font-family="Arial,sans-serif" font-size="16" font-weight="800" fill="#0f172a">${escapeXml(productName)}</text>
  ${variation ? `<text x="28" y="72" font-family="Arial,sans-serif" font-size="12" fill="#64748b">${escapeXml(variation)}</text>` : ''}
  <g fill="#020617" shape-rendering="crispEdges">${bars.join('')}</g>
  <text x="34" y="211" font-family="Arial,sans-serif" font-size="19" fill="#020617">${gtin[0]}</text>
  <text x="143" y="211" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" letter-spacing="10" fill="#020617">${gtin.slice(1, 7)}</text>
  <text x="376" y="211" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" letter-spacing="10" fill="#020617">${gtin.slice(7)}</text>
  <text x="28" y="234" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#64748b">SKU ${escapeXml(item?.sku || '—')}</text>
  <text x="492" y="234" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#94a3b8">GTIN-13 · GS1</text>
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

export function downloadBarcodeSvg(item, platform = '') {
  downloadBlob(new Blob([createEan13Svg(item, { platform })], { type: 'image/svg+xml;charset=utf-8' }), safeBarcodeFilename(item));
}

export async function downloadBarcodePng(item, platform = '') {
  const svg = createEan13Svg(item, { platform });
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
    canvas.width = 1040;
    canvas.height = 500;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível criar o arquivo PNG.');
    downloadBlob(blob, safeBarcodeFilename(item, 'png'));
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
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

export function createBarcodeZip(items, platform = '') {
  const encoder = new TextEncoder();
  const manifest = ['EAN,SKU,Produto,Variacao,Plataformas', ...items.map(item => [
    item.gtin,
    item.sku,
    item.nome,
    item.variacao,
    (item.platforms || []).join(' | ')
  ].map(value => `"${String(value || '').replaceAll('"', '""')}"`).join(','))].join('\r\n');
  const files = items.map(item => ({ name: safeBarcodeFilename(item), data: encoder.encode(createEan13Svg(item, { platform })) }));
  files.push({ name: 'manifesto.csv', data: encoder.encode(`\uFEFF${manifest}`) });

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

export function downloadBarcodeZip(items, platform = '') {
  if (!items.length) throw new Error('Selecione pelo menos um produto.');
  const suffix = platform && platform !== 'all' ? `-${platform.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
  downloadBlob(createBarcodeZip(items, platform), `codigos-ean-nisti${suffix}.zip`);
}
