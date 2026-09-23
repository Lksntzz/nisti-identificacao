create or replace function public.commerce_preview_catalog_audit_v3()
returns table(check_name text,severity text,violations bigint,details jsonb)
language sql
stable
security invoker
set search_path=public
as $$
  select
    a.check_name,
    case when a.check_name='duplicate_normalized_product_name' then 'INFO' else a.severity end as severity,
    a.violations,
    case
      when a.check_name='duplicate_normalized_product_name'
        then a.details || jsonb_build_object(
          'rule','ONE_SKU_ONE_PRODUCT_MASTER',
          'note','Nomes idênticos são permitidos quando os Produtos Mestre possuem SKUs distintos.'
        )
      else a.details
    end as details
  from public.commerce_preview_catalog_audit_v2() a;
$$;

revoke all on function public.commerce_preview_catalog_audit_v3() from public,anon,authenticated;
grant execute on function public.commerce_preview_catalog_audit_v3() to service_role;

create or replace function public.commerce_catalog_audit_v3()
returns table(check_name text,severity text,violations bigint,details jsonb)
language sql
stable
security invoker
set search_path=public
as $$
  select
    a.check_name,
    case when a.check_name='duplicate_normalized_product_name' then 'INFO' else a.severity end as severity,
    a.violations,
    case
      when a.check_name='duplicate_normalized_product_name'
        then a.details || jsonb_build_object(
          'rule','ONE_SKU_ONE_PRODUCT_MASTER',
          'note','Nomes idênticos são permitidos quando os Produtos Mestre possuem SKUs distintos.'
        )
      else a.details
    end as details
  from public.commerce_catalog_audit_v2() a;
$$;

revoke all on function public.commerce_catalog_audit_v3() from public,anon,authenticated;
grant execute on function public.commerce_catalog_audit_v3() to service_role;
