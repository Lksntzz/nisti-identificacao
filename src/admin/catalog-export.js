const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function skuFamily(sku) {
  return String(sku || '').split('_', 1)[0].trim();
}

export function sortedCatalogProducts(products) {
  return [...products].sort((a, b) => {
    for (const field of [
      [a.platform, b.platform],
      [skuFamily(a.sku), skuFamily(b.sku)],
      [a.nome, b.nome],
      [a.variacao, b.variacao],
      [a.sku, b.sku]
    ]) {
      const order = collator.compare(String(field[0] || ''), String(field[1] || ''));
      if (order) return order;
    }
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function organizedCatalogCsv(products) {
  const headers = ['PLATAFORMA', 'FAMILIA_SKU', 'SKU', 'NOME', 'VARIACAO', 'CAPA_CODE', 'EAN', 'ID', 'CRIADO_EM'];
  const rows = sortedCatalogProducts(products).map(p => [
    p.platform, skuFamily(p.sku), p.sku, p.nome, p.variacao,
    p.capa_code, p.gtin, p.id, p.created_at
  ]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
}
