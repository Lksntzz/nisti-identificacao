const TIMEZONE = 'America/Sao_Paulo';

function localDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const ALLOWED_COUNTERS = new Set([
  'gemini_embedding_calls',
  'gemini_generation_calls',
  'vectorize_queries',
  'vectorize_upsert_vectors'
]);

export async function incrementSystemUsage(env, counter, amount = 1) {
  if (!env?.DB || !ALLOWED_COUNTERS.has(counter)) return;
  const delta = Math.max(0, Math.trunc(Number(amount) || 0));
  if (!delta) return;
  const day = localDay();
  try {
    await env.DB.prepare(`
      INSERT INTO system_usage_daily (day, ${counter}, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(day) DO UPDATE SET
        ${counter} = system_usage_daily.${counter} + excluded.${counter},
        updated_at = CURRENT_TIMESTAMP
    `).bind(day, delta).run();
  } catch (error) {
    console.warn(`Falha ao registrar telemetria ${counter}`, error?.message || error);
  }
}

export async function readSystemUsageToday(env) {
  if (!env?.DB) return null;
  const day = localDay();
  try {
    const row = await env.DB.prepare(`
      SELECT day, gemini_embedding_calls, gemini_generation_calls,
             vectorize_queries, vectorize_upsert_vectors, updated_at
      FROM system_usage_daily
      WHERE day=?
    `).bind(day).first();
    return {
      day,
      gemini_embedding_calls: Number(row?.gemini_embedding_calls || 0),
      gemini_generation_calls: Number(row?.gemini_generation_calls || 0),
      vectorize_queries: Number(row?.vectorize_queries || 0),
      vectorize_upsert_vectors: Number(row?.vectorize_upsert_vectors || 0),
      updated_at: row?.updated_at || null
    };
  } catch {
    return {
      day,
      gemini_embedding_calls: 0,
      gemini_generation_calls: 0,
      vectorize_queries: 0,
      vectorize_upsert_vectors: 0,
      updated_at: null,
      unavailable: true
    };
  }
}

export { TIMEZONE as SYSTEM_USAGE_TIMEZONE };
