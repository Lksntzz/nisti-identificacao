-- Sincronização do catálogo do Mercado Livre por conta (ANTIGO/NOVO).
-- Regra combinada com o dono do sistema em 25/10/2026:
--  * status explícito na planilha (inativo/pausado/finalizado) já é aplicado
--    por commerce_sync_import_listing_states_account_v1 (automático);
--  * anúncio ATIVO no sistema que NÃO aparece na planilha mais recente da conta
--    é desativado (INACTIVE) — nunca apagado, para preservar o histórico;
--  * variação de anúncio ativo cujo SKU não aparece mais na planilha é
--    desativada; se o SKU voltar, é reativada.
-- Segurança: só a planilha mais recente da conta; prévia antes de aplicar;
-- confirmação extra quando a desativação for grande (planilha filtrada).

create or replace function public.commerce_catalog_sync_plan_v1(p_batch_id bigint)
returns table(action text, entity text, entity_id bigint, listing_id bigint,
  external_listing_id text, title text, sku text)
language sql stable security invoker set search_path = public as $$
with batch as (
  select b.id, b.marketplace_id, b.account_code, m.code marketplace_code
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id = b.marketplace_id
  where b.id = p_batch_id
), rows as (
  select r.normalized_payload p
  from public.commerce_import_rows r join batch on r.batch_id = batch.id
  where coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
    and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
), observed as (
  select distinct p->>'external_listing_id' ext from rows
), active_in_file as (
  select distinct p->>'external_listing_id' ext from rows where p->>'source_listing_status' = 'ACTIVE'
), file_skus as (
  select distinct p->>'external_listing_id' ext,
    public.commerce_nisti_sku_norm_v1(p->>'sku_primary') norm
  from rows
  where p->>'source_listing_status' = 'ACTIVE'
    and coalesce(p->>'status_only','false') <> 'true'
    and nullif(btrim(coalesce(p->>'sku_primary','')),'') is not null
), account_listings as (
  select l.* from public.commerce_listings l join batch b
    on l.marketplace_id = b.marketplace_id and l.account_code = b.account_code
)
select 'DEACTIVATE_ABSENT', 'LISTING', l.id, l.id, l.external_listing_id, l.title, null::text
from account_listings l
where l.listing_status = 'ACTIVE'
  and l.external_listing_id not in (select ext from observed)
union all
select 'DEACTIVATE_VARIATION', 'VARIATION', lp.id, l.id, l.external_listing_id,
  coalesce(nullif(lp.variation_name,''), l.title), lp.platform_sku
from account_listings l
join public.commerce_listing_products lp on lp.listing_id = l.id
where l.external_listing_id in (select ext from active_in_file)
  and exists (select 1 from file_skus f where f.ext = l.external_listing_id)
  and lp.relation_status in ('ACTIVE','UNKNOWN')
  and not exists (select 1 from file_skus f where f.ext = l.external_listing_id
    and f.norm = public.commerce_nisti_sku_norm_v1(lp.platform_sku))
union all
select 'REACTIVATE_VARIATION', 'VARIATION', lp.id, l.id, l.external_listing_id,
  coalesce(nullif(lp.variation_name,''), l.title), lp.platform_sku
from account_listings l
join public.commerce_listing_products lp on lp.listing_id = l.id
where l.external_listing_id in (select ext from active_in_file)
  and lp.relation_status = 'INACTIVE'
  and exists (select 1 from file_skus f where f.ext = l.external_listing_id
    and f.norm = public.commerce_nisti_sku_norm_v1(lp.platform_sku))
$$;

create or replace function public.commerce_catalog_sync_preview_v1(p_batch_id bigint)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_batch record; v_latest bigint; v_prev_active int; v_prev_vars int;
  v_absent int; v_vars_off int; v_vars_on int; v_requires boolean;
