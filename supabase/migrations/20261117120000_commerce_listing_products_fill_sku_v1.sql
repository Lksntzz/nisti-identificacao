-- Vínculo anúncio↔produto sem SKU: o banco preenche sozinho quando o código do anúncio (platform_sku)
-- bate com exatamente UM SKU do mesmo produto. Nunca cria SKU, nunca recusa a gravação (importações não quebram).
create or replace function public.commerce_listing_products_fill_sku_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $f$
declare
  v_id bigint;
  v_n integer;
begin
  if new.product_sku_id is null and coalesce(btrim(new.platform_sku),'')<>'' then
    select min(s.id), count(*) into v_id, v_n
    from public.commerce_product_skus s
    where s.product_id=new.product_id
      and regexp_replace(upper(s.sku),'[^A-Z0-9]','','g')=regexp_replace(upper(new.platform_sku),'[^A-Z0-9]','','g');
    if v_n=1 then new.product_sku_id:=v_id; end if;
  end if;
  return new;
end
$f$;

revoke all on function public.commerce_listing_products_fill_sku_v1() from public, anon, authenticated;
grant execute on function public.commerce_listing_products_fill_sku_v1() to service_role;

drop trigger if exists commerce_listing_products_fill_sku_trg on public.commerce_listing_products;
create trigger commerce_listing_products_fill_sku_trg
before insert or update of product_id, platform_sku, product_sku_id on public.commerce_listing_products
for each row execute function public.commerce_listing_products_fill_sku_v1();
