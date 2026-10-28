-- Detalhe do anúncio ML (conta Novo): as variações são os SKUs do anúncio (não o código MLB), com vendas só dos SKUs que venderam.
create or replace function public.commerce_listing_cohort_detail_v6(p_platform text, p_key text)
returns jsonb
language sql
stable
set search_path to 'public'
as $g$
with d as (select public.commerce_listing_cohort_detail_v5(p_platform,p_key) j),
k as (select nullif(split_part(coalesce(p_key,''),'|',2),'') acct)
select case when upper(coalesce(p_platform,''))<>'ML' or upper(coalesce((select acct from k),''))<>'NOVO' then (select j from d)
  else jsonb_set((select j from d),'{variations}',coalesce((
    select jsonb_agg(jsonb_build_object('sku',v->>'sku','name',v->>'sku','listing_id',l->>'external_id',
      'units',(v->>'units')::numeric,'revenue',(v->>'revenue')::numeric,'u_last28',coalesce((v->>'u_last28')::numeric,0),
      'best_month',v->'best_month','best_month_units',v->'best_month_units')
      order by (v->>'units')::numeric desc, v->>'sku')
    from jsonb_array_elements((select j from d)->'listings') l, jsonb_array_elements(l->'variations') v),'[]'::jsonb)) end;
$g$;
revoke all on function public.commerce_listing_cohort_detail_v6(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v6(text,text) to service_role;
