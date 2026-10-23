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
