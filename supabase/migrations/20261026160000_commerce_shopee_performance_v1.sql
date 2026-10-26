-- Desempenho por anuncio da Shopee (impressoes, cliques, visitas, pedidos), importado do relatorio
-- "parentskudetail" da Central do Vendedor. Dados ISOLADOS: nunca alteram vendas, pedidos nem SKUs.
create table if not exists public.commerce_shopee_performance_reports_v1 (
 id bigint generated always as identity primary key,
 sha256 text not null unique check(sha256 ~ '^[0-9a-f]{64}$'),
 filename text not null check(length(filename) between 1 and 220),
 period_start date not null, period_end date not null,
 row_count int not null check(row_count between 1 and 3000),
 imported_at timestamptz not null default now(),
 constraint shopee_performance_period check(period_end>=period_start and period_end-period_start<=93)
);
create table if not exists public.commerce_shopee_performance_rows_v1 (
 report_id bigint not null references public.commerce_shopee_performance_reports_v1(id) on delete cascade,
 external_item_id text not null check(external_item_id ~ '^[0-9]{5,20}$'),
 listing_id bigint references public.commerce_listings(id) on delete set null,
 product_name text check(length(product_name)<=300),
 impressions bigint check(impressions is null or impressions>=0),
 clicks bigint check(clicks is null or clicks>=0),
 visitors bigint check(visitors is null or visitors>=0),
 page_views bigint check(page_views is null or page_views>=0),
 add_cart_visitors bigint check(add_cart_visitors is null or add_cart_visitors>=0),
 orders_placed bigint check(orders_placed is null or orders_placed>=0),
 units_placed bigint check(units_placed is null or units_placed>=0),
 buyers_placed bigint check(buyers_placed is null or buyers_placed>=0),
 revenue_placed numeric(14,2) check(revenue_placed is null or revenue_placed>=0),
 revenue_paid numeric(14,2) check(revenue_paid is null or revenue_paid>=0),
 primary key(report_id,external_item_id)
);
create index if not exists shopee_performance_rows_listing_idx on public.commerce_shopee_performance_rows_v1(listing_id,report_id);
alter table public.commerce_shopee_performance_reports_v1 enable row level security;
alter table public.commerce_shopee_performance_rows_v1 enable row level security;
revoke all on public.commerce_shopee_performance_reports_v1,public.commerce_shopee_performance_rows_v1 from public,anon,authenticated;
grant select,insert on public.commerce_shopee_performance_reports_v1,public.commerce_shopee_performance_rows_v1 to service_role;
grant usage,select on sequence public.commerce_shopee_performance_reports_v1_id_seq to service_role;

create or replace function public.commerce_shopee_performance_import_v1(p_report jsonb,p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=public
as $fn$
declare v_id bigint; v_rows int; v_linked int; v_market bigint;
begin
 if jsonb_typeof(p_report)<>'object' or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 3000
    or coalesce(p_report->>'sha256','') !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_report->>'filename','')) not between 1 and 220
    or coalesce(p_report->>'start','') !~ '^20\d\d-\d\d-\d\d$'
    or coalesce(p_report->>'end','') !~ '^20\d\d-\d\d-\d\d$'
    or (p_report->>'end')::date < (p_report->>'start')::date
    or ((p_report->>'end')::date-(p_report->>'start')::date)>93
 then raise exception 'Relatório de desempenho inválido.'; end if;
 if exists (select 1 from jsonb_array_elements(p_rows) x(v)
            where jsonb_typeof(x.v)<>'object' or coalesce(x.v->>'item_id','') !~ '^[0-9]{5,20}$')
    or (select count(*)<>count(distinct v->>'item_id') from jsonb_array_elements(p_rows) x(v))
 then raise exception 'Linhas de desempenho inválidas ou duplicadas.'; end if;
 select id into v_market from public.commerce_marketplaces where code='SHOPEE';
 insert into public.commerce_shopee_performance_reports_v1(sha256,filename,period_start,period_end,row_count)
 values (p_report->>'sha256',p_report->>'filename',(p_report->>'start')::date,(p_report->>'end')::date,jsonb_array_length(p_rows))
 on conflict (sha256) do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from public.commerce_shopee_performance_reports_v1 where sha256=p_report->>'sha256';
   return jsonb_build_object('created',false,'report_id',v_id);
 end if;
 insert into public.commerce_shopee_performance_rows_v1(report_id,external_item_id,listing_id,product_name,
   impressions,clicks,visitors,page_views,add_cart_visitors,orders_placed,units_placed,buyers_placed,revenue_placed,revenue_paid)
 select v_id,x.v->>'item_id',
   (select l.id from public.commerce_listings l where l.marketplace_id=v_market and btrim(l.external_listing_id)=x.v->>'item_id' limit 1),
   left(x.v->>'name',300),
   (x.v->>'impressions')::bigint,(x.v->>'clicks')::bigint,(x.v->>'visitors')::bigint,(x.v->>'page_views')::bigint,
   (x.v->>'add_cart_visitors')::bigint,(x.v->>'orders')::bigint,(x.v->>'units')::bigint,(x.v->>'buyers')::bigint,
   (x.v->>'revenue')::numeric,(x.v->>'revenue_paid')::numeric
 from jsonb_array_elements(p_rows) x(v);
 get diagnostics v_rows=row_count;
 select count(*) into v_linked from public.commerce_shopee_performance_rows_v1 where report_id=v_id and listing_id is not null;
 return jsonb_build_object('created',true,'report_id',v_id,'rows',v_rows,'linked',v_linked,'unlinked',v_rows-v_linked);
