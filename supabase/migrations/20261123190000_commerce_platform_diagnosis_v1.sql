-- Leitura (somente leitura): diagnostico por plataforma do GA "Anuncios com problema".
-- Para Shopee, ML Antigo e ML Novo: faturamento/dia da janela (30/60/90 dias completos) contra a media/dia dos 3 meses
-- completos anteriores (regua principal) e contra o mesmo periodo do ano passado (so onde ha venda importada cobrindo).
-- Conta TODO o faturamento da plataforma, inclusive de anuncios inativos ou removidos (active=false).
-- Perda por anuncio = queda de faturamento do anuncio contra a regua; share_pct = parte da perda bruta (so quedas) da plataforma.
-- Regua sem dados = base_ok false e var_pct nulo (nunca -100%). Dia de hoje fica de fora, por plataforma.
create or replace function public.commerce_platform_diagnosis_v1(p_days integer default 30)
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
     (date_trunc('month',e-p_days+1)-interval '3 months')::date as base_start,
     (e-p_days+1-interval '1 year')::date as ly_start,(e-interval '1 year')::date as ly_end
   from plat
 ),
 lst as materialized (
   select l.id as listing_id, l.external_listing_id as ext, l.title, (l.listing_status='ACTIVE') as active,
     case when mk.code='SHOPEE' then 'SHOPEE' else 'ML_'||l.account_code end as pc
   from public.commerce_listings l join public.commerce_marketplaces mk on mk.id=l.marketplace_id
   where mk.code='SHOPEE' or (mk.code='MERCADO_LIVRE' and l.account_code in ('ANTIGO','NOVO'))
 ),
 sales as materialized (
   select s.platform_code as pc, s.external_listing_id as ext,
     coalesce(sum(s.product_revenue) filter (where s.sale_date>=w.cur_start and s.sale_date<=w.e),0) as r_cur,
     coalesce(sum(s.product_revenue) filter (where s.sale_date>=w.base_start and s.sale_date<=w.base_end),0) as r_base,
     coalesce(sum(s.product_revenue) filter (where s.sale_date>=w.ly_start and s.sale_date<=w.ly_end),0) as r_ly
   from public.commerce_current_sales_listing_daily_v1 s join win w on w.pc=s.platform_code
   group by 1,2
 ),
 pl as (
   select w.pc,w.first_day,w.cur_start,w.e,w.base_start,w.base_end,w.ly_start,w.ly_end,(w.base_end-w.base_start+1) as bd,
     coalesce(sum(s.r_cur),0) as rc,coalesce(sum(s.r_base),0) as rb,coalesce(sum(s.r_ly),0) as rl,
     (w.first_day<=w.base_start and coalesce(sum(s.r_base),0)>0) as ok,
     (w.first_day<=w.ly_start) as lyok
   from win w left join sales s on s.pc=w.pc
   group by w.pc,w.first_day,w.cur_start,w.e,w.base_start,w.base_end,w.ly_start,w.ly_end
 ),
 contrib as (
   select s.pc,s.ext,l.listing_id,coalesce(l.title,'Anúncio '||s.ext) as title,coalesce(l.active,false) as active,
     greatest(0,s.r_base/pl.bd*p_days-s.r_cur) as loss
   from sales s join pl on pl.pc=s.pc and pl.ok
   left join lst l on l.pc=s.pc and l.ext=s.ext
 ),
 tot as (
   select pc,sum(loss) as gross,sum(loss) filter (where not active) as gross_inactive from contrib group by pc
 ),
 ranked as (
   select c.*,round(c.loss/nullif(t.gross,0)*100,1) as share,row_number() over (partition by c.pc order by c.loss desc,c.ext) as rn
   from contrib c join tot t on t.pc=c.pc where c.loss>0
 )
 select jsonb_build_object(
   'window',(select jsonb_build_object('days',p_days,'start',cur_start,'end',e,'base_start',base_start,'base_end',base_end)
             from win order by e desc limit 1),
   'platforms',(select jsonb_agg(jsonb_build_object(
        'platform',pl.pc,
        'rev_per_day_cur',round(pl.rc/p_days,2),
        'rev_per_day_base',case when ok then round(pl.rb/pl.bd,2) end,
        'base_ok',ok,
        'var_pct',case when ok then round(((pl.rc/p_days)-(pl.rb/pl.bd))/(pl.rb/pl.bd)*100,1) end,
        'lost_revenue',case when ok then greatest(0,round(pl.rb/pl.bd*p_days-pl.rc,2)) else 0 end,
        'rev_per_day_ly',case when lyok then round(pl.rl/p_days,2) end,
        'ly_ok',lyok,
        'var_ly_pct',case when lyok and pl.rl>0 then round((pl.rc-pl.rl)/pl.rl*100,1) end,
        'inactive_share_pct',coalesce(round(t.gross_inactive/nullif(t.gross,0)*100,1),0),
        'top',coalesce((select jsonb_agg(jsonb_build_object('listing_id',rk.listing_id,'external_listing_id',rk.ext,
              'title',left(rk.title,160),'active',rk.active,'lost_revenue',round(rk.loss,2),'share_pct',rk.share) order by rk.rn)
              from ranked rk where rk.pc=pl.pc and rk.rn<=5),'[]'::jsonb))
        order by pl.pc) from pl left join tot t on t.pc=pl.pc)
 ) into r;
 return r;
end $fn$;
revoke all on function public.commerce_platform_diagnosis_v1(integer) from public,anon,authenticated;
grant execute on function public.commerce_platform_diagnosis_v1(integer) to service_role;
