-- Explicit account-provenanced status sync and account-filtered listing history.
create or replace function public.commerce_sync_import_listing_states_account_v1(p_batch_id bigint)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_batch record;v_observations int;v_ambiguous int;v_created int;v_changed int;
begin
 select b.id,b.marketplace_id,b.account_code,b.status,m.code marketplace_code
 into v_batch from public.commerce_import_batches b
 join public.commerce_marketplaces m on m.id=b.marketplace_id
 where b.id=p_batch_id for update of b;
 if v_batch.id is null or v_batch.status not in ('REVIEW','PARSED','COMMITTED')
 then raise exception 'listing_status_batch_not_ready' using errcode='22023';end if;
 if v_batch.marketplace_code<>'MERCADO_LIVRE' or
   v_batch.account_code is null or v_batch.account_code not in ('ANTIGO','NOVO')
 then raise exception 'mercado_livre_account_required' using errcode='22023';end if;
 if exists (
   select 1 from public.commerce_import_rows r
   where r.batch_id=p_batch_id
    and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
    and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
   group by r.normalized_payload->>'external_listing_id'
   having count(distinct r.normalized_payload->>'source_listing_status')>1
 ) then raise exception 'listing_status_conflict_in_batch' using errcode='22023';end if;

 select count(*),count(*) filter(where exists(
   select 1 from public.commerce_listings l
   where l.marketplace_id=v_batch.marketplace_id
     and l.account_code is null and l.external_listing_id=z.id
 )) into v_observations,v_ambiguous
 from (
   select distinct r.normalized_payload->>'external_listing_id' id
   from public.commerce_import_rows r
   where r.batch_id=p_batch_id and
      r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
      and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
 ) z;

 with observations as (
   select distinct on (r.normalized_payload->>'external_listing_id')
    r.normalized_payload->>'external_listing_id' external_id,
    r.normalized_payload->>'source_listing_status' status,
    nullif(btrim(r.normalized_payload->>'product_name'),'') title
   from public.commerce_import_rows r
   where r.batch_id=p_batch_id and
    r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
    and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
    and not exists (
      select 1 from public.commerce_listings l
      where l.marketplace_id=v_batch.marketplace_id and l.account_code is null
      and l.external_listing_id=r.normalized_payload->>'external_listing_id'
    )
   order by r.normalized_payload->>'external_listing_id',r.id desc
 ), inserted as (
   insert into public.commerce_listings(
      marketplace_id,account_code,external_listing_id,canonical_url,title,
      listing_status,sales_status,video_status,source,raw_metadata,last_checked_at)
   select v_batch.marketplace_id,v_batch.account_code,o.external_id,
    'https://produto.mercadolivre.com.br/MLB-' || substring(o.external_id from 4),
    o.title,o.status,'UNKNOWN','UNKNOWN','EXCEL',
    jsonb_build_object('status_source','OFFICIAL_ML_WORKBOOK','last_status_import_batch_id',p_batch_id),now()
   from observations o
   on conflict do nothing returning id
 ) select count(*) into v_created from inserted;

 with observations as (
   select distinct on (r.normalized_payload->>'external_listing_id')
    r.normalized_payload->>'external_listing_id' external_id,
    r.normalized_payload->>'source_listing_status' status
   from public.commerce_import_rows r
   where r.batch_id=p_batch_id and
    r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
    and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
   order by r.normalized_payload->>'external_listing_id',r.id desc
 ), changed as (
   update public.commerce_listings l
   set listing_status=o.status,last_checked_at=now(),
      raw_metadata=coalesce(l.raw_metadata,'{}'::jsonb)||
       jsonb_build_object('status_source','OFFICIAL_ML_WORKBOOK',
                          'last_status_import_batch_id',p_batch_id)
   from observations o
   where l.marketplace_id=v_batch.marketplace_id
     and l.account_code=v_batch.account_code
     and l.external_listing_id=o.external_id
     and l.listing_status is distinct from o.status
   returning l.id
 ) select count(*) into v_changed from changed;

 return jsonb_build_object('batch_id',p_batch_id,'account_code',v_batch.account_code,
    'observed_listings',v_observations,'ambiguous_unassigned',v_ambiguous,
    'created',v_created,'status_changed',v_changed,
    'unchanged',greatest(v_observations-v_ambiguous-v_created-v_changed,0));
