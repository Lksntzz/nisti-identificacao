begin;

create or replace function public.commerce_list_update_campaigns_v1(
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id bigint,
  name text,
  source_year integer,
  target_year integer,
  status text,
  created_by text,
  created_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  item_count bigint,
  ok_count bigint,
  pending_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.source_year,
    c.target_year,
    c.status,
    c.created_by,
    c.created_at,
    c.opened_at,
    c.closed_at,
    count(i.id) as item_count,
    count(i.id) filter (where i.overall_status in ('OK', 'NOT_APPLICABLE')) as ok_count,
    count(i.id) filter (where i.overall_status not in ('OK', 'NOT_APPLICABLE')) as pending_count,
    count(*) over() as total_count
  from public.commerce_update_campaigns c
  left join public.commerce_update_items i on i.campaign_id = c.id
  group by c.id
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.commerce_create_update_campaign_v1(
  p_name text,
  p_source_year integer,
  p_target_year integer,
  p_created_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_campaign_id bigint;
  v_items integer;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'campaign_name_required' using errcode = '22023';
  end if;
  if p_source_year is null or p_target_year is null
     or p_source_year < 2000 or p_target_year > 2100
     or p_source_year >= p_target_year then
    raise exception 'campaign_years_invalid' using errcode = '22023';
  end if;

  insert into public.commerce_update_campaigns (
    name, source_year, target_year, status, created_by, opened_at
  ) values (
    btrim(p_name), p_source_year, p_target_year, 'OPEN', nullif(btrim(coalesce(p_created_by, '')), ''), now()
  ) returning id into v_campaign_id;

  insert into public.commerce_update_items (campaign_id, listing_product_id, overall_status)
  select v_campaign_id, lp.id, 'NOT_CHECKED'
  from public.commerce_listing_products lp
  join public.commerce_products p on p.id = lp.product_id
  join public.commerce_listings l on l.id = lp.listing_id
  where p.temporal_type = 'ANNUAL'
    and p.edition_year = p_source_year
    and p.internal_status <> 'DISCONTINUED'
    and l.listing_status <> 'REMOVED'
  on conflict do nothing;

  get diagnostics v_items = row_count;

  insert into public.commerce_update_checks (
    update_item_id, check_type, is_required, status, expected_value
  )
  select
    i.id,
    seed.check_type,
    seed.is_required,
    'NOT_CHECKED',
    'Ano alvo: ' || p_target_year::text
  from public.commerce_update_items i
  cross join (values
    ('SKU'::text, true),
    ('TITLE'::text, true),
    ('DESCRIPTION'::text, true),
    ('IMAGES'::text, true),
    ('VIDEO'::text, false),
    ('ATTRIBUTES'::text, false)
  ) as seed(check_type, is_required)
  where i.campaign_id = v_campaign_id
  on conflict do nothing;

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'status', 'OPEN',
    'source_year', p_source_year,
    'target_year', p_target_year,
    'item_count', v_items
  );
end;
$$;

create or replace function public.commerce_list_update_items_v1(
  p_campaign_id bigint,
  p_status text default null,
  p_marketplace_code text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  overall_status text,
  product_id bigint,
  product_name text,
  current_sku text,
  edition_year integer,
  listing_id bigint,
  marketplace_code text,
  marketplace_name text,
  external_listing_id text,
  listing_title text,
  listing_url text,
  observed_year integer,
  required_ok bigint,
  required_total bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.id,
    i.overall_status,
    p.id,
    p.name,
    current_sku.sku,
    p.edition_year,
    l.id,
    m.code,
    m.name,
    l.external_listing_id,
    l.title,
    l.canonical_url,
    l.observed_year,
    count(ch.id) filter (where ch.is_required and ch.status in ('OK', 'NOT_APPLICABLE')) as required_ok,
    count(ch.id) filter (where ch.is_required) as required_total,
    count(*) over() as total_count
  from public.commerce_update_items i
  join public.commerce_listing_products lp on lp.id = i.listing_product_id
  join public.commerce_products p on p.id = lp.product_id
  join public.commerce_listings l on l.id = lp.listing_id
  join public.commerce_marketplaces m on m.id = l.marketplace_id
  left join public.commerce_update_checks ch on ch.update_item_id = i.id
  left join lateral (
    select s.sku
    from public.commerce_product_skus s
    where s.product_id = p.id and s.sku_type = 'CURRENT' and s.is_active = true
    order by s.id desc
    limit 1
  ) current_sku on true
  where i.campaign_id = p_campaign_id
    and (p_status is null or upper(i.overall_status) = upper(btrim(p_status)))
    and (p_marketplace_code is null or upper(m.code) = upper(btrim(p_marketplace_code)))
    and (
      p_search is null
      or p.name ilike '%' || btrim(p_search) || '%'
      or coalesce(current_sku.sku, '') ilike '%' || btrim(p_search) || '%'
      or coalesce(l.external_listing_id, '') ilike '%' || btrim(p_search) || '%'
    )
  group by i.id, p.id, current_sku.sku, l.id, m.id
  order by i.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.commerce_update_item_v1(p_item_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id,
    'campaign_id', i.campaign_id,
    'overall_status', i.overall_status,
    'notes', i.notes,
    'product_id', p.id,
    'product_name', p.name,
    'edition_year', p.edition_year,
    'current_sku', current_sku.sku,
    'listing_id', l.id,
    'marketplace_code', m.code,
    'marketplace_name', m.name,
    'external_listing_id', l.external_listing_id,
    'listing_title', l.title,
    'listing_url', l.canonical_url,
    'observed_year', l.observed_year,
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ch.id,
        'check_type', ch.check_type,
        'is_required', ch.is_required,
        'status', ch.status,
        'detected_value', ch.detected_value,
        'expected_value', ch.expected_value,
        'notes', ch.notes,
        'checked_by', ch.checked_by,
        'checked_at', ch.checked_at
      ) order by case ch.check_type
        when 'SKU' then 1 when 'TITLE' then 2 when 'DESCRIPTION' then 3
        when 'IMAGES' then 4 when 'VIDEO' then 5 else 6 end)
      from public.commerce_update_checks ch
      where ch.update_item_id = i.id
    ), '[]'::jsonb)
  )
  from public.commerce_update_items i
  join public.commerce_listing_products lp on lp.id = i.listing_product_id
  join public.commerce_products p on p.id = lp.product_id
  join public.commerce_listings l on l.id = lp.listing_id
  join public.commerce_marketplaces m on m.id = l.marketplace_id
  left join lateral (
    select s.sku
    from public.commerce_product_skus s
    where s.product_id = p.id and s.sku_type = 'CURRENT' and s.is_active = true
    order by s.id desc
    limit 1
  ) current_sku on true
  where i.id = p_item_id;
