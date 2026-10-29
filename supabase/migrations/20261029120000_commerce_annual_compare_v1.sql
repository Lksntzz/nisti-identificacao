-- Comparativo anual: regras por prefixo (SKUs novos/ML) + função que compara ano atual x ano base por categoria.
create table if not exists public.commerce_sku_prefix_rules_v1 (
  prefix text primary key,
  category_id bigint not null references public.commerce_categories(id),
  subcategory_id bigint references public.commerce_subcategories(id)
);
alter table public.commerce_sku_prefix_rules_v1 enable row level security;
revoke all on public.commerce_sku_prefix_rules_v1 from public,anon,authenticated;
grant all on public.commerce_sku_prefix_rules_v1 to service_role;

with r(prefix, cat, sub) as (values
 ('PB','Agenda','Agenda Anual / Organização Pessoal'),('AGD','Agenda','Agenda Anual / Organização Pessoal'),('AG2','Agenda','Agenda Anual / Organização Pessoal'),
 ('AGMT','Agenda','Agendamentos (manicure/cabeleireira/lash)'),('MANI','Agenda','Agendamentos (manicure/cabeleireira/lash)'),
 ('AGESC','Agenda','Agenda Escolar / Creche'),('AGDPERM','Agenda','Agenda Permanente'),('AGDGV','Agenda','Agenda Permanente'),
 ('PLAN','Planner','Planner Semanal / Mensal'),('PLASHP','Planner','Planner Semanal / Mensal'),('PLANNV','Planner','Planner da Noiva'),
 ('PLANPROF','Planner','Planner do Professor'),('PNJPRO','Planner','Planner do Professor'),('PLANCARD','Planner','Planner Cardápio / Alimentar'),
 ('PLANGEST','Planner','Planner da Gestante'),('DEVNP','Planner','Planner Devocional'),('DEV365','Planner','Planner Devocional'),
 ('CADCONT','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),('CADCTFIN','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),
 ('CADCONCX','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),('CADPED','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),
 ('CADPEN','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),('CONFIN','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),
 ('CCAIXA','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),('CFTRNV','Caderno','Caderno de Gestão (financeiro / caixa / pedidos)'),
 ('CADANFL','Caderno','Caderno de Anotações'),('CADAFL','Caderno','Caderno de Anotações'),('PTD','Caderno','Caderno de Anotações'),('PDT','Caderno','Caderno de Anotações'),
 ('PONTIL','Caderno','Caderno de Anotações'),('LISO','Caderno','Caderno de Anotações'),('CALIG','Caderno','Caderno de Caligrafia'),
 ('SCP','Caderno','Caderno Scrapbook'),('SCRA','Caderno','Caderno Scrapbook'),('CDISC','Caderno','Caderno de Discos'),('CADISC','Caderno','Caderno de Discos'),('RFL','Caderno','Caderno de Discos'),
 ('RECT','Caderno','Caderno de Receitas'),('CADRMR','Caderno','Caderno de Receitas'),('DIALE','Caderno','Caderno Diário (leitura / doramas / pet)'),
 ('CDRAMA','Caderno','Caderno Diário (leitura / doramas / pet)'),('CADORA','Caderno','Caderno Devocional / Oração'),
 ('VACMNA','Caderneta de Vacinação','Vacinação Menina'),('VCMNA','Caderneta de Vacinação','Vacinação Menina'),
 ('VACMNO','Caderneta de Vacinação','Vacinação Menino'),('VCMNO','Caderneta de Vacinação','Vacinação Menino'),('VPET','Caderneta de Vacinação','Vacinação Pet'),
 ('CMBVAC','Outros','Kits e Combos'),('KIT','Outros','Kits e Combos'),('CMB','Outros','Kits e Combos'),('COMB','Outros','Kits e Combos'),
 ('ETQ','Adesivos / Etiquetas','Etiquetas Escolares'),('ADSV','Adesivos / Etiquetas','Adesivos Chá de Bebê'),('CARDBB','Cardápio','Cardápio Infantil'),
 ('COL1','Livro de colorir','Livro de Colorir Bíblico'),('COL2','Livro de colorir','Livro de Colorir Bíblico'),('COL3','Livro de colorir','Livro de Colorir Bíblico'),
 ('COL4','Livro de colorir','Livro de Colorir Bíblico'),('COL5','Livro de colorir','Livro de Colorir Bíblico'),('LDCOL','Livro de colorir','Livro de Colorir'),
 ('LIVBB','Outros','Livro do Bebê'),('BIBL','Outros','Bíblia'),('DIAPET','Outros','Diário Pet'),('DIAGEST','Outros','Gestante'),('CADGES','Outros','Gestante'),('ET0','Outros','Estojos'))
insert into public.commerce_sku_prefix_rules_v1(prefix, category_id, subcategory_id)
select r.prefix, c.id, sc.id from r join public.commerce_categories c on c.name=r.cat
join public.commerce_subcategories sc on sc.category_id=c.id and sc.name=r.sub
on conflict (prefix) do update set category_id=excluded.category_id, subcategory_id=excluded.subcategory_id;

create or replace function public.commerce_annual_compare_v1(p_platform text default 'SHOPEE', p_gran text default 'month', p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_current_sales_listing_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when lower(coalesce(p_gran,'month')) in ('day','week') then lower(p_gran) else 'month' end gran
), p2 as (select y, coalesce(p_base,y-1) b, plat, gran from prm),
src as (
  select 'SHOPEE'::text plat, d.sale_date, upper(regexp_replace(d.sku_norm,'[\s_]+','','g')) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d
  union all
  select v.platform_code, v.sale_date, upper(regexp_replace(v.sku_norm,'[\s_]+','','g')), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v where v.platform_code like 'ML%'
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
    row_number() over (partition by cat,sub order by (s.cu-s.bu) asc, s.sku) r_dn,
    (select pp.name from public.commerce_product_skus ps join public.commerce_products pp on pp.id=ps.product_id
       where upper(regexp_replace(ps.sku,'[\s_]+','','g'))=s.sku limit 1) pname
  from sku_agg s
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
          'up',coalesce((select jsonb_agg(jsonb_build_object('sku',x.sku,'name',x.pname,'cur',x.cu,'base',x.bu) order by x.r_up) from sku_rank x where x.cat=sa.cat and x.sub=sa.sub and x.r_up<=3 and x.d>0),'[]'::jsonb),
          'down',coalesce((select jsonb_agg(jsonb_build_object('sku',x.sku,'name',x.pname,'cur',x.cu,'base',x.bu) order by x.r_dn) from sku_rank x where x.cat=sa.cat and x.sub=sa.sub and x.r_dn<=3 and x.d<0),'[]'::jsonb)
        ) order by sa.cu desc, sa.bu desc) from sub_agg sa where sa.cat=ca.cat),'[]'::jsonb)
    ) order by ca.cu desc, ca.bu desc) from cat_agg ca),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_compare_v1(text,text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_compare_v1(text,text,int,int) to service_role;
