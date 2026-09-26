-- Product Master reference image fallback.
--
-- Keep reference media on the Product Master instead of evaluating the GS
-- catalog inside every card query. Platform images keep priority.
--
-- The initial audited recovery is Product Master #716 (CMB_AURORA_BBB):
-- GS CMB_AURORA_BXB has the same family + cover, a compatible artwork year,
-- and exactly one distinct image. Finish differences do not change cover art.

alter table public.commerce_products
  add column if not exists reference_image_url text,
  add column if not exists reference_image_source text,
  add column if not exists reference_image_sku text;

alter table public.commerce_preview_products
  add column if not exists reference_image_url text,
  add column if not exists reference_image_source text,
  add column if not exists reference_image_sku text;

-- Resolve the live GS reference from the latest GS source file and refuse
-- ambiguous image sets.
with current_sku as (
  select ps.sku
  from public.commerce_product_skus ps
  where ps.product_id=716
  order by
    case when ps.sku_type='CURRENT' and ps.is_active then 0
         when ps.is_active then 1 else 2 end,
    ps.id
  limit 1
),
gs_file as (
  select id
  from public.commerce_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc
  limit 1
),
candidates as (
  select
    nullif(g.normalized_payload->>'image_url','') image_url,
    nullif(g.normalized_payload->>'sku','') gs_sku
  from gs_file f
  join public.commerce_source_rows g
    on g.source_file_id=f.id and g.is_header=false
  cross join current_sku cs
  where nullif(g.normalized_payload->>'image_url','') is not null
    and nullif(public.commerce_sku_pattern_v1(cs.sku)->>'signature','') is not null
    and public.commerce_sku_pattern_v1(g.normalized_payload->>'sku')->>'signature'
        = public.commerce_sku_pattern_v1(cs.sku)->>'signature'
    and public.commerce_image_years_compatible(
      cs.sku,
      g.normalized_payload->>'sku',
      g.normalized_payload->>'product_name'
    )
),
safe as (
  select min(image_url) image_url,min(gs_sku) gs_sku
  from candidates
  having count(distinct image_url)=1
)
update public.commerce_products p
set reference_image_url=s.image_url,
    reference_image_source='GS_REFERENCE',
    reference_image_sku=s.gs_sku,
    updated_at=now()
from safe s
where p.id=716
  and s.image_url is not null;

-- Apply the same audited reference in preview using preview-scoped source data.
with current_sku as (
  select ps.sku
  from public.commerce_preview_product_skus ps
  where ps.product_id=716
  order by
    case when ps.sku_type='CURRENT' and ps.is_active then 0
         when ps.is_active then 1 else 2 end,
    ps.id
  limit 1
),
gs_file as (
  select id
  from public.commerce_preview_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc
  limit 1
),
candidates as (
  select
    nullif(g.normalized_payload->>'image_url','') image_url,
    nullif(g.normalized_payload->>'sku','') gs_sku
  from gs_file f
  join public.commerce_preview_source_rows g
    on g.source_file_id=f.id and g.is_header=false
  cross join current_sku cs
  where nullif(g.normalized_payload->>'image_url','') is not null
    and nullif(public.commerce_sku_pattern_v1(cs.sku)->>'signature','') is not null
    and public.commerce_sku_pattern_v1(g.normalized_payload->>'sku')->>'signature'
        = public.commerce_sku_pattern_v1(cs.sku)->>'signature'
    and public.commerce_image_years_compatible(
      cs.sku,
      g.normalized_payload->>'sku',
      g.normalized_payload->>'product_name'
    )
),
safe as (
  select min(image_url) image_url,min(gs_sku) gs_sku
  from candidates
  having count(distinct image_url)=1
)
update public.commerce_preview_products p
set reference_image_url=s.image_url,
    reference_image_source='GS_REFERENCE',
    reference_image_sku=s.gs_sku,
    updated_at=now()
from safe s
where p.id=716
  and s.image_url is not null;

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products
    where id=716
      and reference_image_url is not null
      and reference_image_source='GS_REFERENCE'
      and reference_image_sku is not null
  ) then
    raise exception 'Safe live GS reference image for Product Master #716 was not resolved';
  end if;

  if not exists (
    select 1
    from public.commerce_preview_products
    where id=716
      and reference_image_url is not null
      and reference_image_source='GS_REFERENCE'
      and reference_image_sku is not null
  ) then
    raise exception 'Safe preview GS reference image for Product Master #716 was not resolved';
  end if;
end
$assert$;

-- Patch the live and preview Product Master card RPCs. This adds only a
-- direct column fallback, so query cost stays effectively unchanged.
do $patch$
declare
  fn_name text;
  fn_oid oid;
  def text;
  patched text;
  old_base_select text :=
    'mp.product_id,cp.name as product_name,cps.sku as master_sku,cc.name as category_name,cp.edition_year,';
  new_base_select text :=
    'mp.product_id,cp.name as product_name,cps.sku as master_sku,cc.name as category_name,cp.edition_year,cp.reference_image_url,';
  old_group text :=
    'group by mp.product_id,cp.name,cps.sku,cc.name,cp.edition_year';
  new_group text :=
    'group by mp.product_id,cp.name,cps.sku,cc.name,cp.edition_year,cp.reference_image_url';
  old_image text := $old$
    (
      select item->>'image_url'
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
      where nullif(item->>'image_url','') is not null
      order by case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
               case p->>'source_code' when 'SHOPEE' then 1 when 'ML_NOVO' then 2 when 'ML_ANTIGO' then 3 when 'AMAZON' then 4 when 'SHEIN' then 5 else 9 end
      limit 1
    ) as image_url,
$old$;
  new_image text := $new$
    coalesce(
      (
        select item->>'image_url'
        from jsonb_array_elements(lb.platforms) p
        cross join lateral jsonb_array_elements(p->'items') item
        where nullif(item->>'image_url','') is not null
        order by case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
                 case p->>'source_code' when 'SHOPEE' then 1 when 'ML_NOVO' then 2 when 'ML_ANTIGO' then 3 when 'AMAZON' then 4 when 'SHEIN' then 5 else 9 end
        limit 1
      ),
      lb.reference_image_url
    ) as image_url,
$new$;
begin
  foreach fn_name in array array[
    'commerce_management_products_v2',
    'commerce_preview_management_products_v2'
  ]
  loop
    select p.oid into fn_oid
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.proname=fn_name
    limit 1;

    if fn_oid is null then
      raise exception 'Function % not found',fn_name;
    end if;

    def := pg_get_functiondef(fn_oid);

    if position('lb.reference_image_url' in def)>0 then
      continue;
    end if;

    if position(old_base_select in def)=0
       or position(old_group in def)=0
       or position(old_image in def)=0 then
      raise exception 'Expected Product Master card fragments not found in %',fn_name;
    end if;

    patched := replace(def,old_base_select,new_base_select);
    patched := replace(patched,old_group,new_group);
    patched := replace(patched,old_image,new_image);
    execute patched;
  end loop;
end
$patch$;
