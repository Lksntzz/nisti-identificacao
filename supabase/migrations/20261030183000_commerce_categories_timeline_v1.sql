-- Painel Categorias: série mensal por categoria/subcategoria e semanas do mês selecionado.
-- Somente leitura; não materializa vendas nem regrava histórico do scanner.
create or replace function public.commerce_categories_timeline_v1(
  p_platform text default 'SHOPEE',
  p_year integer default 2026,
  p_cat text default null,
  p_month integer default 1,
  p_sub text default null,
  p_week integer default null
) returns jsonb
language sql stable security invoker
set search_path to 'public'
as $fn$
with prm as (
  select plat,y,b,as_of,
    least(extract(day from as_of)::integer,
      extract(day from (make_date(b,extract(month from as_of)::integer,1)+interval '1 month - 1 day')::date)::integer) as cut_day
  from public.commerce_period_v1(p_platform,p_year,'ytd',null,null)
  where p_platform in ('SHOPEE','ML_ANTIGO','ML_NOVO','TODAS')
    and p_year between 2021 and 2100
    and p_month between 1 and 12
    and p_cat is not null and length(p_cat) between 1 and 120
    and (p_sub is null or length(p_sub) between 1 and 120)
    and (p_week is null or p_week between 1 and 5)
), sales as materialized (
  select d.sale_date,public.commerce_sku_canon_v1(d.sku_norm) as sku,
    d.units
  from public.commerce_shopee_sales_sku_daily_v1 d cross join prm p
  where p.plat in ('SHOPEE','TODAS')
    and d.sale_date>=make_date(p.b,1,1)
    and d.sale_date<make_date(p.y+1,1,1)
    and (extract(year from d.sale_date)::integer=p.b or d.sale_date<=p.as_of)
  union all
  select v.sale_date,public.commerce_sku_canon_v1(v.sku_norm),v.units
  from public.commerce_current_sales_listing_daily_v1 v cross join prm p
  where p.plat <> 'SHOPEE' and v.platform_code like 'ML%'
    and (p.plat='TODAS' or v.platform_code=p.plat)
    and v.sale_date>=make_date(p.b,1,1)
    and v.sale_date<make_date(p.y+1,1,1)
    and (extract(year from v.sale_date)::integer=p.b or v.sale_date<=p.as_of)
), skus as (select distinct sku from sales),
classified as materialized (
  select s.sale_date,s.sku,s.units,
    coalesce(c.name,'Sem categoria') cat,
    coalesce(sc.name,'Sem subcategoria') sub,
    extract(year from s.sale_date)::integer yr,
    extract(month from s.sale_date)::integer mon,
    least(((extract(day from s.sale_date)::integer-1)/7)+1,5) wk
  from sales s
  left join public.commerce_sku_category_v1 e on e.sku_norm=s.sku
  left join lateral (
    select r.category_id,r.subcategory_id
    from public.commerce_sku_prefix_rules_v1 r
    where e.sku_norm is null and s.sku like r.prefix||'%'
    order by length(r.prefix) desc limit 1
  ) pref on true
  left join public.commerce_categories c on c.id=coalesce(e.category_id,pref.category_id)
  left join public.commerce_subcategories sc on sc.id=coalesce(e.subcategory_id,pref.subcategory_id)
), monthly_category as (
  select cat,yr,mon,sum(units)::bigint units
  from classified group by 1,2,3
), monthly_sub as (
  select sub,yr,mon,sum(units)::bigint units
  from classified cross join prm p where cat=p_cat
  group by 1,2,3
), weekly_sub as (
  select sub,wk,yr,sum(units)::bigint units
  from classified cross join prm p
  where cat=p_cat and mon=p_month
    and (yr=p.y or (yr=p.b and (p_month<>extract(month from p.as_of)::integer
      or extract(day from sale_date)::integer<=p.cut_day)))
  group by 1,2,3
), sub_totals as (
  select cat,sub,
    coalesce(sum(units) filter (where yr=p.y),0)::bigint cur,
    coalesce(sum(units) filter (where yr=p.b and
      (mon<extract(month from p.as_of)::integer
       or (mon=extract(month from p.as_of)::integer and extract(day from sale_date)::integer<=p.cut_day))),0)::bigint base
  from classified cross join prm p
  where (yr=p.y or yr=p.b and (mon<extract(month from p.as_of)::integer
       or (mon=extract(month from p.as_of)::integer and extract(day from sale_date)::integer<=p.cut_day)))
  group by 1,2
), selected_skus as (
  select s.sku,
    coalesce(sum(s.units) filter (where s.yr=p.y),0)::bigint cur,
    coalesce(sum(s.units) filter (where s.yr=p.b),0)::bigint base
  from classified s cross join prm p
  where s.cat=p_cat and (p_sub is null or s.sub=p_sub) and s.mon=p_month
    and (p_week is null or s.wk=p_week)
    and (s.yr=p.y or (s.yr=p.b and (p_month<>extract(month from p.as_of)::integer
      or extract(day from s.sale_date)::integer<=p.cut_day)))
  group by 1
), leading_products as (
  select s.* from selected_skus s order by s.cur desc,s.base desc,s.sku limit 8
), images as (
  select distinct on (c.name) c.name cat,p.reference_image_url url
  from public.commerce_products p
  join public.commerce_categories c on c.id=p.category_id
  where p.reference_image_url like '/api/images/%'
  order by c.name,p.id desc
)
select jsonb_build_object(
  'platform',(select plat from prm),'year',(select y from prm),
  'base_year',(select b from prm),'as_of',(select as_of from prm),
  'category',p_cat,'subcategory',p_sub,'month',p_month,'week',p_week,
  'category_months',coalesce((select jsonb_agg(jsonb_build_object('cat',cat,'year',yr,'month',mon,'units',units)
     order by yr,mon,cat) from monthly_category),'[]'::jsonb),
  'subcategory_months',coalesce((select jsonb_agg(jsonb_build_object('sub',sub,'year',yr,'month',mon,'units',units)
     order by yr,mon,sub) from monthly_sub),'[]'::jsonb),
  'weekly_subcategories',coalesce((select jsonb_agg(jsonb_build_object('sub',sub,'year',yr,'week',wk,'units',units)
     order by yr,wk,sub) from weekly_sub),'[]'::jsonb),
  'subcategories',coalesce((select jsonb_agg(jsonb_build_object('cat',cat,'name',sub,'cur',cur,'base',base)
     order by cur desc,sub) from sub_totals cross join prm p where cat=p_cat),'[]'::jsonb),
  'leader_subcategory',(select jsonb_build_object('category',cat,'name',sub,'cur',cur)
     from sub_totals where cur>0 order by cur desc,cat,sub limit 1),
  'category_images',coalesce((select jsonb_agg(jsonb_build_object('category',cat,'image',url) order by cat)
     from images),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object(
      'sku',q.sku,'cur',q.cur,'base',q.base,'name',coalesce(meta.name,q.sku),
      'image',meta.image,'url',link.url,'listing_id',link.listing_id
    ) order by q.cur desc,q.base desc,q.sku)
    from leading_products q
    left join lateral (
      select p.name,p.reference_image_url image
      from public.commerce_product_skus ps
      join public.commerce_products p on p.id=ps.product_id
      where public.commerce_sku_canon_v1(ps.sku)=q.sku
      order by (p.reference_image_url like '/api/images/%') desc,p.id desc limit 1
    ) meta on true
    left join lateral (
      select l.external_listing_id listing_id,coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url
      from public.commerce_listing_products lp
      join public.commerce_listings l on l.id=lp.listing_id
      join public.commerce_marketplaces m on m.id=l.marketplace_id
      cross join prm p
      where public.commerce_sku_canon_v1(lp.platform_sku)=q.sku
        and lp.relation_status<>'REMOVED'
        and ((p.plat='SHOPEE' and m.code='SHOPEE')
          or (p.plat like 'ML_%' and m.code='MERCADO_LIVRE'
            and l.account_code=case when p.plat='ML_NOVO' then 'NOVO' else 'ANTIGO' end)
          or p.plat='TODAS')
      order by (l.listing_status='ACTIVE') desc,l.id desc limit 1
    ) link on true
  ),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_categories_timeline_v1(text,integer,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.commerce_categories_timeline_v1(text,integer,text,integer,text,integer) to service_role;
