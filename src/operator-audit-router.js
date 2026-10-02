import app from './platform-runtime-router.js';
import { mirrorSuccessfulMutation } from './supabase-mutation-mirror.js';
import { SupabasePrimaryWriteError } from './supabase-write-store.js';
import { recordAdminActivityFromResponse } from './system-notifications.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function json(data, status = 200, extraHeaders = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(extraHeaders || {})
    }
  });
}

function isMutatingApiRequest(url, request) {
  return url.pathname.startsWith('/api/') && MUTATING_METHODS.has(String(request.method || '').toUpperCase());
}

export function cutoverWriteFreezeEnabled(env) {
  const raw = String(env?.SUPABASE_CUTOVER_WRITE_FREEZE ?? '0').trim();
  if (raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`SUPABASE_CUTOVER_WRITE_FREEZE inválido: ${raw}`);
}

function cutoverFreezeResponse(configError = null) {
  return json({
    error: configError
      ? 'Configuração de manutenção inválida. Escritas bloqueadas por segurança.'
      : 'Sistema temporariamente em manutenção para sincronização do banco. Tente novamente em instantes.',
    technical_error: configError ? 'cutover_write_freeze_invalid_config' : 'cutover_write_freeze',
    retryable: true
  }, 503, {
    'retry-after': '60',
    'x-nisti-maintenance': 'supabase-cutover-write-freeze'
  });
}

function primaryWriteFailureResponse(error) {
  console.error(JSON.stringify({
    message: 'Supabase primary write failed',
    code: error?.code || 'supabase_primary_write_failed',
    status: Number(error?.status || 0) || null
  }));
  return json({
    error: 'A alteração não foi confirmada no banco principal. A produção permanece protegida.',
    technical_error: 'supabase_primary_write_failed',
    retryable: false
  }, 503, {
    'x-nisti-write-authority': 'supabase'
  });
}

function scheduleAdminActivity(ctx, request, response, env) {
  const task = recordAdminActivityFromResponse(request, response, env)
    .catch(error => console.error('[Admin notifications] Falha ao registrar atividade', error?.message || error));
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else return task;
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isMutatingApiRequest(url, request)) {
      try {
        if (cutoverWriteFreezeEnabled(env)) return cutoverFreezeResponse();
      } catch {
        return cutoverFreezeResponse(true);
      }
    }

    let response;
    try {
      response = await app.fetch(request, env, ctx);
    } catch (error) {
      if (error instanceof SupabasePrimaryWriteError) return primaryWriteFailureResponse(error);
      throw error;
    }

    try {
      await mirrorSuccessfulMutation(request, response, env);
    } catch (error) {
      return primaryWriteFailureResponse(error);
    }

    const activity = scheduleAdminActivity(ctx, request, response, env);
    if (activity) await activity;
    return response;
  },

  async scheduled() {}
};
