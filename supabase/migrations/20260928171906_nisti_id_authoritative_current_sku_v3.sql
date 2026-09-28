begin;

create or replace function public.commerce_apply_nisti_link_to_product_v1(
  p_nisti_product_id bigint
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_link public.commerce_nisti_product_links%rowtype;
  v_pattern jsonb;
  v_year integer;
  v_norm text;
  v_sku_row_id bigint;
begin
  select * into v_link
  from public.commerce_nisti_product_links
  where nisti_product_id=p_nisti_product_id
    and sync_status='SYNCED'
    and commerce_product_id is not null;

  if not found then
    return jsonb_build_object('status','SKIPPED','reason','link_not_synced');
  end if;

  v_pattern := public.commerce_sku_pattern_v1(v_link.source_sku);
  v_year := case
    when coalesce(v_pattern->>'year','') ~ '^[0-9]{4}$'
      then (v_pattern->>'year')::integer
    else null
  end;
  v_norm := public.commerce_nisti_sku_norm_v1(v_link.source_sku);

  update public.commerce_products
  set
    name=coalesce(nullif(btrim(v_link.source_name),''),name),
    temporal_type=case when v_year is not null then 'ANNUAL' else temporal_type end,
    edition_year=coalesce(v_year,edition_year),
    reference_image_url=coalesce(nullif(btrim(v_link.source_image_url),''),reference_image_url),
    reference_image_source=case
      when nullif(btrim(v_link.source_image_url),'') is not null then 'NISTI_ID'
      else reference_image_source
    end,
    reference_image_sku=case
      when nullif(btrim(v_link.source_image_url),'') is not null then upper(btrim(v_link.source_sku))
      else reference_image_sku
    end,
    updated_at=now()
  where id=v_link.commerce_product_id;

  select ps.id into v_sku_row_id
  from public.commerce_product_skus ps
  where ps.product_id=v_link.commerce_product_id
    and public.commerce_nisti_sku_norm_v1(ps.sku)=v_norm
  order by
    case when ps.sku_type='CURRENT' then 0 when ps.is_active then 1 else 2 end,
    ps.id
  limit 1;

  if v_year is not null then
    update public.commerce_product_skus ps
    set
      sku_type=case when ps.sku_type='CURRENT' then 'HISTORICAL' else ps.sku_type end,
      is_active=case when ps.sku_type='CURRENT' then false else ps.is_active end,
      valid_to_year=case
        when ps.sku_type='CURRENT'
          then case
            when ps.valid_from_year is null or ps.valid_from_year <= v_year-1 then v_year-1
            else ps.valid_from_year
          end
        else ps.valid_to_year
      end,
      updated_at=now()
    where ps.product_id=v_link.commerce_product_id
      and ps.id is distinct from v_sku_row_id
      and ps.sku_type='CURRENT';
  end if;

  if v_sku_row_id is null then
    insert into public.commerce_product_skus(
      product_id,sku,sku_type,valid_from_year,is_active,created_at,updated_at
    )
    values(
      v_link.commerce_product_id,
      upper(btrim(v_link.source_sku)),
      case when v_year is not null then 'CURRENT' else 'ALIAS' end,
      v_year,
      true,
      now(),
      now()
    )
    returning id into v_sku_row_id;
  else
    update public.commerce_product_skus
    set
      sku=upper(btrim(v_link.source_sku)),
      sku_type=case when v_year is not null then 'CURRENT' else sku_type end,
      valid_from_year=coalesce(v_year,valid_from_year),
      valid_to_year=case when v_year is not null then null else valid_to_year end,
      is_active=true,
      updated_at=now()
    where id=v_sku_row_id;
  end if;

  return jsonb_build_object(
    'status','SYNCED',
    'nisti_product_id',v_link.nisti_product_id,
    'commerce_product_id',v_link.commerce_product_id,
    'sku',upper(btrim(v_link.source_sku)),
    'year',v_year
  );
end;
$$;

revoke all on function public.commerce_apply_nisti_link_to_product_v1(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_apply_nisti_link_to_product_v1(bigint)
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

create or replace function public.commerce_sync_management_platforms_to_master_v1(
  p_platforms jsonb,
  p_master_sku text,
  p_master_year integer,
  p_master_image_url text
)
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
with master as (
  select
    public.commerce_nisti_sku_norm_v1(p_master_sku) as sku_norm,
    public.commerce_sku_pattern_v1(p_master_sku) as pat
),
platforms as (
  select p.platform,p.ord
  from jsonb_array_elements(coalesce(p_platforms,'[]'::jsonb))
       with ordinality p(platform,ord)
),
rebuilt as (
  select
    p.ord,
    p.platform || jsonb_build_object(
      'items',
      coalesce((
        select jsonb_agg(
          case
            when compat.is_compatible then
              i.item || jsonb_build_object(
                'source_sku',i.item->>'sku',
                'sku',p_master_sku,
                'edition_year',p_master_year,
                'sku_pattern',public.commerce_sku_pattern_v1(p_master_sku),
                'image_url',coalesce(nullif(p_master_image_url,''),nullif(i.item->>'image_url','')),
                'image_source',case
                  when nullif(p_master_image_url,'') is not null then 'NISTI_ID'
                  else i.item->>'image_source'
                end,
                'image_source_sku',case
                  when nullif(p_master_image_url,'') is not null then p_master_sku
                  else i.item->>'image_source_sku'
                end,
                'synced_from_master',true
              )
            else i.item
          end
          order by i.iord
        )
        from jsonb_array_elements(coalesce(p.platform->'items','[]'::jsonb))
             with ordinality i(item,iord)
        cross join master m
        cross join lateral (
          select public.commerce_sku_pattern_v1(i.item->>'sku') as item_pat
        ) ip
        cross join lateral (
          select (
            public.commerce_nisti_sku_norm_v1(i.item->>'sku')=m.sku_norm
            or (
              p_master_year is not null
              and coalesce(ip.item_pat->>'year','') ~ '^[0-9]{4}$'
              and nullif(ip.item_pat->>'signature','') is not null
              and ip.item_pat->>'signature'=m.pat->>'signature'
              and coalesce(ip.item_pat->>'finish','')=coalesce(m.pat->>'finish','')
            )
          ) as is_compatible
        ) compat
      ),'[]'::jsonb)
    ) as platform
  from platforms p
)
select coalesce(jsonb_agg(platform order by ord),'[]'::jsonb)
from rebuilt;
$$;

revoke all on function public.commerce_sync_management_platforms_to_master_v1(jsonb,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.commerce_sync_management_platforms_to_master_v1(jsonb,text,integer,text)
  to service_role;

create or replace function public.commerce_management_products_v3(
  p_search text default null,
  p_category text default null,
  p_year integer default null,
  p_presence text default 'LINKED',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  card_key text,
  product_id bigint,
  product_name text,
  master_sku text,
  category_name text,
  edition_year integer,
  image_url text,
  platform_count integer,
  presence_type text,
  platforms jsonb,
  link_review_status text,
  suggested_product_id bigint,
  candidate_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path='public'
as $function$
with base as (
  select
    b.*,
    cp.reference_image_url,
    cp.reference_image_source,
    cp.reference_image_sku,
    case
      when cp.reference_image_source='NISTI_ID'
       and nullif(cp.reference_image_url,'') is not null
       and (
         nullif(cp.reference_image_sku,'') is null
         or public.commerce_image_years_compatible(b.master_sku,cp.reference_image_sku,cp.name)
       )
        then cp.reference_image_url
      else b.image_url
    end as effective_image_url
  from public.commerce_management_products_v2(
    p_search,p_category,p_year,p_presence,p_limit,p_offset
  ) b
  left join public.commerce_products cp on cp.id=b.product_id
)
select
  b.card_key,
  b.product_id,
  b.product_name,
  b.master_sku,
  b.category_name,
  b.edition_year,
  b.effective_image_url as image_url,
  b.platform_count,
  b.presence_type,
  public.commerce_sync_management_platforms_to_master_v1(
    public.commerce_enrich_management_platforms_v1(b.platforms),
    b.master_sku,
    b.edition_year,
    case when b.reference_image_source='NISTI_ID' then b.reference_image_url else null end
  ) as platforms,
  b.link_review_status,
  b.suggested_product_id,
  b.candidate_count,
  b.total_count
from base b;
$function$;

revoke execute on function public.commerce_management_products_v3(text,text,integer,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_management_products_v3(text,text,integer,text,integer,integer)
  to service_role;

do $$
declare
  r record;
begin
  for r in
    select nisti_product_id
    from public.commerce_nisti_product_links
    where sync_status='SYNCED' and commerce_product_id is not null
    order by nisti_product_id
  loop
    perform public.commerce_apply_nisti_link_to_product_v1(r.nisti_product_id);
  end loop;
end;
$$;

commit;
