-- Shopee Ads reports are marketing attribution, NEVER sales order imports.
-- Grain: one export row / report snapshot. Different exports and report kinds never summed.
create table if not exists public.commerce_shopee_ads_reports_v1 (
 id bigint generated always as identity primary key,
 shop_id text not null check (shop_id ~ '^[0-9]{3,24}$'),
 shop_name text not null check (char_length(shop_name) between 1 and 200),
 report_kind text not null check(report_kind in ('GENERAL','TARGETING')),
 period_start date not null, period_end date not null,
 exported_at text not null,
 filename text not null check(char_length(filename) between 1 and 220),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 row_count int not null check(row_count between 1 and 1000),
 inserted_at timestamptz not null default now(),
 constraint ads_period_range check(period_end>=period_start and period_end-period_start<=366),
 unique(shop_id,report_kind,period_start,period_end,sha256)
);
create table if not exists public.commerce_shopee_ads_rows_v1 (
 report_id bigint not null references public.commerce_shopee_ads_reports_v1(id) on delete cascade,
 row_index int not null check(row_index between 1 and 1000),
 listing_id bigint references public.commerce_listings(id) on delete set null,
 external_product_id text,
 campaign_name text not null,
 target_label text,
 impressions bigint check(impressions is null or impressions>=0),
 clicks bigint check(clicks is null or clicks>=0),
 conversions bigint check(conversions is null or conversions>=0),
 items_sold bigint check(items_sold is null or items_sold>=0),
 ctr_pct numeric check(ctr_pct is null or ctr_pct between 0 and 100),
 conversion_pct numeric check(conversion_pct is null or conversion_pct between 0 and 100),
 gmv numeric check(gmv is null or gmv>=0),
 spend numeric check(spend is null or spend>=0),
 roas numeric check(roas is null or roas>=0),
 primary key(report_id,row_index)
);
create index if not exists commerce_shopee_ads_rows_listing_idx
 on public.commerce_shopee_ads_rows_v1(listing_id,report_id);
alter table public.commerce_shopee_ads_reports_v1 enable row level security;
alter table public.commerce_shopee_ads_rows_v1 enable row level security;
revoke all on public.commerce_shopee_ads_reports_v1,public.commerce_shopee_ads_rows_v1
 from public,anon,authenticated;
grant select,insert on public.commerce_shopee_ads_reports_v1,public.commerce_shopee_ads_rows_v1 to service_role;
grant usage,select on sequence public.commerce_shopee_ads_reports_v1_id_seq to service_role;

