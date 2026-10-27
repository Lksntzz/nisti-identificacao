-- Desempenho por anuncio do Mercado Livre (visitas, vendas, conversao, qualidade), importado do relatorio
-- "Relatorio de desempenho das publicacoes" de cada conta (ANTIGO/NOVO). Dados ISOLADOS: nunca alteram vendas, pedidos nem SKUs.
-- O relatorio e um TOTAL do periodo (visitas por anuncio; vendas por variacao). Cada importacao e guardada com a sua data.
create table if not exists public.commerce_ml_performance_reports_v1 (
 id bigint generated always as identity primary key,
 sha256 text not null unique check(sha256 ~ '^[0-9a-f]{64}$'),
 filename text not null check(length(filename) between 1 and 220),
 account_code text not null check(account_code in ('ANTIGO','NOVO')),
 period_start date not null, period_end date not null,
 row_count int not null check(row_count between 1 and 5000),
 imported_at timestamptz not null default now(),
 constraint ml_performance_period check(period_end>=period_start and period_end-period_start<=400)
);
create table if not exists public.commerce_ml_performance_rows_v1 (
 report_id bigint not null references public.commerce_ml_performance_reports_v1(id) on delete cascade,
 row_no int not null,
 external_listing_id text not null check(external_listing_id ~ '^MLB[0-9]{6,14}$'),
 listing_id bigint references public.commerce_listings(id) on delete set null,
 title text check(length(title)<=300),
 status_text text check(length(status_text)<=40),
 variation text check(length(variation)<=200),
 sku text check(length(sku)<=120),
 quality text check(length(quality)<=40),
 experience text check(length(experience)<=40),
 visits bigint check(visits is null or visits>=0),
 sales_count bigint check(sales_count is null or sales_count>=0),
 buyers bigint check(buyers is null or buyers>=0),
 units bigint check(units is null or units>=0),
 gross_sales numeric(14,2) check(gross_sales is null or gross_sales>=0),
 reviews_total bigint check(reviews_total is null or reviews_total>=0),
 reviews_bad bigint check(reviews_bad is null or reviews_bad>=0),
 reviews_good bigint check(reviews_good is null or reviews_good>=0),
 primary key(report_id,row_no)
);
create index if not exists ml_performance_rows_listing_idx on public.commerce_ml_performance_rows_v1(external_listing_id,report_id);
alter table public.commerce_ml_performance_reports_v1 enable row level security;
alter table public.commerce_ml_performance_rows_v1 enable row level security;
revoke all on public.commerce_ml_performance_reports_v1,public.commerce_ml_performance_rows_v1 from public,anon,authenticated;
grant select,insert on public.commerce_ml_performance_reports_v1,public.commerce_ml_performance_rows_v1 to service_role;
grant usage,select on sequence public.commerce_ml_performance_reports_v1_id_seq to service_role;

