import {
  SupabaseReadError,
  supabaseReadsRequested,
  supabaseRpc
} from './supabase-read-store.js';

let schemaReady = false;

async function ensureD1Schema(env) {
  if (schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS gemini_call_budget (
      lane TEXT NOT NULL,
      window_minute INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (lane, window_minute)
    )
  `).run();
  schemaReady = true;
}

async function reserveD1Budget(env, lane, limit, windowMinute) {
  if (!env?.DB) throw new Error('Binding DB não configurado para fallback do budget Gemini.');
  await ensureD1Schema(env);

  const result = await env.DB.prepare(`
    INSERT INTO gemini_call_budget (lane, window_minute, used)
    VALUES (?, ?, 1)
    ON CONFLICT(lane, window_minute) DO UPDATE SET
      used = gemini_call_budget.used + 1
    WHERE gemini_call_budget.used < ?
  `).bind(lane, windowMinute, limit).run();

  if (Math.random() < 0.02) {
    const cutoff = windowMinute - 120;
    env.DB.prepare(`DELETE FROM gemini_call_budget WHERE window_minute < ?`)
      .bind(cutoff)
      .run()
      .catch(() => {});
  }

  return Number(result?.meta?.changes || 0) > 0;
}

export async function reserveGeminiBudget(env, lane, limitPerMinute) {
  const limit = Math.max(1, Math.floor(Number(limitPerMinute || 1)));
  const windowMinute = Math.floor(Date.now() / 60000);
  const cleanLane = String(lane || 'default').trim() || 'default';

  if (!supabaseReadsRequested(env)) {
    return reserveD1Budget(env, cleanLane, limit, windowMinute);
  }

  try {
    return (await supabaseRpc(env, 'nisti_reserve_gemini_budget', {
      p_lane: cleanLane,
      p_window_minute: windowMinute,
      p_limit: limit
    })) === true;
  } catch (error) {
    if (error instanceof SupabaseReadError && error.fallbackEligible) {
      console.warn(`[Supabase] budget Gemini indisponível; usando fallback D1 temporário: ${error.code}`);
      return reserveD1Budget(env, cleanLane, limit, windowMinute);
    }
    throw error;
  }
}
