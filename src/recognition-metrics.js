const TIMEZONE = 'America/Sao_Paulo';
let tableReady = false;

function saoPauloDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function ensureRecognitionMetrics(env) {
  if (tableReady) return;
  if (!env?.DB) throw new Error('Binding DB não configurado');
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS recognition_daily (
      day TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      successes INTEGER NOT NULL DEFAULT 0,
      unmatched INTEGER NOT NULL DEFAULT 0,
      system_errors INTEGER NOT NULL DEFAULT 0,
      embedding_requests INTEGER NOT NULL DEFAULT 0,
      generation_requests INTEGER NOT NULL DEFAULT 0,
      total_ms INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT,
      last_unmatched_at TEXT,
      last_error_at TEXT,
      last_error_message TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  tableReady = true;
}

function classify(responseStatus, data) {
  const hasResult = Boolean(data?.product || (Array.isArray(data?.products) && data.products.length));
  if (responseStatus >= 200 && responseStatus < 300 && hasResult) return 'success';
  if (responseStatus === 422) return 'unmatched';
  if (responseStatus === 400 && data?.error === 'Foto da capa obrigatória') return 'invalid';
  return 'system_error';
}

export async function recordRecognitionAttempt(env, responseStatus, data) {
  try {
    await ensureRecognitionMetrics(env);
    const kind = classify(responseStatus, data);
    if (kind === 'invalid') return;

    const day = saoPauloDay();
    const now = new Date().toISOString();
    const performance = data?.performance || {};
    const success = kind === 'success' ? 1 : 0;
    const unmatched = kind === 'unmatched' ? 1 : 0;
    const systemError = kind === 'system_error' ? 1 : 0;
    const embedding = Number.isFinite(Number(performance.embedding_and_index_ms)) ? 1 : 0;
    const generation = Number.isFinite(Number(performance.gemini_ms)) ? 1 : 0;
    const totalMs = Math.max(0, Math.round(Number(performance.total_ms) || 0));
    const errorMessage = systemError ? String(data?.error || `Erro HTTP ${responseStatus}`).slice(0, 500) : null;

    await env.DB.prepare(`
      INSERT INTO recognition_daily (
        day, attempts, successes, unmatched, system_errors,
        embedding_requests, generation_requests, total_ms,
        last_success_at, last_unmatched_at, last_error_at, last_error_message, updated_at
      ) VALUES (?,1,?,?,?,?,?,?,?, ?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(day) DO UPDATE SET
        attempts = recognition_daily.attempts + 1,
        successes = recognition_daily.successes + excluded.successes,
        unmatched = recognition_daily.unmatched + excluded.unmatched,
        system_errors = recognition_daily.system_errors + excluded.system_errors,
        embedding_requests = recognition_daily.embedding_requests + excluded.embedding_requests,
        generation_requests = recognition_daily.generation_requests + excluded.generation_requests,
        total_ms = recognition_daily.total_ms + excluded.total_ms,
        last_success_at = COALESCE(excluded.last_success_at, recognition_daily.last_success_at),
        last_unmatched_at = COALESCE(excluded.last_unmatched_at, recognition_daily.last_unmatched_at),
        last_error_at = COALESCE(excluded.last_error_at, recognition_daily.last_error_at),
        last_error_message = COALESCE(excluded.last_error_message, recognition_daily.last_error_message),
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      day,
      success,
      unmatched,
      systemError,
      embedding,
      generation,
      totalMs,
      success ? now : null,
      unmatched ? now : null,
      systemError ? now : null,
      errorMessage
    ).run();
  } catch (error) {
    console.error('Falha ao registrar métrica de reconhecimento', error);
  }
}

function normalize(row) {
  return {
    attempts: Number(row?.attempts || 0),
    successes: Number(row?.successes || 0),
    unmatched: Number(row?.unmatched || 0),
    system_errors: Number(row?.system_errors || 0),
    embedding_requests: Number(row?.embedding_requests || 0),
    generation_requests: Number(row?.generation_requests || 0),
    total_ms: Number(row?.total_ms || 0),
    last_success_at: row?.last_success_at || null,
    last_unmatched_at: row?.last_unmatched_at || null,
    last_error_at: row?.last_error_at || null,
    last_error_message: row?.last_error_message || null
  };
}

export async function readRecognitionMetrics(env) {
  await ensureRecognitionMetrics(env);
  const today = saoPauloDay();
  const todayRow = normalize(await env.DB.prepare(`SELECT * FROM recognition_daily WHERE day=?`).bind(today).first());
  const totalRow = normalize(await env.DB.prepare(`
    SELECT
      SUM(attempts) AS attempts,
      SUM(successes) AS successes,
      SUM(unmatched) AS unmatched,
      SUM(system_errors) AS system_errors,
      SUM(embedding_requests) AS embedding_requests,
      SUM(generation_requests) AS generation_requests,
      SUM(total_ms) AS total_ms
    FROM recognition_daily
  `).first());
  const first = await env.DB.prepare(`SELECT MIN(day) AS day FROM recognition_daily WHERE attempts > 0`).first();
  const latestError = await env.DB.prepare(`
    SELECT last_error_at, last_error_message
    FROM recognition_daily
    WHERE last_error_at IS NOT NULL
    ORDER BY day DESC
    LIMIT 1
  `).first();
  const latestSuccess = await env.DB.prepare(`
    SELECT last_success_at
    FROM recognition_daily
    WHERE last_success_at IS NOT NULL
    ORDER BY day DESC
    LIMIT 1
  `).first();

  return {
    timezone: TIMEZONE,
    monitoring_started_on: first?.day || today,
    today: todayRow,
    since_monitoring: totalRow,
    average_ms_today: todayRow.attempts > 0 ? Math.round(todayRow.total_ms / todayRow.attempts) : 0,
    latest_success_at: latestSuccess?.last_success_at || null,
    latest_error_at: latestError?.last_error_at || null,
    latest_error_message: latestError?.last_error_message || null
  };
}
