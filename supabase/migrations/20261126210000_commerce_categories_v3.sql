-- GA-P02C — commerce_categories_v3 (PREPARADA; NÃO aplicada em produção; aplicação só com aprovação do Atlas).
-- Mesma assinatura e mesmo resultado de commerce_categories_v2, sem montar as views de vendas inteiras:
--  * o período (as_of/cf/ct/bf/bt) é calculado na própria função, com uma leitura barata por fonte (máx. de data), em vez de commerce_period_v1;
--  * (ML) a escolha do snapshot mais novo por conta+dia é feita num passo só (função de janela);
--  * a escolha do lote/snapshot vencedor é por dia (Shopee) e por conta+dia (ML): filtrar plataforma e datas ANTES dela não muda quem vence;
--  * a conta ML só lê lotes da própria conta; a Shopee só lê o ramo Shopee; só lotes COMMITTED contam;
--  * arredondamento e tipos por linha iguais aos da view (sum::integer, round(..,2)::numeric(14,2));
--  * a partir de "skus" o corpo é idêntico ao da v2 (nomes e coleções NÃO foram otimizados).
-- Segurança: SECURITY INVOKER, search_path fixo em public, execução só para service_role.
-- A v2 NÃO é alterada nem removida. commerce_cached_read_v1 NÃO é alterada aqui (v3 fica fora da lista permitida até migração própria).
-- Reversão: supabase/rollback/20261126210000_commerce_categories_v3.down.sql (drop function da v3).
create or replace function public.commerce_categories_v3(p_platform text default 'SHOPEE', p_year integer default null,
  p_mode text default 'ytd', p_month integer default null, p_days integer default null)