begin
  select b.id, b.marketplace_id, b.account_code, b.status, m.code marketplace_code
  into v_batch from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id = b.marketplace_id where b.id = p_batch_id;
  if v_batch.id is null then raise exception 'batch_not_found' using errcode='22023'; end if;
  if v_batch.marketplace_code <> 'MERCADO_LIVRE' or coalesce(v_batch.account_code,'') not in ('ANTIGO','NOVO') then
    raise exception 'catalog_sync_ml_account_required' using errcode='22023'; end if;
  select max(b.id) into v_latest from public.commerce_import_batches b
  where b.marketplace_id = v_batch.marketplace_id and b.account_code = v_batch.account_code
    and exists (select 1 from public.commerce_import_rows r where r.batch_id = b.id);
  select count(*) into v_prev_active from public.commerce_listings l
  where l.marketplace_id = v_batch.marketplace_id and l.account_code = v_batch.account_code
    and l.listing_status = 'ACTIVE';
  select count(*) into v_prev_vars from public.commerce_listing_products lp
  join public.commerce_listings l on l.id = lp.listing_id
  where l.marketplace_id = v_batch.marketplace_id and l.account_code = v_batch.account_code
    and l.listing_status = 'ACTIVE' and lp.relation_status in ('ACTIVE','UNKNOWN');
  select count(*) filter (where action = 'DEACTIVATE_ABSENT'),
         count(*) filter (where action = 'DEACTIVATE_VARIATION'),
         count(*) filter (where action = 'REACTIVATE_VARIATION')
  into v_absent, v_vars_off, v_vars_on from public.commerce_catalog_sync_plan_v1(p_batch_id);
  v_requires := v_absent > greatest(5, ceil(v_prev_active * 0.3))
             or v_vars_off > greatest(10, ceil(v_prev_vars * 0.3));
  return jsonb_build_object(
    'batch_id', p_batch_id, 'account_code', v_batch.account_code,
    'is_latest_batch', v_latest = p_batch_id, 'latest_batch_id', v_latest,
    'previous_active_listings', v_prev_active, 'previous_active_variations', v_prev_vars,
    'deactivate_listings', v_absent, 'deactivate_variations', v_vars_off,
    'reactivate_variations', v_vars_on, 'requires_mass_confirmation', v_requires,
    'samples', coalesce((select jsonb_agg(to_jsonb(s)) from (
      select action, entity, external_listing_id, title, sku
      from public.commerce_catalog_sync_plan_v1(p_batch_id)
      order by action, title limit 60) s), '[]'::jsonb));
end $$;

create or replace function public.commerce_catalog_sync_apply_v1(p_batch_id bigint, p_confirm_mass boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_preview jsonb; v_listings int := 0; v_off int := 0; v_on int := 0;
begin
  -- Serializa sincronizações da mesma importação.
  perform 1 from public.commerce_import_batches where id = p_batch_id for update;
  v_preview := public.commerce_catalog_sync_preview_v1(p_batch_id);
  if not (v_preview->>'is_latest_batch')::boolean then
    raise exception 'catalog_sync_not_latest_batch' using errcode='22023'; end if;
  if (v_preview->>'requires_mass_confirmation')::boolean and not coalesce(p_confirm_mass,false) then
    raise exception 'catalog_sync_mass_confirmation_required' using errcode='22023'; end if;

  create temporary table if not exists pg_temp.commerce_sync_plan
    (action text, entity text, entity_id bigint) on commit drop;
  truncate pg_temp.commerce_sync_plan;
  insert into pg_temp.commerce_sync_plan
    select action, entity, entity_id from public.commerce_catalog_sync_plan_v1(p_batch_id);

  with u as (
    update public.commerce_listings l set listing_status = 'INACTIVE', last_checked_at = now(),
      raw_metadata = coalesce(l.raw_metadata,'{}'::jsonb) || jsonb_build_object(
        'deactivated_reason','ABSENT_FROM_IMPORT','deactivated_by_import_batch_id',p_batch_id,
        'deactivated_at', now())
    from pg_temp.commerce_sync_plan p
    where p.action = 'DEACTIVATE_ABSENT' and l.id = p.entity_id and l.listing_status = 'ACTIVE'
    returning l.id) select count(*) into v_listings from u;

  with u as (
    update public.commerce_listing_products lp set relation_status = 'INACTIVE', updated_at = now()
    from pg_temp.commerce_sync_plan p
    where p.action = 'DEACTIVATE_VARIATION' and lp.id = p.entity_id
      and lp.relation_status in ('ACTIVE','UNKNOWN')
    returning lp.id) select count(*) into v_off from u;

  with u as (
    update public.commerce_listing_products lp set relation_status = 'ACTIVE', updated_at = now()
    from pg_temp.commerce_sync_plan p
    where p.action = 'REACTIVATE_VARIATION' and lp.id = p.entity_id and lp.relation_status = 'INACTIVE'
    returning lp.id) select count(*) into v_on from u;

  return jsonb_build_object('batch_id', p_batch_id, 'account_code', v_preview->>'account_code',
    'deactivated_listings', v_listings, 'deactivated_variations', v_off, 'reactivated_variations', v_on);
end $$;

revoke all on function public.commerce_catalog_sync_plan_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_catalog_sync_preview_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_catalog_sync_apply_v1(bigint, boolean) from public, anon, authenticated;
grant execute on function public.commerce_catalog_sync_plan_v1(bigint) to service_role;
grant execute on function public.commerce_catalog_sync_preview_v1(bigint) to service_role;
grant execute on function public.commerce_catalog_sync_apply_v1(bigint, boolean) to service_role;
