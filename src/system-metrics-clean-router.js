import app from './core-router.js';
import { supabaseRpc } from './supabase-read-store.js';
import { explicitUtcTimestamp } from './date-time.js';

const TIMEZONE = 'America/Sao_Paulo';
const SYSTEM_METRICS_CACHE_TTL_MS = 5 * 60 * 1000;
const SYSTEM_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

let systemMetricsCache = { payload: null, expires_at: 0 };
let systemHealthCache = { payload: null, expires_at: 0 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function handleSystemMetrics(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && systemMetricsCache.payload && now < systemMetricsCache.expires_at) {
    return json(systemMetricsCache.payload);
  }

  const core = await supabaseRpc(env, 'nisti_system_metrics_core_v1', {});
  const productStats = core?.products || {};
  const payload = {
    ok: true,
    measured_at: new Date().toISOString(),
    timezone: TIMEZONE,
    cache_ttl_seconds: SYSTEM_METRICS_CACHE_TTL_MS / 1000,
    primary_database: 'supabase',
    database: {
      provider: 'supabase',
      status: 'online',
      used_bytes: Number(core?.database_size_bytes || 0),
      measurement: 'supabase_pg_database_size',
      products: Number(productStats.total || 0),
      products_with_image: Number(productStats.with_image || 0)
    }
  };

  systemMetricsCache = { payload, expires_at: now + SYSTEM_METRICS_CACHE_TTL_MS };
  return json(payload);
}

function compactHealthError(error) {
  return String(error?.message || error || 'Falha desconhecida').replace(/\s+/g, ' ').slice(0, 220);
}

async function runHealthCheck(key, label, runner) {
  const startedAt = Date.now();
  try {
    const data = await runner();
    return {
      key,
      label,
      status: 'healthy',
      latency_ms: Math.max(0, Date.now() - startedAt),
      data
    };
  } catch (error) {
    return {
      key,
      label,
      status: 'error',
      latency_ms: Math.max(0, Date.now() - startedAt),
      error: compactHealthError(error),
      data: null
    };
  }
}

