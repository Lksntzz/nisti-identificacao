function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function naturalCompare(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
}

export function collectionZipFilename(collection) {
  const safeName = normalizeText(collection?.name)
    .replaceAll(' ', '-')
    .slice(0, 80) || 'colecao';
  return `etiquetas-${safeName}.zip`;
}

export function buildEanCollections(items) {
  const groups = new Map();

  for (const item of items || []) {
    const titleKey = normalizeText(item?.nome);
    const familyKey = normalizeText(item?.miolo_code || String(item?.sku || '').split('_')[0]);
    const gtin = String(item?.gtin || '').replace(/\D/g, '');
    const coverCode = normalizeText(item?.capa_code);
    if (!item?.active || !titleKey || !familyKey || gtin.length !== 13 || !coverCode) continue;

    const key = `${familyKey}::${titleKey}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: String(item.nome).trim(),
        family: String(item.miolo_code || '').trim().toUpperCase(),
        items: [],
        gtins: new Set(),
        covers: new Set(),
        platforms: new Set()
      });
    }

    const group = groups.get(key);
    if (group.gtins.has(gtin)) continue;
    group.gtins.add(gtin);
    group.covers.add(coverCode);
    for (const platform of item.platforms || []) group.platforms.add(platform);
    group.items.push(item);
  }

  return [...groups.values()]
    .filter(group => group.items.length >= 2 && group.covers.size >= 2)
    .map(group => ({
      id: group.id,
      name: group.name,
      family: group.family,
      coverCount: group.covers.size,
      platforms: [...group.platforms].sort(naturalCompare),
      items: group.items.sort((left, right) => (
        naturalCompare(left.capa_code, right.capa_code) || naturalCompare(left.sku, right.sku)
      ))
    }))
    .sort((left, right) => naturalCompare(left.name, right.name));
}
