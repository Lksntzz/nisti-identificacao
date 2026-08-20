export async function consolidatePlatforms(env) {
  const before = await env.DB.prepare(`
    SELECT UPPER(TRIM(platform)) AS platform, COUNT(*) AS total
    FROM product_platforms
    WHERE TRIM(COALESCE(platform, '')) <> ''
    GROUP BY UPPER(TRIM(platform))
    ORDER BY platform ASC
  `).all();

  await env.DB.prepare(`
    UPDATE product_platforms
    SET platform='MERCADO LIVRE'
    WHERE UPPER(TRIM(platform)) LIKE 'MERCADO LIVRE%'
  `).run();

  await env.DB.prepare(`
    UPDATE product_platforms
    SET platform='SHOPEE'
    WHERE UPPER(TRIM(platform)) LIKE 'SHOPEE%'
  `).run();

  await env.DB.prepare(`
    UPDATE product_platforms
    SET platform='AMAZON'
    WHERE UPPER(TRIM(platform)) LIKE 'AMAZON%'
  `).run();

  await env.DB.prepare(`
    UPDATE product_platforms
    SET link = COALESCE(
      NULLIF(TRIM(link), ''),
      (
        SELECT duplicate.link
        FROM product_platforms AS duplicate
        WHERE duplicate.product_id=product_platforms.product_id
          AND duplicate.platform=product_platforms.platform
          AND TRIM(COALESCE(duplicate.link, '')) <> ''
        ORDER BY duplicate.id ASC
        LIMIT 1
      )
    )
    WHERE id IN (
      SELECT MIN(id)
      FROM product_platforms
      GROUP BY product_id, platform
    )
  `).run();

  const duplicateCount = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM product_platforms
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM product_platforms
      GROUP BY product_id, platform
    )
  `).first();

  await env.DB.prepare(`
    DELETE FROM product_platforms
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM product_platforms
      GROUP BY product_id, platform
    )
  `).run();

  await env.DB.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_platform_unique
    ON product_platforms(product_id, platform)
  `).run();

  const after = await env.DB.prepare(`
    SELECT UPPER(TRIM(platform)) AS platform, COUNT(DISTINCT product_id) AS product_count
    FROM product_platforms
    WHERE UPPER(TRIM(platform)) IN ('MERCADO LIVRE','SHOPEE','AMAZON')
    GROUP BY UPPER(TRIM(platform))
    ORDER BY platform ASC
  `).all();

  return {
    ok: true,
    duplicate_rows_removed: Number(duplicateCount?.total || 0),
    before: before.results || [],
    canonical_platforms: after.results || []
  };
}
