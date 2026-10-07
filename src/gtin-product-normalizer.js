import { ACCESSORY_COLORS, WIREO_COLORS } from './sku.js';

export function normalizeGtinProduct(product) {
  if (!product) return product;

  const wireoCode = String(product.wireo_code || '').trim().toUpperCase();
  const tasselCode = String(product.tassel_code || '').trim().toUpperCase();
  const elasticoCode = String(product.elastico_code || '').trim().toUpperCase();

  return {
    ...product,
    wireo: product.wireo || WIREO_COLORS[wireoCode] || wireoCode || '',
    tassel: product.tassel || (
      tasselCode === 'X'
        ? 'Sem tassel'
        : ACCESSORY_COLORS[tasselCode] || tasselCode || ''
    ),
    elastico: product.elastico || (
      elasticoCode === 'X'
        ? 'Sem elástico'
        : ACCESSORY_COLORS[elasticoCode] || elasticoCode || ''
    )
  };
}
