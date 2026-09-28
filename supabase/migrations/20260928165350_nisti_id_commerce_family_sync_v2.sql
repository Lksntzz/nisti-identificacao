
begin;

create or replace function public.commerce_nisti_sku_norm_v1(p_sku text)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select nullif(regexp_replace(upper(coalesce(p_sku,'')),'[^A-Z0-9]+','','g'),'');
$$;

revoke all on function public.commerce_nisti_sku_norm_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_nisti_sku_norm_v1(text) to service_role;

create or replace function public.commerce_sync_nisti_product_v1(
  p_nisti_product_id bigint,
  p_sku text,
  p_name text default null,
  p_variation text default null,
  p_image_url text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sku text := upper(btrim(coalesce(p_sku,'')));
  v_norm text := public.commerce_nisti_sku_norm_v1(p_sku);
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_variation text := nullif(btrim(coalesce(p_variation,'')),'');
  v_image text := nullif(btrim(coalesce(p_image_url,'')),'');
  v_pattern jsonb := public.commerce_sku_pattern_v1(p_sku);
  v_source_year integer;
  v_signature text;
  v_finish text;
  v_product_id bigint;
  v_existing_link public.commerce_nisti_product_links%rowtype;
  v_match_count integer := 0;
  v_action text := 'UPDATED';
begin
  if p_nisti_product_id is null or p_nisti_product_id <= 0 then
    raise exception 'nisti_product_id_invalid' using errcode='22023';
  end if;
  if v_sku = '' then
    raise exception 'nisti_sku_required' using errcode='22023';
  end if;

  v_source_year := case
    when coalesce(v_pattern->>'year','') ~ '^[0-9]{4}$'
      then (v_pattern->>'year')::integer
    else null
  end;
  v_signature := nullif(v_pattern->>'signature','');
  v_finish := coalesce(v_pattern->>'finish','');

  select * into v_existing_link
  from public.commerce_nisti_product_links
  where nisti_product_id=p_nisti_product_id;

  if found and v_existing_link.commerce_product_id is not null then
    v_product_id := v_existing_link.commerce_product_id;
    v_action := 'UPDATED';
  else
    select count(distinct product_id)::integer, min(product_id)
      into v_match_count, v_product_id
    from public.commerce_product_skus
    where public.commerce_nisti_sku_norm_v1(sku)=v_norm;

    if v_match_count > 1 then
      insert into public.commerce_nisti_product_links(
        nisti_product_id,commerce_product_id,source_sku,source_name,source_variation,
        source_image_url,source_payload,sync_status,last_error,last_synced_at,updated_at
      ) values(
        p_nisti_product_id,null,v_sku,v_name,v_variation,v_image,coalesce(p_payload,'{}'::jsonb),
        'CONFLICT','Mais de um Produto Mestre usa o mesmo SKU normalizado.',now(),now()
      )
      on conflict(nisti_product_id) do update set
        commerce_product_id=null,
        source_sku=excluded.source_sku,
        source_name=excluded.source_name,
        source_variation=excluded.source_variation,
        source_image_url=excluded.source_image_url,
        source_payload=excluded.source_payload,
        sync_status='CONFLICT',
        last_error=excluded.last_error,
        last_synced_at=now(),
        updated_at=now();

      return jsonb_build_object(
        'status','CONFLICT','action','CONFLICT',
        'nisti_product_id',p_nisti_product_id,'sku',v_sku,'commerce_product_id',null
      );
    elsif v_match_count = 1 then
      v_action := 'LINKED_NORMALIZED';
    else
      v_product_id := null;

      if v_source_year is not null and v_signature is not null then
        with candidates as (
          select
            ps.product_id,
            max((public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer) as candidate_year
          from public.commerce_product_skus ps
          where ps.sku_type='CURRENT'
            and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'signature','')=v_signature
            and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'finish','')=v_finish
            and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'year','') ~ '^[0-9]{4}$'
            and (public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer < v_source_year
          group by ps.product_id
        ),
        best_year as (
          select max(candidate_year) as candidate_year from candidates
        ),
        best as (
          select c.product_id
          from candidates c
          join best_year b using(candidate_year)
        )
        select count(*)::integer,min(product_id)
          into v_match_count,v_product_id
        from best;

        if v_match_count > 1 then
          insert into public.commerce_nisti_product_links(
            nisti_product_id,commerce_product_id,source_sku,source_name,source_variation,
            source_image_url,source_payload,sync_status,last_error,last_synced_at,updated_at
          ) values(
            p_nisti_product_id,null,v_sku,v_name,v_variation,v_image,coalesce(p_payload,'{}'::jsonb),
            'CONFLICT','Mais de um Produto Mestre corresponde à mesma família anual.',now(),now()
          )
          on conflict(nisti_product_id) do update set
            commerce_product_id=null,
            source_sku=excluded.source_sku,
            source_name=excluded.source_name,
            source_variation=excluded.source_variation,
            source_image_url=excluded.source_image_url,
            source_payload=excluded.source_payload,
            sync_status='CONFLICT',
            last_error=excluded.last_error,
            last_synced_at=now(),
            updated_at=now();

          return jsonb_build_object(
            'status','CONFLICT','action','CONFLICT',
            'nisti_product_id',p_nisti_product_id,'sku',v_sku,'commerce_product_id',null
          );
        elsif v_match_count = 1 then
          v_action := 'LINKED_FAMILY';
        end if;
      end if;

      if v_product_id is null then
        insert into public.commerce_products(
          name,temporal_type,edition_year,internal_status,reference_image_url,
          reference_image_source,reference_image_sku
        ) values(
          coalesce(v_name,v_variation,v_sku),
          case when v_source_year is not null then 'ANNUAL' else 'UNCLASSIFIED' end,
          v_source_year,
          'ACTIVE',
          v_image,
          case when v_image is not null then 'NISTI_ID' else null end,
          case when v_image is not null then v_sku else null end
        )
        returning id into v_product_id;

        insert into public.commerce_product_skus(
          product_id,sku,sku_type,valid_from_year,is_active
        ) values(v_product_id,v_sku,'CURRENT',v_source_year,true);
        v_action := 'CREATED';
      end if;
    end if;
  end if;

  if v_product_id is null then
    raise exception 'commerce_product_resolution_failed' using errcode='22023';
  end if;

  update public.commerce_products
  set
    name=coalesce(v_name,name),
    temporal_type=case when v_source_year is not null then 'ANNUAL' else temporal_type end,
    edition_year=case when v_source_year is not null then v_source_year else edition_year end,
    internal_status=case when internal_status='DRAFT' then 'ACTIVE' else internal_status end,
    reference_image_url=coalesce(v_image,reference_image_url),
    reference_image_source=case when v_image is not null then 'NISTI_ID' else reference_image_source end,
    reference_image_sku=case when v_image is not null then v_sku else reference_image_sku end,
    updated_at=now()
  where id=v_product_id;

  if exists (
    select 1 from public.commerce_product_skus
    where product_id=v_product_id
      and public.commerce_nisti_sku_norm_v1(sku)=v_norm
  ) then
    update public.commerce_product_skus
    set sku=v_sku,valid_from_year=coalesce(v_source_year,valid_from_year),is_active=true,updated_at=now()
    where product_id=v_product_id
      and public.commerce_nisti_sku_norm_v1(sku)=v_norm;
  elsif v_source_year is not null and exists (
    select 1
    from public.commerce_product_skus ps
    where ps.product_id=v_product_id
      and ps.sku_type='CURRENT'
      and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'signature','')=v_signature
      and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'finish','')=v_finish
      and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'year','') ~ '^[0-9]{4}$'
      and (public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer < v_source_year
  ) then
    update public.commerce_product_skus ps
    set sku_type='HISTORICAL',is_active=false,valid_to_year=v_source_year-1,updated_at=now()
    where ps.product_id=v_product_id
      and ps.sku_type='CURRENT'
      and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'signature','')=v_signature
      and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'finish','')=v_finish
      and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'year','') ~ '^[0-9]{4}$'
      and (public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer < v_source_year;

    insert into public.commerce_product_skus(
      product_id,sku,sku_type,valid_from_year,is_active
    ) values(v_product_id,v_sku,'CURRENT',v_source_year,true);
  elsif not exists (
    select 1 from public.commerce_product_skus
    where product_id=v_product_id and upper(btrim(sku))=v_sku
  ) then
    insert into public.commerce_product_skus(
      product_id,sku,sku_type,valid_from_year,is_active
    ) values(v_product_id,v_sku,'ALIAS',v_source_year,true);
  end if;

  insert into public.commerce_nisti_product_links(
    nisti_product_id,commerce_product_id,source_sku,source_name,source_variation,
    source_image_url,source_payload,sync_status,last_error,last_synced_at,updated_at
  ) values(
    p_nisti_product_id,v_product_id,v_sku,v_name,v_variation,v_image,
    coalesce(p_payload,'{}'::jsonb),'SYNCED',null,now(),now()
  )
  on conflict(nisti_product_id) do update set
    commerce_product_id=excluded.commerce_product_id,
    source_sku=excluded.source_sku,
    source_name=excluded.source_name,
    source_variation=excluded.source_variation,
    source_image_url=excluded.source_image_url,
    source_payload=excluded.source_payload,
    sync_status='SYNCED',
    last_error=null,
    last_synced_at=now(),
    updated_at=now();

  return jsonb_build_object(
    'status','SYNCED','action',v_action,'nisti_product_id',p_nisti_product_id,
    'sku',v_sku,'commerce_product_id',v_product_id
  );
end;
$$;

revoke execute on function public.commerce_sync_nisti_product_v1(bigint,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_sync_nisti_product_v1(bigint,text,text,text,text,jsonb) to service_role;

create temporary table _nisti_norm_repair on commit drop as
with matches as (
  select
    l.nisti_product_id,l.commerce_product_id old_product_id,l.source_sku,l.source_name,l.source_image_url,
    ps.product_id target_product_id,ps.id target_sku_id,
    count(*) over(partition by l.nisti_product_id) candidate_count
  from public.commerce_nisti_product_links l
  join public.commerce_product_skus ps
    on ps.product_id<>l.commerce_product_id
   and public.commerce_nisti_sku_norm_v1(ps.sku)=public.commerce_nisti_sku_norm_v1(l.source_sku)
  join public.commerce_products oldp on oldp.id=l.commerce_product_id
  where l.sync_status='SYNCED'
    and oldp.reference_image_source='NISTI_ID'
    and not exists(select 1 from public.commerce_listing_products x where x.product_id=l.commerce_product_id)
    and not exists(select 1 from public.commerce_source_rows x where x.matched_product_id=l.commerce_product_id)
    and not exists(select 1 from public.commerce_product_media_links x where x.product_id=l.commerce_product_id)
    and not exists(select 1 from public.commerce_product_state_events x where x.product_id=l.commerce_product_id)
)
select * from matches where candidate_count=1;

update public.commerce_products p
set name=coalesce(r.source_name,p.name),
    reference_image_url=coalesce(r.source_image_url,p.reference_image_url),
    reference_image_source=case when r.source_image_url is not null then 'NISTI_ID' else p.reference_image_source end,
    reference_image_sku=case when r.source_image_url is not null then r.source_sku else p.reference_image_sku end,
    updated_at=now()
from _nisti_norm_repair r
where p.id=r.target_product_id;

update public.commerce_nisti_product_links l
set commerce_product_id=r.target_product_id,last_synced_at=now(),updated_at=now()
from _nisti_norm_repair r
where l.nisti_product_id=r.nisti_product_id;

delete from public.commerce_products p
using _nisti_norm_repair r
where p.id=r.old_product_id
  and not exists(select 1 from public.commerce_nisti_product_links l where l.commerce_product_id=p.id)
  and not exists(select 1 from public.commerce_listing_products x where x.product_id=p.id)
  and not exists(select 1 from public.commerce_source_rows x where x.matched_product_id=p.id)
  and not exists(select 1 from public.commerce_product_media_links x where x.product_id=p.id)
  and not exists(select 1 from public.commerce_product_state_events x where x.product_id=p.id);

update public.commerce_product_skus ps
set sku=r.source_sku,updated_at=now()
from _nisti_norm_repair r
where ps.id=r.target_sku_id;

create temporary table _nisti_family_repair on commit drop as
with links as (
  select l.*,public.commerce_sku_pattern_v1(l.source_sku) pat
  from public.commerce_nisti_product_links l
  join public.commerce_products oldp on oldp.id=l.commerce_product_id
  where l.sync_status='SYNCED'
    and oldp.reference_image_source='NISTI_ID'
    and not exists(select 1 from public.commerce_listing_products x where x.product_id=l.commerce_product_id)
    and not exists(select 1 from public.commerce_source_rows x where x.matched_product_id=l.commerce_product_id)
    and not exists(select 1 from public.commerce_product_media_links x where x.product_id=l.commerce_product_id)
    and not exists(select 1 from public.commerce_product_state_events x where x.product_id=l.commerce_product_id)
),
candidate_rows as (
  select
    l.nisti_product_id,l.commerce_product_id old_product_id,l.source_sku,l.source_name,l.source_image_url,
    (l.pat->>'year')::integer source_year,l.pat->>'signature' signature,coalesce(l.pat->>'finish','') finish,
    ps.product_id target_product_id,
    (public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer candidate_year
  from links l
  join public.commerce_product_skus ps
    on ps.product_id<>l.commerce_product_id
   and ps.sku_type='CURRENT'
   and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'signature','')=coalesce(l.pat->>'signature','')
   and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'finish','')=coalesce(l.pat->>'finish','')
  where coalesce(l.pat->>'year','') ~ '^[0-9]{4}$'
    and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'year','') ~ '^[0-9]{4}$'
    and (public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer < (l.pat->>'year')::integer
    and public.commerce_nisti_sku_norm_v1(ps.sku)<>public.commerce_nisti_sku_norm_v1(l.source_sku)
),
ranked as (
  select *,dense_rank() over(partition by nisti_product_id order by candidate_year desc) year_rank
  from candidate_rows
),
best as (
  select
    nisti_product_id,old_product_id,source_sku,source_name,source_image_url,source_year,signature,finish,
    min(target_product_id) filter(where year_rank=1) target_product_id,
    count(distinct target_product_id) filter(where year_rank=1)::integer candidate_count
  from ranked
  group by nisti_product_id,old_product_id,source_sku,source_name,source_image_url,source_year,signature,finish
)
select * from best where candidate_count=1;

update public.commerce_products p
set name=coalesce(r.source_name,p.name),
    temporal_type='ANNUAL',
    edition_year=r.source_year,
    reference_image_url=coalesce(r.source_image_url,p.reference_image_url),
    reference_image_source=case when r.source_image_url is not null then 'NISTI_ID' else p.reference_image_source end,
    reference_image_sku=case when r.source_image_url is not null then r.source_sku else p.reference_image_sku end,
    updated_at=now()
from _nisti_family_repair r
where p.id=r.target_product_id;

update public.commerce_product_skus ps
set sku_type='HISTORICAL',is_active=false,valid_to_year=r.source_year-1,updated_at=now()
from _nisti_family_repair r
where ps.product_id=r.target_product_id
  and ps.sku_type='CURRENT'
  and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'signature','')=r.signature
  and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'finish','')=r.finish
  and coalesce(public.commerce_sku_pattern_v1(ps.sku)->>'year','') ~ '^[0-9]{4}$'
  and (public.commerce_sku_pattern_v1(ps.sku)->>'year')::integer < r.source_year;

