-- NISTI ID — pós-importação D1 -> Supabase
-- Execute somente depois de importar os registros preservando os IDs originais.
-- Não altera dados funcionais; apenas sincroniza as sequences das colunas IDENTITY.

SELECT setval(
  pg_get_serial_sequence('public.products', 'id'),
  COALESCE((SELECT MAX(id) FROM public.products), 1),
  EXISTS (SELECT 1 FROM public.products)
);

SELECT setval(
  pg_get_serial_sequence('public.product_platforms', 'id'),
  COALESCE((SELECT MAX(id) FROM public.product_platforms), 1),
  EXISTS (SELECT 1 FROM public.product_platforms)
);

SELECT setval(
  pg_get_serial_sequence('public.recognition_events', 'id'),
  COALESCE((SELECT MAX(id) FROM public.recognition_events), 1),
  EXISTS (SELECT 1 FROM public.recognition_events)
);

SELECT setval(
  pg_get_serial_sequence('public.cover_visual_references', 'id'),
  COALESCE((SELECT MAX(id) FROM public.cover_visual_references), 1),
  EXISTS (SELECT 1 FROM public.cover_visual_references)
);

SELECT setval(
  pg_get_serial_sequence('public.notifications', 'id'),
  COALESCE((SELECT MAX(id) FROM public.notifications), 1),
  EXISTS (SELECT 1 FROM public.notifications)
);

SELECT setval(
  pg_get_serial_sequence('public.notification_reads', 'id'),
  COALESCE((SELECT MAX(id) FROM public.notification_reads), 1),
  EXISTS (SELECT 1 FROM public.notification_reads)
);

SELECT setval(
  pg_get_serial_sequence('public.push_subscriptions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.push_subscriptions), 1),
  EXISTS (SELECT 1 FROM public.push_subscriptions)
);

SELECT setval(
  pg_get_serial_sequence('public.scan_occurrences', 'id'),
  COALESCE((SELECT MAX(id) FROM public.scan_occurrences), 1),
  EXISTS (SELECT 1 FROM public.scan_occurrences)
);

SELECT setval(
  pg_get_serial_sequence('public.geometric_shadow_evidence', 'id'),
  COALESCE((SELECT MAX(id) FROM public.geometric_shadow_evidence), 1),
  EXISTS (SELECT 1 FROM public.geometric_shadow_evidence)
);
