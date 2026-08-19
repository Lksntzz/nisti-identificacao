export function normalizePlatform(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
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

export async function listPlatforms(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      UPPER(TRIM(platform)) AS platform,
      COUNT(DISTINCT product_id) AS product_count
    FROM product_platforms
    WHERE TRIM(COALESCE(platform, '')) <> ''
    GROUP BY UPPER(TRIM(platform))
    ORDER BY UPPER(TRIM(platform)) ASC
  `).all();

  return (results || [])
    .map(row => ({
      platform: normalizePlatform(row.platform),
      platform_key: platformNamespace(row.platform),
      product_count: Number(row.product_count || 0)
    }))
    .filter(row => row.platform && row.platform_key);
}

export async function platformExists(env, platform) {
  const normalized = normalizePlatform(platform);
  if (!normalized) return false;
  const row = await env.DB.prepare(`
    SELECT 1 AS found
    FROM product_platforms
    WHERE UPPER(TRIM(platform))=?
    LIMIT 1
  `).bind(normalized).first();
  return Boolean(row?.found);
}

export async function platformsForReference(env, reference) {
  const sourceProductId = Number(reference?.source_product_id || 0);
  const capaCode = String(reference?.capa_code || '').trim().toUpperCase();

  let results = [];
  if (sourceProductId > 0) {
    ({ results } = await env.DB.prepare(`
      SELECT DISTINCT UPPER(TRIM(platform)) AS platform
      FROM product_platforms
      WHERE product_id=? AND TRIM(COALESCE(platform, '')) <> ''
      ORDER BY UPPER(TRIM(platform)) ASC
    `).bind(sourceProductId).all());
  } else if (capaCode) {
    ({ results } = await env.DB.prepare(`
      SELECT DISTINCT UPPER(TRIM(pp.platform)) AS platform
      FROM products p
      JOIN product_platforms pp ON pp.product_id=p.id
      WHERE UPPER(TRIM(p.capa_code))=?
        AND TRIM(COALESCE(pp.platform, '')) <> ''
      ORDER BY UPPER(TRIM(pp.platform)) ASC
    `).bind(capaCode).all());
  }

  return (results || [])
    .map(row => normalizePlatform(row.platform))
    .filter(Boolean);
}
