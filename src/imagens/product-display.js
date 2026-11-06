export function normalizeProductDisplayText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function productTypeLabel(product) {
  const source = normalizeProductDisplayText([
    product?.nome ?? product?.product_name,
    product?.sku,
    product?.miolo_code
  ].filter(Boolean).join(' '));

  if (/\bplanner\b/.test(source)) return 'Planner';
  if (/\bagenda\b/.test(source)) return 'Agenda';
  if (/\bcaderno\b|\bnotebook\b/.test(source)) return 'Caderno';
  if (/\bcaderneta\b/.test(source)) return 'Caderneta';
  if (/\bfichario\b/.test(source)) return 'Fichário';
  return 'Produto';
}
