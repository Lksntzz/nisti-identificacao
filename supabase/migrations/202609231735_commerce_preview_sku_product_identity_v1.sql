create or replace function public.commerce_preview_enforce_sku_product_identity_v1(
  p_operator text default 'SMITH'
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  rec record;
  v_ps_id bigint;
  v_ps_product_id bigint;
  v_ps_type text;
  v_ps_active boolean;
  v_current_count integer;
  v_owner_product_id bigint;
  v_owner_sku_id bigint;
  v_anchor_product_id bigint;
  v_base_name text;
  v_new_name text;
  v_category_id bigint;
  v_subcategory_id bigint;
  v_temporal_type text;
  v_edition_year integer;
  v_rep_year integer;
  v_created integer := 0;
  v_promoted integer := 0;
  v_anchor_reused integer := 0;
  v_moved_alias integer := 0;
  v_links_reassigned integer := 0;
  v_links_inserted integer := 0;
  v_links_deduped integer := 0;
begin
  create temporary table tmp_sku_candidates on commit drop as
  with existing as (
    select
      lp.listing_id,
      lp.platform_sku as sku,
      upper(btrim(lp.platform_sku)) as norm_sku,
      nullif(btrim(lp.variation_name),'') as variation_name,
      lp.product_id as base_product_id,
      l.title,
      coalesce((
        select min(sr.row_number)
        from public.commerce_preview_source_rows sr
        join public.commerce_preview_source_files sf on sf.id=sr.source_file_id
        where sf.source_filename='ANÚNCIOS NOVOS.xlsx'
          and sr.normalized_payload->>'listing_url'=l.canonical_url
          and upper(btrim(coalesce(sr.normalized_payload->>'sku','')))=upper(btrim(lp.platform_sku))
      ),1000000000 + lp.id)::bigint as sort_key,
      0 as source_priority
    from public.commerce_preview_listing_products lp
    join public.commerce_preview_listings l on l.id=lp.listing_id
    where nullif(btrim(lp.platform_sku),'') is not null
  ),
  source_rows as (
    select
      l.id as listing_id,
      sr.normalized_payload->>'sku' as sku,
      upper(btrim(sr.normalized_payload->>'sku')) as norm_sku,
      nullif(btrim(sr.normalized_payload->>'variation'),'') as variation_name,
      (
        select lp.product_id
        from public.commerce_preview_listing_products lp
        where lp.listing_id=l.id
        order by lp.id
        limit 1
      ) as base_product_id,
      l.title,
      sr.row_number::bigint as sort_key,
      1 as source_priority
    from public.commerce_preview_source_rows sr
    join public.commerce_preview_source_files sf on sf.id=sr.source_file_id
    join public.commerce_preview_listings l
      on nullif(btrim(sr.normalized_payload->>'listing_url'),'')=l.canonical_url
    where sf.source_filename='ANÚNCIOS NOVOS.xlsx'
      and nullif(btrim(sr.normalized_payload->>'sku'),'') is not null
      and not exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(l.raw_metadata->'operator_correction'->'source_skus')='array'
               then l.raw_metadata->'operator_correction'->'source_skus'
               else '[]'::jsonb end
        ) accepted(sku)
        where upper(btrim(accepted.sku))=upper(btrim(sr.normalized_payload->>'sku'))
      )
  ),
  combined as (
    select * from existing
    union all
    select * from source_rows
  )
  select distinct on (listing_id,norm_sku)
    listing_id,sku,norm_sku,variation_name,base_product_id,title,sort_key,source_priority
  from combined
  order by listing_id,norm_sku,source_priority,sort_key;

  create index on tmp_sku_candidates(norm_sku);
  create index on tmp_sku_candidates(base_product_id);

  create temporary table tmp_sku_anchors on commit drop as
  select distinct on (lp.product_id)
    lp.product_id,
    upper(btrim(lp.platform_sku)) as norm_sku
  from public.commerce_preview_listing_products lp
  join public.commerce_preview_listings l on l.id=lp.listing_id
  where nullif(btrim(lp.platform_sku),'') is not null
    and not exists (
      select 1
      from public.commerce_preview_product_skus ps
      where ps.product_id=lp.product_id
        and ps.sku_type='CURRENT'
        and ps.is_active
    )
  order by lp.product_id,
    coalesce((
      select min(sr.row_number)
      from public.commerce_preview_source_rows sr
      join public.commerce_preview_source_files sf on sf.id=sr.source_file_id
      where sf.source_filename='ANÚNCIOS NOVOS.xlsx'
        and sr.normalized_payload->>'listing_url'=l.canonical_url
        and upper(btrim(coalesce(sr.normalized_payload->>'sku','')))=upper(btrim(lp.platform_sku))
    ),1000000000 + lp.id),
    lp.id;

  create temporary table tmp_sku_owners(
    norm_sku text primary key,
    sku text not null,
    owner_product_id bigint,
    owner_sku_id bigint,
    representative_listing_id bigint,
    representative_variation text,
    base_product_id bigint
  ) on commit drop;

  insert into tmp_sku_owners(norm_sku,sku,representative_listing_id,representative_variation,base_product_id)
  select distinct on (c.norm_sku)
    c.norm_sku,c.sku,c.listing_id,c.variation_name,c.base_product_id
  from tmp_sku_candidates c
  order by c.norm_sku,c.source_priority,c.sort_key,c.listing_id;

  for rec in
    select o.*,c.title
    from tmp_sku_owners o
    join tmp_sku_candidates c
      on c.norm_sku=o.norm_sku
     and c.listing_id=o.representative_listing_id
    order by o.norm_sku
  loop
    v_ps_id := null;
    v_ps_product_id := null;
    v_ps_type := null;
    v_ps_active := null;
    v_owner_product_id := null;
    v_owner_sku_id := null;
    v_anchor_product_id := null;
    v_base_name := null;
    v_category_id := null;
    v_subcategory_id := null;
    v_temporal_type := null;
    v_edition_year := null;
    v_rep_year := null;

    select ps.id,ps.product_id,ps.sku_type,ps.is_active
      into v_ps_id,v_ps_product_id,v_ps_type,v_ps_active
    from public.commerce_preview_product_skus ps
    where upper(btrim(ps.sku))=rec.norm_sku
    limit 1;

    if v_ps_id is not null then
      select count(*) into v_current_count
      from public.commerce_preview_product_skus ps
      where ps.product_id=v_ps_product_id
        and ps.sku_type='CURRENT'
        and ps.is_active;

      if v_ps_type='CURRENT' and coalesce(v_ps_active,false) then
        v_owner_product_id := v_ps_product_id;
        v_owner_sku_id := v_ps_id;
      elsif v_current_count=0 then
        update public.commerce_preview_product_skus
        set sku_type='CURRENT',is_active=true,updated_at=now()
        where id=v_ps_id;
        v_owner_product_id := v_ps_product_id;
        v_owner_sku_id := v_ps_id;
        v_promoted := v_promoted + 1;
      else
        select p.name,p.category_id,p.subcategory_id,p.temporal_type,p.edition_year
          into v_base_name,v_category_id,v_subcategory_id,v_temporal_type,v_edition_year
        from public.commerce_preview_products p
        where p.id=coalesce(rec.base_product_id,v_ps_product_id);

        if v_base_name is null then
          select p.name,p.category_id,p.subcategory_id,p.temporal_type,p.edition_year
            into v_base_name,v_category_id,v_subcategory_id,v_temporal_type,v_edition_year
          from public.commerce_preview_products p
          where p.id=v_ps_product_id;
        end if;

        begin
          v_rep_year := substring(rec.title from '(20[0-9]{2})')::integer;
        exception when others then
          v_rep_year := null;
        end;

        v_new_name := coalesce(nullif(btrim(rec.title),''),v_base_name,'Produto')
          || case when rec.representative_variation is not null
                  then ' - '||rec.representative_variation
                  else ' - SKU '||rec.sku end;

        insert into public.commerce_preview_products(
          name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes
        )
        values(
          v_new_name,v_category_id,v_subcategory_id,v_temporal_type,
          coalesce(v_rep_year,v_edition_year),'DRAFT',
          'Separado automaticamente pela regra global SKU → Produto Mestre. SKU='||rec.sku||
          '; origem Produto Mestre #'||v_ps_product_id||'; operador='||coalesce(p_operator,'')
        )
        returning id into v_owner_product_id;

        update public.commerce_preview_product_skus
        set product_id=v_owner_product_id,sku_type='CURRENT',is_active=true,updated_at=now()
        where id=v_ps_id;

        v_owner_sku_id := v_ps_id;
        v_created := v_created + 1;
        v_moved_alias := v_moved_alias + 1;
      end if;
    else
      select a.product_id into v_anchor_product_id
      from tmp_sku_anchors a
      where a.norm_sku=rec.norm_sku
      limit 1;

      if v_anchor_product_id is not null then
        v_owner_product_id := v_anchor_product_id;

        insert into public.commerce_preview_product_skus(product_id,sku,sku_type,is_active)
        values(v_owner_product_id,rec.sku,'CURRENT',true)
        returning id into v_owner_sku_id;

        if (
          select count(distinct c.norm_sku)
          from tmp_sku_candidates c
          where c.base_product_id=v_owner_product_id
        ) > 1 and rec.representative_variation is not null then
          update public.commerce_preview_products p
          set name = case
                       when lower(p.name) like '%'||lower(rec.representative_variation) then p.name
                       else p.name||' - '||rec.representative_variation
                     end,
              updated_at=now()
          where p.id=v_owner_product_id;
        end if;

        v_anchor_reused := v_anchor_reused + 1;
      else
        select p.name,p.category_id,p.subcategory_id,p.temporal_type,p.edition_year
          into v_base_name,v_category_id,v_subcategory_id,v_temporal_type,v_edition_year
        from public.commerce_preview_products p
        where p.id=rec.base_product_id;

        begin
          v_rep_year := substring(rec.title from '(20[0-9]{2})')::integer;
        exception when others then
          v_rep_year := null;
        end;

        v_new_name := coalesce(nullif(btrim(rec.title),''),v_base_name,'Produto')
          || case when rec.representative_variation is not null
                  then ' - '||rec.representative_variation
                  else ' - SKU '||rec.sku end;

        insert into public.commerce_preview_products(
          name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes
        )
        values(
          v_new_name,v_category_id,v_subcategory_id,v_temporal_type,
          coalesce(v_rep_year,v_edition_year),'DRAFT',
          'Criado automaticamente pela regra global SKU → Produto Mestre. SKU='||rec.sku||
          '; operador='||coalesce(p_operator,'')
        )
        returning id into v_owner_product_id;

        insert into public.commerce_preview_product_skus(product_id,sku,sku_type,is_active)
        values(v_owner_product_id,rec.sku,'CURRENT',true)
        returning id into v_owner_sku_id;

        v_created := v_created + 1;
      end if;
    end if;

    update tmp_sku_owners
    set owner_product_id=v_owner_product_id,
        owner_sku_id=v_owner_sku_id
    where norm_sku=rec.norm_sku;
  end loop;

  create temporary table tmp_link_targets on commit drop as
  select
    lp.id as link_id,
    lp.listing_id,
    lp.variation_id,
    upper(btrim(lp.platform_sku)) as norm_sku,
    o.owner_product_id,
    o.owner_sku_id,
    row_number() over (
      partition by lp.listing_id,o.owner_product_id,o.owner_sku_id,
                   upper(btrim(lp.platform_sku)),coalesce(btrim(lp.variation_id),'')
      order by lp.id
    ) as rn
  from public.commerce_preview_listing_products lp
  join tmp_sku_owners o on o.norm_sku=upper(btrim(lp.platform_sku))
  where nullif(btrim(lp.platform_sku),'') is not null;

  delete from public.commerce_preview_listing_products lp
  using tmp_link_targets t
  where lp.id=t.link_id and t.rn>1;
  get diagnostics v_links_deduped = row_count;

  update public.commerce_preview_listing_products lp
  set product_id=t.owner_product_id,
      product_sku_id=t.owner_sku_id,
      relation_status='ACTIVE'
  from tmp_link_targets t
  where lp.id=t.link_id
    and t.rn=1;
  get diagnostics v_links_reassigned = row_count;

  update public.commerce_preview_listing_products lp
  set variation_name=coalesce(lp.variation_name,c.variation_name)
  from tmp_sku_candidates c
  where lp.listing_id=c.listing_id
    and upper(btrim(lp.platform_sku))=c.norm_sku;

  insert into public.commerce_preview_listing_products(
    listing_id,product_id,product_sku_id,platform_sku,variation_name,relation_status
  )
  select
    c.listing_id,o.owner_product_id,o.owner_sku_id,c.sku,c.variation_name,'ACTIVE'
  from tmp_sku_candidates c
  join tmp_sku_owners o on o.norm_sku=c.norm_sku
  where not exists (
    select 1
    from public.commerce_preview_listing_products lp
    where lp.listing_id=c.listing_id
      and upper(btrim(coalesce(lp.platform_sku,'')))=c.norm_sku
  );
  get diagnostics v_links_inserted = row_count;

  update public.commerce_preview_listings l
  set raw_metadata=jsonb_set(
        coalesce(l.raw_metadata,'{}'::jsonb),
        '{sku_identity_normalization}',
        jsonb_build_object(
          'rule','ONE_LISTING_SKU_ONE_PRODUCT_MASTER',
          'operator',nullif(btrim(coalesce(p_operator,'')),''),
          'normalized_at',now()
        ),
        true
      ),
      updated_at=now()
  where exists (
    select 1 from tmp_sku_candidates c where c.listing_id=l.id
  );

  return jsonb_build_object(
    'rule','ONE_LISTING_SKU_ONE_PRODUCT_MASTER',
    'candidate_skus',(select count(*) from tmp_sku_owners),
    'products_created',v_created,
    'alias_rows_promoted',v_promoted,
    'alias_rows_moved_to_new_product',v_moved_alias,
    'sku_less_products_reused',v_anchor_reused,
    'links_reassigned',v_links_reassigned,
    'links_inserted',v_links_inserted,
    'duplicate_links_removed',v_links_deduped
  );
end;
$$;

revoke all on function public.commerce_preview_enforce_sku_product_identity_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_preview_enforce_sku_product_identity_v1(text) to service_role;