create or replace function public.commerce_shopee_ads_import_v1(p_report jsonb,p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=public
as $function$
declare v_id bigint; v_new boolean; v_count int; v_matched int;
begin
 if jsonb_typeof(p_report)<>'object' or jsonb_typeof(p_rows)<>'array'
   or jsonb_array_length(p_rows) not between 1 and 1000
   or coalesce(p_report->>'kind','') not in ('GENERAL','TARGETING')
   or coalesce(p_report->>'shop_id','') !~ '^[0-9]{3,24}$'
   or coalesce(p_report->>'sha256','') !~ '^[a-f0-9]{64}$'
   or nullif(btrim(coalesce(p_report->>'shop_name','')),'') is null
   or length(coalesce(p_report->>'shop_name',''))>200
   or length(coalesce(p_report->>'filename','')) not between 1 and 220
   or length(coalesce(p_report->>'exported_at','')) not between 8 and 60
 then raise exception 'Relatório Shopee Ads inválido.'; end if;
 if (p_report->>'start')::date is null or (p_report->>'end')::date is null
   or (p_report->>'end')::date < (p_report->>'start')::date
   or (p_report->>'end')::date - (p_report->>'start')::date > 366
 then raise exception 'Período Shopee Ads inválido.'; end if;
 insert into public.commerce_shopee_ads_reports_v1(
    shop_id,shop_name,report_kind,period_start,period_end,exported_at,filename,sha256,row_count)
 values(p_report->>'shop_id',p_report->>'shop_name',p_report->>'kind',
    (p_report->>'start')::date,(p_report->>'end')::date,p_report->>'exported_at',
    p_report->>'filename',p_report->>'sha256',jsonb_array_length(p_rows))
 on conflict(shop_id,report_kind,period_start,period_end,sha256) do nothing
 returning id into v_id;
 v_new:=v_id is not null;
 if not v_new then
   select id into v_id from public.commerce_shopee_ads_reports_v1
   where shop_id=p_report->>'shop_id' and report_kind=p_report->>'kind'
     and period_start=(p_report->>'start')::date and period_end=(p_report->>'end')::date
     and sha256=p_report->>'sha256';
   if v_id is null then raise exception 'Importação duplicada sem referência.'; end if;
 else
   with incoming as (
     select value v, ordinality::int row_no
     from jsonb_array_elements(p_rows) with ordinality
   ), validated as (
     select i.*, case when nullif(btrim(i.v->>'product_id'),'') ~ '^[0-9]{5,24}$'
       then i.v->>'product_id' else null end product_id
     from incoming i
   )
   insert into public.commerce_shopee_ads_rows_v1(
     report_id,row_index,listing_id,external_product_id,campaign_name,target_label,
     impressions,clicks,conversions,items_sold,ctr_pct,conversion_pct,gmv,spend,roas)
   select v_id,v.row_no,
     (select min(l.id) from public.commerce_listings l
       join public.commerce_marketplaces m on m.id=l.marketplace_id
       where m.code='SHOPEE' and l.external_listing_id=v.product_id
       having count(*)=1),
     v.product_id,
     left(coalesce(nullif(btrim(v.v->>'name'),''),'Sem nome'),300),
     left(nullif(btrim(v.v->>'target'),''),160),
     (v.v->>'impressions')::bigint,(v.v->>'clicks')::bigint,
     (v.v->>'conversions')::bigint,(v.v->>'items_sold')::bigint,
     (v.v->>'ctr_pct')::numeric,(v.v->>'conversion_pct')::numeric,
     (v.v->>'gmv')::numeric,(v.v->>'spend')::numeric,(v.v->>'roas')::numeric
   from validated v;
 end if;
 select count(*)::int,count(*) filter(where listing_id is not null)::int
 into v_count,v_matched from public.commerce_shopee_ads_rows_v1 where report_id=v_id;
 return jsonb_build_object('report_id',v_id,'created',v_new,'rows',v_count,
   'linked_products',v_matched,'non_product_or_unlinked',v_count-v_matched);
end;
$function$;

create or replace function public.commerce_shopee_ads_listing_v1(p_listing_id bigint)
returns jsonb language sql stable security invoker set search_path=public
as $function$
select coalesce(jsonb_agg(jsonb_build_object(
 'report_kind',v.report_kind,'start',v.period_start,'end',v.period_end,
 'exported_at',v.exported_at,'impressions',v.impressions,'clicks',v.clicks,
 'ctr_pct',v.ctr_pct,'conversions',v.conversions,'conversion_pct',v.conversion_pct,
 'items_sold',v.items_sold,'gmv',v.gmv,'spend',v.spend,'roas',v.roas,
 'target_label',v.target_label,'shop_name',v.shop_name,
 'filename',v.filename
 ) order by v.period_end desc,v.inserted_at desc),'[]'::jsonb)
from (select r.*,b.report_kind,b.period_start,b.period_end,b.exported_at,
      b.shop_name,b.filename,b.inserted_at
      from public.commerce_shopee_ads_rows_v1 r
      join public.commerce_shopee_ads_reports_v1 b on b.id=r.report_id
      where r.listing_id=p_listing_id
      order by b.period_end desc,b.inserted_at desc limit 12) v;
$function$;

revoke all on function public.commerce_shopee_ads_import_v1(jsonb,jsonb)
 from public,anon,authenticated;
revoke all on function public.commerce_shopee_ads_listing_v1(bigint)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_ads_import_v1(jsonb,jsonb) to service_role;
grant execute on function public.commerce_shopee_ads_listing_v1(bigint) to service_role;
