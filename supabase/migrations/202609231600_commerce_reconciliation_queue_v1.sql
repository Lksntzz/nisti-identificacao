begin;

create or replace function public.commerce_list_reconciliation_queue_v1(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  listing_id bigint,
  marketplace_code text,
  marketplace_name text,
  title text,
  canonical_url text,
  external_listing_id text,
  family text,
  classification text,
  reason text,
  source_product text,
  source_category text,
  source_account text,
  variants jsonb,
  relation_count bigint,
  relations jsonb,
  family_pending_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with pending as (
    select l.id,l.marketplace_id,l.title,l.canonical_url,l.external_listing_id,l.raw_metadata,
      nullif(l.raw_metadata->'reconciliation_review'->>'family','') as family,
      l.raw_metadata->'reconciliation_review'->>'classification' as classification,
      l.raw_metadata->'reconciliation_review'->>'reason' as reason,
      nullif(l.raw_metadata->>'source_file_id','')::bigint as source_file_id,
      nullif(l.raw_metadata->>'source_row','')::integer as source_row
    from public.commerce_listings l
    where coalesce((l.raw_metadata->>'product_reconciliation_pending')::boolean,false)=true
  )
  select
    p.id,m.code,m.name,p.title,p.canonical_url,p.external_listing_id,p.family,p.classification,p.reason,
    src.normalized_payload->>'product',
    coalesce(src.normalized_payload->>'category_treated',src.normalized_payload->>'category'),
    p.raw_metadata->>'source_account',
    coalesce(v.variants,'[]'::jsonb),
    coalesce(r.relation_count,0)::bigint,
    coalesce(r.relations,'[]'::jsonb),
    (select count(*) from pending p2 where coalesce(p2.family,'')=coalesce(p.family,''))::bigint,
    count(*) over()::bigint
  from pending p
  join public.commerce_marketplaces m on m.id=p.marketplace_id
  left join public.commerce_source_rows src
    on src.source_file_id=p.source_file_id and src.row_number=p.source_row
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'row_number',s.row_number,
      'sku',s.normalized_payload->>'sku',
      'variation',s.normalized_payload->>'variation',
      'product',s.normalized_payload->>'product'
    ) order by s.row_number) as variants
    from public.commerce_source_rows s
    where s.source_file_id=p.source_file_id
      and ((p.canonical_url is not null and s.normalized_payload->>'listing_url'=p.canonical_url) or s.row_number=p.source_row)
  ) v on true
  left join lateral (
    select count(*) as relation_count,
      jsonb_agg(jsonb_build_object(
        'product_id',lp.product_id,
        'product_name',pr.name,
        'platform_sku',lp.platform_sku,
        'variation_name',lp.variation_name
      ) order by lp.id) as relations
    from public.commerce_listing_products lp
    join public.commerce_products pr on pr.id=lp.product_id
    where lp.listing_id=p.id
  ) r on true
  order by p.id
  limit greatest(1,least(coalesce(p_limit,50),100))
  offset greatest(coalesce(p_offset,0),0);
$$;

