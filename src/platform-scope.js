import {
  preferSupabaseRead,
  supabaseListPlatforms,
  supabasePlatformExists,
  supabasePlatformsForReference
} from './supabase-read-store.js';

const SUPPORTED_PLATFORMS = Object.freeze([
  'MERCADO LIVRE',
  'SHOPEE',
  'AMAZON'
]);

function normalizedPlatformText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePlatform(value) {
  const normalized = normalizedPlatformText(value);
  if (!normalized) return '';

  // Mercado Livre antigo/novo passam a ser uma única plataforma canônica.
  if (/^MERCADO LIVRE(?:\s|$)/.test(normalized)) return 'MERCADO LIVRE';
  if (/^SHOPEE(?:\s|$)/.test(normalized)) return 'SHOPEE';
  if (/^AMAZON(?:\s|$)/.test(normalized)) return 'AMAZON';

  return '';
}

export function supportedPlatforms() {
  return [...SUPPORTED_PLATFORMS];
}

export function platformNamespace(value) {
  const normalized = normalizePlatform(value);
  if (!normalized) return '';
  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function platformVectorId(referenceId, platform) {
  const id = Number(referenceId || 0);
  const namespace = platformNamespace(platform);
  if (!Number.isInteger(id) || id <= 0 || !namespace) return '';
  return `ref:${id}:p:${namespace}`;
}

async function listPlatformsFromD1(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      UPPER(TRIM(platform)) AS platform,
      COUNT(DISTINCT product_id) AS product_count
    FROM product_platforms
    WHERE TRIM(COALESCE(platform, '')) <> ''
    GROUP BY UPPER(TRIM(platform))
  `).all();
  return results || [];
}

export async function listPlatforms(env) {
  const rows = await preferSupabaseRead(
    env,
    () => supabaseListPlatforms(env),
    () => listPlatformsFromD1(env),
    'list-platforms'
  );

  const counts = new Map(SUPPORTED_PLATFORMS.map(platform => [platform, 0]));
  for (const row of rows || []) {
    const platform = normalizePlatform(row.platform);
    if (!platform || !counts.has(platform)) continue;
    counts.set(platform, counts.get(platform) + Number(row.product_count || 0));
  }

  return SUPPORTED_PLATFORMS.map(platform => ({
    platform,
    platform_key: platformNamespace(platform),
    product_count: counts.get(platform) || 0
  }));
}

async function platformExistsInD1(env, normalized) {
  // Hot path: every identification validates the selected platform. Keep the
  // existing UPPER(TRIM()) semantics, but ask D1 for a single matching row so
  // idx_product_platforms_platform_normalized_product can satisfy the lookup.
  const row = await env.DB.prepare(`
    SELECT 1 AS found
    FROM product_platforms
    WHERE UPPER(TRIM(platform))=?
    LIMIT 1
  `).bind(normalized).first();

  return Boolean(row?.found);
}

export async function platformExists(env, platform) {
  const normalized = normalizePlatform(platform);
  if (!normalized) return false;

  return preferSupabaseRead(
    env,
    () => supabasePlatformExists(env, normalized),
    () => platformExistsInD1(env, normalized),
    'platform-exists'
  );
}

async function platformsForReferenceFromD1(env, sourceProductId, capaCode) {
  let results = [];
  if (sourceProductId > 0) {
    ({ results } = await env.DB.prepare(`
      SELECT DISTINCT UPPER(TRIM(platform)) AS platform
      FROM product_platforms
      WHERE product_id=? AND TRIM(COALESCE(platform, '')) <> ''
    `).bind(sourceProductId).all());
  } else if (capaCode) {
    ({ results } = await env.DB.prepare(`
      SELECT DISTINCT UPPER(TRIM(pp.platform)) AS platform
      FROM products p
      JOIN product_platforms pp ON pp.product_id=p.id
      WHERE UPPER(TRIM(p.capa_code))=?
        AND TRIM(COALESCE(pp.platform, '')) <> ''
    `).bind(capaCode).all());
  }
  return results || [];
}

export async function platformsForReference(env, reference) {
  const sourceProductId = Number(reference?.source_product_id || 0);
  const capaCode = String(reference?.capa_code || '').trim().toUpperCase();

  const rows = await preferSupabaseRead(
    env,
    () => supabasePlatformsForReference(env, sourceProductId, capaCode),
    () => platformsForReferenceFromD1(env, sourceProductId, capaCode),
    'platforms-for-reference'
  );

  return [...new Set(
    (rows || [])
      .map(row => normalizePlatform(row.platform))
      .filter(Boolean)
  )];
}