create or replace function public.commerce_ml_performance_import_v1(p_report jsonb,p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=public
as $fn$
declare v_id bigint; v_rows int; v_linked int; v_market bigint; v_acc text;
begin
 if jsonb_typeof(p_report)<>'object' or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 5000
    or coalesce(p_report->>'sha256','') !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_report->>'filename','')) not between 1 and 220
    or coalesce(p_report->>'account','') not in ('ANTIGO','NOVO')
    or coalesce(p_report->>'start','') !~ '^20\d\d-\d\d-\d\d$'
    or coalesce(p_report->>'end','') !~ '^20\d\d-\d\d-\d\d$'
    or (p_report->>'end')::date < (p_report->>'start')::date
    or ((p_report->>'end')::date-(p_report->>'start')::date)>400
 then raise exception 'Relatório de desempenho do Mercado Livre inválido.'; end if;
 if exists (select 1 from jsonb_array_elements(p_rows) x(v)
            where jsonb_typeof(x.v)<>'object' or coalesce(x.v->>'listing_id','') !~ '^MLB[0-9]{6,14}$')
 then raise exception 'Linhas de desempenho inválidas.'; end if;
 v_acc:=p_report->>'account';
 select id into v_market from public.commerce_marketplaces where code='MERCADO_LIVRE';
 -- Protecao contra conta errada: pelo menos 40% dos anuncios do arquivo precisam existir no catalogo da conta escolhida.
 if (select count(distinct x.v->>'listing_id') filter (where exists (
        select 1 from public.commerce_listings l where l.marketplace_id=v_market
          and upper(coalesce(l.account_code,''))=v_acc and l.external_listing_id=x.v->>'listing_id'))::numeric
        / nullif(count(distinct x.v->>'listing_id'),0)
     from jsonb_array_elements(p_rows) x(v)) < 0.40
 then raise exception 'Menos de 40%% dos anúncios do arquivo existem na conta %. Confira se escolheu a conta certa.',v_acc; end if;
 insert into public.commerce_ml_performance_reports_v1(sha256,filename,account_code,period_start,period_end,row_count)
 values (p_report->>'sha256',p_report->>'filename',v_acc,(p_report->>'start')::date,(p_report->>'end')::date,jsonb_array_length(p_rows))
 on conflict (sha256) do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from public.commerce_ml_performance_reports_v1 where sha256=p_report->>'sha256';
   return jsonb_build_object('created',false,'report_id',v_id);
 end if;
 insert into public.commerce_ml_performance_rows_v1(report_id,row_no,external_listing_id,listing_id,title,status_text,variation,sku,
   quality,experience,visits,sales_count,buyers,units,gross_sales,reviews_total,reviews_bad,reviews_good)
 select v_id,(x.ord)::int,x.v->>'listing_id',
   (select l.id from public.commerce_listings l where l.marketplace_id=v_market and upper(coalesce(l.account_code,''))=v_acc
      and l.external_listing_id=x.v->>'listing_id' limit 1),
   left(x.v->>'title',300),left(x.v->>'status',40),left(x.v->>'variation',200),left(x.v->>'sku',120),
   left(x.v->>'quality',40),left(x.v->>'experience',40),
   (x.v->>'visits')::bigint,(x.v->>'sales')::bigint,(x.v->>'buyers')::bigint,(x.v->>'units')::bigint,
   (x.v->>'gross')::numeric,(x.v->>'reviews')::bigint,(x.v->>'bad')::bigint,(x.v->>'good')::bigint
 from jsonb_array_elements(p_rows) with ordinality x(v,ord);
 get diagnostics v_rows=row_count;
 select count(*) into v_linked from public.commerce_ml_performance_rows_v1 where report_id=v_id and listing_id is not null;
 return jsonb_build_object('created',true,'report_id',v_id,'rows',v_rows,'linked',v_linked,'unlinked',v_rows-v_linked);
end $fn$;
revoke all on function public.commerce_ml_performance_import_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_ml_performance_import_v1(jsonb,jsonb) to service_role;

-- Leitura (somente leitura): ultimo relatorio de cada conta, somado por anuncio.
-- Visitas e dado do anuncio (repetido em cada variacao): usa o maior valor; vendas/unidades/faturamento somam as variacoes.
create or replace function public.commerce_ml_performance_latest_v1()
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with last as (
  select distinct on (account_code) id,account_code,filename,period_start,period_end,imported_at
  from public.commerce_ml_performance_reports_v1 order by account_code,period_end desc,id desc
), agg as (
  select l.account_code,r.external_listing_id,
    max(r.visits) visits,sum(r.sales_count) sales,sum(r.units) units,sum(r.gross_sales) gross,
    max(r.status_text) status_text,max(r.quality) quality,max(r.experience) experience
  from last l join public.commerce_ml_performance_rows_v1 r on r.report_id=l.id
  group by l.account_code,r.external_listing_id
)
select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(jsonb_build_object('account',account_code,'filename',filename,
      'start',period_start,'end',period_end,'imported_at',imported_at) order by account_code) from last),'[]'::jsonb),
  'items',coalesce((select jsonb_object_agg(external_listing_id,jsonb_build_object(
      'account',account_code,'visits',visits,'sales',sales,'units',units,'gross',gross,
      'conversion_pct',case when visits>0 then round(sales::numeric/visits*100,2) end,
      'status',status_text,'quality',quality,'experience',experience)) from agg),'{}'::jsonb));
$fn$;
revoke all on function public.commerce_ml_performance_latest_v1() from public,anon,authenticated;
grant execute on function public.commerce_ml_performance_latest_v1() to service_role;
