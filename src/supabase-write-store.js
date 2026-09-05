import { supabaseRpc } from './supabase-read-store.js';

const WRITE_MODES = new Set(['off', 'mirror']);

export function supabaseWriteMode(env) {
  const mode = String(env?.SUPABASE_WRITE_MODE || 'off').trim().toLowerCase() || 'off';
  if (!WRITE_MODES.has(mode)) {
    throw new Error(`SUPABASE_WRITE_MODE inválido para a fase atual: ${mode}`);
  }
  return mode;
}

export function supabaseMirrorWritesRequested(env) {
  return supabaseWriteMode(env) === 'mirror';
}

export async function mirrorSupabaseRpc(env, rpcName, args, label = rpcName) {
  const mode = supabaseWriteMode(env);
  if (mode === 'off') return { attempted: false, ok: true };

  try {
    await supabaseRpc(env, rpcName, args);
    return { attempted: true, ok: true };
  } catch (error) {
    console.error(`[Supabase mirror] ${label} falhou`, {
      code: error?.code || 'supabase_mirror_error',
      status: Number(error?.status || 0) || null,
      message: error?.message || String(error)
    });
    return { attempted: true, ok: false, error };
  }
}
