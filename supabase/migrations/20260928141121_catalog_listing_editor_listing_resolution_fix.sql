
create or replace function public.commerce_enrich_management_platforms_v1(p_platforms jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
select coalesce(jsonb_agg(
  p.platform || jsonb_build_object('items',coalesce(e.items,'[]'::jsonb))
  order by p.ord
),'[]'::jsonb)
from jsonb_array_elements(coalesce(p_platforms,'[]'::jsonb)) with ordinality p(platform,ord)
left join lateral (
  select jsonb_agg(
    i.item || jsonb_build_object(
      'listing_id',l.id,
      'listing_title',coalesce(o.title,l.title,i.item->>'product_name'),
      'listing_status',coalesce(o.listing_status,i.item->>'listing_status'),
      'edition_year',coalesce(o.observed_year,case when (i.item->>'edition_year') ~ '^[0-9]+$' then (i.item->>'edition_year')::integer end),
      'image_url',coalesce(o.image_url,nullif(i.item->>'image_url','')),
      'price',o.price,
      'listing_category',o.category,
      'listing_note',o.note,
      'sync_status',coalesce(o.sync_status,'NONE')
    )
    order by i.iord
  ) as items
  from jsonb_array_elements(coalesce(p.platform->'items','[]'::jsonb)) with ordinality i(item,iord)
  left join public.commerce_source_rows sr
    on sr.id=case when (i.item->>'source_row_id') ~ '^[0-9]+$' then (i.item->>'source_row_id')::bigint end
  left join lateral (
    select lx.*
    from public.commerce_listings lx
    where lx.id=sr.matched_listing_id
       or (
         sr.matched_listing_id is null
         and nullif(i.item->>'listing_url','') is not null
         and lx.canonical_url=i.item->>'listing_url'
       )
    order by case when lx.id=sr.matched_listing_id then 0 else 1 end,lx.id
    limit 1
  ) l on true
  left join public.commerce_listing_overrides o on o.listing_id=l.id
) e on true;
$$;

create or replace function public.commerce_preview_enrich_management_platforms_v1(p_platforms jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
select coalesce(jsonb_agg(
  p.platform || jsonb_build_object('items',coalesce(e.items,'[]'::jsonb))
  order by p.ord
),'[]'::jsonb)
from jsonb_array_elements(coalesce(p_platforms,'[]'::jsonb)) with ordinality p(platform,ord)
left join lateral (
  select jsonb_agg(
    i.item || jsonb_build_object(
      'listing_id',l.id,
      'listing_title',coalesce(o.title,l.title,i.item->>'product_name'),
      'listing_status',coalesce(o.listing_status,i.item->>'listing_status'),
      'edition_year',coalesce(o.observed_year,case when (i.item->>'edition_year') ~ '^[0-9]+$' then (i.item->>'edition_year')::integer end),
      'image_url',coalesce(o.image_url,nullif(i.item->>'image_url','')),
      'price',o.price,
      'listing_category',o.category,
      'listing_note',o.note,
      'sync_status',coalesce(o.sync_status,'NONE')
    )
    order by i.iord
  ) as items
  from jsonb_array_elements(coalesce(p.platform->'items','[]'::jsonb)) with ordinality i(item,iord)
  left join public.commerce_preview_source_rows sr
    on sr.id=case when (i.item->>'source_row_id') ~ '^[0-9]+$' then (i.item->>'source_row_id')::bigint end
  left join lateral (
    select lx.*
    from public.commerce_preview_listings lx
    where lx.id=sr.matched_listing_id
       or (
         sr.matched_listing_id is null
         and nullif(i.item->>'listing_url','') is not null
         and lx.canonical_url=i.item->>'listing_url'
       )
    order by case when lx.id=sr.matched_listing_id then 0 else 1 end,lx.id
    limit 1
  ) l on true
  left join public.commerce_preview_listing_overrides o on o.listing_id=l.id
) e on true;
$$;

revoke execute on function public.commerce_enrich_management_platforms_v1(jsonb) from public, anon, authenticated;
grant execute on function public.commerce_enrich_management_platforms_v1(jsonb) to service_role;
revoke execute on function public.commerce_preview_enrich_management_platforms_v1(jsonb) from public, anon, authenticated;
grant execute on function public.commerce_preview_enrich_management_platforms_v1(jsonb) to service_role;
