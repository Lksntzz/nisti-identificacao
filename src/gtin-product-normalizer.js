import { ACCESSORY_COLORS, WIREO_COLORS, parseSku } from './sku.js';

function normalizedCode(value) {
  return String(value || '').trim().toUpperCase();
}

function colorLabel(value, colors, code, emptyLabel = '') {
  const raw = normalizedCode(value);
  if (raw === 'X' && emptyLabel) return emptyLabel;
  return colors[raw] || colors[normalizedCode(code)] || String(value || code || '').trim();
}

function tasselLabel(value, code) {
  const raw = normalizedCode(value);
  const effective = normalizedCode(code) || raw;
  if (!effective) return '';
  const noTassel = new Set(['X', 'N', 'NAO', 'NÃO', 'NO', 'FALSE', '0', 'SEM TASSEL']);
  if (noTassel.has(effective)) return 'Não';
  return ACCESSORY_COLORS[effective] || String(value || code || '').trim() || effective;
}

export function normalizeGtinProduct(product) {
  if (!product) return product;

  let parsedSku = null;
  try {
    parsedSku = parseSku(product.sku);
  } catch {}

  const wireoCode = normalizedCode(product.wireo_code) || parsedSku?.wireoCode || '';
  const tasselCode = normalizedCode(product.tassel_code) || parsedSku?.tasselCode || '';
  const elasticoCode = normalizedCode(product.elastico_code) || parsedSku?.elasticoCode || '';

  return {
    ...product,
    wireo: colorLabel(wireoCode || product.wireo || product.wireo_code, WIREO_COLORS, wireoCode),
    tassel: tasselLabel(product.tassel || product.tassel_code, tasselCode),
    elastico: colorLabel(elasticoCode || product.elastico || product.elastico_code, ACCESSORY_COLORS, elasticoCode, 'Sem elástico')
  };
}
