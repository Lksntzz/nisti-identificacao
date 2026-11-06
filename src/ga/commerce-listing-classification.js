// A situação de vendas não depende de tendência ou quantidade relativa de vendas.
// Sem cobertura confiável, preservamos o estado pendente (nunca presumimos zero).
export function listingSalesSituation(item) {
  if (!item?.ready) return 'PENDING';
  return Number(item.units) > 0 ? 'SOLD' : 'ZERO';
}
