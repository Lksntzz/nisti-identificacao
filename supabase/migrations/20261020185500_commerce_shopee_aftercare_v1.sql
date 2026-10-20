-- Isolated Shopee Returns/Refunds audit trail. NEVER edits confirmed sales or Scanner.
create table if not exists public.commerce_shopee_aftercare_reports_v1 (
 id bigint generated always as identity primary key,
 sha256 text not null unique check(sha256 ~ '^[0-9a-f]{64}$'),
 filename text not null check(length(filename) between 1 and 220),
 period_start date not null, period_end date not null,
 imported_at timestamptz not null default now(),
 constraint aftercare_period check(period_end>=period_start and period_end-period_start<=366),
 request_count int not null check(request_count between 1 and 3000),
 item_count int not null check(item_count between 1 and 5000)
);
create table if not exists public.commerce_shopee_aftercare_requests_v1 (
 report_id bigint not null references public.commerce_shopee_aftercare_reports_v1(id) on delete cascade,
 return_id text not null check(length(return_id) between 8 and 48),
 order_id text not null check(length(order_id) between 5 and 48),
 requested_at timestamptz,
 order_created_at timestamptz,
 status text not null check(length(status) between 1 and 120),
 solution text check(length(solution)<=120),
 reason text check(length(reason)<=250),
 tracking_status text check(length(tracking_status)<=100),
 refund_requested numeric(14,2) check(refund_requested is null or refund_requested>=0),
 primary key(report_id,return_id)
);
create table if not exists public.commerce_shopee_aftercare_items_v1 (
 report_id bigint not null,
 return_id text not null,
 row_no int not null check(row_no between 1 and 5000),
 sku text not null check(length(sku) between 1 and 160),
 quantity int not null check(quantity between 1 and 10000),
 listing_id bigint references public.commerce_listings(id) on delete set null,
 primary key(report_id,return_id,row_no),
 foreign key(report_id,return_id) references public.commerce_shopee_aftercare_requests_v1(report_id,return_id) on delete cascade
);
create index if not exists shopee_aftercare_items_listing_idx on public.commerce_shopee_aftercare_items_v1(listing_id,report_id,return_id);
create index if not exists shopee_aftercare_requests_date_idx on public.commerce_shopee_aftercare_requests_v1(requested_at);
alter table public.commerce_shopee_aftercare_reports_v1 enable row level security;
alter table public.commerce_shopee_aftercare_requests_v1 enable row level security;
alter table public.commerce_shopee_aftercare_items_v1 enable row level security;
revoke all on public.commerce_shopee_aftercare_reports_v1,public.commerce_shopee_aftercare_requests_v1,public.commerce_shopee_aftercare_items_v1 from public,anon,authenticated;
grant select,insert on public.commerce_shopee_aftercare_reports_v1,public.commerce_shopee_aftercare_requests_v1,public.commerce_shopee_aftercare_items_v1 to service_role;
grant usage,select on sequence public.commerce_shopee_aftercare_reports_v1_id_seq to service_role;

create or replace function public.commerce_shopee_aftercare_import_v1(p_report jsonb,p_requests jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=public
as $fn$
declare v_id bigint; v_created boolean; v_reqs int; v_items int; v_linked int;
begin
 if jsonb_typeof(p_report)<>'object' or jsonb_typeof(p_requests)<>'array' 
    or jsonb_array_length(p_requests) not between 1 and 3000
    or coalesce(p_report->>'sha256','') !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_report->>'filename','')) not between 1 and 220
    or (p_report->>'start')::date is null
    or (p_report->>'end')::date is null
    or (p_report->>'end')::date < (p_report->>'start')::date
    or ((p_report->>'end')::date-(p_report->>'start')::date)>366
 then raise exception 'Relatório de pós-venda inválido.'; end if;
 -- Defensive checks before any write: no duplicates within request set, valid
 -- identifiers, bounded nested items, no raw contact/address data.
 if exists (select 1 from jsonb_array_elements(p_requests) x(v)
    where jsonb_typeof(x.v)<>'object'
     or coalesce(x.v->>'return_id','') !~ '^[a-zA-Z0-9_-]{8,48}$'
     or coalesce(x.v->>'order_id','') !~ '^[a-zA-Z0-9_-]{5,48}$'
     or length(coalesce(x.v->>'status','')) not between 1 and 120
     or jsonb_typeof(x.v->'items')<>'array'
     or jsonb_array_length(x.v->'items') not between 1 and 100
     or length(coalesce(x.v->>'reason',''))>250
     or length(coalesce(x.v->>'solution',''))>120
     or length(coalesce(x.v->>'tracking_status',''))>100
 ) or exists (select 1 from jsonb_array_elements(p_requests) x(v)
               group by x.v->>'return_id' having count(*)>1)
 then raise exception 'Solicitações duplicadas ou inválidas.'; end if;
 if (select sum(jsonb_array_length(x.v->'items')) from jsonb_array_elements(p_requests) x(v))>5000
 then raise exception 'Excesso de linhas de pós-venda.'; end if;
 if exists (select 1 from jsonb_array_elements(p_requests) x(v)
     cross join lateral jsonb_array_elements(x.v->'items') i(v)
     where length(coalesce(i.v->>'sku','')) not between 1 and 160
       or coalesce(i.v->>'quantity','') !~ '^[1-9][0-9]{0,3}$')
 then raise exception 'SKU ou quantidade inválidos.'; end if;
 insert into public.commerce_shopee_aftercare_reports_v1
   (sha256,filename,period_start,period_end,request_count,item_count)
 values (p_report->>'sha256',p_report->>'filename',(p_report->>'start')::date,
   (p_report->>'end')::date,jsonb_array_length(p_requests),
   (select sum(jsonb_array_length(x.v->'items')) from jsonb_array_elements(p_requests) x(v)))
 on conflict(sha256) do nothing returning id into v_id;
 v_created:=v_id is not null;
 if not v_created then
    select id into v_id from public.commerce_shopee_aftercare_reports_v1
       where sha256=p_report->>'sha256';
 else
   insert into public.commerce_shopee_aftercare_requests_v1
     (report_id,return_id,order_id,requested_at,order_created_at,status,solution,reason,tracking_status,refund_requested)
   select v_id,r.v->>'return_id',r.v->>'order_id',
     nullif(r.v->>'requested_at','')::timestamptz,
     nullif(r.v->>'order_created_at','')::timestamptz,
     r.v->>'status',nullif(r.v->>'solution',''),nullif(r.v->>'reason',''),
     nullif(r.v->>'tracking_status',''),
     nullif(r.v->>'refund_requested','')::numeric
   from jsonb_array_elements(p_requests) r(v);
   with source_items as (
     select r.v->>'return_id' as return_id, i.v,
       i.n::integer row_no
     from jsonb_array_elements(p_requests) r(v)
     cross join lateral jsonb_array_elements(r.v->'items') with ordinality i(v,n)
   )
   insert into public.commerce_shopee_aftercare_items_v1
     (report_id,return_id,row_no,sku,quantity,listing_id)
   select v_id,s.return_id,s.row_no,s.v->>'sku',(s.v->>'quantity')::int,
      (select min(lp.listing_id) from public.commerce_listing_products lp
        join public.commerce_listings l on l.id=lp.listing_id
        join public.commerce_marketplaces m on m.id=l.marketplace_id
        where m.code='SHOPEE'
         and upper(trim(lp.platform_sku))=upper(trim(s.v->>'sku'))
         and l.listing_status='ACTIVE'
        having count(distinct lp.listing_id)=1)
   from source_items s;
 end if;
 select count(*) into v_reqs from public.commerce_shopee_aftercare_requests_v1 where report_id=v_id;
 select count(*),count(*) filter(where listing_id is not null) into v_items,v_linked
   from public.commerce_shopee_aftercare_items_v1 where report_id=v_id;
 return jsonb_build_object('created',v_created,'report_id',v_id,'requests',v_reqs,
       'items',v_items,'linked_items',v_linked,'unlinked_items',v_items-v_linked);