revoke all on function public.commerce_list_reconciliation_queue_v1(integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_list_reconciliation_queue_v1(integer,integer) to service_role;

create or replace function public.commerce_preview_list_reconciliation_queue_v1(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  listing_id bigint,
  marketplace_code text,
  marketplace_name text,
  title text,
  canonical_url text,
  external_listing_id text,
  family text,
  classification text,
  reason text,
  source_product text,
  source_category text,
  source_account text,
  variants jsonb,
  relation_count bigint,
  relations jsonb,
  family_pending_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with pending as (
    select l.id,l.marketplace_id,l.title,l.canonical_url,l.external_listing_id,l.raw_metadata,
      nullif(l.raw_metadata->'reconciliation_review'->>'family','') as family,
      l.raw_metadata->'reconciliation_review'->>'classification' as classification,
      l.raw_metadata->'reconciliation_review'->>'reason' as reason,
      nullif(l.raw_metadata->>'source_file_id','')::bigint as source_file_id,
      nullif(l.raw_metadata->>'source_row','')::integer as source_row
    from public.commerce_preview_listings l
    where coalesce((l.raw_metadata->>'product_reconciliation_pending')::boolean,false)=true
  )
  select
    p.id,m.code,m.name,p.title,p.canonical_url,p.external_listing_id,p.family,p.classification,p.reason,
    src.normalized_payload->>'product',
    coalesce(src.normalized_payload->>'category_treated',src.normalized_payload->>'category'),
    p.raw_metadata->>'source_account',
    coalesce(v.variants,'[]'::jsonb),
    coalesce(r.relation_count,0)::bigint,
    coalesce(r.relations,'[]'::jsonb),
    (select count(*) from pending p2 where coalesce(p2.family,'')=coalesce(p.family,''))::bigint,
    count(*) over()::bigint
  from pending p
  join public.commerce_preview_marketplaces m on m.id=p.marketplace_id
  left join public.commerce_preview_source_rows src
    on src.source_file_id=p.source_file_id and src.row_number=p.source_row
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'row_number',s.row_number,
      'sku',s.normalized_payload->>'sku',
      'variation',s.normalized_payload->>'variation',
      'product',s.normalized_payload->>'product'
    ) order by s.row_number) as variants
    from public.commerce_preview_source_rows s
    where s.source_file_id=p.source_file_id
      and ((p.canonical_url is not null and s.normalized_payload->>'listing_url'=p.canonical_url) or s.row_number=p.source_row)
  ) v on true
  left join lateral (
    select count(*) as relation_count,
      jsonb_agg(jsonb_build_object(
        'product_id',lp.product_id,
        'product_name',pr.name,
        'platform_sku',lp.platform_sku,
        'variation_name',lp.variation_name
      ) order by lp.id) as relations
    from public.commerce_preview_listing_products lp
    join public.commerce_preview_products pr on pr.id=lp.product_id
    where lp.listing_id=p.id
  ) r on true
  order by p.id
  limit greatest(1,least(coalesce(p_limit,50),100))
  offset greatest(coalesce(p_offset,0),0);
$$;

