-- Importação Shopee: um lote confirmado mais novo substitui os mesmos dias de lotes de snapshots mais antigos.
-- Arquivos do mesmo snapshot continuam somando. As linhas substituídas ficam guardadas para desfazer.
create table if not exists public.commerce_shopee_sku_daily_superseded_v1 (
  like public.commerce_shopee_sales_sku_daily_v1,
  superseded_by_batch bigint not null,
  superseded_at timestamptz not null default now()
);
create table if not exists public.commerce_shopee_fin_daily_superseded_v1 (
  like public.commerce_shopee_finance_stage_daily_v1,
  superseded_by_batch bigint not null,
  superseded_at timestamptz not null default now()
);
alter table public.commerce_shopee_sku_daily_superseded_v1 enable row level security;
alter table public.commerce_shopee_fin_daily_superseded_v1 enable row level security;
revoke all on public.commerce_shopee_sku_daily_superseded_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_fin_daily_superseded_v1 from public,anon,authenticated;
grant select,insert,delete on public.commerce_shopee_sku_daily_superseded_v1 to service_role;
grant select,insert,delete on public.commerce_shopee_fin_daily_superseded_v1 to service_role;

create or replace function public.commerce_shopee_supersede_old_days_v1()
returns trigger language plpgsql security invoker set search_path=public as $fn$
begin
  if new.platform_code is distinct from 'SHOPEE' or new.snapshot_id is null then return new; end if;
  with gone as (
    delete from public.commerce_shopee_sales_sku_daily_v1 d
    using public.commerce_sales_import_batches ob
    where d.batch_id=ob.id and ob.platform_code='SHOPEE' and ob.status='COMMITTED'
      and ob.snapshot_id is not null and ob.snapshot_id<new.snapshot_id
      and d.sale_date in (select n.sale_date from public.commerce_shopee_sales_sku_daily_v1 n where n.batch_id=new.id)
    returning d.*
  ) insert into public.commerce_shopee_sku_daily_superseded_v1
    select g.*,new.id,now() from gone g;
  with gone as (
    delete from public.commerce_shopee_finance_stage_daily_v1 d
    using public.commerce_sales_import_batches ob
    where d.batch_id=ob.id and ob.platform_code='SHOPEE' and ob.status='COMMITTED'
      and ob.snapshot_id is not null and ob.snapshot_id<new.snapshot_id
      and d.sale_date in (select n.sale_date from public.commerce_shopee_finance_stage_daily_v1 n where n.batch_id=new.id)
    returning d.*
  ) insert into public.commerce_shopee_fin_daily_superseded_v1
    select g.*,new.id,now() from gone g;
  return new;
end $fn$;
revoke all on function public.commerce_shopee_supersede_old_days_v1() from public,anon,authenticated;

drop trigger if exists commerce_shopee_supersede_old_days_trg on public.commerce_sales_import_batches;
create trigger commerce_shopee_supersede_old_days_trg
after update of status on public.commerce_sales_import_batches
for each row when (new.status='COMMITTED' and old.status is distinct from 'COMMITTED')
execute function public.commerce_shopee_supersede_old_days_v1();
