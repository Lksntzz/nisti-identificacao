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

async function addColumnIfMissing(env, sql) {
  try {
    await env.DB.prepare(sql).run();
  } catch (error) {
    if (!/duplicate column name/i.test(String(error?.message || ''))) throw error;
  }
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

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS recognition_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      product_id INTEGER,
      capa_code TEXT,
      sku TEXT,
      confidence REAL,
      retrieval_score REAL,
      identified_by TEXT,
      error_message TEXT,
      total_ms INTEGER NOT NULL DEFAULT 0,
      embedding_ms INTEGER,
      gemini_ms INTEGER,
      retrieval_top1 REAL,
      retrieval_top1_code TEXT,
      retrieval_top2 REAL,
      retrieval_top2_code TEXT,
      retrieval_margin REAL,
      candidate_count INTEGER,
      verification_mode TEXT,
      accepted_by TEXT,
      model TEXT
    )
  `).run();

  const extraColumns = [
    'ALTER TABLE recognition_events ADD COLUMN product_id INTEGER',
    'ALTER TABLE recognition_events ADD COLUMN retrieval_top1_code TEXT',
    'ALTER TABLE recognition_events ADD COLUMN retrieval_top2_code TEXT',
    'ALTER TABLE recognition_events ADD COLUMN candidate_count INTEGER',
    'ALTER TABLE recognition_events ADD COLUMN model TEXT'
  ];
  for (const sql of extraColumns) await addColumnIfMissing(env, sql);

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recognition_events_created_at ON recognition_events(created_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recognition_events_kind_created_at ON recognition_events(kind, created_at DESC)`).run();
  tableReady = true;
}

function classify(responseStatus, data) {
  const hasResult = Boolean(data?.product || (Array.isArray(data?.products) && data.products.length));
  if (responseStatus >= 200 && responseStatus < 300 && hasResult) return 'success';
  if (responseStatus === 422) return 'unmatched';
  if (responseStatus === 400 && data?.error === 'Foto da capa obrigatória') return 'invalid';
  return 'system_error';
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function recordRecognitionAttempt(env, responseStatus, data) {
  try {
    await ensureRecognitionMetrics(env);
    const kind = classify(responseStatus, data);
    if (kind === 'invalid') return;

    const day = saoPauloDay();
    const now = new Date().toISOString();
    const performance = data?.performance || {};
    const product = data?.product || null;
    const success = kind === 'success' ? 1 : 0;
    const unmatched = kind === 'unmatched' ? 1 : 0;
    const systemError = kind === 'system_error' ? 1 : 0;
    const embedding = Number.isFinite(Number(performance.embedding_and_index_ms)) ? 1 : 0;
    const generation = Number.isFinite(Number(performance.gemini_ms)) ? 1 : 0;
    const totalMs = Math.max(0, Math.round(Number(performance.total_ms) || 0));
    const errorMessage = kind === 'success' ? null : String(data?.error || `Erro HTTP ${responseStatus}`).slice(0, 500);
    const capaCode = String(data?.capa_code || product?.capa_code || '').trim().toUpperCase() || null;
    const sku = String(product?.sku || '').trim().toUpperCase() || null;

    await env.DB.prepare(`
      INSERT INTO recognition_daily (
        day, attempts, successes, unmatched, system_errors,
        embedding_requests, generation_requests, total_ms,
        last_success_at, last_unmatched_at, last_error_at, last_error_message, updated_at
      ) VALUES (?,1,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
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
      systemError ? errorMessage : null
    ).run();

    await env.DB.prepare(`
      INSERT INTO recognition_events (
        day, kind, http_status, product_id, capa_code, sku,
        confidence, retrieval_score, identified_by, error_message,
        total_ms, embedding_ms, gemini_ms,
        retrieval_top1, retrieval_top1_code, retrieval_top2, retrieval_top2_code, retrieval_margin,
        candidate_count, verification_mode, accepted_by, model
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      day,
      kind,
      Number(responseStatus || 0),
      product?.id || null,
      capaCode,
      sku,
      numberOrNull(data?.confidence ?? performance.gemini_confidence),
      numberOrNull(data?.retrieval_score),
      data?.identified_by || null,
      errorMessage,
      totalMs,
      numberOrNull(performance.embedding_and_index_ms),
      numberOrNull(performance.gemini_ms),
      numberOrNull(performance.retrieval_top1),
      performance.retrieval_top1_code || null,
      numberOrNull(performance.retrieval_top2),
      performance.retrieval_top2_code || null,
      numberOrNull(performance.retrieval_margin),
      numberOrNull(performance.candidate_count),
      performance.verification_mode || null,
      performance.accepted_by || null,
      performance.model || null
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

function normalizeEvent(row) {
  const imageVersion = String(row?.image_key || '').split('/').pop();
  return {
    id: Number(row?.id || 0),
    created_at: row?.created_at || null,
    day: row?.day || null,
    kind: row?.kind || 'unknown',
    http_status: Number(row?.http_status || 0),
    product_id: row?.product_id ? Number(row.product_id) : null,
    capa_code: row?.capa_code || null,
    sku: row?.sku || null,
    confidence: numberOrNull(row?.confidence),
    retrieval_score: numberOrNull(row?.retrieval_score),
    identified_by: row?.identified_by || null,
    error_message: row?.error_message || null,
    total_ms: Number(row?.total_ms || 0),
    embedding_ms: numberOrNull(row?.embedding_ms),
    gemini_ms: numberOrNull(row?.gemini_ms),
    retrieval_top1: numberOrNull(row?.retrieval_top1),
    retrieval_top1_code: row?.retrieval_top1_code || null,
    retrieval_top2: numberOrNull(row?.retrieval_top2),
    retrieval_top2_code: row?.retrieval_top2_code || null,
    retrieval_margin: numberOrNull(row?.retrieval_margin),
    candidate_count: numberOrNull(row?.candidate_count),
    verification_mode: row?.verification_mode || null,
    accepted_by: row?.accepted_by || null,
    model: row?.model || null,
    image_url: row?.product_id && imageVersion
      ? `/api/images/${row.product_id}?v=${encodeURIComponent(imageVersion)}`
      : null
  };
}

export async function readRecognitionEvents(env, options = {}) {
  await ensureRecognitionMetrics(env);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
  const kind = String(options.kind || '').trim();
  const issuesOnly = Boolean(options.issuesOnly);
  let where = '';
  const binds = [];

  if (issuesOnly) {
    where = `WHERE e.kind IN ('unmatched','system_error')`;
  } else if (['success', 'unmatched', 'system_error'].includes(kind)) {
    where = 'WHERE e.kind=?';
    binds.push(kind);
  }

  const statement = env.DB.prepare(`
    SELECT e.*, p.image_key
    FROM recognition_events e
    LEFT JOIN products p ON p.id=e.product_id
    ${where}
    ORDER BY e.id DESC
    LIMIT ?
  `);
  const { results } = await statement.bind(...binds, limit).all();
  return (results || []).map(normalizeEvent);
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
