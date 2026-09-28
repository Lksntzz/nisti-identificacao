create or replace function public.commerce_nisti_match_sku_v2(p_sku text)
returns table(
  nisti_product_id bigint,
  commerce_product_id bigint,
  source_sku text,
  source_image_url text,
  match_kind text
)
language sql
stable
security invoker
set search_path=public
as $$
with input as (
  select
    public.commerce_nisti_sku_norm_v1(p_sku) as sku_norm,
    public.commerce_sku_pattern_v1(p_sku) as pat
),
candidates as (
  select
    l.nisti_product_id,
    l.commerce_product_id,
    upper(btrim(l.source_sku)) as source_sku,
    l.source_image_url,
    case
      when public.commerce_nisti_sku_norm_v1(l.source_sku)=i.sku_norm then 0
      when coalesce(i.pat->>'year','') ~ '^[0-9]{4}$'
       and coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'year','') ~ '^[0-9]{4}$'
       and nullif(i.pat->>'signature','') is not null
       and public.commerce_sku_pattern_v1(l.source_sku)->>'signature'=i.pat->>'signature'
       and coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'finish','')=coalesce(i.pat->>'finish','')
       and (public.commerce_sku_pattern_v1(l.source_sku)->>'year')::integer >= (i.pat->>'year')::integer
        then 1
      else 9
    end as match_rank,
    case
      when coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'year','') ~ '^[0-9]{4}$'
        then (public.commerce_sku_pattern_v1(l.source_sku)->>'year')::integer
      else null
    end as target_year
  from public.commerce_nisti_product_links l
  cross join input i
  where l.sync_status='SYNCED'
    and l.commerce_product_id is not null
),
ranked as (
  select * from candidates where match_rank<9
),
best_rank as (
  select min(match_rank) as match_rank from ranked
),
best_year as (
  select max(target_year) as target_year
  from ranked r join best_rank b using(match_rank)
),
best as (
  select r.*
  from ranked r
  join best_rank br using(match_rank)
  cross join best_year byear
  where r.match_rank=0
     or r.target_year is not distinct from byear.target_year
),
unique_product as (
  select min(commerce_product_id) as commerce_product_id
  from best
  having count(distinct commerce_product_id)=1
)
select
  b.nisti_product_id,
  b.commerce_product_id,
  b.source_sku,
  b.source_image_url,
  case b.match_rank when 0 then 'EXACT' else 'FAMILY_YEAR' end as match_kind
from best b
join unique_product u using(commerce_product_id)
order by b.match_rank,b.target_year desc nulls last,b.nisti_product_id
limit 1;
$$;

revoke all on function public.commerce_nisti_match_sku_v2(text)
  from public,anon,authenticated;
grant execute on function public.commerce_nisti_match_sku_v2(text)
  to service_role;

create or replace function public.commerce_source_row_nisti_canonicalize_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_sku text;
  v_match record;
  v_current_has_other_link boolean := false;
begin
  if new.is_header then return new; end if;

  v_sku := coalesce(
    nullif(btrim(new.normalized_payload->>'sku'),''),
    nullif(btrim(new.normalized_payload->>'sku_primary'),''),
    nullif(btrim(new.normalized_payload->>'sku_base'),''),
    nullif(btrim(new.normalized_payload->>'sku_secondary'),'')
  );
  if v_sku is null then return new; end if;

  select * into v_match
  from public.commerce_nisti_match_sku_v2(v_sku)
  limit 1;

  if v_match.commerce_product_id is null then return new; end if;

  if new.matched_product_id is not null
     and new.matched_product_id<>v_match.commerce_product_id then
    select exists(
      select 1
      from public.commerce_nisti_product_links l
      where l.commerce_product_id=new.matched_product_id
        and l.sync_status='SYNCED'
    ) into v_current_has_other_link;

    if v_current_has_other_link then return new; end if;
  end if;

  if new.matched_product_id is distinct from v_match.commerce_product_id then
    new.matched_product_id := v_match.commerce_product_id;
    if coalesce(new.resolution_status,'RAW') in ('RAW','UNMATCHED','REFERENCE_ONLY','PRODUCT_MATCHED') then
      new.resolution_status := 'PRODUCT_MATCHED';
    end if;
    new.notes := concat_ws(
      ' · ',nullif(new.notes,''),
      'NISTI ID auto-sync '||v_match.match_kind||' → produto '||v_match.commerce_product_id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commerce_source_row_nisti_canonicalize_v1
  on public.commerce_source_rows;

create trigger trg_commerce_source_row_nisti_canonicalize_v1
before insert or update of normalized_payload,matched_product_id
on public.commerce_source_rows
for each row
execute function public.commerce_source_row_nisti_canonicalize_v1();

create or replace function public.commerce_reconcile_nisti_product_v2(
  p_nisti_product_id bigint
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_link public.commerce_nisti_product_links%rowtype;
  v_rows integer := 0;
begin
  select * into v_link
  from public.commerce_nisti_product_links
  where nisti_product_id=p_nisti_product_id
    and sync_status='SYNCED'
    and commerce_product_id is not null;

  if not found then
    return jsonb_build_object('status','SKIPPED','reason','link_not_synced');
  end if;

  with eligible as (
    select r.id,m.commerce_product_id
    from public.commerce_source_rows r
    cross join lateral public.commerce_nisti_match_sku_v2(
      coalesce(
        nullif(btrim(r.normalized_payload->>'sku'),''),
        nullif(btrim(r.normalized_payload->>'sku_primary'),''),
        nullif(btrim(r.normalized_payload->>'sku_base'),''),
        nullif(btrim(r.normalized_payload->>'sku_secondary'),'')
      )
    ) m
    where not r.is_header
      and m.nisti_product_id=p_nisti_product_id
      and m.commerce_product_id=v_link.commerce_product_id
      and r.matched_product_id is distinct from v_link.commerce_product_id
      and (
        r.matched_product_id is null
        or not exists(
          select 1
          from public.commerce_nisti_product_links existing
          where existing.commerce_product_id=r.matched_product_id
            and existing.sync_status='SYNCED'
        )
      )
  )
  update public.commerce_source_rows r
  set
    matched_product_id=e.commerce_product_id,
    resolution_status=case
      when coalesce(r.resolution_status,'RAW') in ('RAW','UNMATCHED','REFERENCE_ONLY','PRODUCT_MATCHED')
        then 'PRODUCT_MATCHED'
      else r.resolution_status
    end,
    notes=concat_ws(' · ',nullif(r.notes,''),'NISTI ID reconciled → produto '||e.commerce_product_id::text)
  from eligible e
  where r.id=e.id;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'status','SYNCED',
    'nisti_product_id',p_nisti_product_id,
    'commerce_product_id',v_link.commerce_product_id,
    'source_rows_relinked',v_rows
  );
end;
$$;

revoke all on function public.commerce_reconcile_nisti_product_v2(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_reconcile_nisti_product_v2(bigint)
  to service_role;

create or replace function public.commerce_nisti_link_apply_trigger_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.sync_status='SYNCED' and new.commerce_product_id is not null then
    perform public.commerce_apply_nisti_link_to_product_v1(new.nisti_product_id);
    perform public.commerce_reconcile_nisti_product_v2(new.nisti_product_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_commerce_nisti_link_apply_v1
  on public.commerce_nisti_product_links;

create trigger trg_commerce_nisti_link_apply_v1
after insert or update of commerce_product_id,source_sku,source_name,source_image_url,sync_status
on public.commerce_nisti_product_links
for each row
execute function public.commerce_nisti_link_apply_trigger_v1();
