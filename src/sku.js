export const WIREO_COLORS = { P: 'Preto', B: 'Branco', R: 'Rose Gold' };
export const ACCESSORY_COLORS = { P: 'Preto', B: 'Branco', A: 'Azul', R: 'Rosa', V: 'Verde', L: 'Laranja' };

export function parseSku(sku) {
  const value = String(sku || '').trim().toUpperCase();
  const parts = value.split('_');
  if (parts.length !== 3) throw new Error('SKU deve seguir MIOLO_CAPA_ACABAMENTO');

  const [mioloCode, capaCode, acabamentoCode] = parts;
  if (!mioloCode || !capaCode || acabamentoCode.length !== 3) {
    throw new Error('SKU inválido');
  }

  const [wireoCode, tasselCode, elasticoCode] = acabamentoCode;
  if (!WIREO_COLORS[wireoCode]) throw new Error(`Wire-O desconhecido: ${wireoCode}`);
  if (tasselCode !== 'X' && !ACCESSORY_COLORS[tasselCode]) throw new Error(`Tassel desconhecido: ${tasselCode}`);
  if (!ACCESSORY_COLORS[elasticoCode]) throw new Error(`Elástico desconhecido: ${elasticoCode}`);

  return {
    sku: value,
    mioloCode,
    capaCode,
    acabamentoCode,
    wireoCode,
    tasselCode,
    elasticoCode,
    wireo: WIREO_COLORS[wireoCode],
    tassel: tasselCode === 'X' ? 'Sem tassel' : ACCESSORY_COLORS[tasselCode],
    elastico: ACCESSORY_COLORS[elasticoCode],
  };
}
