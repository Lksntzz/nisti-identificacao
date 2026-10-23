// Política do cache local do scanner (histórico de EAN no aparelho).
// O cache só pode substituir o servidor quando o servidor está INACESSÍVEL
// (falha de rede/timeout ou erro 5xx/408/429). Respostas definitivas como
// 404 (EAN não cadastrado), 401/403 (PIN/sessão) ou 400 nunca usam o cache,
// para não exibir um produto desvinculado ou contornar o PIN.
export const GTIN_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function serverUnavailable(status, networkError) {
  if (networkError) return true;
  const code = Number(status || 0);
  return code === 0 || code === 408 || code === 429 || code >= 500;
}

export function findFreshCachedEntry(history, gtin, now = Date.now(), maxAgeMs = GTIN_CACHE_MAX_AGE_MS) {
  const wanted = String(gtin || '');
  for (const entry of Array.isArray(history) ? history : []) {
    if (String(entry?.gtin || '') !== wanted || !entry?.product) continue;
    const scannedAt = Date.parse(entry?.scanned_at || '');
    if (!Number.isFinite(scannedAt)) continue;
    const age = now - scannedAt;
    if (age < 0 || age > maxAgeMs) continue;
    return entry;
  }
  return null;
}

export function withoutGtin(history, gtin) {
  const wanted = String(gtin || '');
  return (Array.isArray(history) ? history : []).filter(entry => String(entry?.gtin || '') !== wanted);
}

export function cachedLookupWarning(entry) {
  const when = new Date(entry?.scanned_at || '');
  const label = Number.isNaN(when.getTime())
    ? 'leitura anterior'
    : when.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `Sem conexão com o servidor. Exibindo dados salvos neste aparelho (${label}), NÃO confirmados. Confira o produto antes de expedir.`;
}
