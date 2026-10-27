-- Dashboard: (1) p_days=0 = "Sem filtro" (todo o histórico); (2) Curva ABC sempre calculada sobre
-- todo o histórico, independente do período do filtro. Somente leitura.
do $mig$
declare
  fn text; def text; oid_ oid; par text[]; pairs text[];
  alst constant text := $x$), allw as (
  select b.platform_code,b.external_listing_id,max(nullif(btrim(b.sku_norm),'')) sku,
    coalesce(sum(b.units),0) cur_units,coalesce(sum(b.product_revenue),0) cur_rev
  from base b group by b.platform_code,b.external_listing_id
), alst as (
  select w.*,l.id listing_id,l.title,l.listing_status
  from allw w
  left join lateral (
    select l.id,l.title,l.listing_status from public.commerce_listings l
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where l.external_listing_id=w.external_listing_id
      and (case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end)=w.platform_code
    order by (l.listing_status='ACTIVE') desc,l.id limit 1
  ) l on true
), prod as ($x$;
begin
  foreach fn in array array['commerce_dashboard_v1','commerce_dashboard_overview_v1','commerce_dashboard_segment_series_v1'] loop
    select p.oid into oid_ from pg_proc p where p.proname=fn and p.pronamespace='public'::regnamespace and p.pronargs>=2;
    if oid_ is null then raise exception 'funcao % nao encontrada', fn; end if;
    def := pg_get_functiondef(oid_);
    pairs := array[ array[$a$when p_days in (7,30,60,90) then p_days$a$, $b$when p_days=0 then 36500 when p_days in (7,30,60,90) then p_days$b$] ];
    if fn='commerce_dashboard_v1' then
      pairs := pairs || array[
        array[$a$'current_start',(select last_day-days+1 from ref,params),$a$, $b$'current_start',(select greatest(first_day,last_day-days+1) from ref,params),$b$],
        array[$a$'days',(select days from params),$a$, $b$'days',(select case when days=36500 then 0 else days end from params),'all',(select days=36500 from params),$b$],
        array[$a$), prod as ($a$, alst],
        array[$a$from lst where cur_rev>0 group by 1,2
), ranked as ($a$, $b$from alst where cur_rev>0 group by 1,2
), ranked as ($b$]
      ];
    elsif fn='commerce_dashboard_segment_series_v1' then
      pairs := pairs || array[
        array[$a$), prod as ($a$, alst],
        array[$a$from lst where cur_rev>0 group by 1,2
), ranked as ($a$, $b$from alst where cur_rev>0 group by 1,2
), ranked as ($b$]
      ];
    end if;
    foreach par slice 1 in array pairs loop
      if position(par[1] in def)=0 then raise exception 'padrao nao encontrado em %: %', fn, left(par[1],60); end if;
      def := replace(def, par[1], par[2]);
    end loop;
    execute def;
  end loop;
end $mig$;
