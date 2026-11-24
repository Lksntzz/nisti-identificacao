-- GA-021 — Unificação da fonte de vendas da Shopee por SKU.
-- DEFEITO: dez funções liam a tabela legada commerce_shopee_sales_sku_daily_v1 CRUA, sem olhar o status do lote. Lotes
-- abertos (STAGED) e versões antigas de um dia eram somados junto com os dados válidos (Categorias, Curva ABC,
-- comparativo anual, cobertura anual, divisão de frete).
-- CORREÇÃO: uma única fonte por SKU/dia (commerce_shopee_current_sku_daily_v1) com a MESMA regra de seleção da GA-019
-- (commerce_sales_daily_source_v2 e commerce_current_sales_listing_daily_v1):
--   * só lote COMMITTED da Shopee;
--   * por dia, só o snapshot mais novo; as partes (lotes) do mesmo snapshot naquele dia se SOMAM (importação em várias partes);
--   * um dia que só existe em snapshot antigo continua valendo (a escolha é por dia, não global).
-- A fonte é a venda TOTAL por SKU: inclui SKUs sem vínculo com anúncio (GA-011). A venda vinculada continua sendo a da
-- view commerce_current_sales_listing_daily_v1; commerce_shopee_sales_link_split_v1 (reaproveita a conciliação GA-011) separa
-- total, vinculada, sem vínculo, outras causas explicadas, resíduo não explicado e ausência de informação.
-- As dez funções mantêm o texto de produção; muda SOMENTE o nome da fonte. Regras de categoria, coleção e ABC não mudam.
-- Mercado Livre não muda (já lê a view da GA-019). Dados históricos e lotes (inclusive os abertos) não são tocados.
-- NÃO exclui, aplica nem descarta nenhum lote. Esta migração só cria/substitui objetos de leitura e limpa cache.

create or replace view public.commerce_shopee_current_sku_daily_v1
with (security_invoker = true) as
 with sku_source as (
   select d.sale_date, d.sku_norm, d.units, d.orders_with_item, d.product_revenue,
          coalesce(b.snapshot_id, 0::bigint) as snapshot_id
   from public.commerce_shopee_sales_sku_daily_v1 d
   join public.commerce_sales_import_batches b on b.id = d.batch_id
   where b.platform_code = 'SHOPEE' and b.status = 'COMMITTED'
 ), most_recent as (
   select x.sale_date, max(x.snapshot_id) as snapshot_id from sku_source x group by x.sale_date
 )
 select s.sale_date, s.sku_norm,
        sum(s.units)::integer as units,
        sum(s.orders_with_item)::integer as orders_with_item,
        round(sum(s.product_revenue), 2)::numeric(14,2) as product_revenue
 from sku_source s
 join most_recent v on v.sale_date = s.sale_date and v.snapshot_id = s.snapshot_id
 group by s.sale_date, s.sku_norm;
revoke all on public.commerce_shopee_current_sku_daily_v1 from public, anon, authenticated;
grant select on public.commerce_shopee_current_sku_daily_v1 to service_role;
comment on view public.commerce_shopee_current_sku_daily_v1 is
  'GA-021: vendas da Shopee por SKU/dia, regra de seleção da GA-019 (COMMITTED, snapshot mais novo por dia). Total, inclui SKU sem vínculo.';

-- Total x vinculada x sem vínculo (somente leitura). Reaproveita a conciliação GA-011 (commerce_shopee_reconciliation_v1):
-- NÃO presume que toda diferença entre a venda total por SKU e a base por anúncio seja "sem vínculo". A decomposição é exata:
--   diferença (base - total) = efeito dos SKUs sem vínculo + efeito de dias nativos (outras causas explicadas) + resíduo não explicado.
-- Ausência de informação nunca vira zero: período sem vendas importadas devolve status SEM_INFORMACAO e números nulos;
-- dia sem linhas importadas aparece em coverage (status PARCIAL). Só unidades (sem receita).
create or replace function public.commerce_shopee_sales_link_split_v1(p_start date, p_end date)
returns jsonb language plpgsql stable security invoker set search_path = public as $fn$
declare
  r jsonb; d jsonb; v_total bigint; v_src bigint; v_diff bigint; v_unl bigint; v_oth bigint; v_res bigint;
  v_expl boolean; v_status text; v_rec text; v_dir text;