end $$;

create or replace function public.commerce_listing_history_account_v1(
 p_group text default 'ALL',p_account_code text default 'ALL',
 p_limit integer default 30,p_offset integer default 0
) returns jsonb language plpgsql stable set search_path to 'public' as $$
declare v_group text:=upper(btrim(coalesce(p_group,'ALL')));
 v_account text:=upper(btrim(coalesce(p_account_code,'ALL')));v_result jsonb;
begin
 if v_group not in ('ALL','ACTIVE','DEACTIVATED','UNKNOWN')
 then raise exception 'listing_history_group_invalid' using errcode='22023';end if;
 if v_account not in ('ALL','ANTIGO','NOVO','UNASSIGNED')
 then raise exception 'listing_account_filter_invalid' using errcode='22023';end if;
 if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0
 then raise exception 'listing_history_page_invalid' using errcode='22023';end if;
 with scope as (
   select l.id,l.account_code,l.external_listing_id,l.title,l.listing_status,l.canonical_url,
     l.updated_at,l.last_checked_at,m.code marketplace_code,m.name marketplace_name,
     coalesce(a.label,case when m.code='MERCADO_LIVRE' then 'Conta não identificada'
                        else 'Não se aplica' end) account_label
   from public.commerce_listings l join public.commerce_marketplaces m on m.id=l.marketplace_id
   left join public.commerce_marketplace_accounts a on a.marketplace_id=l.marketplace_id
      and a.code=l.account_code
   where v_account='ALL'
      or (m.code='MERCADO_LIVRE' and coalesce(l.account_code,'UNASSIGNED')=v_account)
 ), filtered as (
   select * from scope where v_group='ALL'
    or (v_group='ACTIVE' and listing_status='ACTIVE')
    or (v_group='DEACTIVATED' and listing_status in ('PAUSED','INACTIVE','REMOVED'))
    or (v_group='UNKNOWN' and listing_status='UNKNOWN')
 ), paged as (
   select * from filtered order by updated_at desc,id desc limit p_limit offset p_offset
 ), totals as (
   select count(*) all_count,count(*) filter(where listing_status='ACTIVE') active_count,
    count(*) filter(where listing_status in ('PAUSED','INACTIVE','REMOVED')) deactivated_count,
    count(*) filter(where listing_status='UNKNOWN') unknown_count
   from scope
 )
 select jsonb_build_object(
   'total',(select count(*) from filtered),
   'account_code',v_account,
   'counts',jsonb_build_object('all',all_count,'active',active_count,'deactivated',deactivated_count,'unknown',unknown_count),
   'items',coalesce((select jsonb_agg(jsonb_build_object(
     'id',p.id,'external_listing_id',p.external_listing_id,'title',p.title,
     'status',p.listing_status,'url',p.canonical_url,'updated_at',p.updated_at,
     'marketplace_code',p.marketplace_code,'marketplace_name',p.marketplace_name,
     'account_code',p.account_code,'account_label',p.account_label)
     order by p.updated_at desc,p.id desc) from paged p),'[]'::jsonb)
 ) into v_result from totals;
 return v_result;
end $$;

create or replace function public.commerce_import_batch_account_v1(p_batch_id bigint)
returns jsonb language sql stable set search_path to 'public' as $$
 select public.commerce_import_batch_v2(p_batch_id) ||
  jsonb_build_object('account_code',(select account_code from public.commerce_import_batches where id=p_batch_id));
$$;

revoke execute on function public.commerce_sync_import_listing_states_account_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_sync_import_listing_states_account_v1(bigint) to service_role;
revoke execute on function public.commerce_listing_history_account_v1(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.commerce_listing_history_account_v1(text,text,integer,integer) to service_role;
revoke execute on function public.commerce_import_batch_account_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_import_batch_account_v1(bigint) to service_role;
