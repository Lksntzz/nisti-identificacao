import {
  preferSupabaseRead,
  supabaseListPlatforms,
  supabasePlatformExists
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

function platformKey(value) {
  return normalizedPlatformText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
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
    platform_key: platformKey(platform),
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

