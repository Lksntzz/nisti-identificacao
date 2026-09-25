CREATE OR REPLACE FUNCTION public.commerce_management_link_candidates_v1(p_source_row_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with sources(code,label,sort_order) as (
  values ('SHOPEE','Shopee',1),('ML_NOVO','ML Novo',2),('ML_ANTIGO','ML Antigo',3),('AMAZON','Amazon',4),('SHEIN','Shein',5)
),
first_pages as (
  select s.code,s.label,s.sort_order,r.*
  from sources s
  cross join lateral public.commerce_management_rows_v1(s.code,null,null,null,null,null,null,null,null,100,0) r
),
totals as (
  select code,label,sort_order,coalesce(max(total_count),0)::integer total
  from first_pages group by code,label,sort_order
),
rest_pages as (
  select t.code,t.label,t.sort_order,r.*
  from totals t
  cross join lateral generate_series(100,greatest(t.total-1,0),100) o(page_offset)
  cross join lateral public.commerce_management_rows_v1(t.code,null,null,null,null,null,null,null,null,100,o.page_offset) r
),
all_rows as (
  select * from first_pages
  union all
  select * from rest_pages
),
target as (
  select *
  from all_rows
  where source_row_id=p_source_row_id and product_id is null
  limit 1
),
candidate_ids as (
  select distinct l.product_id
  from target u
  join all_rows l
    on l.product_id is not null
   and lower(regexp_replace(btrim(coalesce(l.product_name,'')),'[^[:alnum:]]+','','g'))
       = lower(regexp_replace(btrim(coalesce(u.product_name,'')),'[^[:alnum:]]+','','g'))
   and lower(regexp_replace(btrim(coalesce(u.product_name,'')),'[^[:alnum:]]+','','g')) <> ''
   and upper(btrim(coalesce(l.category_name,'')))=upper(btrim(coalesce(u.category_name,'')))
   and coalesce(l.edition_year,-1)=coalesce(u.edition_year,-1)
),
candidate_rows as (
  select
    ci.product_id,
    cp.name as product_name,
    cps.sku as master_sku,
    cc.name as category_name,
    cp.edition_year,
    count(distinct ar.code)::integer as platform_count,
    jsonb_agg(distinct jsonb_build_object('source_code',ar.code,'label',ar.label)) as platforms,
    (
      select ar2.image_url
      from all_rows ar2
      where ar2.product_id=ci.product_id and nullif(ar2.image_url,'') is not null
      order by
        case when ar2.edition_year=cp.edition_year then 0 else 1 end,
        ar2.sort_order,
        ar2.source_row_id
      limit 1
    ) as image_url
  from candidate_ids ci
  join public.commerce_products cp on cp.id=ci.product_id
  left join public.commerce_categories cc on cc.id=cp.category_id
  left join lateral (
    select ps.sku
    from public.commerce_product_skus ps
    where ps.product_id=cp.id
    order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end,ps.id
    limit 1
  ) cps on true
  join all_rows ar on ar.product_id=ci.product_id
  group by ci.product_id,cp.name,cps.sku,cc.name,cp.edition_year
)
select jsonb_build_object(
  'source',(
    select jsonb_build_object(
      'source_row_id',t.source_row_id,
      'platform',t.label,
      'source_code',t.code,
      'sku',t.sku,
      'product_name',t.product_name,
      'category_name',t.category_name,
      'edition_year',t.edition_year,
      'image_url',t.image_url
    ) from target t
  ),
  'candidates',coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id',c.product_id,
      'product_name',c.product_name,
      'master_sku',c.master_sku,
      'category_name',c.category_name,
      'edition_year',c.edition_year,
      'image_url',c.image_url,
      'platform_count',c.platform_count,
      'platforms',c.platforms
    ) order by c.product_name,c.product_id)
    from candidate_rows c
  ),'[]'::jsonb)
);
$function$;
revoke execute on function public.commerce_management_link_candidates_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_management_link_candidates_v1(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_link_candidates_v1(p_source_row_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with sources(code,label,sort_order) as (
  values ('SHOPEE','Shopee',1),('ML_NOVO','ML Novo',2),('ML_ANTIGO','ML Antigo',3),('AMAZON','Amazon',4),('SHEIN','Shein',5)
),
first_pages as (
  select s.code,s.label,s.sort_order,r.*
  from sources s
  cross join lateral public.commerce_preview_management_rows_v1(s.code,null,null,null,null,null,null,null,null,100,0) r
),
totals as (
  select code,label,sort_order,coalesce(max(total_count),0)::integer total
  from first_pages group by code,label,sort_order
),
rest_pages as (
  select t.code,t.label,t.sort_order,r.*
  from totals t
  cross join lateral generate_series(100,greatest(t.total-1,0),100) o(page_offset)
  cross join lateral public.commerce_preview_management_rows_v1(t.code,null,null,null,null,null,null,null,null,100,o.page_offset) r
),
all_rows as (
  select * from first_pages
  union all
  select * from rest_pages
),
target as (
  select *
  from all_rows
  where source_row_id=p_source_row_id and product_id is null
  limit 1
),
candidate_ids as (
  select distinct l.product_id
  from target u
  join all_rows l
    on l.product_id is not null
   and lower(regexp_replace(btrim(coalesce(l.product_name,'')),'[^[:alnum:]]+','','g'))
       = lower(regexp_replace(btrim(coalesce(u.product_name,'')),'[^[:alnum:]]+','','g'))
   and lower(regexp_replace(btrim(coalesce(u.product_name,'')),'[^[:alnum:]]+','','g')) <> ''
   and upper(btrim(coalesce(l.category_name,'')))=upper(btrim(coalesce(u.category_name,'')))
   and coalesce(l.edition_year,-1)=coalesce(u.edition_year,-1)
),
candidate_rows as (
  select
    ci.product_id,
    cp.name as product_name,
    cps.sku as master_sku,
    cc.name as category_name,
    cp.edition_year,
    count(distinct ar.code)::integer as platform_count,
    jsonb_agg(distinct jsonb_build_object('source_code',ar.code,'label',ar.label)) as platforms,
    (
      select ar2.image_url
      from all_rows ar2
      where ar2.product_id=ci.product_id and nullif(ar2.image_url,'') is not null
      order by case when ar2.edition_year=cp.edition_year then 0 else 1 end,ar2.sort_order,ar2.source_row_id
      limit 1
    ) as image_url
  from candidate_ids ci
  join public.commerce_preview_products cp on cp.id=ci.product_id
  left join public.commerce_preview_categories cc on cc.id=cp.category_id
  left join lateral (
    select ps.sku
    from public.commerce_preview_product_skus ps
    where ps.product_id=cp.id
    order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end,ps.id
    limit 1
  ) cps on true
  join all_rows ar on ar.product_id=ci.product_id
  group by ci.product_id,cp.name,cps.sku,cc.name,cp.edition_year
)
select jsonb_build_object(
  'source',(
    select jsonb_build_object(
      'source_row_id',t.source_row_id,'platform',t.label,'source_code',t.code,'sku',t.sku,
      'product_name',t.product_name,'category_name',t.category_name,'edition_year',t.edition_year,'image_url',t.image_url
    ) from target t
  ),
  'candidates',coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id',c.product_id,'product_name',c.product_name,'master_sku',c.master_sku,
      'category_name',c.category_name,'edition_year',c.edition_year,'image_url',c.image_url,
      'platform_count',c.platform_count,'platforms',c.platforms
    ) order by c.product_name,c.product_id)
    from candidate_rows c
  ),'[]'::jsonb)
);
$function$;
revoke execute on function public.commerce_preview_management_link_candidates_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_link_candidates_v1(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_resolve_link_v1(p_source_row_id bigint, p_product_id bigint, p_operator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_valid boolean := false;
  v_updated bigint := 0;
begin
  with sources(code) as (
    values ('SHOPEE'),('ML_NOVO'),('ML_ANTIGO'),('AMAZON'),('SHEIN')
  ),
  selected_files as (
    select s.code,(
      select f.id
      from public.commerce_preview_source_files f
      where upper(f.source_code) in (s.code,s.code||'_GESTAO')
      order by case when upper(f.source_code)=s.code||'_GESTAO' then 0 else 1 end,
               f.imported_at desc nulls last,f.id desc
      limit 1
    ) source_file_id
    from sources s
  ),
  rows as (
    select
      sf.code,r.id as source_row_id,r.matched_product_id,
      lower(regexp_replace(btrim(coalesce(r.normalized_payload->>'product_name','')),'[^[:alnum:]]+','','g')) name_norm,
      upper(btrim(coalesce(r.normalized_payload->>'category',''))) category_norm,
      coalesce(
        substring(coalesce(r.normalized_payload->>'sku','') from '(20[0-9]{2})')::integer,
        substring(coalesce(r.normalized_payload->>'product_name','') from '(20[0-9]{2})')::integer
      ) edition_year
    from selected_files sf
    join public.commerce_preview_source_rows r on r.source_file_id=sf.source_file_id and r.is_header=false
  ),
  target as (
    select * from rows where source_row_id=p_source_row_id and matched_product_id is null
  )
  select exists(
    select 1
    from target u
    join rows l
      on l.matched_product_id=p_product_id
     and l.name_norm=u.name_norm and u.name_norm<>''
     and l.category_norm=u.category_norm
     and coalesce(l.edition_year,-1)=coalesce(u.edition_year,-1)
  ) into v_valid;

  if not v_valid then
    raise exception 'Produto candidato inválido para esta linha.';
  end if;

  update public.commerce_preview_source_rows
  set matched_product_id=p_product_id,
      resolution_status='PRODUCT_MATCHED',
      notes=concat_ws(' · ',nullif(notes,''),'preview manual link by '||coalesce(nullif(btrim(p_operator),''),'Administrador'))
  where id=p_source_row_id and matched_product_id is null
  returning id into v_updated;

  if v_updated is null then
    raise exception 'Linha já vinculada ou não encontrada.';
  end if;

  return jsonb_build_object('ok',true,'source_row_id',p_source_row_id,'product_id',p_product_id);
end;
$function$;
revoke execute on function public.commerce_preview_management_resolve_link_v1(bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_resolve_link_v1(bigint,bigint,text) to service_role;

