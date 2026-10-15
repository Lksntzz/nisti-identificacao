-- One NISTI product per SKU; keep every active marketplace listing as a distinct sales channel.
-- Manual figures are deliberately independent from imported commerce_sales_rows.
create table if not exists public.commerce_manual_listing_sales (
  listing_id bigint not null references public.commerce_listings(id) on delete cascade,
  nisti_product_id bigint not null references public.products(id) on delete cascade,
  period_month date not null,
  units integer not null check (units between 0 and 100000000),
  entered_by text not null default 'Administrador',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_manual_listing_sales_month_first check (extract(day from period_month)=1),
  primary key (listing_id,nisti_product_id,period_month)
);
create index if not exists commerce_manual_listing_sales_period_idx
 on public.commerce_manual_listing_sales(period_month,nisti_product_id);
alter table public.commerce_manual_listing_sales enable row level security;
revoke all on public.commerce_manual_listing_sales from public,anon,authenticated;
grant select,insert,update on public.commerce_manual_listing_sales to service_role;

create or replace function public.commerce_sku_listing_groups_v1(
 p_search text default null,
 p_marketplace_code text default null,
 p_period_month date default null,
 p_limit integer default 25,
 p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with requested as (
 select nullif(btrim(p_search),'') as search,
        nullif(upper(btrim(p_marketplace_code)),'') as marketplace,
        coalesce(p_period_month,date_trunc('month',current_date)::date) as period_month
), pairs as (
  select distinct on (p.id,l.id)
    p.id product_id,p.sku,p.nome,p.variacao,p.image_key,
    l.id listing_id,l.external_listing_id,l.title listing_title,l.canonical_url,
    l.account_code,l.listing_status,
    m.code marketplace_code,m.name marketplace_name,
    lp.platform_sku,lp.variation_id,lp.variation_name
  from public.products p
  join public.commerce_nisti_product_links nl on nl.nisti_product_id=p.id
    and nl.sync_status='SYNCED'
  join public.commerce_listing_products lp on lp.product_id=nl.commerce_product_id
    and lp.relation_status<>'REMOVED'
  join public.commerce_listings l on l.id=lp.listing_id and l.listing_status='ACTIVE'
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join requested r
  where (r.marketplace is null or m.code=r.marketplace)
    and (r.search is null or p.sku ilike '%'||r.search||'%'
         or p.nome ilike '%'||r.search||'%'
         or l.external_listing_id ilike '%'||r.search||'%'
         or l.title ilike '%'||r.search||'%')
  order by p.id,l.id,lp.variation_id nulls first,lp.id
), product_ids as (
  select distinct product_id,sku,nome,variacao,image_key from pairs
), numbered as (
  select *,count(*) over () total_count
  from product_ids
), page as (
  select * from numbered order by sku,product_id
  limit greatest(1,least(coalesce(p_limit,25),100))
  offset greatest(coalesce(p_offset,0),0)
), entries as (
  select page.product_id,page.sku,page.nome,page.variacao,page.image_key,page.total_count,
  jsonb_agg(jsonb_build_object(
    'listing_id',p.listing_id,
    'external_listing_id',p.external_listing_id,
    'title',p.listing_title,
    'url',p.canonical_url,
    'marketplace_code',p.marketplace_code,
    'marketplace_name',p.marketplace_name,
    'account_code',p.account_code,
    'platform_sku',p.platform_sku,
    'variation_id',p.variation_id,
    'variation_name',p.variation_name,
    'manual_units',s.units,
    'last_entered_by',s.entered_by
  ) order by p.marketplace_code,p.account_code,p.external_listing_id) as listings
  from page
  join pairs p on p.product_id=page.product_id
  cross join requested r
  left join public.commerce_manual_listing_sales s
    on s.nisti_product_id=page.product_id and s.listing_id=p.listing_id
   and s.period_month=r.period_month
  group by page.product_id,page.sku,page.nome,page.variacao,page.image_key,page.total_count
)
select jsonb_build_object(
 'items',coalesce((
  select jsonb_agg(jsonb_build_object(
    'product_id',e.product_id,
    'sku',e.sku,
    'product_name',e.nome,
    'variation',e.variacao,
    'image_url',case when nullif(btrim(e.image_key),'') is not null
       then '/api/images/'||e.product_id::text else null end,
    'listings',e.listings
  ) order by e.sku,e.product_id)
  from entries e
 ),'[]'::jsonb),
 'total',coalesce((select max(total_count) from numbered),0),
 'period_month',(select period_month from requested)
);
$function$;

create or replace function public.commerce_save_listing_sales_v1(
 p_listing_id bigint,
 p_nisti_product_id bigint,
 p_period_month date,
 p_units integer,
 p_actor text default 'Administrador'
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp
as $function$
begin
 if p_listing_id is null or p_nisti_product_id is null
   or p_period_month is null or extract(day from p_period_month)<>1
   or p_units is null or p_units<0 or p_units>100000000 then
   raise exception 'invalid_listing_sales_input' using errcode='22023';
 end if;
 if not exists (
   select 1 from public.commerce_listing_products lp
   join public.commerce_nisti_product_links nl on nl.commerce_product_id=lp.product_id
   join public.commerce_listings l on l.id=lp.listing_id
   where lp.listing_id=p_listing_id
     and nl.nisti_product_id=p_nisti_product_id
     and nl.sync_status='SYNCED'
     and lp.relation_status<>'REMOVED'
     and l.listing_status='ACTIVE'
 ) then
   raise exception 'listing_product_link_not_verified' using errcode='22023';
 end if;
 insert into public.commerce_manual_listing_sales
  (listing_id,nisti_product_id,period_month,units,entered_by)
 values (p_listing_id,p_nisti_product_id,p_period_month,p_units,
         coalesce(nullif(btrim(p_actor),''),'Administrador'))
 on conflict(listing_id,nisti_product_id,period_month)
 do update set units=excluded.units,entered_by=excluded.entered_by,updated_at=now();
 return jsonb_build_object('status','ok','listing_id',p_listing_id,
   'product_id',p_nisti_product_id,'period_month',p_period_month,'units',p_units);
end;
$function$;

revoke all on function public.commerce_sku_listing_groups_v1(text,text,date,integer,integer) from public,anon,authenticated;
revoke all on function public.commerce_save_listing_sales_v1(bigint,bigint,date,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_sku_listing_groups_v1(text,text,date,integer,integer) to service_role;
grant execute on function public.commerce_save_listing_sales_v1(bigint,bigint,date,integer,text) to service_role;
