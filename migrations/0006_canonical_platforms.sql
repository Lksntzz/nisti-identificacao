-- Consolida as plataformas do catálogo em três valores canônicos.
-- MERCADO LIVRE - ANTIGO e MERCADO LIVRE - NOVO passam a MERCADO LIVRE.

UPDATE product_platforms
SET platform = CASE
  WHEN UPPER(TRIM(platform)) LIKE 'MERCADO LIVRE%' THEN 'MERCADO LIVRE'
  WHEN UPPER(TRIM(platform)) LIKE 'SHOPEE%' THEN 'SHOPEE'
  WHEN UPPER(TRIM(platform)) LIKE 'AMAZON%' THEN 'AMAZON'
  ELSE platform
END
WHERE TRIM(COALESCE(platform, '')) <> '';

-- Se a consolidação gerar mais de um vínculo idêntico para o mesmo produto,
-- preserva no registro principal um link existente antes de remover duplicatas.
UPDATE product_platforms AS keep
SET link = COALESCE(
  NULLIF(TRIM(keep.link), ''),
  (
    SELECT duplicate.link
    FROM product_platforms AS duplicate
    WHERE duplicate.product_id = keep.product_id
      AND duplicate.platform = keep.platform
      AND TRIM(COALESCE(duplicate.link, '')) <> ''
    ORDER BY duplicate.id ASC
    LIMIT 1
  )
)
WHERE keep.id IN (
  SELECT MIN(id)
  FROM product_platforms
  GROUP BY product_id, platform
);

DELETE FROM product_platforms
WHERE id NOT IN (
  SELECT MIN(id)
  FROM product_platforms
  GROUP BY product_id, platform
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_platform_unique
ON product_platforms(product_id, platform);
