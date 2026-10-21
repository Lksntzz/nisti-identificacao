// Interpretacao de CSV de cadastro: funcao pura, sem dependencias do React ou do navegador.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

export function catalogRowsFromCsv(text) {
  const parsed = parseCsv(text);
  if (!parsed.length) return [];
  const headers = parsed[0].map(value => String(value || '').trim().toLowerCase());
  const indexOf = (...names) => headers.findIndex(header => names.includes(header));
  const skuIndex = indexOf('sku');
  const gtinIndex = indexOf('ean', 'ean-13', 'gtin', 'gtin-13');
  const hasHeader = skuIndex >= 0;
  const valueAt = (row, index, fallback = '') => String(index >= 0 ? row[index] : fallback || '').trim();

  return (hasHeader ? parsed.slice(1) : parsed).map(row => ({
    nome: hasHeader ? valueAt(row, indexOf('nome', 'produto', 'nome do produto')) : String(row[2] || row[9] || '').trim(),
    variacao: hasHeader ? valueAt(row, indexOf('variacao', 'variação', 'capa')) : String(row[3] || row[13] || '').trim(),
    platform: hasHeader ? valueAt(row, indexOf('plataforma', 'platform')) : String(row[4] || row[11] || '').trim(),
    sku: hasHeader ? valueAt(row, skuIndex) : String(row[5] || row[14] || '').trim(),
    gtin: hasHeader ? valueAt(row, gtinIndex) : String(row[7] || '').replace(/\D/g, '').trim(),
    link: hasHeader ? valueAt(row, indexOf('link', 'url')) : String(row[6] || row[12] || '').trim()
  })).filter(row => row.sku && row.sku.toUpperCase() !== 'SKU');
}
