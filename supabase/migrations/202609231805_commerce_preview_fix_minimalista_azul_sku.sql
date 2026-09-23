begin;

update public.commerce_preview_product_skus
set sku='VACMNO_MNZ3_BAA',
    updated_at=now()
where product_id=339
  and sku='VCMNO_MNZ3_BAA';

update public.commerce_preview_listing_products
set platform_sku='VACMNO_MNZ3_BAA'
where listing_id=1471
  and product_id=339
  and platform_sku='VCMNO_MNZ3_BAA';

update public.commerce_preview_source_rows
set normalized_payload =
      jsonb_set(
        jsonb_set(
          normalized_payload,
          '{sku}',
          to_jsonb('VACMNO_MNZ3_BAA'::text),
          true
        ),
        '{operator_correction}',
        jsonb_build_object(
          'field','sku',
          'from','VCMNO_MNZ3_BAA',
          'to','VACMNO_MNZ3_BAA',
          'reason','Usuário confirmou erro de digitação no prefixo do SKU.',
          'corrected_at',now(),
          'operator','SMITH'
        ),
        true
      )
where normalized_payload->>'sku'='VCMNO_MNZ3_BAA'
  and normalized_payload->>'variation'='CAPA 3'
  and row_number=164;

update public.commerce_preview_listings
set raw_metadata=jsonb_set(
      coalesce(raw_metadata,'{}'::jsonb),
      '{operator_corrections,minimalista_azul_capa_3_sku}',
      jsonb_build_object(
        'from','VCMNO_MNZ3_BAA',
        'to','VACMNO_MNZ3_BAA',
        'confirmed_by_user',true,
        'corrected_at',now(),
        'operator','SMITH'
      ),
      true
    ),
    updated_at=now()
where id=1471;

commit;
