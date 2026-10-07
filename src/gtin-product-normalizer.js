import { ACCESSORY_COLORS, WIREO_COLORS, parseSku } from './sku.js';

function normalizedCode(value) {
  return String(value || '').trim().toUpperCase();
}

function colorLabel(value, colors, code) {
  const raw = normalizedCode(value);
  return colors[raw] || colors[normalizedCode(code)] || String(value || code || '').trim();
}

function tasselPresenceLabel(value, code) {
  const raw = normalizedCode(value);
  const effective = normalizedCode(code) || raw;
  if (!effective) return '';
  const noTassel = new Set(['X', 'N', 'NAO', 'NÃO', 'NO', 'FALSE', '0', 'SEM TASSEL']);
  return noTassel.has(effective) ? 'Não' : 'Sim';
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
    wireo: colorLabel(product.wireo || product.wireo_code, WIREO_COLORS, wireoCode),
    tassel: tasselPresenceLabel(product.tassel || product.tassel_code, tasselCode),
    elastico: colorLabel(product.elastico || product.elastico_code, ACCESSORY_COLORS, elasticoCode)
  };
}
