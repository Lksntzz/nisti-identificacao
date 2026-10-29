-- Categorias por coleção: a coleção é lida do nome do produto (heurística) e pode ser corrigida por SKU na tabela de ajuste.
create table if not exists public.commerce_sku_collection_v1 (sku_norm text primary key, collection text not null, note text);
alter table public.commerce_sku_collection_v1 enable row level security;
revoke all on public.commerce_sku_collection_v1 from public,anon,authenticated;
grant all on public.commerce_sku_collection_v1 to service_role;

create or replace function public.commerce_collection_v1(p_name text) returns text language sql immutable set search_path to 'public' as $f$
with a as (select regexp_replace(regexp_replace(coalesce(p_name,''),'\s+',' ','g'),'(\s[-–]\s*(\d+|capa\s*\d+))+$','','i') n),
b as (select coalesce((regexp_match(n,'Cole[cç][aã]o\s+(.+)$','i'))[1], case when n ~ '\s[-–]\s' then regexp_replace(n,'^.*\s[-–]\s+','') end) c from a),
c as (select btrim(regexp_replace(regexp_replace(c,'\s[-–]\s.*$',''),'[\s.,;:-]+$','')) c from b)
select case when c is null or c='' or length(c)>32 or c ~ '^\d+$'
  or lower(c) ~ '^(capa\s*0*\d+|grande|m[eé]dia|pequen[oa]|permanente|capa dura|semanal.*|menino|meninos|menina|meninas|pet|unissex|fosco|brilho|a4|a5|a6)$'
  then null else initcap(lower(c)) end from c;
$f$;
revoke all on function public.commerce_collection_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_collection_v1(text) to service_role;

create or replace function public.commerce_sku_col_v1(p_sku text, p_name text) returns text language sql stable set search_path to 'public' as $f$
  select coalesce((select o.collection from public.commerce_sku_collection_v1 o where o.sku_norm=p_sku), public.commerce_collection_v1(p_name), 'Sem coleção');
$f$;
revoke all on function public.commerce_sku_col_v1(text,text) from public,anon,authenticated;
grant execute on function public.commerce_sku_col_v1(text,text) to service_role;

-- commerce_categories_v2: o nível "subs" (subcategoria) passa a ser "cols" (coleção): cl ganha a coleção por SKU e a agregação agrupa por categoria + coleção.
-- commerce_categories_col_v2(plataforma, ano, modo, mês, dias, categoria, coleção): variações (SKUs) da coleção com unidades, receita, links e melhor mês.
-- (definições completas aplicadas no banco via apply_migration commerce_categories_collections_v1)
