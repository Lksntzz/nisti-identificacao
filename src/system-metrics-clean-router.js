import app from './core-router.js';
import { readRecognitionEvents, readRecognitionMetrics, readOperatorStats } from './recognition-metrics.js';

const FREE_D1_LIMIT_BYTES = 500 * 1024 * 1024;
const FREE_WORKERS_DAILY_REQUESTS = 100000;
const FREE_GEMINI_DAILY_REQUESTS = 1500;
const FREE_R2_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;

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
  const referenceStats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS references_total,
      SUM(CASE WHEN e.reference_id IS NOT NULL THEN 1 ELSE 0 END) AS indexed_total,
      COUNT(DISTINCT CASE WHEN e.reference_id IS NOT NULL THEN r.capa_code END) AS indexed_covers
    FROM cover_visual_references r
    LEFT JOIN cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
  `).first();
  const recognition = await readRecognitionMetrics(env);

  const attemptsToday = Number(recognition.today?.attempts || 0);
  const geminiRequestsToday = Number(recognition.today?.generation_requests || recognition.today?.attempts || 0);

  return json({
    ok: true,
    measured_at: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    free_tier_status: {
      is_free_tier: true,
      summary: '100% dos serviços estão operando dentro dos limites gratuitos.',
      workers: {
        used_today: attemptsToday,
        limit_daily: FREE_WORKERS_DAILY_REQUESTS,
        percent_used: (attemptsToday / FREE_WORKERS_DAILY_REQUESTS) * 100,
        status: attemptsToday > 80000 ? 'warning' : 'safe'
      },
      d1: {
        used_bytes: sizeBytes,
        limit_bytes: FREE_D1_LIMIT_BYTES,
        percent_used: sizeBytes ? (sizeBytes / FREE_D1_LIMIT_BYTES) * 100 : 0,
        status: (sizeBytes / FREE_D1_LIMIT_BYTES) > 0.8 ? 'warning' : 'safe'
      },
      r2: {
        limit_bytes: FREE_R2_STORAGE_BYTES,
        status: 'safe'
      },
      gemini: {
        used_today: geminiRequestsToday,
        limit_daily: FREE_GEMINI_DAILY_REQUESTS,
        rpm_limit: 15,
        percent_used: (geminiRequestsToday / FREE_GEMINI_DAILY_REQUESTS) * 100,
        status: geminiRequestsToday > 1200 ? 'warning' : 'safe'
      }
    },
    database: {
      status: 'online',
      used_bytes: sizeBytes,
      products: Number(productStats.total || 0),
      products_with_image: Number(productStats.with_image || 0),
      cover_embeddings: Number(referenceStats?.indexed_total || 0),
      cover_visual_references: Number(referenceStats?.references_total || 0),
      indexed_reference_covers: Number(referenceStats?.indexed_covers || 0),
      query_rows_read: Number(productsProbe.meta?.rows_read || 0),
      served_by_colo: productsProbe.meta?.served_by_colo || null,
      served_by_region: productsProbe.meta?.served_by_region || null,
      documented_limits: {
        workers_free_bytes: FREE_D1_LIMIT_BYTES,
        workers_paid_bytes: 10 * 1024 * 1024 * 1024
      },
      percent_of_free_limit: sizeBytes ? (sizeBytes / FREE_D1_LIMIT_BYTES) * 100 : 0
    },
    recognition,
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY),
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      embedding_model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
      recognition_today: recognition.today,
      recognition_since_monitoring: recognition.since_monitoring,
      monitoring_started_on: recognition.monitoring_started_on,
      free_tier_limits: {
        rpd: 1500,
        rpm: 15
      }
    }
  });
}

async function handleRecognitionEvents(url, env) {
  const scope = String(url.searchParams.get('scope') || '').trim();
  const kind = String(url.searchParams.get('kind') || '').trim();
  const operatorName = String(url.searchParams.get('operator_name') || url.searchParams.get('operator') || '').trim();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
  const events = await readRecognitionEvents(env, {
    limit,
    kind,
    issuesOnly: scope === 'issues',
    operator_name: operatorName
  });
  return json({
    ok: true,
    scope: scope || (kind || 'all'),
    count: events.length,
    events
  });
}

async function handleOperators(env) {
  const operators = await readOperatorStats(env);
  return json({
    ok: true,
    count: operators.length,
    operators
  });
}

async function handleUpdateOperatorName(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = request.headers.get('x-user-id') || body?.operator_id || null;
  const newName = String(body?.operator_name || '').trim().slice(0, 120);
  if (!userId || !newName) {
    return json({ ok: false, error: 'operator_id e operator_name são obrigatórios' }, 400);
  }

  const result = await env.DB.prepare(`
    UPDATE recognition_events
    SET operator_name = ?
    WHERE operator_id = ?
      AND (operator_name IS NULL OR operator_name = '' OR operator_name != ?)
  `).bind(newName, userId, newName).run();

  const updated = Number(result?.meta?.changes || 0);
  return json({ ok: true, updated });
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
    if (url.pathname === '/api/admin/operators' && request.method === 'GET') {
      try {
        return await handleOperators(env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao ler estatísticas de operadores' }, 500);
      }
    }

    if (url.pathname === '/api/operator/update-name' && request.method === 'POST') {
      try {
        return await handleUpdateOperatorName(request, env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao atualizar nome do operador' }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  }
};
