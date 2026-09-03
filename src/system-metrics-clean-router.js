import app from './core-router.js';
import { readRecognitionEvents, readRecognitionMetrics, readOperatorStats } from './recognition-metrics.js';

const TIMEZONE = 'America/Sao_Paulo';
const EMBEDDING_DIMENSIONS = 768;

// Referências documentais verificadas em 2026-09-02. Elas NÃO representam
// consumo medido da conta Cloudflare/Google. O painel separa explicitamente
// limite documentado de uso observado pelo NISTI.
const DOCUMENTED_LIMITS = Object.freeze({
  workers: {
    free_requests_per_day: 100000,
    source: 'Cloudflare Workers limits/pricing'
  },
  d1: {
    free_max_database_bytes: 500 * 1024 * 1024,
    free_account_storage_bytes: 5 * 1000 * 1000 * 1000,
    free_rows_read_per_day: 5_000_000,
    free_rows_written_per_day: 100_000,
    source: 'Cloudflare D1 limits/pricing'
  },
  r2: {
    free_standard_storage_gb_month: 10,
    free_class_a_operations_per_month: 1_000_000,
    free_class_b_operations_per_month: 10_000_000,
    source: 'Cloudflare R2 pricing'
  },
  vectorize: {
    free_stored_dimensions: 5_000_000,
    free_queried_dimensions_per_month: 30_000_000,
    source: 'Cloudflare Vectorize pricing'
  },
  gemini: {
    source: 'Google AI Studio / Gemini API rate limits',
    note: 'Os limites ativos variam por projeto, modelo e tier; o NISTI não inventa RPM/RPD.'
  }
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

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

async function readExpectedVectorFootprint(env) {
  const row = await env.DB.prepare(`
    WITH indexed_refs AS (
      SELECT r.id, r.capa_code, r.source_product_id
      FROM cover_visual_references r
      JOIN cover_reference_embeddings e ON e.reference_id = r.id
      WHERE r.active = 1
    ), platform_counts AS (
      SELECT
        r.id,
        CASE
          WHEN r.source_product_id IS NOT NULL THEN (
            SELECT COUNT(DISTINCT UPPER(TRIM(pp.platform)))
            FROM product_platforms pp
            WHERE pp.product_id = r.source_product_id
              AND UPPER(TRIM(pp.platform)) IN ('MERCADO LIVRE','SHOPEE','AMAZON')
          )
          ELSE (
            SELECT COUNT(DISTINCT UPPER(TRIM(pp.platform)))
            FROM products p
            JOIN product_platforms pp ON pp.product_id = p.id
            WHERE UPPER(TRIM(p.capa_code)) = UPPER(TRIM(r.capa_code))
              AND UPPER(TRIM(pp.platform)) IN ('MERCADO LIVRE','SHOPEE','AMAZON')
          )
        END AS platform_count
      FROM indexed_refs r
    )
    SELECT
      COUNT(*) AS indexed_references,
      COALESCE(SUM(CASE WHEN platform_count > 0 THEN platform_count ELSE 3 END), 0) AS expected_vector_copies
    FROM platform_counts
  `).first();

  const indexedReferences = Number(row?.indexed_references || 0);
  const expectedVectorCopies = Number(row?.expected_vector_copies || 0);
  return {
    indexed_references: indexedReferences,
    expected_vector_copies: expectedVectorCopies,
    dimensions_per_vector: EMBEDDING_DIMENSIONS,
    expected_stored_dimensions: expectedVectorCopies * EMBEDDING_DIMENSIONS,
    measurement: 'derived_from_d1_platform_scope',
    exact_provider_usage: false,
    note: 'Estimativa do estado que o NISTI espera no Vectorize. A cobrança/uso real da conta exige Analytics da Cloudflare.'
  };
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
  // D1Result.meta.size_after é o tamanho real do banco após a consulta.
  const sizeBytes = Number(productsProbe.meta?.size_after || 0);

  const referenceStats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS references_total,
      SUM(CASE WHEN e.reference_id IS NOT NULL THEN 1 ELSE 0 END) AS indexed_total,
      COUNT(DISTINCT CASE WHEN e.reference_id IS NOT NULL THEN r.capa_code END) AS indexed_covers
    FROM cover_visual_references r
    LEFT JOIN cover_reference_embeddings e ON e.reference_id = r.id
    WHERE r.active = 1
  `).first();

  const today = saoPauloDay();
  const embeddingActivity = await env.DB.prepare(`
    SELECT
      COUNT(*) AS embeddings_updated_today,
      COUNT(DISTINCT reference_id) AS references_updated_today
    FROM cover_reference_embeddings
    WHERE substr(updated_at, 1, 10) = ?
  `).bind(today).first();

  const recognition = await readRecognitionMetrics(env);
  const vectorize = await readExpectedVectorFootprint(env);

  const d1Limit = DOCUMENTED_LIMITS.d1.free_max_database_bytes;
  const d1Percent = d1Limit > 0 ? (sizeBytes / d1Limit) * 100 : null;

  return json({
    ok: true,
    measured_at: new Date().toISOString(),
    timezone: TIMEZONE,
    measurement_policy: {
      provider_billing_connected: false,
      cost_guarantee: false,
      note: 'O painel mostra medições do próprio NISTI e referências documentais. Não afirma consumo total da conta quando a API de billing/analytics do provedor não está conectada.'
    },
    documented_limits: {
      verified_on: '2026-09-02',
      ...DOCUMENTED_LIMITS
    },
    database: {
      status: 'online',
      used_bytes: sizeBytes,
      measurement: 'd1_meta_size_after',
      products: Number(productStats.total || 0),
      products_with_image: Number(productStats.with_image || 0),
      cover_embeddings: Number(referenceStats?.indexed_total || 0),
      cover_visual_references: Number(referenceStats?.references_total || 0),
      indexed_reference_covers: Number(referenceStats?.indexed_covers || 0),
      query_rows_read_for_this_probe: Number(productsProbe.meta?.rows_read || 0),
      served_by_colo: productsProbe.meta?.served_by_colo || null,
      served_by_region: productsProbe.meta?.served_by_region || null,
      free_max_database_bytes: d1Limit,
      percent_of_free_database_max: d1Percent,
      account_daily_rows_read: null,
      account_daily_rows_written: null,
      account_usage_note: 'Rows read/write totais da conta não são inferidos a partir de uma consulta isolada.'
    },
    vectorize,
    recognition,
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY),
      models: {
        recognition: env.GEMINI_MODEL || null,
        verifier: env.GEMINI_VERIFIER_MODEL || null,
        detail: env.GEMINI_DETAIL_MODEL || null,
        embedding: env.GEMINI_EMBEDDING_MODEL || null
      },
      observed_today: {
        recognition_generation_requests: Number(recognition.today?.generation_requests || 0),
        recognition_embedding_requests: Number(recognition.today?.embedding_requests || 0),
        embeddings_updated_in_catalog: Number(embeddingActivity?.embeddings_updated_today || 0),
        references_updated_in_catalog: Number(embeddingActivity?.references_updated_today || 0)
      },
      quota_usage: null,
      quota_note: DOCUMENTED_LIMITS.gemini.note
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
