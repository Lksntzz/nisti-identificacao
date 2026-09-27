-- Version audited Product Master reference images already validated in live/preview.
--
-- This migration does not introduce new image decisions. It records the
-- current audited production state so repository migrations and Supabase stay aligned.

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (14::bigint,'MATCHED_SNAPSHOT','AGMT26_NAIL_PXP','https://cf.shopee.com.br/file/sg-11134201-7repp-m22luwvb2fts75'),
    (22::bigint,'MATCHED_SNAPSHOT','PB26_NEG_PXP','https://cf.shopee.com.br/file/br-11134207-820l7-msvc0fc746bq8c'),
    (63::bigint,'MATCHED_SNAPSHOT','PB26_CIRC_BBB','https://cf.shopee.com.br/file/br-11134207-820lr-mte9lqx1odmre0'),
    (372::bigint,'PLATFORM_AUDITED_ALIAS','AGESCO RAP BB','https://cf.shopee.com.br/file/br-11134207-7r98o-lx9uw4m7h8zj42'),
    (405::bigint,'PLATFORM_EXACT_NAME','RECTAS ELEG PP','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w09i6qkao22b'),
    (463::bigint,'PLATFORM_AUDITED_ALIAS','PLAN26_GRAT_BXB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w0rvh6q8i9b5'),
    (468::bigint,'PLATFORM_EXACT_NAME','PLAN26_HIH_BXA','https://cf.shopee.com.br/file/br-11134207-7r98o-m04kxxkf0nl527'),
    (473::bigint,'PLATFORM_AUDITED_ALIAS','PLANNV_FRL_RVV','https://cf.shopee.com.br/file/7c24ba30239ef187edb35c1df635a9cf'),
    (654::bigint,'PLATFORM_AUDITED_ALIAS','CADKRAFT_PXP','https://cf.shopee.com.br/file/br-11134207-7r98o-maof9xr9jbaxed'),
    (680::bigint,'PLATFORM_EXACT_NAME','CONFIN25 BAA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dr6jkhe4'),
    (681::bigint,'PLATFORM_AUDITED_ALIAS','CONFIN25_CIFR_BVV','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w09i6qg2yqdf'),
    (683::bigint,'PLATFORM_AUDITED_ALIAS','DEVNP MVIRT BRB','https://cf.shopee.com.br/file/br-11134207-81z1k-me5r4r6hhywxc1'),
    (684::bigint,'PLATFORM_EXACT_NAME','DEVNP SEG BXB','https://cf.shopee.com.br/file/br-11134207-81z1k-me001u6j1ji942'),
    (685::bigint,'PLATFORM_EXACT_NAME','DEVNP LION PXP','https://cf.shopee.com.br/file/br-11134207-81z1k-me4b6giejx1e47'),
    (690::bigint,'PLATFORM_AUDITED_ALIAS','CDRAMA_SRGHAE_AZL_PXP','https://cf.shopee.com.br/file/sg-11134201-7rbkr-m5lkexjsyoke54'),
    (693::bigint,'PLATFORM_AUDITED_ALIAS','PLANNV_FRL_RVV','https://cf.shopee.com.br/file/7c24ba30239ef187edb35c1df635a9cf'),
    (694::bigint,'PLATFORM_AUDITED_ALIAS','CARDSE PNJA BB','https://cf.shopee.com.br/file/br-11134207-7r98o-mdm5zg4zrohl32')
)
update public.commerce_products p
set reference_image_url=m.image_url,
    reference_image_source=m.source_kind,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source=m.source_kind
  );

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (14::bigint,'MATCHED_SNAPSHOT','AGMT26_NAIL_PXP','https://cf.shopee.com.br/file/sg-11134201-7repp-m22luwvb2fts75'),
    (22::bigint,'MATCHED_SNAPSHOT','PB26_NEG_PXP','https://cf.shopee.com.br/file/br-11134207-820l7-msvc0fc746bq8c'),
    (63::bigint,'MATCHED_SNAPSHOT','PB26_CIRC_BBB','https://cf.shopee.com.br/file/br-11134207-820lr-mte9lqx1odmre0'),
    (372::bigint,'PLATFORM_AUDITED_ALIAS','AGESCO RAP BB','https://cf.shopee.com.br/file/br-11134207-7r98o-lx9uw4m7h8zj42'),
    (405::bigint,'PLATFORM_EXACT_NAME','RECTAS ELEG PP','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w09i6qkao22b'),
    (463::bigint,'PLATFORM_AUDITED_ALIAS','PLAN26_GRAT_BXB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w0rvh6q8i9b5'),
    (468::bigint,'PLATFORM_EXACT_NAME','PLAN26_HIH_BXA','https://cf.shopee.com.br/file/br-11134207-7r98o-m04kxxkf0nl527'),
    (473::bigint,'PLATFORM_AUDITED_ALIAS','PLANNV_FRL_RVV','https://cf.shopee.com.br/file/7c24ba30239ef187edb35c1df635a9cf'),
    (654::bigint,'PLATFORM_AUDITED_ALIAS','CADKRAFT_PXP','https://cf.shopee.com.br/file/br-11134207-7r98o-maof9xr9jbaxed'),
    (680::bigint,'PLATFORM_EXACT_NAME','CONFIN25 BAA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dr6jkhe4'),
    (681::bigint,'PLATFORM_AUDITED_ALIAS','CONFIN25_CIFR_BVV','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w09i6qg2yqdf'),
    (683::bigint,'PLATFORM_AUDITED_ALIAS','DEVNP MVIRT BRB','https://cf.shopee.com.br/file/br-11134207-81z1k-me5r4r6hhywxc1'),
    (684::bigint,'PLATFORM_EXACT_NAME','DEVNP SEG BXB','https://cf.shopee.com.br/file/br-11134207-81z1k-me001u6j1ji942'),
    (685::bigint,'PLATFORM_EXACT_NAME','DEVNP LION PXP','https://cf.shopee.com.br/file/br-11134207-81z1k-me4b6giejx1e47'),
    (690::bigint,'PLATFORM_AUDITED_ALIAS','CDRAMA_SRGHAE_AZL_PXP','https://cf.shopee.com.br/file/sg-11134201-7rbkr-m5lkexjsyoke54'),
    (693::bigint,'PLATFORM_AUDITED_ALIAS','PLANNV_FRL_RVV','https://cf.shopee.com.br/file/7c24ba30239ef187edb35c1df635a9cf'),
    (694::bigint,'PLATFORM_AUDITED_ALIAS','CARDSE PNJA BB','https://cf.shopee.com.br/file/br-11134207-7r98o-mdm5zg4zrohl32')
)
update public.commerce_preview_products p
set reference_image_url=m.image_url,
    reference_image_source=m.source_kind,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source=m.source_kind
  );

do $assert$
begin
  if (
    select count(*)
    from public.commerce_products
    where id in (14,22,63,372,405,463,468,473,654,680,681,683,684,685,690,693,694)
      and reference_image_url is not null
      and reference_image_source in ('MATCHED_SNAPSHOT','PLATFORM_EXACT_NAME','PLATFORM_AUDITED_ALIAS')
  ) <> 17 then
    raise exception 'Expected 17 live audited reference images';
  end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (14,22,63,372,405,463,468,473,654,680,681,683,684,685,690,693,694)
      and reference_image_url is not null
      and reference_image_source in ('MATCHED_SNAPSHOT','PLATFORM_EXACT_NAME','PLATFORM_AUDITED_ALIAS')
  ) <> 17 then
    raise exception 'Expected 17 preview audited reference images';
  end if;
end
$assert$;
