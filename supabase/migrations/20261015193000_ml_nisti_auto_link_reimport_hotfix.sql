-- Replace only the reimport code inside the already installed RPC.
do $$
declare
  v_body text;
  v_old text := $oldblock$    if v_variation_id is not null and exists (
      select 1 from public.commerce_listing_products lp
      where lp.listing_id=v_listing_id and btrim(lp.variation_id)=v_variation_id
        and lp.product_id<>v_product_id
    ) then v_collisions:=v_collisions+1; continue; end if;

    insert into public.commerce_listing_products(
      listing_id,product_id,platform_sku,variation_id,variation_name,relation_status
    ) values (
      v_listing_id,v_product_id,v_source_sku,v_variation_id,
      nullif(btrim(coalesce(v_row.item->>'source_variation','')),''),'ACTIVE'
    ) on conflict do nothing;

$oldblock$;
  v_new text := $newblock$    -- An existing listing/variation may have ONE product identity only.
    if exists (
      select 1 from public.commerce_listing_products lp
      where lp.listing_id=v_listing_id
        and lp.variation_id is not distinct from v_variation_id
        and lp.product_id<>v_product_id
    ) then v_collisions:=v_collisions+1; continue; end if;

    -- Reimport is an update to the same link, never another product row.
    update public.commerce_listing_products lp
    set platform_sku=v_source_sku,
        variation_name=coalesce(
          nullif(btrim(coalesce(v_row.item->>'source_variation','')),''),
          lp.variation_name
        ),relation_status='ACTIVE'
    where lp.listing_id=v_listing_id and lp.product_id=v_product_id
      and lp.variation_id is not distinct from v_variation_id;

    if not found then
      insert into public.commerce_listing_products(
        listing_id,product_id,platform_sku,variation_id,variation_name,relation_status
      ) values (
        v_listing_id,v_product_id,v_source_sku,v_variation_id,
        nullif(btrim(coalesce(v_row.item->>'source_variation','')),''),'ACTIVE'
      ) on conflict do nothing;
    end if;

$newblock$;
begin
  v_body:=pg_get_functiondef('public.commerce_auto_link_ml_active_v1(bigint)'::regprocedure);
  if position(v_old in v_body)>0 then
    execute replace(v_body,v_old,v_new);
  elsif position('An existing listing/variation may have ONE product identity only.' in v_body)=0 then
    raise exception 'unexpected_auto_link_function_definition';
  end if;
end;
$$;
