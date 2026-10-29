-- Troca de código do mesmo produto: SKU antigo passa a contar como o SKU novo nos comparativos anuais.
create table if not exists public.commerce_sku_alias_v1 (
  old_sku text primary key,
  new_sku text not null,
  note text
);
alter table public.commerce_sku_alias_v1 enable row level security;
revoke all on public.commerce_sku_alias_v1 from public,anon,authenticated;
grant all on public.commerce_sku_alias_v1 to service_role;
insert into public.commerce_sku_alias_v1(old_sku,new_sku,note) values ('CADMNAPFL','VACMNAFLRBRR','Caderneta vacinação menina floral: código antigo CADMNAPFL virou VACMNA_FLR_BRR')
on conflict (old_sku) do update set new_sku=excluded.new_sku, note=excluded.note;

create or replace function public.commerce_sku_canon_v1(p_sku text) returns text
language sql stable set search_path to 'public' as $f$
  select coalesce((select a.new_sku from public.commerce_sku_alias_v1 a where a.old_sku=upper(regexp_replace(p_sku,'[\s_]+','','g'))), upper(regexp_replace(p_sku,'[\s_]+','','g')));
$f$;
revoke all on function public.commerce_sku_canon_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_sku_canon_v1(text) to service_role;

do $do$
declare r record; def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('commerce_annual_compare_v1','commerce_annual_month_v1') loop
    def := pg_get_functiondef(r.oid);
    def := replace(def, $s$upper(regexp_replace(d.sku_norm,'[\s_]+','','g'))$s$, $s$public.commerce_sku_canon_v1(d.sku_norm)$s$);
    def := replace(def, $s$upper(regexp_replace(v.sku_norm,'[\s_]+','','g'))$s$, $s$public.commerce_sku_canon_v1(v.sku_norm)$s$);
    execute def;
  end loop;
end $do$;
