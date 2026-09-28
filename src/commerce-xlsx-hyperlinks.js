const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const MAX_EOCD_SEARCH = 0xffff + 22;

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attrs(fragment) {
  const out = {};
  const regex = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = regex.exec(String(fragment || '')))) out[match[1]] = xmlDecode(match[3]);
  return out;
}

function normalizeZipPath(baseFile, target) {
  const raw = String(target || '').replace(/\\/g, '/');
  if (!raw) return '';
  if (raw.startsWith('/')) return raw.replace(/^\/+/, '');
  const base = String(baseFile || '').split('/');
  base.pop();
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

function relsPathFor(filePath) {
  const parts = String(filePath || '').split('/');
  const name = parts.pop();
  return [...parts, '_rels', `${name}.rels`].join('/');
}

function parseRelationships(xml) {
  const out = new Map();
  const regex = /<Relationship\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = regex.exec(String(xml || '')))) {
    const a = attrs(match[1]);
    if (a.Id && a.Target) out.set(a.Id, a.Target);
  }
  return out;
}

export function parseWorkbookSheetTargets(workbookXml, workbookRelsXml) {
  const rels = parseRelationships(workbookRelsXml);
  const result = [];
  const regex = /<sheet\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = regex.exec(String(workbookXml || '')))) {
    const a = attrs(match[1]);
    const relId = a['r:id'];
    const target = relId ? rels.get(relId) : null;
    if (!a.name || !target) continue;
    result.push({ name: a.name, path: normalizeZipPath('xl/workbook.xml', target) });
  }
  return result;
}

export function parseWorksheetHyperlinks(sheetXml, sheetRelsXml) {
  const rels = parseRelationships(sheetRelsXml);
  const result = new Map();
  const regex = /<hyperlink\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = regex.exec(String(sheetXml || '')))) {
    const a = attrs(match[1]);
    const ref = String(a.ref || '').trim().toUpperCase();
    const relId = a['r:id'];
    const target = relId ? rels.get(relId) : null;
    if (!/^[A-Z]+\d+$/.test(ref) || !/^https?:\/\//i.test(String(target || '').trim())) continue;
    result.set(ref, String(target).trim());
  }
  return result;
}

function findEocd(view) {
  const start = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD) return offset;
  }
  throw new Error('Estrutura ZIP do arquivo .xlsx inválida.');
}

function zipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const eocd = findEocd(view);
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let index = 0; index < total; index++) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL) throw new Error('Diretório ZIP do .xlsx corrompido.');
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decodeUtf8(new Uint8Array(arrayBuffer, offset + 46, nameLength));
    entries.set(name, { compression, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function unzipEntry(arrayBuffer, entry) {
  const view = new DataView(arrayBuffer);
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== ZIP_LOCAL) throw new Error('Entrada ZIP do .xlsx inválida.');
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const bytes = new Uint8Array(arrayBuffer, start, entry.compressedSize);

  if (entry.compression === 0) return bytes.slice();
  if (entry.compression !== 8) throw new Error(`Compressão ZIP não suportada no .xlsx: ${entry.compression}.`);
  if (typeof DecompressionStream !== 'function') throw new Error('Este navegador não oferece descompressão ZIP necessária para preservar hyperlinks do Excel.');

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function xmlEntry(arrayBuffer, entries, path) {
  const entry = entries.get(path);
  if (!entry) return '';
  return decodeUtf8(await unzipEntry(arrayBuffer, entry));
}

export async function extractCommerceXlsxHyperlinks(arrayBuffer) {
  const entries = zipEntries(arrayBuffer);
  const workbookPath = 'xl/workbook.xml';
  const workbookXml = await xmlEntry(arrayBuffer, entries, workbookPath);
  const workbookRelsXml = await xmlEntry(arrayBuffer, entries, relsPathFor(workbookPath));
  if (!workbookXml || !workbookRelsXml) return new Map();

  const sheets = parseWorkbookSheetTargets(workbookXml, workbookRelsXml);
  const result = new Map();
  for (const sheet of sheets) {
    const [sheetXml, sheetRelsXml] = await Promise.all([
      xmlEntry(arrayBuffer, entries, sheet.path),
      xmlEntry(arrayBuffer, entries, relsPathFor(sheet.path))
    ]);
    if (!sheetXml || !sheetRelsXml) continue;
    const links = parseWorksheetHyperlinks(sheetXml, sheetRelsXml);
    if (links.size) result.set(sheet.name, links);
  }
  return result;
}

export function excelColumnIndex(cellRef) {
  const match = String(cellRef || '').trim().toUpperCase().match(/^([A-Z]+)\d+$/);
  if (!match) return null;
  let value = 0;
  for (const char of match[1]) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

export function hyperlinksForRow(sheetLinks, rowNumber) {
  const out = {};
  if (!(sheetLinks instanceof Map)) return out;
  const suffix = String(Number(rowNumber || 0));
  for (const [ref, target] of sheetLinks) {
    if (!suffix || !ref.endsWith(suffix)) continue;
    const match = ref.match(/^(\D+)(\d+)$/);
    if (!match || match[2] !== suffix) continue;
    const index = excelColumnIndex(ref);
    if (index != null) out[index] = target;
  }
  return out;
}
