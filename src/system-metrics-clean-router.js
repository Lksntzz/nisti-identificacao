import app from './core-router.js';
import { readRecognitionEvents, readRecognitionMetrics } from './recognition-metrics.js';

const FREE_D1_LIMIT_BYTES = 500 * 1024 * 1024;
const PAID_D1_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function handleSystemMetrics(env) {
  if (!env.DB) throw new Error('Binding DB não configurado');

  const productsProbe = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN image_key IS NOT NULL THEN 1 ELSE 0 END) AS with_image
    FROM products
  `).all();
  const productStats = productsProbe.results?.[0] || {};
  const sizeBytes = Number(productsProbe.meta?.size_after || 0);
  const embeddingStats = await env.DB.prepare(`SELECT COUNT(*) AS total FROM cover_embeddings`).first();
  const recognition = await readRecognitionMetrics(env);

  const configuredLimitMb = Number(env.D1_DATABASE_LIMIT_MB || 0);
  const configuredLimitBytes = configuredLimitMb > 0
    ? Math.round(configuredLimitMb * 1024 * 1024)
    : null;

  return json({
    ok: true,
    measured_at: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    database: {
      status: 'online',
      used_bytes: sizeBytes,
      products: Number(productStats.total || 0),
      products_with_image: Number(productStats.with_image || 0),
      cover_embeddings: Number(embeddingStats?.total || 0),
      query_rows_read: Number(productsProbe.meta?.rows_read || 0),
      served_by_colo: productsProbe.meta?.served_by_colo || null,
      served_by_region: productsProbe.meta?.served_by_region || null,
      configured_limit_bytes: configuredLimitBytes,
      configured_percent: configuredLimitBytes && sizeBytes
        ? (sizeBytes / configuredLimitBytes) * 100
        : null,
      documented_limits: {
        workers_free_bytes: FREE_D1_LIMIT_BYTES,
        workers_paid_bytes: PAID_D1_LIMIT_BYTES
      },
      percent_of_free_limit: sizeBytes ? (sizeBytes / FREE_D1_LIMIT_BYTES) * 100 : 0,
      plan_detected: false,
      plan_note: 'O Worker não recebe da Cloudflare qual é o plano da conta.'
    },
    recognition,
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY),
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      embedding_model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
      recognition_today: recognition.today,
      recognition_since_monitoring: recognition.since_monitoring,
      monitoring_started_on: recognition.monitoring_started_on,
      active_quota_available_via_api: false,
      quota_note: 'RPM, TPM e RPD ativos são consultados no Google AI Studio.'
    }
  });
}

async function handleRecognitionEvents(url, env) {
  const scope = String(url.searchParams.get('scope') || '').trim();
  const kind = String(url.searchParams.get('kind') || '').trim();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
  const events = await readRecognitionEvents(env, {
    limit,
    kind,
    issuesOnly: scope === 'issues'
  });
  return json({
    ok: true,
    scope: scope || (kind || 'all'),
    count: events.length,
    events
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/system-metrics' && request.method === 'GET') {
      try {
        return await handleSystemMetrics(env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao ler métricas do sistema' }, 500);
      }
    }
    if (url.pathname === '/api/admin/recognition-events' && request.method === 'GET') {
      try {
        return await handleRecognitionEvents(url, env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao ler diagnóstico de reconhecimento' }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  }
};
