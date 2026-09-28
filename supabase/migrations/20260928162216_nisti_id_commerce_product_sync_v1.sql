create table if not exists public.commerce_nisti_product_links (
  nisti_product_id bigint primary key,
  commerce_product_id bigint references public.commerce_products(id) on delete set null,
  source_sku text not null,
  source_name text,
  source_variation text,
  source_image_url text,
  source_payload jsonb not null default '{}'::jsonb,
  sync_status text not null default 'SYNCED',
  last_error text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_nisti_product_links_status_ck
    check (sync_status in ('SYNCED','CONFLICT','ERROR'))
);

create index if not exists commerce_nisti_product_links_product_idx
  on public.commerce_nisti_product_links(commerce_product_id);
create index if not exists commerce_nisti_product_links_sku_idx
  on public.commerce_nisti_product_links(upper(btrim(source_sku)));

alter table public.commerce_nisti_product_links enable row level security;
revoke all on table public.commerce_nisti_product_links from public, anon, authenticated;
grant select, insert, update on table public.commerce_nisti_product_links to service_role;

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
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_variation text := nullif(btrim(coalesce(p_variation,'')),'');
  v_image text := nullif(btrim(coalesce(p_image_url,'')),'');
  v_product_id bigint;
  v_existing_link public.commerce_nisti_product_links%rowtype;
  v_match_count integer := 0;
  v_action text := 'UPDATED';
  v_old_sku text;
begin
  if p_nisti_product_id is null or p_nisti_product_id <= 0 then
    raise exception 'nisti_product_id_invalid' using errcode='22023';
  end if;
  if v_sku = '' then
    raise exception 'nisti_sku_required' using errcode='22023';
  end if;

  select * into v_existing_link
  from public.commerce_nisti_product_links
  where nisti_product_id=p_nisti_product_id;

  if found and v_existing_link.commerce_product_id is not null then
    v_product_id := v_existing_link.commerce_product_id;
    v_old_sku := upper(btrim(v_existing_link.source_sku));
    v_action := 'UPDATED';
  else
    select count(distinct product_id)::integer, min(product_id)
      into v_match_count, v_product_id
    from public.commerce_product_skus
    where upper(btrim(sku))=v_sku;

    if v_match_count > 1 then
      insert into public.commerce_nisti_product_links(
        nisti_product_id,commerce_product_id,source_sku,source_name,source_variation,
        source_image_url,source_payload,sync_status,last_error,last_synced_at,updated_at
      ) values(
        p_nisti_product_id,null,v_sku,v_name,v_variation,v_image,coalesce(p_payload,'{}'::jsonb),
        'CONFLICT','Mais de um Produto Mestre usa este SKU.',now(),now()
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
        'status','CONFLICT',
        'action','CONFLICT',
        'nisti_product_id',p_nisti_product_id,
        'sku',v_sku,
        'commerce_product_id',null
      );
    elsif v_match_count = 1 then
      v_action := 'LINKED';
    else
      insert into public.commerce_products(
        name,temporal_type,edition_year,internal_status,reference_image_url,
        reference_image_source,reference_image_sku
      ) values(
        coalesce(v_name,v_variation,v_sku),
        'UNCLASSIFIED',
        null,
        'ACTIVE',
        v_image,
        case when v_image is not null then 'NISTI_ID' else null end,
        case when v_image is not null then v_sku else null end
      )
      returning id into v_product_id;

      insert into public.commerce_product_skus(
        product_id,sku,sku_type,is_active
      ) values(
        v_product_id,v_sku,'CURRENT',true
      );
      v_action := 'CREATED';
    end if;
  end if;

  if v_product_id is null then
    raise exception 'commerce_product_resolution_failed' using errcode='22023';
  end if;

  update public.commerce_products
  set
    name=coalesce(v_name,name),
    internal_status=case when internal_status='DRAFT' then 'ACTIVE' else internal_status end,
    reference_image_url=coalesce(v_image,reference_image_url),
    reference_image_source=case when v_image is not null then 'NISTI_ID' else reference_image_source end,
    reference_image_sku=case when v_image is not null then v_sku else reference_image_sku end,
    updated_at=now()
  where id=v_product_id;

  if not exists (
    select 1 from public.commerce_product_skus
    where product_id=v_product_id and upper(btrim(sku))=v_sku
  ) then
    insert into public.commerce_product_skus(
      product_id,sku,sku_type,is_active
    ) values(
      v_product_id,v_sku,'CURRENT',true
    );
  else
    update public.commerce_product_skus
    set is_active=true, updated_at=now()
    where product_id=v_product_id and upper(btrim(sku))=v_sku;
  end if;

  if v_old_sku is not null and v_old_sku <> v_sku then
    update public.commerce_product_skus
    set sku_type=case when sku_type='CURRENT' then 'ALIAS' else sku_type end,
        updated_at=now()
    where product_id=v_product_id and upper(btrim(sku))=v_old_sku;
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
    'status','SYNCED',
    'action',v_action,
    'nisti_product_id',p_nisti_product_id,
    'sku',v_sku,
    'commerce_product_id',v_product_id
  );
end;
$$;

create or replace function public.commerce_sync_nisti_products_v1(
  p_products jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_created integer := 0;
  v_linked integer := 0;
  v_updated integer := 0;
  v_conflicts integer := 0;
begin
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'products_array_required' using errcode='22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_products) loop
    v_total := v_total + 1;
    begin
      v_result := public.commerce_sync_nisti_product_v1(
        nullif(v_item->>'id','')::bigint,
        v_item->>'sku',
        v_item->>'nome',
        v_item->>'variacao',
        v_item->>'image_url',
        v_item
      );

      if v_result->>'action'='CREATED' then v_created := v_created + 1;
      elsif v_result->>'action'='LINKED' then v_linked := v_linked + 1;
      elsif v_result->>'action'='UPDATED' then v_updated := v_updated + 1;
      elsif v_result->>'action'='CONFLICT' then v_conflicts := v_conflicts + 1;
      end if;

      v_results := v_results || jsonb_build_array(v_result);
    exception when others then
      v_conflicts := v_conflicts + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status','ERROR',
        'action','ERROR',
        'nisti_product_id',v_item->>'id',
        'sku',v_item->>'sku',
        'error',sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'total',v_total,
    'created',v_created,
    'linked',v_linked,
    'updated',v_updated,
    'conflicts',v_conflicts,
    'results',v_results
  );
end;
$$;

create or replace function public.commerce_nisti_sync_status_v1()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
select jsonb_build_object(
  'linked_total',count(*) filter (where sync_status='SYNCED'),
  'conflicts',count(*) filter (where sync_status='CONFLICT'),
  'errors',count(*) filter (where sync_status='ERROR'),
  'last_synced_at',max(last_synced_at)
)
from public.commerce_nisti_product_links;
$$;

revoke execute on function public.commerce_sync_nisti_product_v1(bigint,text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.commerce_sync_nisti_products_v1(jsonb) from public, anon, authenticated;
revoke execute on function public.commerce_nisti_sync_status_v1() from public, anon, authenticated;
grant execute on function public.commerce_sync_nisti_product_v1(bigint,text,text,text,text,jsonb) to service_role;
grant execute on function public.commerce_sync_nisti_products_v1(jsonb) to service_role;
grant execute on function public.commerce_nisti_sync_status_v1() to service_role;
