-- Relatório "Anúncios sem vendas e que pararam" (Dashboard). Somente leitura.
-- Mesma janela de período do commerce_dashboard_overview_v1 (p_days: 7/30/60/90, 0 = tudo; p_month: AAAA-MM ou AAAA).
-- Linhas: ANUNCIO (todo o anúncio ativo sem venda no período) e VARIACAO (anúncio ativo que vende, mas uma variação cadastrada não vendeu).
-- Situação: PAROU (já vendeu 3+ unidades antes) ou SEM_VENDAS (nunca vendeu ou vendeu 1–2 unidades).
create or replace function public.commerce_sales_report_no_sales_v1(
  p_platform text default 'TODAS', p_days integer default 30, p_month text default null
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_days=0 then 36500 when p_days in (7,30,60,90) then p_days else 30 end days,
         case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then (p_month||'-01')::date when p_month ~ '^20[0-9]{2}$' then make_date(p_month::int,1,1) end ms,
         case when p_month ~ '^20[0-9]{2}$' then interval '1 year' else interval '1 month' end span
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where (p.plat='TODAS' or v.platform_code=p.plat)
    and v.sale_date < (now() at time zone 'America/Sao_Paulo')::date
), ref as (
  select max(sale_date) last_day from base
), wn as (
  select case when p.ms is not null then p.ms else r.last_day-p.days+1 end ws,
         case when p.ms is not null then least((p.ms+p.span)::date-1,r.last_day) else r.last_day end we
  from params p cross join ref r
), cat as (
  select l.id,l.external_listing_id,l.title,
    coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url,
    case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end src
  from public.commerce_listings l join public.commerce_marketplaces m on m.id=l.marketplace_id, params p
  where l.listing_status='ACTIVE'
    and (p.plat='TODAS' or (case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end)=p.plat)
), lst_sales as (
  select b.platform_code,b.external_listing_id,
    coalesce(sum(b.units) filter (where b.sale_date between w.ws and w.we),0) cur_units,
    max(b.sale_date) last_sale,sum(b.units) total_units
  from base b cross join wn w group by 1,2
), sku_raw as (
  select b.platform_code,b.external_listing_id,upper(regexp_replace(btrim(b.sku_norm),'[\s_]+','','g')) sku_key,
    coalesce(sum(b.units) filter (where b.sale_date between w.ws and w.we),0) cur_units,
    max(b.sale_date) last_sale,sum(b.units) total_units
  from base b cross join wn w where nullif(btrim(b.sku_norm),'') is not null group by 1,2,3
), sku_sales as (
  select platform_code,external_listing_id,public.commerce_sku_canon_v1(sku_key) sku_key,
    sum(cur_units) cur_units,max(last_sale) last_sale,sum(total_units) total_units
  from sku_raw group by 1,2,3
), vars as (
  select c.id listing_id,c.src,c.external_listing_id,c.title,c.url,
    nullif(lp.variation_name,'') variation_name,lp.platform_sku,
    public.commerce_sku_canon_v1(upper(regexp_replace(coalesce(lp.platform_sku,''),'[\s_]+','','g'))) sku_key
  from cat c join public.commerce_listing_products lp on lp.listing_id=c.id and lp.relation_status<>'REMOVED'
), var_count as (
  select listing_id,count(*) n from vars group by 1
), listing_rows as (
  select 'ANUNCIO'::text scope,c.src platform,c.external_listing_id,c.title,c.url,
    null::text variation_name,null::text sku,coalesce(vc.n,0) listing_variations,
    h.last_sale,coalesce(h.total_units,0) units_ever
  from cat c
  left join lst_sales h on h.platform_code=c.src and h.external_listing_id=c.external_listing_id
  left join var_count vc on vc.listing_id=c.id
  where coalesce(h.cur_units,0)=0
), variation_rows as (
  select 'VARIACAO'::text scope,v.src platform,v.external_listing_id,v.title,v.url,
    v.variation_name,v.platform_sku sku,vc.n listing_variations,
    s.last_sale,coalesce(s.total_units,0) units_ever
  from vars v
  join var_count vc on vc.listing_id=v.listing_id and vc.n>1
  join lst_sales h on h.platform_code=v.src and h.external_listing_id=v.external_listing_id and h.cur_units>0
  left join sku_sales s on s.platform_code=v.src and s.external_listing_id=v.external_listing_id and s.sku_key=v.sku_key
  where coalesce(s.cur_units,0)=0
), rows_all as (
  select r.*,case when r.units_ever>=3 then 'PAROU' else 'SEM_VENDAS' end situation,
    (select last_day from ref)-r.last_sale days_since
  from (select * from listing_rows union all select * from variation_rows) r
)
select jsonb_build_object(
  'platform',(select plat from params),
  'period_start',(select ws from wn),'period_end',(select we from wn),'data_until',(select last_day from ref),
  'generated_at',now(),
  'counts',jsonb_build_object(
    'listings',(select count(*) from cat),
    'rows',(select count(*) from rows_all),
    'by',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'scope',scope,'situation',situation,'n',n) order by platform,scope,situation)
        from (select platform,scope,situation,count(*) n from rows_all group by 1,2,3) g),'[]'::jsonb)),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'scope',scope,'situation',situation,
      'external_id',external_listing_id,'title',title,'url',url,'variation_name',variation_name,'sku',sku,
      'listing_variations',listing_variations,'last_sale',last_sale,'days_since',days_since,'units_ever',units_ever)
      order by platform,situation desc,scope,last_sale desc nulls last,title,variation_name)
      from (select * from rows_all order by platform,situation desc,scope,last_sale desc nulls last,title,variation_name limit 3000) x),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_report_no_sales_v1(text,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_sales_report_no_sales_v1(text,integer,text) to service_role;
