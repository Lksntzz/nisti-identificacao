-- PostgreSQL-native identity allocation for tables that were imported from D1 with explicit bigint IDs.
-- D1 remains frozen during cutover; explicit mirrored IDs continue to work while new Supabase-primary
-- rows can now safely obtain an ID from a sequence.

DO $$
DECLARE
  item record;
  current_max bigint;
  sequence_name text;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      ('products'),
      ('product_platforms'),
      ('product_gtins'),
      ('cover_visual_references'),
      ('notifications'),
      ('notification_reads'),
      ('push_subscriptions'),
      ('recognition_events'),
      ('scan_occurrences'),
      ('geometric_shadow_evidence'),
      ('mural_posts'),
      ('mural_collections')
    ) AS t(table_name)
  LOOP
    sequence_name := 'nisti_' || item.table_name || '_id_seq';
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I AS bigint', sequence_name);
    EXECUTE format('SELECT COALESCE(MAX(id),0) FROM public.%I', item.table_name) INTO current_max;
    PERFORM setval(('public.' || quote_ident(sequence_name))::regclass, current_max + 1, false);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',
      item.table_name,
      'public.' || sequence_name
    );
    EXECUTE format(
      'ALTER SEQUENCE public.%I OWNED BY public.%I.id',
      sequence_name,
      item.table_name
    );
  END LOOP;
END;
$$;