update public.commerce_nisti_product_links l
set commerce_product_id=r.target_product_id,last_synced_at=now(),updated_at=now()
from _nisti_family_repair r
where l.nisti_product_id=r.nisti_product_id;

delete from public.commerce_products p
using _nisti_family_repair r
where p.id=r.old_product_id
  and not exists(select 1 from public.commerce_nisti_product_links l where l.commerce_product_id=p.id)
  and not exists(select 1 from public.commerce_listing_products x where x.product_id=p.id)
  and not exists(select 1 from public.commerce_source_rows x where x.matched_product_id=p.id)
  and not exists(select 1 from public.commerce_product_media_links x where x.product_id=p.id)
  and not exists(select 1 from public.commerce_product_state_events x where x.product_id=p.id);

insert into public.commerce_product_skus(product_id,sku,sku_type,valid_from_year,is_active,created_at,updated_at)
select r.target_product_id,r.source_sku,'CURRENT',r.source_year,true,now(),now()
from _nisti_family_repair r
where not exists(
  select 1 from public.commerce_product_skus ps
  where public.commerce_nisti_sku_norm_v1(ps.sku)=public.commerce_nisti_sku_norm_v1(r.source_sku)
);

update public.commerce_product_skus ps
set sku=r.source_sku,sku_type='CURRENT',valid_from_year=r.source_year,is_active=true,updated_at=now()
from _nisti_family_repair r
where ps.product_id=r.target_product_id
  and public.commerce_nisti_sku_norm_v1(ps.sku)=public.commerce_nisti_sku_norm_v1(r.source_sku);

commit;
