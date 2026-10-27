-- Desativar produto: ao marcar um produto como DISCONTINUED, os anuncios ligados somente a produtos
-- desativados passam a INACTIVE (historico de vendas preservado). Ao reativar, o estado anterior volta.
-- Nada e apagado; o estado anterior fica em raw_metadata.status_before_deactivation.
do $mig$
declare
  d text := pg_get_functiondef('public.commerce_set_product_state_v1(bigint,text,text)'::regprocedure);
  anchor text := E'  select jsonb_build_object(\n    ''id'', id,';
  block text := $b$
  if v_previous <> v_status and v_status = 'DISCONTINUED' then
    update public.commerce_listings l
    set raw_metadata = l.raw_metadata || jsonb_build_object('status_before_deactivation', l.listing_status),
        listing_status = 'INACTIVE',
        updated_at = now()
    where l.listing_status in ('ACTIVE','PAUSED','UNKNOWN')
      and exists (select 1 from public.commerce_listing_products lp
                  where lp.listing_id = l.id and lp.product_id = p_product_id and lp.relation_status <> 'REMOVED')
      and not exists (select 1 from public.commerce_listing_products lp
                      join public.commerce_products p on p.id = lp.product_id
                      where lp.listing_id = l.id and lp.relation_status <> 'REMOVED'
                        and p.internal_status <> 'DISCONTINUED');
  elsif v_previous = 'DISCONTINUED' and v_status <> 'DISCONTINUED' then
    update public.commerce_listings l
    set listing_status = l.raw_metadata->>'status_before_deactivation',
        raw_metadata = l.raw_metadata - 'status_before_deactivation',
        updated_at = now()
    where l.listing_status = 'INACTIVE'
      and l.raw_metadata->>'status_before_deactivation' in ('ACTIVE','PAUSED','UNKNOWN')
      and exists (select 1 from public.commerce_listing_products lp
                  where lp.listing_id = l.id and lp.product_id = p_product_id and lp.relation_status <> 'REMOVED');
  end if;

$b$;
begin
  if position(anchor in d) = 0 then raise exception 'ancora nao encontrada em commerce_set_product_state_v1'; end if;
  if position('status_before_deactivation' in d) > 0 then return; end if;
  d := replace(d, anchor, block || anchor);
  execute d;
end
$mig$;