revoke all on function public.commerce_preview_list_reconciliation_queue_v1(integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_preview_list_reconciliation_queue_v1(integer,integer) to service_role;

create or replace function public.commerce_resolve_reconciliation_listing_v1(
  p_listing_id bigint,
  p_action text,
  p_product_id bigint default null,
  p_product_name text default null,
  p_category_id bigint default null,
  p_platform_skus text[] default null,
  p_apply_family boolean default false,
  p_resolve boolean default true,
  p_operator text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_family text;
  v_product_id bigint;
  v_category_id bigint;
  v_created_product_id bigint;
  v_target_count integer := 0;
  v_link_count integer := 0;
  v_resolved_count integer := 0;
  v_relation_count integer := 0;
  rec record;
begin
  if p_listing_id is null or p_listing_id <= 0 then
    raise exception 'listing_id_invalid' using errcode='22023';
  end if;
  if v_action not in ('LINK_EXISTING','CREATE_NEW','MARK_RESOLVED') then
    raise exception 'reconciliation_action_invalid' using errcode='22023';
  end if;

  select nullif(l.raw_metadata->'reconciliation_review'->>'family','')
    into v_family
  from public.commerce_listings l
  where l.id=p_listing_id
    and coalesce((l.raw_metadata->>'product_reconciliation_pending')::boolean,false)=true;
  if not found then raise exception 'reconciliation_listing_not_pending' using errcode='22023'; end if;
  if coalesce(p_apply_family,false) and v_family is null then
    raise exception 'reconciliation_family_missing' using errcode='22023';
  end if;

  if v_action='LINK_EXISTING' then
    if p_product_id is null or p_product_id <= 0 then
      raise exception 'product_id_required' using errcode='22023';
    end if;
    select id into v_product_id from public.commerce_products where id=p_product_id;
    if v_product_id is null then raise exception 'product_not_found' using errcode='22023'; end if;
  elsif v_action='CREATE_NEW' then
    if nullif(btrim(coalesce(p_product_name,'')),'') is null then
      raise exception 'product_name_required' using errcode='22023';
    end if;
    v_category_id := p_category_id;
    if v_category_id is not null and not exists (
      select 1 from public.commerce_categories c where c.id=v_category_id
    ) then raise exception 'category_not_found' using errcode='22023'; end if;

    if v_category_id is null then
      select c.id into v_category_id
      from public.commerce_categories c
      where c.slug = case
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_listings l left join public.commerce_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%caderneta%' then 'caderneta-de-vacinacao'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_listings l left join public.commerce_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%agenda%' then 'agenda'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_listings l left join public.commerce_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%planner%' then 'planner'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_listings l left join public.commerce_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%caderno%' then 'caderno'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_listings l left join public.commerce_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%card%' then 'cardapio'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_listings l left join public.commerce_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%livro%' then 'livro-de-colorir'
        else 'outros'
      end
      limit 1;
    end if;

    insert into public.commerce_products(name,category_id,internal_status,notes)
    values(btrim(p_product_name),v_category_id,'DRAFT',
      'Criado pela fila de revisão de vínculos. Família='||coalesce(v_family,'(sem família)'))
    returning id into v_created_product_id;
    v_product_id := v_created_product_id;
  end if;

  for rec in
    select l.id,l.canonical_url,
      nullif(l.raw_metadata->>'source_file_id','')::bigint as source_file_id,
      nullif(l.raw_metadata->>'source_row','')::integer as source_row
    from public.commerce_listings l
    where coalesce((l.raw_metadata->>'product_reconciliation_pending')::boolean,false)=true
      and (l.id=p_listing_id or (coalesce(p_apply_family,false) and nullif(l.raw_metadata->'reconciliation_review'->>'family','')=v_family))
    order by l.id
  loop
    v_target_count := v_target_count + 1;

    if v_action in ('LINK_EXISTING','CREATE_NEW') then
      insert into public.commerce_listing_products(listing_id,product_id,platform_sku,variation_name,relation_status)
      select rec.id,v_product_id,
        nullif(sr.normalized_payload->>'sku',''),
        nullif(sr.normalized_payload->>'variation',''),
        'ACTIVE'
      from public.commerce_source_rows sr
      where sr.source_file_id=rec.source_file_id
        and ((rec.canonical_url is not null and sr.normalized_payload->>'listing_url'=rec.canonical_url) or sr.row_number=rec.source_row)
        and (p_platform_skus is null or cardinality(p_platform_skus)=0 or sr.normalized_payload->>'sku'=any(p_platform_skus))
        and not exists (
          select 1 from public.commerce_listing_products lp
          where lp.listing_id=rec.id and lp.product_id=v_product_id
            and coalesce(upper(btrim(lp.platform_sku)),'')=coalesce(upper(btrim(sr.normalized_payload->>'sku')),'')
            and coalesce(btrim(lp.variation_id),'')=''
        );
      get diagnostics v_relation_count = row_count;
      v_link_count := v_link_count + v_relation_count;

      if v_relation_count=0 and not exists (
        select 1 from public.commerce_listing_products lp where lp.listing_id=rec.id and lp.product_id=v_product_id
      ) then
        insert into public.commerce_listing_products(listing_id,product_id,relation_status)
        values(rec.id,v_product_id,'ACTIVE');
        v_link_count := v_link_count + 1;
      end if;
    end if;

    if coalesce(p_resolve,true) or v_action='MARK_RESOLVED' then
      if not exists (select 1 from public.commerce_listing_products lp where lp.listing_id=rec.id) then
        raise exception 'reconciliation_requires_product_link' using errcode='22023';
      end if;
      update public.commerce_listings l
      set raw_metadata=jsonb_set(
        jsonb_set(coalesce(l.raw_metadata,'{}'::jsonb),'{product_reconciliation_pending}','false'::jsonb,true),
        '{product_reconciliation_resolution}',
        jsonb_build_object(
          'status',case when v_action='CREATE_NEW' then 'NEW_MASTER_CREATED' when v_action='LINK_EXISTING' then 'LINKED_EXISTING' else 'REVIEW_COMPLETED' end,
          'product_id',v_product_id,
          'apply_family',coalesce(p_apply_family,false),
          'operator',nullif(btrim(coalesce(p_operator,'')),''),
          'resolved_at',now()
        ),true),
        updated_at=now()
      where l.id=rec.id;
      v_resolved_count := v_resolved_count + 1;
    else
      update public.commerce_listings l
      set raw_metadata=jsonb_set(coalesce(l.raw_metadata,'{}'::jsonb),'{product_reconciliation_last_action}',
        jsonb_build_object(
          'status',case when v_action='CREATE_NEW' then 'NEW_MASTER_LINK_ADDED' else 'EXISTING_LINK_ADDED' end,
          'product_id',v_product_id,
          'operator',nullif(btrim(coalesce(p_operator,'')),''),
          'at',now()
        ),true),
        updated_at=now()
      where l.id=rec.id;
    end if;
  end loop;

  if v_target_count=0 then raise exception 'reconciliation_no_targets' using errcode='22023'; end if;
  return jsonb_build_object(
    'listing_id',p_listing_id,'action',v_action,'product_id',v_product_id,
    'created_product_id',v_created_product_id,'target_count',v_target_count,
    'links_added',v_link_count,'resolved_count',v_resolved_count
  );
end;
$$;

revoke all on function public.commerce_resolve_reconciliation_listing_v1(bigint,text,bigint,text,bigint,text[],boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.commerce_resolve_reconciliation_listing_v1(bigint,text,bigint,text,bigint,text[],boolean,boolean,text) to service_role;

create or replace function public.commerce_preview_resolve_reconciliation_listing_v1(
  p_listing_id bigint,
  p_action text,
  p_product_id bigint default null,
  p_product_name text default null,
  p_category_id bigint default null,
  p_platform_skus text[] default null,
  p_apply_family boolean default false,
  p_resolve boolean default true,
  p_operator text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_family text;
  v_product_id bigint;
  v_category_id bigint;
  v_created_product_id bigint;
  v_target_count integer := 0;
  v_link_count integer := 0;
  v_resolved_count integer := 0;
  v_relation_count integer := 0;
  rec record;
begin
  if p_listing_id is null or p_listing_id <= 0 then
    raise exception 'listing_id_invalid' using errcode='22023';
  end if;
  if v_action not in ('LINK_EXISTING','CREATE_NEW','MARK_RESOLVED') then
    raise exception 'reconciliation_action_invalid' using errcode='22023';
  end if;

  select nullif(l.raw_metadata->'reconciliation_review'->>'family','')
    into v_family
  from public.commerce_preview_listings l
  where l.id=p_listing_id
    and coalesce((l.raw_metadata->>'product_reconciliation_pending')::boolean,false)=true;
  if not found then raise exception 'reconciliation_listing_not_pending' using errcode='22023'; end if;
  if coalesce(p_apply_family,false) and v_family is null then
    raise exception 'reconciliation_family_missing' using errcode='22023';
  end if;

  if v_action='LINK_EXISTING' then
    if p_product_id is null or p_product_id <= 0 then
      raise exception 'product_id_required' using errcode='22023';
    end if;
    select id into v_product_id from public.commerce_preview_products where id=p_product_id;
    if v_product_id is null then raise exception 'product_not_found' using errcode='22023'; end if;
  elsif v_action='CREATE_NEW' then
    if nullif(btrim(coalesce(p_product_name,'')),'') is null then
      raise exception 'product_name_required' using errcode='22023';
    end if;
    v_category_id := p_category_id;
    if v_category_id is not null and not exists (
      select 1 from public.commerce_preview_categories c where c.id=v_category_id
    ) then raise exception 'category_not_found' using errcode='22023'; end if;

    if v_category_id is null then
      select c.id into v_category_id
      from public.commerce_preview_categories c
      where c.slug = case
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_preview_listings l left join public.commerce_preview_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%caderneta%' then 'caderneta-de-vacinacao'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_preview_listings l left join public.commerce_preview_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%agenda%' then 'agenda'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_preview_listings l left join public.commerce_preview_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%planner%' then 'planner'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_preview_listings l left join public.commerce_preview_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%caderno%' then 'caderno'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_preview_listings l left join public.commerce_preview_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%card%' then 'cardapio'
        when lower(coalesce((select coalesce(sr.normalized_payload->>'category_treated',sr.normalized_payload->>'category') from public.commerce_preview_listings l left join public.commerce_preview_source_rows sr on sr.source_file_id=nullif(l.raw_metadata->>'source_file_id','')::bigint and sr.row_number=nullif(l.raw_metadata->>'source_row','')::integer where l.id=p_listing_id),'')) like '%livro%' then 'livro-de-colorir'
        else 'outros'
      end
      limit 1;
    end if;

    insert into public.commerce_preview_products(name,category_id,internal_status,notes)
    values(btrim(p_product_name),v_category_id,'DRAFT',
      'Criado pela fila de revisão de vínculos. Família='||coalesce(v_family,'(sem família)'))
    returning id into v_created_product_id;
    v_product_id := v_created_product_id;
  end if;

  for rec in
    select l.id,l.canonical_url,
      nullif(l.raw_metadata->>'source_file_id','')::bigint as source_file_id,
      nullif(l.raw_metadata->>'source_row','')::integer as source_row
    from public.commerce_preview_listings l
    where coalesce((l.raw_metadata->>'product_reconciliation_pending')::boolean,false)=true
      and (l.id=p_listing_id or (coalesce(p_apply_family,false) and nullif(l.raw_metadata->'reconciliation_review'->>'family','')=v_family))
    order by l.id
  loop
    v_target_count := v_target_count + 1;

    if v_action in ('LINK_EXISTING','CREATE_NEW') then
      insert into public.commerce_preview_listing_products(listing_id,product_id,platform_sku,variation_name,relation_status)
      select rec.id,v_product_id,
        nullif(sr.normalized_payload->>'sku',''),
        nullif(sr.normalized_payload->>'variation',''),
        'ACTIVE'
      from public.commerce_preview_source_rows sr
      where sr.source_file_id=rec.source_file_id
        and ((rec.canonical_url is not null and sr.normalized_payload->>'listing_url'=rec.canonical_url) or sr.row_number=rec.source_row)
        and (p_platform_skus is null or cardinality(p_platform_skus)=0 or sr.normalized_payload->>'sku'=any(p_platform_skus))
        and not exists (
          select 1 from public.commerce_preview_listing_products lp
          where lp.listing_id=rec.id and lp.product_id=v_product_id
            and coalesce(upper(btrim(lp.platform_sku)),'')=coalesce(upper(btrim(sr.normalized_payload->>'sku')),'')
            and coalesce(btrim(lp.variation_id),'')=''
        );
      get diagnostics v_relation_count = row_count;
      v_link_count := v_link_count + v_relation_count;

      if v_relation_count=0 and not exists (
        select 1 from public.commerce_preview_listing_products lp where lp.listing_id=rec.id and lp.product_id=v_product_id
      ) then
        insert into public.commerce_preview_listing_products(listing_id,product_id,relation_status)
        values(rec.id,v_product_id,'ACTIVE');
        v_link_count := v_link_count + 1;
      end if;
    end if;

    if coalesce(p_resolve,true) or v_action='MARK_RESOLVED' then
      if not exists (select 1 from public.commerce_preview_listing_products lp where lp.listing_id=rec.id) then
        raise exception 'reconciliation_requires_product_link' using errcode='22023';
      end if;
      update public.commerce_preview_listings l
      set raw_metadata=jsonb_set(
        jsonb_set(coalesce(l.raw_metadata,'{}'::jsonb),'{product_reconciliation_pending}','false'::jsonb,true),
        '{product_reconciliation_resolution}',
        jsonb_build_object(
          'status',case when v_action='CREATE_NEW' then 'NEW_MASTER_CREATED' when v_action='LINK_EXISTING' then 'LINKED_EXISTING' else 'REVIEW_COMPLETED' end,
          'product_id',v_product_id,
          'apply_family',coalesce(p_apply_family,false),
          'operator',nullif(btrim(coalesce(p_operator,'')),''),
          'resolved_at',now()
        ),true),
        updated_at=now()
      where l.id=rec.id;
      v_resolved_count := v_resolved_count + 1;
    else
      update public.commerce_preview_listings l
      set raw_metadata=jsonb_set(coalesce(l.raw_metadata,'{}'::jsonb),'{product_reconciliation_last_action}',
        jsonb_build_object(
          'status',case when v_action='CREATE_NEW' then 'NEW_MASTER_LINK_ADDED' else 'EXISTING_LINK_ADDED' end,
          'product_id',v_product_id,
          'operator',nullif(btrim(coalesce(p_operator,'')),''),
          'at',now()
        ),true),
        updated_at=now()
      where l.id=rec.id;
    end if;
  end loop;

  if v_target_count=0 then raise exception 'reconciliation_no_targets' using errcode='22023'; end if;
  return jsonb_build_object(
    'listing_id',p_listing_id,'action',v_action,'product_id',v_product_id,
    'created_product_id',v_created_product_id,'target_count',v_target_count,
    'links_added',v_link_count,'resolved_count',v_resolved_count
  );
end;
$$;

revoke all on function public.commerce_preview_resolve_reconciliation_listing_v1(bigint,text,bigint,text,bigint,text[],boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.commerce_preview_resolve_reconciliation_listing_v1(bigint,text,bigint,text,bigint,text[],boolean,boolean,text) to service_role;


commit;
