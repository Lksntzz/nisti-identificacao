const CATEGORY_HINTS = new Set([
  'agenda',
  'planner',
  'caderno',
  'caderneta de vacinacao',
  'outros',
  'adesivos / etiquetas',
  'cardapio',
  'livro de colorir'
]);

function text(value) {
  return String(value ?? '').trim();
}

function fold(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function compactToken(value) {
  return fold(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function isUrl(value) {
  return /^https?:\/\//i.test(text(value));
}

function normalizeMarketplace(value) {
  const token = compactToken(value).replace(/ /g, '_').toUpperCase();
  if (token === 'MERCADO_LIVRE' || token === 'MERCADOLIVRE' || token === 'ML') return 'MERCADO_LIVRE';
  if (token === 'SHOPEE') return 'SHOPEE';
  throw new Error(`Marketplace não suportado: ${value}`);
}

function normalizeUpdateHint(value) {
  const token = compactToken(value);
  if (!token) return 'UNKNOWN';
  if (['s', 'sim', 'ok', 'atualizado', 'atualizada'].includes(token)) return 'UPDATED';
  if (token.includes('nao cadastrado') || token.includes('n cadastrado')) return 'NOT_LISTED';
  if (['n', 'nao', 'pendente', 'desatualizado', 'desatualizada'].includes(token)) return 'NOT_UPDATED';
  return 'REVIEW';
}

function normalizeVideoStatus(value) {
  const token = compactToken(value);
  if (!token) return 'UNKNOWN';
  if (['s', 'sim', 'ativo', 'ativa'].includes(token)) return 'ACTIVE';
  if (['n', 'nao', 'sem video', 'ausente'].includes(token)) return 'ABSENT';
  if (
    token === 's d'
    || token.includes('desa')
    || token.includes('desativ')
    || token.includes('desatualiz')
  ) return 'DISABLED';
  return 'UNKNOWN';
}

function extractObservedYear(...values) {
  for (const value of values) {
    const match = text(value).match(/\b(20(?:2[0-9]|3[0-9]))\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractExternalListingId(marketplace, value) {
  const raw = text(value);
  if (!raw) return null;

  if (marketplace === 'SHOPEE') {
    const match = raw.match(/\/product\/\d+\/(\d+)/i);
    return match?.[1] || null;
  }

  if (marketplace === 'MERCADO_LIVRE') {
    const itemFilter = raw.match(/item_id[:=](MLB\d+)/i);
    if (itemFilter) return itemFilter[1].toUpperCase();
    const itemPath = raw.match(/\b(MLB)-?(\d{6,})\b/i);
    if (itemPath) return `${itemPath[1].toUpperCase()}${itemPath[2]}`;
    return null;
  }

  return null;
}

function nonEmptyTail(row, startIndex) {
  return (row || [])
    .slice(Math.max(0, startIndex || 0))
    .map(text)
    .filter(Boolean);
}

function valueAt(row, index) {
  return index == null ? '' : text((row || [])[index]);
}

const SHOPEE_PROFILE = Object.freeze({
  skuPrimary: 0,
  skuSecondary: 1,
  name: 2,
  category: 3,
  update: 4,
  video: 5,
  listing: 6,
  notesStart: 7
});

const ML_PROFILES = Object.freeze({
  agendas: { skuPrimary: 0, skuSecondary: 1, name: 2, category: 3, update: 4, video: 5, listing: 6, notesStart: 7 },
  'caderneta de vacinacao': { skuPrimary: 0, skuSecondary: 1, name: 2, category: 3, update: 4, video: 5, listing: 6, notesStart: 7 },
  planner: { skuPrimary: 0, name: 1, category: 2, update: 4, video: 5, listing: 6, notesStart: 7 },
  'livro leitura': { skuPrimary: 0, name: 1, category: 2, update: 4, video: 5, listing: 6, notesStart: 7 },
  'adesivos etiquetas': { skuPrimary: 0, name: 1, category: 2, update: 4, video: 5, listing: 6, notesStart: 7 },
  caderno: { skuPrimary: 0, name: 1, category: 2, update: 3, video: 4, listing: 5, notesStart: 6 },
  outros: { skuPrimary: 0, name: 1, category: 2, update: 3, video: 4, listing: 5, notesStart: 6 },
  cardapio: { skuPrimary: 0, name: 1, category: 2, update: 3, video: 4, listing: 5, notesStart: 6 }
});

function normalizedSheetKey(sheetName) {
  return fold(sheetName).replace(/[^a-z0-9]+/g, ' ').trim();
}

function profileFor(marketplace, sheetName) {
  if (marketplace === 'SHOPEE') return SHOPEE_PROFILE;
  if (marketplace !== 'MERCADO_LIVRE') return null;
  return ML_PROFILES[normalizedSheetKey(sheetName)] || null;
}

function looksLikeHeader(row) {
  const joined = (row || []).map(compactToken).join('|');
  return joined.includes('nome produto')
    || joined.includes('sku base')
    || (joined.includes('sku') && joined.includes('categoria') && joined.includes('video'));
}

function categoryFallback(sheetName) {
  const key = normalizedSheetKey(sheetName);
  const aliases = {
    agendas: 'Agenda',
    planner: 'Planner',
    caderno: 'Caderno',
    'caderneta de vacinacao': 'Caderneta de Vacinação',
    outros: 'Outros',
    'adesivos etiquetas': 'Adesivos / Etiquetas',
    cardapio: 'Cardápio',
    'livro leitura': 'Livro de colorir'
  };
  return aliases[key] || text(sheetName);
}

function normalizeCategory(raw, sheetName) {
  const value = text(raw);
  if (value) return value;
  return categoryFallback(sheetName);
}

function validateNormalized(row) {
  const issues = [];
  if (!row.sku_primary) issues.push('missing_sku');
  if (!row.product_name) issues.push('missing_product_name');
  if (!row.category) issues.push('missing_category');
  if (!row.listing_ref) issues.push('missing_listing_reference');
  if (row.category && !CATEGORY_HINTS.has(fold(row.category))) issues.push('nonstandard_category');
  if (row.listing_ref && !row.listing_url) issues.push('listing_reference_not_url');
  return issues;
}

export function normalizeCommerceImportRow({ marketplace, sheetName, row, rowNumber }) {
  const market = normalizeMarketplace(marketplace);
  if (!Array.isArray(row) || !row.some(value => text(value))) return null;
  if (looksLikeHeader(row)) return null;

  const profile = profileFor(market, sheetName);
  if (!profile) {
    return {
      status: 'INVALID',
      issues: ['unsupported_sheet_layout'],
      normalized: null,
      original: row
    };
  }

  const listingRef = valueAt(row, profile.listing);
  const skuPrimary = valueAt(row, profile.skuPrimary);
  const skuSecondary = valueAt(row, profile.skuSecondary);
  const productName = valueAt(row, profile.name);
  const category = normalizeCategory(valueAt(row, profile.category), sheetName);
  const updateRaw = valueAt(row, profile.update);
  const videoRaw = valueAt(row, profile.video);
  const notes = nonEmptyTail(row, profile.notesStart);

  const normalized = {
    source_sheet: text(sheetName),
    source_row_number: Number(rowNumber || 0) || null,
    marketplace: market,
    sku_primary: skuPrimary || null,
    sku_secondary: skuSecondary || null,
    product_name: productName || null,
    category: category || null,
    update_raw: updateRaw || null,
    update_hint: normalizeUpdateHint(updateRaw),
    video_raw: videoRaw || null,
    video_status: normalizeVideoStatus(videoRaw),
    listing_ref: listingRef || null,
    listing_url: isUrl(listingRef) ? listingRef : null,
    external_listing_id: isUrl(listingRef) ? extractExternalListingId(market, listingRef) : null,
    observed_year: extractObservedYear(productName, listingRef),
    notes
  };

  const issues = validateNormalized(normalized);
  return {
    status: issues.some(issue => ['missing_sku', 'missing_product_name'].includes(issue)) ? 'INVALID' : (issues.length ? 'REVIEW' : 'READY'),
    issues,
    normalized,
    original: row
  };
}

export function normalizeCommerceSheet({ marketplace, sheetName, rows }) {
  const normalizedRows = [];
  (rows || []).forEach((row, index) => {
    const result = normalizeCommerceImportRow({
      marketplace,
      sheetName,
      row,
      rowNumber: index + 1
    });
    if (result) normalizedRows.push(result);
  });
  return normalizedRows;
}

export const commerceImportNormalizerInternals = Object.freeze({
  normalizeUpdateHint,
  normalizeVideoStatus,
  extractExternalListingId,
  extractObservedYear,
  normalizedSheetKey
});
