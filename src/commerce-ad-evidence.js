// Nunca misturar a janela mensal Shopee com janelas móveis de 7/30/60/90 dias.
// Zero sem vínculo exclusivo é ausência de identificação, não venda zero comprovada.
export function listingLinkedSalesForPeriod(item,days) {
  if(item?.source!=='SHOPEE')return {hasSales:false,units:null,revenue:null};
  const useMonth=days===0&&item?.month_linked_units!=null;
  const sourceUnits=useMonth?item.month_linked_units:item?.identified_units;
  const sourceRevenue=useMonth?item.month_linked_revenue:item?.identified_revenue;
  const units=sourceUnits==null?NaN:Number(sourceUnits);
  const revenue=sourceRevenue==null?NaN:Number(sourceRevenue);
  if(!Number.isFinite(units)||units<=0||!Number.isFinite(revenue)||revenue<0)
    return {hasSales:false,units:null,revenue:null};
  return {hasSales:true,units,revenue};
}

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

// Summary of active listings, not of variations. Marketplace sales tied to a
// listing ID and Shopee sales identified through SKU are disjoint groups.
// Shopee without a reliable link is UNKNOWN, never a proven zero.
export function listingPlatformSalesBreakdown(kpis, days, sourceKind) {
  const active=Math.max(0,Number(kpis?.active_ads)||0);
  const mixed=sourceKind==='MIXED_LISTING_SKU_PARTIAL';
  const partial=mixed||sourceKind==='MONTHLY_SKU_PARTIAL'||
    sourceKind==='DAILY_SKU_PARTIAL';
  const covered=Math.min(active,Math.max(0,Number(kpis?.covered_ads)||0));
  const marketplaceWithSales=mixed
    ?Math.min(covered,Math.max(0,Number(kpis?.sold_ads)||0)):0;
  const shopeeActive=partial?(mixed?active-covered:active):0;
  const sourceSales=days===0&&sourceKind==='MONTHLY_SKU_PARTIAL'
    ?kpis?.month_linked_ads:kpis?.identified_ads;
  const shopeeWithSales=partial
    ?Math.min(shopeeActive,Math.max(0,Number(sourceSales)||0)):0;
  const identified=partial
    ?Math.min(active,marketplaceWithSales+shopeeWithSales)
    :Math.min(active,Math.max(0,Number(kpis?.sold_ads)||0));
  const marketplaceWithoutSales=mixed?covered-marketplaceWithSales:0;
  const shopeeWithoutLink=partial?shopeeActive-shopeeWithSales:0;
  return {active,identified,withoutIdentified:active-identified,
    marketplaceWithSales,marketplaceWithoutSales,
    shopeeWithSales,shopeeWithoutLink};
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

// Distingue total bruto importado no mês dos subtotais associados a anúncios.
// Janelas móveis não presumem cobertura global quando ela não foi comprovada.
export function shopeeSalesTotals(data,days){
  const mixed=data?.source_kind==='MIXED_LISTING_SKU_PARTIAL';
  if(!mixed&&!['MONTHLY_SKU_PARTIAL','DAILY_SKU_PARTIAL'].includes(data?.source_kind))return null;
  const monthly=days===0?data.imported_month:null;
  const rawUnits=days===0&&!mixed?data.kpis?.month_linked_units:data.kpis?.identified_units;
  const rawRevenue=days===0&&!mixed?data.kpis?.month_linked_revenue:data.kpis?.identified_revenue;
  if(rawUnits==null||rawRevenue==null)return null;
  const linkedUnits=Number(rawUnits),linkedRevenue=Number(rawRevenue);
  if(!Number.isFinite(linkedUnits)||!Number.isFinite(linkedRevenue)||
    linkedUnits<0||linkedRevenue<0)return null;
  // Combined platform views have two disjoint, verified components:
  // ML sales identified by real listing ID, and Shopee sales identified
  // by SKU. Neither component is a proof of all Shopee sales.
  const verifiedUnits=mixed?Number(data.kpis?.units):0;
  const verifiedRevenue=mixed?Number(data.kpis?.revenue):0;
  if(!Number.isFinite(verifiedUnits)||!Number.isFinite(verifiedRevenue)||
     verifiedUnits<0||verifiedRevenue<0)return null;
  const coveredUnits=linkedUnits+verifiedUnits;
  const coveredRevenue=Math.round((linkedRevenue+verifiedRevenue)*100)/100;
  const importedUnits=monthly?.units==null?NaN:Number(monthly.units);
  const importedRevenue=monthly?.revenue==null?NaN:Number(monthly.revenue);
  const hasImportedTotal=Number.isFinite(importedUnits)&&Number.isFinite(importedRevenue)&&
    importedUnits>=coveredUnits&&importedRevenue>=coveredRevenue-0.01;
  return {
    hasImportedTotal,
    units:hasImportedTotal?importedUnits:coveredUnits,
    revenue:hasImportedTotal?importedRevenue:coveredRevenue,
    linkedUnits,linkedRevenue,
    ...(mixed?{verifiedUnits,verifiedRevenue}:{})
  };
}

export function shopeeMonthlyImportCoverage(data){
  if(!data?.imported_month||data?.source_kind!=='MONTHLY_SKU_PARTIAL')return null;
  const importedUnits=Number(data.imported_month.units);
  const importedRevenue=Number(data.imported_month.revenue);
  const identifiedUnits=Number(data?.kpis?.month_linked_units);
  const identifiedRevenue=Number(data?.kpis?.month_linked_revenue);
  if(!Number.isFinite(importedUnits)||importedUnits<=0||
     !Number.isFinite(identifiedUnits)||identifiedUnits<0||
     !Number.isFinite(importedRevenue)||!Number.isFinite(identifiedRevenue))return null;
  const matchedUnits=Math.min(importedUnits,identifiedUnits);
  const remainingUnits=Math.max(0,importedUnits-matchedUnits);
  const percentage=Math.min(100,Math.max(0,matchedUnits/importedUnits*100));
  return {
    importedUnits,matchedUnits,remainingUnits,percentage,
    importedRevenue,identifiedRevenue,
    remainingRevenue:Math.max(0,Math.round((importedRevenue-identifiedRevenue)*100)/100),
    importedThrough:data.imported_month.period_end||null,
    // A month-level coverage ratio never certifies each individual listing.
    perListingComplete:false
  };
}
