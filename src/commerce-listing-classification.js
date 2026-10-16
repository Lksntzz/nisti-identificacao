// Situação de vendas e indicadores são dimensões independentes.
// Um anúncio pode ter vendas e estar em crescimento ou com baixo volume.
export function listingSalesSituation(item) {
  if (!item?.ready) return 'PENDING';
  return Number(item.units) > 0 ? 'SOLD' : 'ZERO';
}

export function listingPerformanceIndicators(item) {
  if (listingSalesSituation(item) !== 'SOLD') return [];
  const indicators = [];
  if (item.growing === true) indicators.push('RISING');
  if (item.low_sales === true) indicators.push('LOW');
  return indicators;
}