returns jsonb language sql stable security invoker set search_path to 'public' as $function$
with prm as materialized (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         coalesce(p_year,(select extract(year from max(d.sale_date))::int
                            from public.commerce_shopee_sales_sku_daily_v1 d join public.commerce_sales_import_batches b on b.id=d.batch_id
                           where b.platform_code='SHOPEE' and b.status='COMMITTED')) y
), a as materialized (
  select prm.*, coalesce(greatest(
      case when prm.plat in ('SHOPEE','TODAS') then (select max(d.sale_date) from public.commerce_shopee_sales_sku_daily_v1 d
         join public.commerce_sales_import_batches b on b.id=d.batch_id
         where b.platform_code='SHOPEE' and b.status='COMMITTED'
           and d.sale_date >= make_date(prm.y,1,1) and d.sale_date < make_date(prm.y+1,1,1)) end,
      case when prm.plat <> 'SHOPEE' then (select max(d.sale_date) from public.commerce_sales_import_batches b
         join public.commerce_sales_import_stage_summary s on s.batch_id=b.id and s.period_start=s.period_end
         join public.commerce_sales_listing_daily_v1 d on d.batch_id=b.id and d.sale_date=s.period_start
         where b.status='COMMITTED' and b.platform_code like 'ML%' and (prm.plat='TODAS' or b.platform_code=prm.plat)
           and d.sale_date >= make_date(prm.y,1,1) and d.sale_date < make_date(prm.y+1,1,1)) end),
      make_date(prm.y,12,31)) as_of from prm
), r as (
  select a.plat, a.y, a.y-1 b, a.as_of,
    case when p_mode='month' and p_month between 1 and 12 then make_date(a.y,p_month,1)
         when p_mode='days' and p_days between 1 and 99 then a.as_of-(p_days-1)
         else make_date(a.y,1,1) end cf,
    case when p_mode='month' and p_month between 1 and 12 then least(a.as_of,(make_date(a.y,p_month,1)+interval '1 month - 1 day')::date)
         else a.as_of end ct,
    (p_mode='days' and p_days between 1 and 99) is_days
  from a
), pr as materialized (
  select r.plat, r.y, r.b, r.as_of, r.cf, r.ct,
    case when r.is_days then (r.ct - interval '1 year')::date-(p_days-1) else (r.cf - interval '1 year')::date end bf,
    (r.ct - interval '1 year')::date bt
  from r
),
sh_src as (
  select d.sale_date, d.sku_norm, d.units, d.orders_with_item, d.product_revenue, coalesce(b.snapshot_id,(0)::bigint) snapshot_id
    from public.commerce_shopee_sales_sku_daily_v1 d join public.commerce_sales_import_batches b on b.id=d.batch_id, pr
   where pr.plat in ('SHOPEE','TODAS') and b.platform_code='SHOPEE' and b.status='COMMITTED'
     and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
), sh_top as (select sale_date, max(snapshot_id) snapshot_id from sh_src group by sale_date),
sh_cur as (
  select s.sale_date, s.sku_norm, (sum(s.units))::integer units, (round(sum(s.product_revenue),2))::numeric(14,2) product_revenue
    from sh_src s join sh_top t on t.sale_date=s.sale_date and t.snapshot_id=s.snapshot_id group by s.sale_date, s.sku_norm
),
ml_rows as (
  -- um passo só: linha de anúncio do dia, do(s) lote(s) COMMITTED da conta cujo snapshot é o mais novo daquele dia (partes do mesmo snapshot somam).
  -- "exists" no resumo diário (period_start=period_end) equivale ao join da view e não duplica linhas se houver dois resumos do mesmo dia.
  select q.platform_code, q.sale_date, q.external_listing_id, q.sku_norm,
         (sum(q.units))::integer units, (round(sum(q.product_revenue),2))::numeric(14,2) product_revenue
  from (
    select b.platform_code, d.sale_date, d.external_listing_id, d.sku_norm, d.units, d.product_revenue,
           coalesce(b.snapshot_id,(0)::bigint) sid,
           max(coalesce(b.snapshot_id,(0)::bigint)) over (partition by b.platform_code, d.sale_date) top_sid
      from public.commerce_sales_import_batches b
      join public.commerce_sales_listing_daily_v1 d on d.batch_id=b.id, pr
     where pr.plat <> 'SHOPEE' and b.status='COMMITTED' and b.platform_code like 'ML%' and (pr.plat='TODAS' or b.platform_code=pr.plat)
       and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
       and exists (select 1 from public.commerce_sales_import_stage_summary s where s.batch_id=b.id and s.period_start=s.period_end and s.period_start=d.sale_date)
  ) q
  where q.sid=q.top_sid
  group by q.platform_code, q.sale_date, q.external_listing_id, q.sku_norm
), raw as (
  select sale_date, sku_norm, units, product_revenue rev from sh_cur
  union all
  select sale_date, sku_norm, units, product_revenue from ml_rows
), canon as materialized (select sku_norm, public.commerce_sku_canon_v1(sku_norm) sku from (select distinct sku_norm from raw) q),
src as (select r.sale_date, c.sku, r.units, r.rev from raw r join canon c on c.sku_norm=r.sku_norm),
skus as materialized (select distinct sku from src),
cl as materialized (
  select k.sku, coalesce(e.category_id, r.category_id) cid,
    public.commerce_sku_col_v1(k.sku,public.commerce_sku_name_v1(k.sku)) col
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select x.category_id from public.commerce_sku_prefix_rules_v1 x
     where e.sku_norm is null and k.sku like x.prefix||'%' order by length(x.prefix) desc limit 1) r on true
), fd as (
  select coalesce(c.name,'Sem categoria') cat, cl.col, s.units, s.rev,
    case when s.sale_date between pr.cf and pr.ct then 'cur' when s.sale_date between pr.bf and pr.bt then 'base' end per,
    case when s.sale_date between greatest(pr.cf,pr.ct-27) and pr.ct then 'cur'
         when s.sale_date between greatest(pr.bf,pr.bt-27) and pr.bt then 'base' end l28
  from src s join pr on true join cl on cl.sku=s.sku
  left join public.commerce_categories c on c.id=cl.cid
), sub_agg as (
  select cat, col,
    coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
    coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br,
    coalesce(sum(units) filter (where l28='cur'),0) c28, coalesce(sum(units) filter (where l28='base'),0) b28
  from fd group by 1,2
), cat_agg as (
  select cat, sum(cu) cu, sum(bu) bu, sum(cr) cr, sum(br) br, sum(c28) c28, sum(b28) b28 from sub_agg group by 1
)
select jsonb_build_object(
  'platform',(select plat from pr),'year',(select y from pr),'base_year',(select b from pr),'mode',coalesce(p_mode,'ytd'),
  'as_of',(select as_of from pr),'cur_from',(select cf from pr),'cur_to',(select ct from pr),'base_from',(select bf from pr),'base_to',(select bt from pr),
  'total',(select jsonb_build_object('cur',coalesce(sum(cu),0),'base',coalesce(sum(bu),0),'cur_rev',coalesce(sum(cr),0),'base_rev',coalesce(sum(br),0),'c28',coalesce(sum(c28),0),'b28',coalesce(sum(b28),0)) from cat_agg),
  'categories',coalesce((select jsonb_agg(jsonb_build_object('name',c.cat,'cur',c.cu,'base',c.bu,'cur_rev',c.cr,'base_rev',c.br,'c28',c.c28,'b28',c.b28,
      'cols',(select jsonb_agg(jsonb_build_object('name',s.col,'cur',s.cu,'base',s.bu,'cur_rev',s.cr,'base_rev',s.br,'c28',s.c28,'b28',s.b28) order by (s.col='Sem coleção'), s.cu desc, s.col)
              from sub_agg s where s.cat=c.cat and (s.cu>0 or s.bu>0))) order by c.cu desc, c.bu desc, c.cat) from cat_agg c where c.cu>0 or c.bu>0),'[]'::jsonb));
$function$;

revoke all on function public.commerce_categories_v3(text,integer,text,integer,integer) from public,anon,authenticated;
grant execute on function public.commerce_categories_v3(text,integer,text,integer,integer) to service_role;