async function handleSystemHealth(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && systemHealthCache.payload && now < systemHealthCache.expires_at) {
    return json(systemHealthCache.payload);
  }

  const measuredAt = new Date().toISOString();
  const workerCheck = {
    key: 'worker',
    label: 'Worker / API',
    status: 'healthy',
    latency_ms: 0,
    data: { app_env: env.APP_ENV || null }
  };

  const [r2Check, supabaseCheck] = await Promise.all([
    runHealthCheck('r2', 'Imagens R2', async () => {
      if (!env.PRODUCT_IMAGES) throw new Error('Binding PRODUCT_IMAGES não configurado');
      const result = await env.PRODUCT_IMAGES.list({ limit: 1 });
      return {
        reachable: true,
        has_objects: Array.isArray(result?.objects) && result.objects.length > 0,
        truncated: Boolean(result?.truncated)
      };
    }),
    runHealthCheck('supabase', 'Banco primário / Supabase', async () => {
      const [core, summary, statuses] = await Promise.all([
        supabaseRpc(env, 'nisti_system_health_core_v1', {}, { timeoutMs: 5000 }),
        supabaseRpc(env, 'commerce_nisti_sync_status_v1', {}, { timeoutMs: 5000 }),
        supabaseRpc(env, 'commerce_nisti_product_statuses_v1', {}, { timeoutMs: 5000 })
      ]);
      return {
        core: core || {},
        summary: summary || {},
        statuses: Array.isArray(statuses) ? statuses : []
      };
    })
  ]);

  const core = supabaseCheck.data?.core || {};
  const scanSummary = {
    technical_errors_today: Number(core.technical_errors_today || 0),
    last_error_at: core.last_error_at || null,
    recent_errors: (Array.isArray(core.recent_errors) ? core.recent_errors : []).map(row => ({
      source: 'BIPAGEM',
      severity: 'error',
      title: 'Erro técnico na bipagem',
      detail: row.error_code || 'system_error',
      sku: row.sku || null,
      gtin: row.gtin || null,
      operator_name: row.operator_name || null,
      response_ms: Number(row.response_ms || 0),
      created_at: explicitUtcTimestamp(row.created_at) || row.created_at || null
    }))
  };

  const syncSummaryRaw = supabaseCheck.data?.summary || {};
  const syncStatuses = Array.isArray(supabaseCheck.data?.statuses) ? supabaseCheck.data.statuses : [];
  const primaryProducts = Number(core.products || 0);
  const syncSummary = {
    nisti_products: primaryProducts,
    linked_total: Number(syncSummaryRaw.linked_total || 0),
    conflicts: Number(syncSummaryRaw.conflicts || 0),
    errors: Number(syncSummaryRaw.errors || 0),
    unlinked: Math.max(
      0,
      primaryProducts
        - Number(syncSummaryRaw.linked_total || 0)
        - Number(syncSummaryRaw.conflicts || 0)
        - Number(syncSummaryRaw.errors || 0)
    ),
    last_synced_at: syncSummaryRaw.last_synced_at || null
  };

  const syncErrors = syncStatuses
    .filter(item => {
      const status = String(item?.sync_status || '').toUpperCase();
      return Boolean(item?.last_error) || status === 'ERROR' || status === 'CONFLICT';
    })
    .slice(0, 12)
    .map(item => ({
      source: 'SINCRONIZAÇÃO',
      severity: String(item?.sync_status || '').toUpperCase() === 'CONFLICT' ? 'warning' : 'error',
      title: item?.source_sku ? `Falha de sincronização · ${item.source_sku}` : 'Falha de sincronização',
      detail: item?.last_error || `Status: ${item?.sync_status || 'ERROR'}`,
      sku: item?.source_sku || item?.commerce_sku || null,
      gtin: null,
      operator_name: null,
      response_ms: null,
      created_at: item?.last_synced_at || null
    }));

  const recentIssues = [...syncErrors, ...scanSummary.recent_errors]
    .sort((a, b) => {
      const left = a.created_at ? Date.parse(a.created_at) : 0;
      const right = b.created_at ? Date.parse(b.created_at) : 0;
      return right - left;
    })
    .slice(0, 20);

  const checks = [workerCheck, r2Check, supabaseCheck].map(check => {
    const base = {
      key: check.key,
      label: check.label,
      status: check.status,
      latency_ms: check.latency_ms
    };
    if (check.error) base.error = check.error;
    if (check.key === 'worker') base.detail = 'A API respondeu a esta verificação.';
    if (check.key === 'r2' && check.status === 'healthy') base.detail = 'Bucket de imagens acessível.';
    if (check.key === 'supabase' && check.status === 'healthy') {
      base.detail = `${primaryProducts.toLocaleString('pt-BR')} produtos acessíveis na base primária.`;
    }
    return base;
  });

  const unavailable = checks.filter(check => check.status === 'error').length;
  const operationalIssues = syncSummary.errors + syncSummary.conflicts + scanSummary.technical_errors_today;
  const overallStatus = unavailable > 0 ? 'degraded' : operationalIssues > 0 ? 'attention' : 'healthy';

  const payload = {
    ok: unavailable === 0,
    measured_at: measuredAt,
    cache_ttl_seconds: SYSTEM_HEALTH_CACHE_TTL_MS / 1000,
    primary_database: 'supabase',
    overall_status: overallStatus,
    summary: {
      services_ok: checks.length - unavailable,
      services_total: checks.length,
      unavailable_services: unavailable,
      operational_issues: operationalIssues,
      technical_errors_today: scanSummary.technical_errors_today
    },
    checks,
    sync: syncSummary,
    recent_issues: recentIssues,
    scan: {
      technical_errors_today: scanSummary.technical_errors_today,
      last_error_at: scanSummary.last_error_at,
      read_error: null
    }
  };

  systemHealthCache = { payload, expires_at: now + SYSTEM_HEALTH_CACHE_TTL_MS };
  return json(payload);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const force = url.searchParams.get('fresh') === '1';

    if (url.pathname === '/api/admin/system-metrics' && request.method === 'GET') {
      try {
        return await handleSystemMetrics(env, { force });
      } catch (error) {
        return json({ error: error?.message || 'Falha ao ler métricas do sistema' }, 500);
      }
    }

    if (url.pathname === '/api/admin/system-health' && request.method === 'GET') {
      try {
        return await handleSystemHealth(env, { force });
      } catch (error) {
        return json({ error: error?.message || 'Falha ao verificar saúde do sistema' }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
