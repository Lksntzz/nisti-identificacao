-- NISTI ID — validação pós-importação D1 -> Supabase
-- Compare a seção TABLE_COUNTS com d1-counts.json do snapshot de origem.

-- TABLE_COUNTS
SELECT 'cover_embeddings' AS table_name, COUNT(*)::bigint AS row_count FROM public.cover_embeddings
UNION ALL SELECT 'cover_reference_embeddings', COUNT(*) FROM public.cover_reference_embeddings
UNION ALL SELECT 'cover_visual_references', COUNT(*) FROM public.cover_visual_references
UNION ALL SELECT 'cover_visual_signatures', COUNT(*) FROM public.cover_visual_signatures
UNION ALL SELECT 'geometric_shadow_evidence', COUNT(*) FROM public.geometric_shadow_evidence
UNION ALL SELECT 'notification_reads', COUNT(*) FROM public.notification_reads
UNION ALL SELECT 'notifications', COUNT(*) FROM public.notifications
UNION ALL SELECT 'product_platforms', COUNT(*) FROM public.product_platforms
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'push_subscriptions', COUNT(*) FROM public.push_subscriptions
UNION ALL SELECT 'recognition_daily', COUNT(*) FROM public.recognition_daily
UNION ALL SELECT 'recognition_events', COUNT(*) FROM public.recognition_events
UNION ALL SELECT 'scan_occurrences', COUNT(*) FROM public.scan_occurrences
ORDER BY table_name;

-- REFERENTIAL_INTEGRITY: todos os valores abaixo devem ser 0.
SELECT 'product_platforms_without_product' AS check_name, COUNT(*)::bigint AS violations
FROM public.product_platforms pp
LEFT JOIN public.products p ON p.id = pp.product_id
WHERE p.id IS NULL
UNION ALL
SELECT 'visual_references_without_product', COUNT(*)
FROM public.cover_visual_references r
LEFT JOIN public.products p ON p.id = r.source_product_id
WHERE r.source_product_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'reference_embeddings_without_reference', COUNT(*)
FROM public.cover_reference_embeddings e
LEFT JOIN public.cover_visual_references r ON r.id = e.reference_id
WHERE r.id IS NULL
UNION ALL
SELECT 'visual_signatures_without_reference', COUNT(*)
FROM public.cover_visual_signatures s
LEFT JOIN public.cover_visual_references r ON r.id = s.reference_id
WHERE s.reference_id IS NOT NULL AND r.id IS NULL
UNION ALL
SELECT 'notification_reads_without_notification', COUNT(*)
FROM public.notification_reads nr
LEFT JOIN public.notifications n ON n.id = nr.notification_id
WHERE n.id IS NULL
UNION ALL
SELECT 'shadow_occurrence_missing', COUNT(*)
FROM public.geometric_shadow_evidence g
LEFT JOIN public.scan_occurrences o ON o.id = g.occurrence_id
WHERE g.occurrence_id IS NOT NULL AND o.id IS NULL
ORDER BY check_name;

-- BUSINESS_INVARIANTS: todos os valores abaixo devem ser 0.
SELECT 'duplicate_sku' AS check_name, COUNT(*)::bigint AS violations
FROM (
  SELECT sku FROM public.products GROUP BY sku HAVING COUNT(*) > 1
) q
UNION ALL
SELECT 'duplicate_product_platform', COUNT(*)
FROM (
  SELECT product_id, platform
  FROM public.product_platforms
  GROUP BY product_id, platform
  HAVING COUNT(*) > 1
) q
UNION ALL
SELECT 'duplicate_cover_image_reference', COUNT(*)
FROM (
  SELECT capa_code, image_key
  FROM public.cover_visual_references
  GROUP BY capa_code, image_key
  HAVING COUNT(*) > 1
) q
UNION ALL
SELECT 'invalid_reference_active', COUNT(*)
FROM public.cover_visual_references
WHERE active NOT IN (0, 1)
UNION ALL
SELECT 'invalid_occurrence_status', COUNT(*)
FROM public.scan_occurrences
WHERE status NOT IN ('pending', 'trained', 'dismissed')
ORDER BY check_name;

-- PLATFORM_DOMAIN: deve conter apenas os valores canônicos atualmente aceitos.
SELECT upper(btrim(platform)) AS platform, COUNT(*)::bigint AS product_count
FROM public.product_platforms
GROUP BY upper(btrim(platform))
ORDER BY platform;

-- ID_RANGES: usado para conferir preservação de IDs e sequences.
SELECT 'products' AS table_name, MIN(id) AS min_id, MAX(id) AS max_id FROM public.products
UNION ALL SELECT 'product_platforms', MIN(id), MAX(id) FROM public.product_platforms
UNION ALL SELECT 'recognition_events', MIN(id), MAX(id) FROM public.recognition_events
UNION ALL SELECT 'cover_visual_references', MIN(id), MAX(id) FROM public.cover_visual_references
UNION ALL SELECT 'notifications', MIN(id), MAX(id) FROM public.notifications
UNION ALL SELECT 'notification_reads', MIN(id), MAX(id) FROM public.notification_reads
UNION ALL SELECT 'push_subscriptions', MIN(id), MAX(id) FROM public.push_subscriptions
UNION ALL SELECT 'scan_occurrences', MIN(id), MAX(id) FROM public.scan_occurrences
UNION ALL SELECT 'geometric_shadow_evidence', MIN(id), MAX(id) FROM public.geometric_shadow_evidence
ORDER BY table_name;
