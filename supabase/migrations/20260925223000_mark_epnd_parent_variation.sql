-- Preview-only: the generic EPND row is the parent of three concrete Shopee variations.
-- It shares the exact listing URL with PTD180_EPND1_BBB, EPND2 and EPND3,
-- which are already linked to their own Product Masters.
update public.commerce_preview_source_rows
set resolution_status='VARIATION',
    notes=concat_ws(
      ' · ',
      nullif(notes,''),
      'preview variation parent: same Shopee listing as PTD180_EPND1_BBB / EPND2 / EPND3; not a standalone Product Master'
    )
where id=4908
  and matched_product_id is null
  and resolution_status<>'VARIATION';