end
$fn$;

-- Latest snapshot per Shopee return ID; avoids duplicate counting across
-- overlapping CSV exports. Attribution uses exact unique SKU owner only.
create or replace function public.commerce_shopee_aftercare_listing_v1(p_listing_id bigint)
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with latest as (
 select distinct on (r.return_id)
   r.*,b.period_start,b.period_end,b.imported_at
 from public.commerce_shopee_aftercare_requests_v1 r
 join public.commerce_shopee_aftercare_reports_v1 b on b.id=r.report_id
 order by r.return_id,b.imported_at desc,b.id desc
), attached as (
 select l.*,
 (select count(*) from public.commerce_shopee_aftercare_items_v1 i
   where i.report_id=l.report_id and i.return_id=l.return_id) all_items,
 (select count(*) from public.commerce_shopee_aftercare_items_v1 i
   where i.report_id=l.report_id and i.return_id=l.return_id
     and i.listing_id=p_listing_id) own_items
 from latest l
 where exists (select 1 from public.commerce_shopee_aftercare_items_v1 i
   where i.report_id=l.report_id and i.return_id=l.return_id and i.listing_id=p_listing_id)
), totals as (
 select count(*)::int requests,
 count(*) filter(where status='Aprovada')::int approved,
 count(*) filter(where status='Solicitação cancelada pelo comprador')::int withdrawn,
 count(*) filter(where tracking_status='Devolução concluída')::int returns_delivered,
 count(*) filter(where status not in ('Aprovada','Solicitação cancelada pelo comprador'))::int other_status,
 count(*) filter(where own_items<all_items)::int mixed_or_unlinked,
 coalesce(sum(refund_requested) filter(where status='Aprovada' and own_items=all_items),0) approved_requested_value,
 count(*) filter(where status='Aprovada' and own_items=all_items and refund_requested is not null)::int value_attributable_requests,
 min(period_start) from_date,max(period_end) through_date
 from attached
)
select jsonb_build_object(
  'coverage',jsonb_build_object('start',t.from_date,'end',t.through_date),
  'counts',jsonb_build_object('requests',t.requests,'approved',t.approved,
    'withdrawn',t.withdrawn,'returned_to_carrier',t.returns_delivered,
    'other',t.other_status,'mixed_or_unlinked',t.mixed_or_unlinked,
    'approved_requested_value',t.approved_requested_value,
    'value_attributable_requests',t.value_attributable_requests),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'return_id',e.return_id,'order_id',e.order_id,'requested_at',e.requested_at,
    'status',e.status,'reason',e.reason,'solution',e.solution,
    'tracking_status',e.tracking_status,'refund_requested',
       case when e.own_items=e.all_items then e.refund_requested else null end,
    'amount_attribution',e.own_items=e.all_items
    ) order by e.requested_at desc nulls last)
    from (select * from attached order by requested_at desc nulls last limit 40) e),'[]'::jsonb)
) from totals t;
$fn$;
revoke all on function public.commerce_shopee_aftercare_import_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.commerce_shopee_aftercare_listing_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_shopee_aftercare_import_v1(jsonb,jsonb) to service_role;
grant execute on function public.commerce_shopee_aftercare_listing_v1(bigint) to service_role;