$$;

create or replace function public.commerce_set_update_check_v1(
  p_check_id bigint,
  p_status text,
  p_detected_value text default null,
  p_expected_value text default null,
  p_notes text default null,
  p_checked_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_item_id bigint;
  v_overall text;
begin
  if v_status not in ('NOT_CHECKED', 'OK', 'NEEDS_UPDATE', 'IN_PROGRESS', 'BLOCKED', 'NOT_APPLICABLE') then
    raise exception 'update_check_status_invalid' using errcode = '22023';
  end if;

  update public.commerce_update_checks
  set
    status = v_status,
    detected_value = nullif(btrim(coalesce(p_detected_value, '')), ''),
    expected_value = coalesce(nullif(btrim(coalesce(p_expected_value, '')), ''), expected_value),
    notes = nullif(btrim(coalesce(p_notes, '')), ''),
    checked_by = nullif(btrim(coalesce(p_checked_by, '')), ''),
    checked_at = case when v_status = 'NOT_CHECKED' then null else now() end
  where id = p_check_id
  returning update_item_id into v_item_id;

  if v_item_id is null then
    raise exception 'update_check_not_found' using errcode = '22023';
  end if;

  select case
    when bool_or(ch.status = 'BLOCKED') filter (where ch.is_required) then 'BLOCKED'
    when bool_or(ch.status = 'NEEDS_UPDATE') filter (where ch.is_required) then 'NEEDS_UPDATE'
    when bool_or(ch.status = 'IN_PROGRESS') filter (where ch.is_required) then 'IN_PROGRESS'
    when bool_and(ch.status in ('OK', 'NOT_APPLICABLE')) filter (where ch.is_required) then 'OK'
    else 'NOT_CHECKED'
  end
  into v_overall
  from public.commerce_update_checks ch
  where ch.update_item_id = v_item_id;

  update public.commerce_update_items
  set overall_status = coalesce(v_overall, 'NOT_CHECKED')
  where id = v_item_id;

  return public.commerce_update_item_v1(v_item_id);
end;
$$;

create or replace function public.commerce_close_update_campaign_v1(p_campaign_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pending integer;
  v_name text;
begin
  select name into v_name
  from public.commerce_update_campaigns
  where id = p_campaign_id and status = 'OPEN';

  if v_name is null then
    raise exception 'open_campaign_not_found' using errcode = '22023';
  end if;

  select count(*)::integer into v_pending
  from public.commerce_update_items
  where campaign_id = p_campaign_id
    and overall_status not in ('OK', 'NOT_APPLICABLE');

  if v_pending > 0 then
    raise exception 'campaign_has_pending_items' using errcode = '22023';
  end if;

  update public.commerce_update_campaigns
  set status = 'CLOSED', closed_at = now()
  where id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'name', v_name,
    'status', 'CLOSED',
    'pending_items', 0
  );
end;
$$;

revoke all on function public.commerce_list_update_campaigns_v1(integer, integer) from public, anon, authenticated;
revoke all on function public.commerce_create_update_campaign_v1(text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.commerce_list_update_items_v1(bigint, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.commerce_update_item_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_set_update_check_v1(bigint, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.commerce_close_update_campaign_v1(bigint) from public, anon, authenticated;

grant execute on function public.commerce_list_update_campaigns_v1(integer, integer) to service_role;
grant execute on function public.commerce_create_update_campaign_v1(text, integer, integer, text) to service_role;
grant execute on function public.commerce_list_update_items_v1(bigint, text, text, text, integer, integer) to service_role;
grant execute on function public.commerce_update_item_v1(bigint) to service_role;
grant execute on function public.commerce_set_update_check_v1(bigint, text, text, text, text, text) to service_role;
grant execute on function public.commerce_close_update_campaign_v1(bigint) to service_role;

commit;
