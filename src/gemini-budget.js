let schemaReady = false;

async function ensureSchema(env) {
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

export async function reserveGeminiBudget(env, lane, limitPerMinute) {
  const limit = Math.max(1, Number(limitPerMinute || 1));
  const windowMinute = Math.floor(Date.now() / 60000);
  await ensureSchema(env);

  const result = await env.DB.prepare(`
    INSERT INTO gemini_call_budget (lane, window_minute, used)
    VALUES (?, ?, 1)
    ON CONFLICT(lane, window_minute) DO UPDATE SET
      used = gemini_call_budget.used + 1
    WHERE gemini_call_budget.used < ?
  `).bind(String(lane || 'default'), windowMinute, limit).run();

  if (Math.random() < 0.02) {
    const cutoff = windowMinute - 120;
    env.DB.prepare(`DELETE FROM gemini_call_budget WHERE window_minute < ?`)
      .bind(cutoff)
      .run()
      .catch(() => {});
  }

  return Number(result?.meta?.changes || 0) > 0;
}
