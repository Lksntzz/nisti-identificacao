-- Leitura (somente leitura): GA "Anuncios com problema". Anuncios ATIVOS em 4 grupos, cada um em um so (prioridade):
--  PAROU  = ja vendeu (historico importado) e zero vendas nos ultimos 90 dias.
--  QUEDA  = ainda vende, media/dia no periodo 30% ou mais abaixo da media/dia dos 3 meses completos anteriores ao periodo
--           (baseline minimo de 10 unidades nesses 3 meses). Etiqueta also_low_conv = tambem converte mal.
--  PIOR   = so Shopee, relatorio de desempenho mais recente: 1.000+ impressoes, 100+ visitantes e conversao abaixo de 50%
--           da media da loja. O grupo some se o relatorio terminou ha mais de 90 dias.
--  NUNCA  = so Shopee, zero vendas desde o inicio do historico e idade minima maior que 90 dias. Idade = primeiro relatorio
--           de desempenho em que o anuncio aparece (created_at do GA e a data de entrada no sistema, nao serve).
-- Anuncio ativo sem venda: Shopee com idade <= 90 dias ou desconhecida = EM_TESTE; ML (sem fonte de idade) = SEM_IDADE.
-- Dia de hoje fica de fora (incompleto) por plataforma. Regua sem dados = base_ok false (nunca zero).
create or replace function public.commerce_problem_groups_v1(p_days integer default 30)
returns jsonb language plpgsql stable security invoker set search_path=public
as $fn$
declare r jsonb;
begin
 if p_days is null or p_days not in (30,60,90) then raise exception 'Janela inválida: escolha 30, 60 ou 90 dias.'; end if;
 with plat as (
   select platform_code as pc, max(sale_date)-1 as e, min(sale_date) as first_day
   from public.commerce_current_sales_listing_daily_v1 group by 1
 ),
 win as (
   select pc,e,first_day,e-p_days+1 as cur_start,
     (date_trunc('month',e-p_days+1)::date-1) as base_end,
     (date_trunc('month',e-p_days+1)-interval '3 months')::date as base_start
   from plat
 ),
 sales as materialized (
   select s.platform_code as pc, s.external_listing_id as ext,
     sum(s.units) as u_all,
     coalesce(sum(s.units) filter (where s.sale_date>=w.cur_start and s.sale_date<=w.e),0) as u_cur,
     coalesce(sum(s.product_revenue) filter (where s.sale_date>=w.cur_start and s.sale_date<=w.e),0) as r_cur,
     coalesce(sum(s.units) filter (where s.sale_date>=w.base_start and s.sale_date<=w.base_end),0) as u_base,
     coalesce(sum(s.product_revenue) filter (where s.sale_date>=w.base_start and s.sale_date<=w.base_end),0) as r_base,
     coalesce(sum(s.units) filter (where s.sale_date>w.e-90),0) as u90,
     max(s.sale_date) filter (where s.units>0) as last_sale
   from public.commerce_current_sales_listing_daily_v1 s join win w on w.pc=s.platform_code
   group by 1,2
 ),
 lst as (
   select l.id as listing_id, l.external_listing_id as ext, l.title,
     case when mk.code='SHOPEE' then 'SHOPEE' else 'ML_'||l.account_code end as pc
   from public.commerce_listings l join public.commerce_marketplaces mk on mk.id=l.marketplace_id
   where l.listing_status='ACTIVE' and (mk.code='SHOPEE' or (mk.code='MERCADO_LIVRE' and l.account_code in ('ANTIGO','NOVO')))
 ),
 rep as (
   select id,period_start,period_end,(current_date-period_end) as age
   from public.commerce_shopee_performance_reports_v1 order by period_end desc,id desc limit 1
 ),
 latest as materialized (
   select external_item_id as ext,impressions,visitors,orders_placed
   from public.commerce_shopee_performance_rows_v1 where report_id=(select id from rep)
 ),
 store as (select sum(orders_placed)::numeric/nullif(sum(visitors),0) as conv from latest),
 seen as materialized (
   select x.external_item_id as ext,min(rp.period_start) as first_seen
   from public.commerce_shopee_performance_rows_v1 x join public.commerce_shopee_performance_reports_v1 rp on rp.id=x.report_id
   group by 1
 ),
 base as (
   select l.listing_id,l.ext,l.title,l.pc,
     coalesce(s.u_all,0) as u_all,coalesce(s.u_cur,0) as u_cur,coalesce(s.r_cur,0) as r_cur,
     coalesce(s.u_base,0) as u_base,coalesce(s.r_base,0) as r_base,coalesce(s.u90,0) as u90,s.last_sale,
     (w.base_end-w.base_start+1) as base_days,(w.first_day<=w.base_start) as base_ok,
     case when l.pc='SHOPEE' then current_date-sn.first_seen end as age,
     lp.impressions as l_imp,lp.visitors as l_vis,lp.orders_placed as l_ord
   from lst l
   join win w on w.pc=l.pc
   left join sales s on s.pc=l.pc and s.ext=l.ext
   left join seen sn on l.pc='SHOPEE' and sn.ext=l.ext
   left join latest lp on l.pc='SHOPEE' and lp.ext=l.ext
 ),
 cls as (
   select b.*,
     (b.u_all>0 and b.u90=0) as is_parou,
     (b.u_all>0 and b.u90>0 and b.base_ok and b.u_base>=10
        and b.u_cur<=0.7*(b.u_base::numeric/b.base_days*p_days)) as is_queda,
     (b.pc='SHOPEE' and (select age from rep)<=90 and b.l_imp>=1000 and b.l_vis>=100
        and (b.l_ord::numeric/b.l_vis)<0.5*(select conv from store)) as is_pior,
     (b.pc='SHOPEE' and b.u_all=0 and b.age>90) as is_nunca
   from base b
 ),
 grp as (
   select c.*,
     case when is_parou then 'PAROU' when is_queda then 'QUEDA' when is_pior then 'PIOR' when is_nunca then 'NUNCA' end as g,
     (c.is_queda and c.is_pior) as also_low
   from cls c
 )
 select jsonb_build_object(
   'window',(select jsonb_build_object('days',p_days,'start',cur_start,'end',e,'base_start',base_start,'base_end',base_end)
             from win order by e desc limit 1),
   'per_platform',(select jsonb_object_agg(pc,jsonb_build_object('start',cur_start,'end',e,'base_start',base_start,'base_end',base_end,'base_ok',(first_day<=base_start))) from win),
   'report',(select jsonb_build_object('id',id,'start',period_start,'end',period_end,'age_days',age) from rep),
   'store_conv_pct',(select round(conv*100,2) from store),
   'counts',(select jsonb_object_agg(w.pc,jsonb_build_object(
        'PAROU',(select count(*) from grp where pc=w.pc and g='PAROU'),
        'QUEDA',(select count(*) from grp where pc=w.pc and g='QUEDA'),
        'PIOR',(select count(*) from grp where pc=w.pc and g='PIOR'),
        'NUNCA',(select count(*) from grp where pc=w.pc and g='NUNCA'),
        'EM_TESTE',(select count(*) from grp where pc=w.pc and pc='SHOPEE' and u_all=0 and g is null),
        'SEM_IDADE',(select count(*) from grp where pc=w.pc and pc<>'SHOPEE' and u_all=0)))
      from win w),
   'items',coalesce((select jsonb_agg(jsonb_build_object(
        'platform',pc,'listing_id',listing_id,'external_listing_id',ext,'title',left(title,160),'group',g,
        'drop_pct',case when g='PAROU' then 100 when g='QUEDA' then round((1-u_cur/(u_base::numeric/base_days*p_days))*100,1) end,
        'units_cur',u_cur,'units_base',round(u_base::numeric/base_days*p_days,1),
        'lost_revenue',case when g in ('PAROU','QUEDA') then greatest(0,round(r_base/base_days*p_days-r_cur,2)) else 0 end,
        'last_sale',last_sale,'age_days_min',age,'also_low_conv',also_low,
        'impressions',l_imp,'visitors',l_vis,'conv_pct',case when l_vis>0 then round(l_ord::numeric/l_vis*100,2) end)
      order by case when g in ('PAROU','QUEDA') then greatest(0,r_base/base_days*p_days-r_cur) else 0 end desc,listing_id)
      from grp where g is not null),'[]'::jsonb)
 ) into r;
 return r;
end $fn$;
revoke all on function public.commerce_problem_groups_v1(integer) from public,anon,authenticated;
grant execute on function public.commerce_problem_groups_v1(integer) to service_role;