begin
  if p_start is null or p_end is null or p_start > p_end then raise exception 'periodo invalido'; end if;
  if p_end - p_start > 1100 then raise exception 'periodo maior que 1100 dias'; end if;
  r := public.commerce_shopee_reconciliation_v1(p_start, p_end, 1);
  if r->>'status' = 'SEM_DADOS' then
    return jsonb_build_object('start', p_start, 'end', p_end, 'status', 'SEM_INFORMACAO',
      'total_units', null, 'linked_units', null, 'unlinked_units', null, 'base_units', null, 'difference', null,
      'reconciliation', jsonb_build_object('status', 'SEM_INFORMACAO'),
      'coverage', jsonb_build_object('missing_days', (r->'coverage'->>'source_missing_days')::int,
                                     'missing_ranges', r->'coverage'->'missing_ranges', 'days_with_data', 0),
      'note', 'Nenhuma venda importada no período: ausência de informação, não zero.');
  end if;
  select coalesce(sum(units), 0)::bigint into v_total
    from public.commerce_shopee_current_sku_daily_v1 where sale_date between p_start and p_end;
  d := r->'difference';
  v_src := (r#>>'{totals,source,units}')::bigint;
  v_diff := (d->>'units')::bigint;
  v_unl := (d->>'unmatched_effect_units')::bigint;
  v_oth := (d->>'native_days_effect_units')::bigint;
  v_res := (d->>'residual_units')::bigint;
  v_expl := (d->>'explained')::boolean;
  v_status := case when r->>'status' = 'PARCIAL' then 'PARCIAL' else 'COMPLETO' end;
  v_rec := case when v_total <> v_src or v_diff <> v_unl + v_oth + v_res then 'INCONSISTENTE'
                when v_expl then 'EXPLICADA' else 'RESIDUO_NAO_EXPLICADO' end;
  v_dir := case when v_diff > 0 then 'POSITIVA' when v_diff < 0 then 'NEGATIVA' else 'NENHUMA' end;
  return jsonb_build_object('start', p_start, 'end', p_end, 'status', v_status,
    'total_units', v_total,
    'linked_units', (r#>>'{reconciled_pct,matched_units}')::bigint,
    'unlinked_units', (r#>>'{reconciled_pct,unmatched_units}')::bigint,
    'unlinked_sku_count', jsonb_array_length(r->'unmatched_skus'),
    'base_units', (r#>>'{totals,base,units}')::bigint,
    'difference', jsonb_build_object('units', v_diff, 'direction', v_dir,
      'unlinked_effect_units', v_unl, 'other_explained_units', v_oth, 'residual_units', v_res, 'explained', v_expl),
    'reconciliation', jsonb_build_object('status', v_rec,
      'source_units_match', v_total = v_src, 'identity_ok', v_diff = v_unl + v_oth + v_res),
    'coverage', jsonb_build_object('missing_days', (r->'coverage'->>'source_missing_days')::int,
      'missing_ranges', r->'coverage'->'missing_ranges', 'days_with_data', (r->'coverage'->>'source_days_with_data')::int),
    'note', 'Total = fonte por SKU. Vinculada/sem vínculo = SKUs com/sem dono revisado (GA-011). Diferença = base por anúncio - total, separada em sem vínculo, outras causas explicadas e resíduo. status COMPLETO/PARCIAL = há ou não linhas importadas em cada dia; não prova cobertura completa do dia (ver Qualidade dos dados, GA-018/GA-019).');
end $fn$;
revoke all on function public.commerce_shopee_sales_link_split_v1(date, date) from public, anon, authenticated;
grant execute on function public.commerce_shopee_sales_link_split_v1(date, date) to service_role;

-- ===== As dez funções: texto de produção, trocando só public.commerce_shopee_sales_sku_daily_v1 por
-- public.commerce_shopee_current_sku_daily_v1 (permissões e dono são preservados pelo CREATE OR REPLACE). =====

CREATE OR REPLACE FUNCTION public.commerce_annual_compare_coverage_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select coalesce(jsonb_agg(jsonb_build_object('platform',plat,'year',yr,'units',u,'days',d) order by plat, yr),'[]'::jsonb)
from (
  select plat, extract(year from sale_date)::int yr, sum(units)::bigint u, count(distinct sale_date)::int d
  from (
    select 'SHOPEE'::text plat, sale_date, units from public.commerce_shopee_current_sku_daily_v1
    union all
    select platform_code, sale_date, units from public.commerce_current_sales_listing_daily_v1 where platform_code like 'ML%'
  ) s group by 1,2
) t;
$function$;

CREATE OR REPLACE FUNCTION public.commerce_period_v1(p_platform text, p_year integer, p_mode text, p_month integer, p_days integer)
 RETURNS TABLE(plat text, y integer, b integer, as_of date, cf date, ct date, bf date, bt date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_shopee_current_sku_daily_v1)) y
), a as (
  select prm.*, coalesce(greatest(
      case when prm.plat in ('SHOPEE','TODAS') then (select max(d.sale_date) from public.commerce_shopee_current_sku_daily_v1 d
         where d.sale_date >= make_date(prm.y,1,1) and d.sale_date < make_date(prm.y+1,1,1)) end,
      case when prm.plat <> 'SHOPEE' then (select max(v.sale_date) from public.commerce_current_sales_listing_daily_v1 v
         where v.platform_code like 'ML%' and (prm.plat='TODAS' or v.platform_code=prm.plat)
           and v.sale_date >= make_date(prm.y,1,1) and v.sale_date < make_date(prm.y+1,1,1)) end),
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
)
select r.plat, r.y, r.b, r.as_of, r.cf, r.ct,
  case when r.is_days then (r.ct - interval '1 year')::date-(p_days-1) else (r.cf - interval '1 year')::date end,
  (r.ct - interval '1 year')::date
from r;
$function$;

CREATE OR REPLACE FUNCTION public.commerce_sku_prior_map_v1(p_platform text, p_base integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         make_date(p_base,1,1) d0, make_date(p_base+1,1,1) d1, make_date(p_base+2,1,1) d2
), src as (
  select 'SHOPEE'::text plat, d.sku_norm, d.units
    from public.commerce_shopee_current_sku_daily_v1 d, prm where d.sale_date >= prm.d0 and d.sale_date < prm.d1
  union all
  select v.platform_code, v.sku_norm, v.units
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE' and v.sale_date >= prm.d0 and v.sale_date < prm.d1
), agg as (
  select public.commerce_sku_canon_v1(s.sku_norm) sku, sum(s.units) u
    from src s, prm where prm.plat='TODAS' or s.plat=prm.plat group by 1
), lst as (
  select v.platform_code plat, v.external_listing_id id, v.sku_norm, v.units, v.sale_date, prm.d1
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.sale_date >= prm.d0 and v.sale_date < prm.d2 and (prm.plat='TODAS' or v.platform_code=prm.plat)
), base_l as (select plat, id, sum(units) u from lst where sale_date < d1 group by 1,2),
cur_l as (select distinct plat, id, public.commerce_sku_canon_v1(sku_norm) sku from lst where sale_date >= d1),
alias as (select c.sku, sum(b.u) u from cur_l c join base_l b on b.plat=c.plat and b.id=c.id group by 1),
fin as (
  select coalesce(a.sku, l.sku) sku, greatest(coalesce(a.u,0), coalesce(l.u,0)) u
  from agg a full join alias l on l.sku=a.sku
)
select coalesce(jsonb_object_agg(sku, u), '{}'::jsonb) from fin where u > 0;
$function$;

CREATE OR REPLACE FUNCTION public.commerce_categories_v2(p_platform text DEFAULT 'SHOPEE'::text, p_year integer DEFAULT NULL::integer, p_mode text DEFAULT 'ytd'::text, p_month integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with pr as (select * from public.commerce_period_v1(p_platform,p_year,p_mode,p_month,p_days)),
src as (
  select d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_current_sku_daily_v1 d, pr
   where pr.plat in ('SHOPEE','TODAS') and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
  union all
  select v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, pr
   where pr.plat <> 'SHOPEE' and v.platform_code like 'ML%' and (pr.plat='TODAS' or v.platform_code=pr.plat)
     and (v.sale_date between pr.cf and pr.ct or v.sale_date between pr.bf and pr.bt)
), skus as materialized (select distinct sku from src),
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

CREATE OR REPLACE FUNCTION public.commerce_categories_col_v2(p_platform text DEFAULT 'SHOPEE'::text, p_year integer DEFAULT NULL::integer, p_mode text DEFAULT 'ytd'::text, p_month integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer, p_cat text DEFAULT NULL::text, p_col text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with pr as (select * from public.commerce_period_v1(p_platform,p_year,p_mode,p_month,p_days)),
src as (
  select d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_current_sku_daily_v1 d, pr
   where pr.plat in ('SHOPEE','TODAS') and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
  union all
  select v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, pr
   where pr.plat <> 'SHOPEE' and v.platform_code like 'ML%' and (pr.plat='TODAS' or v.platform_code=pr.plat)
     and (v.sale_date between pr.cf and pr.ct or v.sale_date between pr.bf and pr.bt)
), skus as materialized (select distinct sku from src),
cl as materialized (
  select k.sku, coalesce(e.category_id, r.category_id) cid,
    public.commerce_sku_name_v1(k.sku) pname
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select x.category_id from public.commerce_sku_prefix_rules_v1 x
     where e.sku_norm is null and k.sku like x.prefix||'%' order by length(x.prefix) desc limit 1) r on true
), fd as (
  select s.sku, s.sale_date, s.units, s.rev, cl.pname,
    case when s.sale_date between pr.cf and pr.ct then 'cur' when s.sale_date between pr.bf and pr.bt then 'base' end per
  from src s join pr on true join cl on cl.sku=s.sku
  left join public.commerce_categories c on c.id=cl.cid
  where coalesce(c.name,'Sem categoria')=p_cat and public.commerce_sku_col_v1(s.sku,cl.pname)=p_col
), sk as (
  select sku, max(pname) pname, coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
         coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br
  from fd group by 1
), rk as (select sk.*, row_number() over (order by sk.cu desc, sk.bu desc, sk.sku) r from sk where cu>0 or bu>0),
links as (
  select z.sku, jsonb_agg(jsonb_build_object('platform',z.platform,'id',z.id)) links from (
    select upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) sku, m.code platform,
           (array_agg(l.external_listing_id order by (l.listing_status<>'ACTIVE'), l.id))[1] id
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.platform_sku is not null and lp.relation_status<>'REMOVED'
      and upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) in (select sku from rk where r<=40)
    group by 1,2) z group by z.sku
), bm as (
  select to_char(sale_date,'YYYY-MM') m, sum(units) u from fd where per='cur' group by 1 order by 2 desc, 1 limit 1
)
select jsonb_build_object(
  'platform',(select plat from pr),'category',p_cat,'collection',p_col,'cur_from',(select cf from pr),'cur_to',(select ct from pr),
  'best_month',(select jsonb_build_object('month',m,'units',u) from bm),
  'skus',(select count(*) from rk),
  'items',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,
      'links',coalesce((select k.links from links k where k.sku=rk.sku),'[]'::jsonb)) order by r) from rk where r<=40),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.commerce_categories_sub_v2(p_platform text DEFAULT 'SHOPEE'::text, p_year integer DEFAULT NULL::integer, p_mode text DEFAULT 'ytd'::text, p_month integer DEFAULT NULL::integer, p_days integer DEFAULT NULL::integer, p_cat text DEFAULT NULL::text, p_sub text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with pr as (select * from public.commerce_period_v1(p_platform,p_year,p_mode,p_month,p_days)),
src as (
  select d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_current_sku_daily_v1 d, pr
   where pr.plat in ('SHOPEE','TODAS') and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
  union all
  select v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, pr
   where pr.plat <> 'SHOPEE' and v.platform_code like 'ML%' and (pr.plat='TODAS' or v.platform_code=pr.plat)
     and (v.sale_date between pr.cf and pr.ct or v.sale_date between pr.bf and pr.bt)
), skus as (select distinct sku from src),
cl as (
  select k.sku, coalesce(e.category_id, r.category_id) cid, coalesce(e.subcategory_id, r.subcategory_id) sid
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select x.category_id, x.subcategory_id from public.commerce_sku_prefix_rules_v1 x
     where e.sku_norm is null and k.sku like x.prefix||'%' order by length(x.prefix) desc limit 1) r on true
), fd as (
  select s.sku, s.sale_date, s.units, s.rev,
    case when s.sale_date between pr.cf and pr.ct then 'cur' when s.sale_date between pr.bf and pr.bt then 'base' end per
  from src s join pr on true join cl on cl.sku=s.sku
  left join public.commerce_categories c on c.id=cl.cid left join public.commerce_subcategories sc on sc.id=cl.sid
  where coalesce(c.name,'Sem categoria')=p_cat and coalesce(sc.name,'Sem subcategoria')=p_sub
), sk as (
  select sku, coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
         coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br
  from fd group by 1
), rk as (
  select sk.*, sk.cu-sk.bu d,
    row_number() over (order by (sk.cu-sk.bu) desc, sk.cu desc, sk.sku) r_up,
    row_number() over (order by (sk.cu-sk.bu) asc, sk.cu desc, sk.sku) r_dn
  from sk
), pick as (select * from rk where (r_up<=5 and d>0) or (r_dn<=5 and d<0)),
links as (
  select z.sku, jsonb_agg(jsonb_build_object('platform',z.platform,'id',z.id)) links from (
    select upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) sku, m.code platform,
           (array_agg(l.external_listing_id order by (l.listing_status<>'ACTIVE'), l.id))[1] id
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.platform_sku is not null and lp.relation_status<>'REMOVED'
      and upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) in (select sku from pick)
    group by 1,2) z group by z.sku
), item as (
  select p.*, 
    public.commerce_sku_name_v1(p.sku) pname,
    coalesce((select k.links from links k where k.sku=p.sku),'[]'::jsonb) lk
  from pick p
), bm as (
  select to_char(sale_date,'YYYY-MM') m, sum(units) u from fd where per='cur' group by 1 order by 2 desc, 1 limit 1
)
select jsonb_build_object(
  'platform',(select plat from pr),'category',p_cat,'subcategory',p_sub,'cur_from',(select cf from pr),'cur_to',(select ct from pr),
  'best_month',(select jsonb_build_object('month',m,'units',u) from bm),
  'skus',(select count(*) from sk),
  'up',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,'links',lk) order by r_up) from item where r_up<=5 and d>0),'[]'::jsonb),
  'down',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,'links',lk) order by r_dn) from item where r_dn<=5 and d<0),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.commerce_dashboard_abc_v2(p_platform text DEFAULT 'TODAS'::text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prm as (
  select upper(coalesce(p_platform,'TODAS')) plat from (select 1) x
  where upper(coalesce(p_platform,'TODAS')) in ('TODAS','SHOPEE','ML_ANTIGO','ML_NOVO')
), shp as (
  select nullif(btrim(d.sku_norm),'') s, sum(d.units)::numeric units, sum(d.product_revenue)::numeric revenue
  from public.commerce_shopee_current_sku_daily_v1 d cross join prm
  where prm.plat in ('TODAS','SHOPEE')
    and (p_start is null or d.sale_date>=p_start) and (p_end is null or d.sale_date<=p_end)
  group by 1
), lv as (
  select v.platform_code, v.external_listing_id, nullif(btrim(v.sku_norm),'') s,
    sum(v.units)::numeric units, sum(v.product_revenue)::numeric revenue
  from public.commerce_current_sales_listing_daily_v1 v cross join prm
  where (prm.plat='TODAS' or v.platform_code=prm.plat)
    and (p_start is null or v.sale_date>=p_start) and (p_end is null or v.sale_date<=p_end)
  group by 1,2,3
), mlv as (
  select * from lv where platform_code like 'ML%'
), cmap as (
  select s, nullif(public.commerce_sku_canon_v1(s),'') canon
  from (select s from shp union select s from lv) u where s is not null
), src as (
  select coalesce(c.canon,'SEM SKU') key, p.units, p.revenue from shp p left join cmap c on c.s=p.s
  union all
  select coalesce(c.canon,'ANÚNCIO '||m.external_listing_id), m.units, m.revenue from mlv m left join cmap c on c.s=m.s
), prod as (
  select key,sum(units) units,sum(revenue) revenue from src group by 1 having sum(revenue)>0
), ranked as (
  select p.*,sum(revenue) over (order by revenue desc,key rows between unbounded preceding and 1 preceding) before_rev,
    sum(revenue) over () total_rev from prod p
), abc as (
  select r.*,case when coalesce(before_rev,0)<0.80*total_rev then 'A'
    when coalesce(before_rev,0)<0.95*total_rev then 'B' else 'C' end cls from ranked r
), cls as (
  select cls,count(*) products,sum(units) units,sum(revenue) revenue,
    sum(revenue)/nullif(sum(sum(revenue)) over (),0)*100 pct from abc group by 1
), top as (
  select * from abc order by revenue desc,key limit 120
), lk as (
  select t.key,m.platform_code,m.external_listing_id,sum(m.units) units,sum(m.revenue) revenue
  from lv m left join cmap c on c.s=m.s
  join top t on t.key=coalesce(c.canon,'ANÚNCIO '||m.external_listing_id)
  group by 1,2,3 having sum(m.revenue)>0
)
select jsonb_build_object(
  'platform',(select plat from prm),'start',p_start,'end',p_end,
  'classes',coalesce((select jsonb_agg(jsonb_build_object('class',cls,'products',products,'units',units,
     'revenue',round(revenue,2),'revenue_pct',round(pct,1)) order by cls) from cls),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(jsonb_build_object('platform',(select plat from prm),'key',t.key,'class',t.cls,
     'title',coalesce(nullif(public.commerce_sku_name_v1(t.key),''),
       (select li.title from public.commerce_listings li where 'ANÚNCIO '||li.external_listing_id=t.key limit 1)),
     'units',t.units,'revenue',round(t.revenue,2),
     'listings',(select count(*) from lk where lk.key=t.key),
     'links',coalesce((select jsonb_agg(jsonb_build_object('platform',lk.platform_code,'external_id',lk.external_listing_id,
        'units',lk.units,'revenue',round(lk.revenue,2)) order by lk.revenue desc) from lk where lk.key=t.key),'[]'::jsonb),
     'cum_pct',round((coalesce(t.before_rev,0)+t.revenue)/t.total_rev*100,1)) order by t.revenue desc,t.key) from top t),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.commerce_dashboard_shipping_split_v1(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with last_day as (select max(sale_date) d from public.commerce_shopee_current_sku_daily_v1),
  full_src as (
    select f.sale_month ms, f.units, f.product_revenue from public.commerce_shopee_full_monthly_v1 f where f.sale_month<='2026-10-01'
    union all
    select date_trunc('month',f.sale_date)::date, f.units, f.product_revenue
    from public.commerce_shopee_full_daily_v1 f join public.commerce_sales_import_batches b on b.id=f.batch_id and b.status='COMMITTED'
    where f.sale_date>='2026-11-01'
  ),
  months as (
    select m::date as ms from generate_series(date_trunc('month',p_start)::date, date_trunc('month',p_end)::date, interval '1 month') m
    where m::date>=p_start
      and p_end>=least((m::date+interval '1 month - 1 day')::date,(select d from last_day))
      and exists (select 1 from full_src f where f.ms=m::date)
  ),
  tot as (select coalesce(sum(s.product_revenue),0) rev, coalesce(sum(s.units),0) units
          from public.commerce_shopee_current_sku_daily_v1 s join months mo on date_trunc('month',s.sale_date)::date=mo.ms),
  fl as (select coalesce(sum(f.product_revenue),0) rev, coalesce(sum(f.units),0) units
         from full_src f join months mo on f.ms=mo.ms)
  select jsonb_build_object(
    'months',(select coalesce(jsonb_agg(ms order by ms),'[]') from months),
    'total_revenue',(select rev from tot),'full_revenue',(select rev from fl),
    'own_revenue',greatest((select rev from tot)-(select rev from fl),0),
    'total_units',(select units from tot),'full_units',(select units from fl));
$function$;

CREATE OR REPLACE FUNCTION public.commerce_annual_compare_v1(p_platform text DEFAULT 'SHOPEE'::text, p_gran text DEFAULT 'month'::text, p_year integer DEFAULT NULL::integer, p_base integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_shopee_current_sku_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when lower(coalesce(p_gran,'month')) in ('day','week') then lower(p_gran) else 'month' end gran
), p2 as (select y, coalesce(p_base,y-1) b, plat, gran from prm),
src as (
  select 'SHOPEE'::text plat, d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_current_sku_daily_v1 d
  union all
  select v.platform_code, v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE'
), f as (
  select s.*, extract(year from s.sale_date)::int yr from src s, p2
  where (p2.plat='TODAS' or s.plat=p2.plat) and s.sale_date >= make_date(p2.b-1,1,1) and s.sale_date < make_date(p2.y+1,1,1)
), cut as (
  select p2.y, p2.b, p2.plat, p2.gran,
    coalesce((select max(sale_date) from f where yr=p2.y), make_date(p2.y,12,31)) a,
    (coalesce((select max(sale_date) from f where yr=p2.y), make_date(p2.y,12,31)) - interval '1 year')::date bc
  from p2
), skus as (select distinct sku from f),
cl as (
  select k.sku, coalesce(e.category_id, r.category_id) cid, coalesce(e.subcategory_id, r.subcategory_id) sid
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select pr.category_id, pr.subcategory_id from public.commerce_sku_prefix_rules_v1 pr
     where e.sku_norm is null and k.sku like pr.prefix||'%' order by length(pr.prefix) desc limit 1) r on true
), fd as (
  select f.sale_date, f.sku, f.units, f.rev, f.yr,
    coalesce(c.name,'Sem categoria') cat, coalesce(sc.name,'Sem subcategoria') sub,
    case when f.yr=cut.y and f.sale_date<=cut.a then 'cur' when f.yr=cut.b and f.sale_date<=cut.bc then 'base' end per,
    case when f.sale_date>cut.a-28 and f.sale_date<=cut.a then 'cur' when f.sale_date>cut.bc-28 and f.sale_date<=cut.bc then 'base' end l28
  from f join cut on true join cl on cl.sku=f.sku
  left join public.commerce_categories c on c.id=cl.cid left join public.commerce_subcategories sc on sc.id=cl.sid
  where f.yr in (cut.y,cut.b)
), sub_agg as (
  select cat, sub,
    coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
    coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br,
    coalesce(sum(units) filter (where l28='cur' and yr=(select y from cut)),0) c28, coalesce(sum(units) filter (where l28='base' and yr=(select b from cut)),0) b28
  from fd group by 1,2
), cat_agg as (
  select cat, sum(cu) cu, sum(bu) bu, sum(cr) cr, sum(br) br, sum(c28) c28, sum(b28) b28 from sub_agg group by 1
), bm_sub as (
  select distinct on (cat,sub) cat, sub, m, u from (select cat, sub, to_char(sale_date,'YYYY-MM') m, sum(units) u from fd where per='cur' group by 1,2,3) t order by cat, sub, u desc, m
), bm_cat as (
  select distinct on (cat) cat, m, u from (select cat, to_char(sale_date,'YYYY-MM') m, sum(units) u from fd where per='cur' group by 1,2) t order by cat, u desc, m
), sku_agg as (
  select cat, sub, sku, coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu from fd group by 1,2,3
), sku_rank as (
  select s.*, s.cu-s.bu d,
    row_number() over (partition by cat,sub order by (s.cu-s.bu) desc, s.sku) r_up,
    row_number() over (partition by cat,sub order by (s.cu-s.bu) asc, s.sku) r_dn
  from sku_agg s
), sku_named as (
  select x.*, case when x.r_up<=3 or x.r_dn<=3 then
    public.commerce_sku_name_v1(x.sku) end pname
  from sku_rank x
), tot as (
  select sum(cu) cu, sum(bu) bu, sum(cr) cr, sum(br) br, sum(c28) c28, sum(b28) b28 from sub_agg
), basefull as (select coalesce(sum(units),0) u from fd where yr=(select b from cut)),
kpi as (
  select t.*, bf.u base_full,
    case when t.b28>0 then round(t.cu + (bf.u - t.bu) * (t.c28::numeric/t.b28)) end proj
  from tot t, basefull bf
), dd as (select sale_date, sum(units) u, sum(rev) r from f group by 1),
per_month as (
  select m.mo, coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
         coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br
  from generate_series(1,12) m(mo) left join fd on extract(month from fd.sale_date)::int=m.mo and fd.per is not null
  where m.mo <= (select extract(month from a)::int from cut) group by m.mo order by m.mo
), per_week as (
  select k, (select a from cut)-7*k-6 s, (select a from cut)-7*k e,
    coalesce((select sum(u) from dd where sale_date between (select a from cut)-7*k-6 and (select a from cut)-7*k),0) cu,
    coalesce((select sum(u) from dd where sale_date between (select a from cut)-7*k-6-364 and (select a from cut)-7*k-364),0) bu
  from generate_series(0,11) k
), per_day as (
  select k, (select a from cut)-k d,
    coalesce((select u from dd where sale_date=(select a from cut)-k),0) cu,
    coalesce((select u from dd where sale_date=(select a from cut)-k-364),0) bu
  from generate_series(0,29) k
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'gran',(select gran from cut),
  'as_of',(select a from cut),'base_cut',(select bc from cut),
  'kpi',(select jsonb_build_object('cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,'cur28',c28,'base28',b28,'base_full',base_full,'projection',proj) from kpi),
  'periods',case (select gran from cut)
    when 'month' then coalesce((select jsonb_agg(jsonb_build_object('key',mo,'label',(array['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'])[mo],'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br) order by mo) from per_month),'[]'::jsonb)
    when 'week' then coalesce((select jsonb_agg(jsonb_build_object('key',k,'label',to_char(s,'DD/MM')||' a '||to_char(e,'DD/MM'),'cur',cu,'base',bu) order by k) from per_week),'[]'::jsonb)
    else coalesce((select jsonb_agg(jsonb_build_object('key',k,'label',to_char(d,'DD/MM')||' '||(array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from d)::int+1],'cur',cu,'base',bu) order by k) from per_day),'[]'::jsonb) end,
  'categories',coalesce((select jsonb_agg(jsonb_build_object(
      'name',ca.cat,'cur',ca.cu,'base',ca.bu,'cur_rev',ca.cr,'base_rev',ca.br,'cur28',ca.c28,'base28',ca.b28,
      'best_month',(select m from bm_cat b where b.cat=ca.cat),'best_month_units',(select u from bm_cat b where b.cat=ca.cat),
      'subs',coalesce((select jsonb_agg(jsonb_build_object('name',sa.sub,'cur',sa.cu,'base',sa.bu,'cur_rev',sa.cr,'base_rev',sa.br,'cur28',sa.c28,'base28',sa.b28,
          'best_month',(select m from bm_sub b where b.cat=sa.cat and b.sub=sa.sub),'best_month_units',(select u from bm_sub b where b.cat=sa.cat and b.sub=sa.sub),
          'up',coalesce((select jsonb_agg(jsonb_build_object('sku',x.sku,'name',x.pname,'cur',x.cu,'base',x.bu) order by x.r_up) from sku_named x where x.cat=sa.cat and x.sub=sa.sub and x.r_up<=3 and x.d>0),'[]'::jsonb),
          'down',coalesce((select jsonb_agg(jsonb_build_object('sku',x.sku,'name',x.pname,'cur',x.cu,'base',x.bu) order by x.r_dn) from sku_named x where x.cat=sa.cat and x.sub=sa.sub and x.r_dn<=3 and x.d<0),'[]'::jsonb)
        ) order by sa.cu desc, sa.bu desc) from sub_agg sa where sa.cat=ca.cat),'[]'::jsonb)
    ) order by ca.cu desc, ca.bu desc) from cat_agg ca),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.commerce_categories_timeline_v1(p_platform text DEFAULT 'SHOPEE'::text, p_year integer DEFAULT 2026, p_cat text DEFAULT NULL::text, p_month integer DEFAULT 1, p_sub text DEFAULT NULL::text, p_week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prm as (
  select plat,y,b,as_of,
    least(extract(day from as_of)::integer,
      extract(day from (make_date(b,extract(month from as_of)::integer,1)+interval '1 month - 1 day')::date)::integer) as cut_day
  from public.commerce_period_v1(p_platform,p_year,'ytd',null,null)
  where p_platform in ('SHOPEE','ML_ANTIGO','ML_NOVO','TODAS')
    and p_year between 2021 and 2100
    and p_month between 1 and 12
    and p_cat is not null and length(p_cat) between 1 and 120
    and (p_sub is null or length(p_sub) between 1 and 120)
    and (p_week is null or p_week between 1 and 5)
), sales as materialized (
  select d.sale_date,public.commerce_sku_canon_v1(d.sku_norm) as sku,
    d.units
  from public.commerce_shopee_current_sku_daily_v1 d cross join prm p
  where p.plat in ('SHOPEE','TODAS')
    and d.sale_date>=make_date(p.b,1,1)
    and d.sale_date<make_date(p.y+1,1,1)
    and (extract(year from d.sale_date)::integer=p.b or d.sale_date<=p.as_of)
  union all
  select v.sale_date,public.commerce_sku_canon_v1(v.sku_norm),v.units
  from public.commerce_current_sales_listing_daily_v1 v cross join prm p
  where p.plat <> 'SHOPEE' and v.platform_code like 'ML%'
    and (p.plat='TODAS' or v.platform_code=p.plat)
    and v.sale_date>=make_date(p.b,1,1)
    and v.sale_date<make_date(p.y+1,1,1)
    and (extract(year from v.sale_date)::integer=p.b or v.sale_date<=p.as_of)
), sku_collections as materialized (
  select k.sku,public.commerce_sku_col_v1(k.sku,public.commerce_sku_name_v1(k.sku)) col
  from (select distinct sku from sales) k
), classified as materialized (
  select s.sale_date,s.sku,s.units,
    coalesce(c.name,'Sem categoria') cat,
    names.col col,
    extract(year from s.sale_date)::integer yr,
    extract(month from s.sale_date)::integer mon,
    least(((extract(day from s.sale_date)::integer-1)/7)+1,5) wk
  from sales s
  join sku_collections names on names.sku=s.sku
  left join public.commerce_sku_category_v1 e on e.sku_norm=s.sku
  left join lateral (
    select r.category_id,r.subcategory_id
    from public.commerce_sku_prefix_rules_v1 r
    where e.sku_norm is null and s.sku like r.prefix||'%'
    order by length(r.prefix) desc limit 1
  ) pref on true
  left join public.commerce_categories c on c.id=coalesce(e.category_id,pref.category_id)
), monthly_category as (
  select cat,yr,mon,sum(units)::bigint units
  from classified cross join prm p
  where not (yr=p.b and mon=extract(month from p.as_of)::integer
    and extract(day from sale_date)::integer>p.cut_day)
  group by 1,2,3
), monthly_col as (
  select col,yr,mon,sum(units)::bigint units
  from classified cross join prm p where cat=p_cat
    and not (yr=p.b and mon=extract(month from p.as_of)::integer
      and extract(day from sale_date)::integer>p.cut_day)
  group by 1,2,3
), weekly_col as (
  select col,wk,yr,sum(units)::bigint units
  from classified cross join prm p
  where cat=p_cat and mon=p_month
    and (yr=p.y or (yr=p.b and (p_month<>extract(month from p.as_of)::integer
      or extract(day from sale_date)::integer<=p.cut_day)))
  group by 1,2,3
), col_totals as (
  select cat,col,
    coalesce(sum(units) filter (where yr=p.y),0)::bigint cur,
    coalesce(sum(units) filter (where yr=p.b and
      (mon<extract(month from p.as_of)::integer
       or (mon=extract(month from p.as_of)::integer and extract(day from sale_date)::integer<=p.cut_day))),0)::bigint base
  from classified cross join prm p
  where (yr=p.y or yr=p.b and (mon<extract(month from p.as_of)::integer
       or (mon=extract(month from p.as_of)::integer and extract(day from sale_date)::integer<=p.cut_day)))
  group by 1,2
), selected_skus as (
  select s.sku,
    coalesce(sum(s.units) filter (where s.yr=p.y),0)::bigint cur,
    coalesce(sum(s.units) filter (where s.yr=p.b),0)::bigint base
  from classified s cross join prm p
  where s.cat=p_cat and (p_sub is null or s.col=p_sub) and s.mon=p_month
    and (p_week is null or s.wk=p_week)
    and (s.yr=p.y or (s.yr=p.b and (p_month<>extract(month from p.as_of)::integer
      or extract(day from s.sale_date)::integer<=p.cut_day)))
  group by 1
), selected_skus_ytd as (
  select s.sku,
    coalesce(sum(s.units) filter (where s.yr=p.y),0)::bigint cur,
    coalesce(sum(s.units) filter (where s.yr=p.b),0)::bigint base
  from classified s cross join prm p
  where s.cat=p_cat and (p_sub is null or s.col=p_sub)
    and (s.yr=p.y or (s.yr=p.b and (s.mon<extract(month from p.as_of)::integer
      or (s.mon=extract(month from p.as_of)::integer and extract(day from s.sale_date)::integer<=p.cut_day))))
  group by 1
), leading_products as (
  (select 'm'::text k,s.* from selected_skus s order by s.cur desc,s.base desc,s.sku
    limit (case when p_sub is null then 8 else 30 end))
  union all
  (select 'y'::text k,s.* from selected_skus_ytd s order by s.cur desc,s.base desc,s.sku
    limit (case when p_sub is null then 8 else 60 end))
), images as (
  select distinct on (c.name) c.name cat,p.reference_image_url url
  from public.commerce_products p
  join public.commerce_categories c on c.id=p.category_id
  where p.reference_image_url like '/api/images/%'
  order by c.name,p.id desc
)
select jsonb_build_object(
  'platform',(select plat from prm),'year',(select y from prm),
  'base_year',(select b from prm),'as_of',(select as_of from prm),
  'category',p_cat,'collection',p_sub,'month',p_month,'week',p_week,
  'variation_count',(select count(*) from selected_skus),
  'variation_count_ytd',(select count(*) from selected_skus_ytd),
  'category_months',coalesce((select jsonb_agg(jsonb_build_object('cat',cat,'year',yr,'month',mon,'units',units)
     order by yr,mon,cat) from monthly_category),'[]'::jsonb),
  'collection_months',coalesce((select jsonb_agg(jsonb_build_object('col',col,'year',yr,'month',mon,'units',units)
     order by yr,mon,col) from monthly_col),'[]'::jsonb),
  'weekly_collections',coalesce((select jsonb_agg(jsonb_build_object('col',col,'year',yr,'week',wk,'units',units)
     order by yr,wk,col) from weekly_col),'[]'::jsonb),
  'collections',coalesce((select jsonb_agg(jsonb_build_object('cat',cat,'name',col,'cur',cur,'base',base)
     order by cur desc,col) from col_totals cross join prm p where cat=p_cat),'[]'::jsonb),
  'leader_collection',(select jsonb_build_object('category',cat,'name',col,'cur',cur)
     from col_totals where cur>0 order by cur desc,cat,col limit 1),
  'category_images',coalesce((select jsonb_agg(jsonb_build_object('category',cat,'image',url) order by cat)
     from images),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object(
      'sku',q.sku,'cur',q.cur,'base',q.base,'name',coalesce(meta.name,q.sku),
      'image',meta.image,'url',link.url,'listing_id',link.listing_id,
      'variation_name',link.variation
    ) order by q.cur desc,q.base desc,q.sku)
    from (select * from leading_products where k='m') q
    left join lateral (
      select p.name,p.reference_image_url image
      from public.commerce_product_skus ps
      join public.commerce_products p on p.id=ps.product_id
      where public.commerce_sku_canon_v1(ps.sku)=q.sku
      order by (p.reference_image_url like '/api/images/%') desc,p.id desc limit 1
    ) meta on true
    left join lateral (
      select l.external_listing_id listing_id,nullif(lp.variation_name,'') variation,
        coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url
      from public.commerce_listing_products lp
      join public.commerce_listings l on l.id=lp.listing_id
      join public.commerce_marketplaces m on m.id=l.marketplace_id
      cross join prm p
      where public.commerce_sku_canon_v1(lp.platform_sku)=q.sku
        and lp.relation_status<>'REMOVED'
        and ((p.plat='SHOPEE' and m.code='SHOPEE')
          or (p.plat like 'ML_%' and m.code='MERCADO_LIVRE'
            and l.account_code=case when p.plat='ML_NOVO' then 'NOVO' else 'ANTIGO' end)
          or p.plat='TODAS')
      order by (l.listing_status='ACTIVE') desc,l.id desc limit 1
    ) link on true
  ),'[]'::jsonb),
  'products_ytd',coalesce((select jsonb_agg(jsonb_build_object(
      'sku',q.sku,'cur',q.cur,'base',q.base,'name',coalesce(meta.name,q.sku),
      'image',meta.image,'url',link.url,'listing_id',link.listing_id,
      'variation_name',link.variation
    ) order by q.cur desc,q.base desc,q.sku)
    from (select * from leading_products where k='y') q
    left join lateral (
      select p.name,p.reference_image_url image
      from public.commerce_product_skus ps
      join public.commerce_products p on p.id=ps.product_id
      where public.commerce_sku_canon_v1(ps.sku)=q.sku
      order by (p.reference_image_url like '/api/images/%') desc,p.id desc limit 1
    ) meta on true
    left join lateral (
      select l.external_listing_id listing_id,nullif(lp.variation_name,'') variation,
        coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url
      from public.commerce_listing_products lp
      join public.commerce_listings l on l.id=lp.listing_id
      join public.commerce_marketplaces m on m.id=l.marketplace_id
      cross join prm p
      where public.commerce_sku_canon_v1(lp.platform_sku)=q.sku
        and lp.relation_status<>'REMOVED'
        and ((p.plat='SHOPEE' and m.code='SHOPEE')
          or (p.plat like 'ML_%' and m.code='MERCADO_LIVRE'
            and l.account_code=case when p.plat='ML_NOVO' then 'NOVO' else 'ANTIGO' end)
          or p.plat='TODAS')
      order by (l.listing_status='ACTIVE') desc,l.id desc limit 1
    ) link on true
  ),'[]'::jsonb)
);
$function$;

-- Cache: só as leituras cacheadas no banco que dependem da fonte corrigida. O cache do edge expira sozinho (5 min).
do $cache$
begin
  if to_regclass('public.commerce_read_cache_v1') is not null then
    execute $q$delete from public.commerce_read_cache_v1
      where cache_key like 'commerce_dashboard_abc_v2|%' or cache_key like 'commerce_categories_v2|%'
         or cache_key like 'commerce_categories_timeline_v1|%' or cache_key like 'commerce_dashboard_shipping_split_v1|%'$q$;
  end if;
end $cache$;
