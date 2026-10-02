import { supabaseRpc } from './supabase-read-store.js';

export async function reserveGeminiBudget(env, lane, limitPerMinute) {
  const limit = Math.max(1, Math.floor(Number(limitPerMinute || 1)));
  const windowMinute = Math.floor(Date.now() / 60000);
  const cleanLane = String(lane || 'default').trim() || 'default';

  return (await supabaseRpc(env, 'nisti_reserve_gemini_budget', {
    p_lane: cleanLane,
    p_window_minute: windowMinute,
    p_limit: limit
  })) === true;
}
