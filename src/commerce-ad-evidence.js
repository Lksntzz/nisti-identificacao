// Dados com vínculo exclusivo não comprovam ausência de vendas nas demais variações.
export function identifiedVariationCoverage(item, days) {
  const source = days === 0 ? item?.month_variations : item?.identified_variations;
  const variations = Array.isArray(source) ? source : [];
  const total = Math.max(0, Number(item?.total_variations) || 0);
  const counted = new Set();
  for (const [i, variation] of variations.entries()) {
    if (variation?.units == null) continue;
    const units = Number(variation.units);
    if (!Number.isFinite(units) || units <= 0) continue;
    const key = variation?.id == null ? 'row-' + i : 'id-' + String(variation.id);
    counted.add(key);
  }
  return { identified: counted.size, total, variations };
}

export function listingClassificationCoverage(kpis, days) {
  const active = Math.max(0, Number(kpis?.active_ads) || 0);
  const identified = Math.max(0, Number(
    days === 0 ? kpis?.month_linked_ads : kpis?.identified_ads
  ) || 0);
  return {
    active, identified: Math.min(active, identified),
    unclassified: Math.max(0, active - identified)
  };
}

// Janelas móveis do Gestor usam o último dia importado, não a data de hoje.
// Evita rotular a consulta como "últimos 30 dias corridos" quando faltam vendas recentes.
export function importedWindowDescription(data, days, formatDate) {
  if (!data?.period_start || !data?.period_end) return 'Período conforme os filtros selecionados';
  const start = formatDate(data.period_start);
  const end = formatDate(data.period_end);
  if (days > 0 && data.source_kind === 'DAILY_SKU_PARTIAL') {
    const endDate = formatDate(data.data_through || data.period_end);
    return 'Janela de ' + days + ' dias disponíveis: ' + start + ' a ' + end +
      ' · última data importada: ' + endDate + ' (não é um período contado a partir de hoje)';
  }
  return 'Período analisado: ' + start + ' a ' + end;
}