end $fn$;
revoke all on function public.commerce_shopee_performance_import_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_shopee_performance_import_v1(jsonb,jsonb) to service_role;

-- Leitura: compara o relatorio mais recente de cada anuncio com o anterior (sem sobreposicao),
-- normalizando por dia. Mostra qual indicador mais explica a variacao das vendas. Correlacao, nao prova de causa.
create or replace function public.commerce_listing_performance_diagnosis_v1(p_listing_ids bigint[])
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with ids as (
  select distinct unnest(coalesce(p_listing_ids,'{}')) lid
  where cardinality(coalesce(p_listing_ids,'{}'))<=200
), cur as (
  select distinct on (r.listing_id) r.*,rp.period_start ps,rp.period_end pe,rp.id rid,
    (rp.period_end-rp.period_start+1) days
  from public.commerce_shopee_performance_rows_v1 r
  join public.commerce_shopee_performance_reports_v1 rp on rp.id=r.report_id
  where r.listing_id in (select lid from ids)
  order by r.listing_id,rp.period_end desc,rp.id desc
), prev as (
  select distinct on (c.listing_id) c.listing_id,r.impressions,r.clicks,r.orders_placed,r.units_placed,
    r.revenue_placed,rp.period_start ps,rp.period_end pe,(rp.period_end-rp.period_start+1) days
  from cur c
  join public.commerce_shopee_performance_rows_v1 r on r.listing_id=c.listing_id
  join public.commerce_shopee_performance_reports_v1 rp on rp.id=r.report_id
  where rp.period_end<c.ps and (rp.period_end-rp.period_start+1)>=7
  order by c.listing_id,rp.period_end desc,rp.id desc
), calc as (
  select c.listing_id,c.ps cps,c.pe cpe,p.ps pps,p.pe ppe,
    c.impressions::numeric/c.days ci, p.impressions::numeric/p.days pimp,
    c.clicks::numeric/nullif(c.impressions,0) cctr, p.clicks::numeric/nullif(p.impressions,0) pctr,
    c.orders_placed::numeric/nullif(c.clicks,0) cconv, p.orders_placed::numeric/nullif(p.clicks,0) pconv,
    c.revenue_placed/nullif(c.units_placed,0) cprice, p.revenue_placed/nullif(p.units_placed,0) pprice,
    c.units_placed::numeric/c.days cu, p.units_placed::numeric/p.days pu,
    c.clicks cc, p.clicks pc, c.units_placed cun, p.units_placed pun
  from cur c join prev p using(listing_id)
), pct as (
  select k.*,
    round((ci/nullif(pimp,0)-1)*100,1) imp_pct, round((cctr/nullif(pctr,0)-1)*100,1) ctr_pct,
    round((cconv/nullif(pconv,0)-1)*100,1) conv_pct, round((cprice/nullif(pprice,0)-1)*100,1) price_pct,
    round((cu/nullif(pu,0)-1)*100,1) units_pct
  from calc k
)
select coalesce(jsonb_object_agg(listing_id::text,jsonb_build_object(
  'current_start',cps,'current_end',cpe,'previous_start',pps,'previous_end',ppe,
  'impressions_pct',imp_pct,'ctr_pct',ctr_pct,'conversion_pct',conv_pct,'price_pct',price_pct,'units_pct',units_pct,
  'driver',case
    when cc<30 or pc<30 or coalesce(cun,0)+coalesce(pun,0)<10 then 'INSUFFICIENT'
    when units_pct<=-15 then coalesce((select d from (values ('IMPRESSIONS',imp_pct),('CTR',ctr_pct),('CONVERSION',conv_pct)) t(d,v)
        where v is not null and v<=-10 order by v limit 1),'OTHER')
    when units_pct>=15 then coalesce((select d from (values ('IMPRESSIONS',imp_pct),('CTR',ctr_pct),('CONVERSION',conv_pct)) t(d,v)
        where v is not null and v>=10 order by v desc limit 1),'OTHER')
    else 'STABLE' end,
  'trend',case when units_pct<=-15 then 'DOWN' when units_pct>=15 then 'UP' else 'FLAT' end
)),'{}'::jsonb) from pct;
$fn$;
revoke all on function public.commerce_listing_performance_diagnosis_v1(bigint[]) from public,anon,authenticated;
grant execute on function public.commerce_listing_performance_diagnosis_v1(bigint[]) to service_role;
