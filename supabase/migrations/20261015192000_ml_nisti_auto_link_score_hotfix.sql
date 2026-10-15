-- NISTI confidence scores are numeric(6,5), in the range 0..1.
-- Keep this migration idempotent for fresh databases and already-upgraded ones.
do $$
declare
  v_source text;
begin
  v_source:=pg_get_functiondef('public.commerce_auto_link_ml_active_v1(bigint)'::regprocedure);
  if strpos(v_source,'match_score=100')>0 then
    execute replace(v_source,'match_score=100','match_score=1.0');
  end if;
end;
$$;
