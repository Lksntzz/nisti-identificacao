begin;

create or replace function public.commerce_set_listing_state_v1(
  p_listing_id bigint,
  p_listing_status text default null,
  p_sales_status text default null,
  p_video_status text default null,
  p_checked_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_listing_status text := nullif(upper(btrim(coalesce(p_listing_status, ''))), '');
  v_sales_status text := nullif(upper(btrim(coalesce(p_sales_status, ''))), '');
  v_video_status text := nullif(upper(btrim(coalesce(p_video_status, ''))), '');
  v_result jsonb;
begin
  if p_listing_id is null or p_listing_id <= 0 then
    raise exception 'listing_id_invalid' using errcode = '22023';
  end if;

  if v_listing_status is not null and v_listing_status not in ('UNKNOWN', 'ACTIVE', 'PAUSED', 'INACTIVE', 'REMOVED') then
    raise exception 'listing_status_invalid' using errcode = '22023';
  end if;
  if v_sales_status is not null and v_sales_status not in ('UNKNOWN', 'SELLING', 'NO_SALES') then
    raise exception 'sales_status_invalid' using errcode = '22023';
  end if;
  if v_video_status is not null and v_video_status not in ('UNKNOWN', 'ACTIVE', 'ABSENT', 'DISABLED') then
    raise exception 'video_status_invalid' using errcode = '22023';
  end if;

  update public.commerce_listings
  set
    listing_status = coalesce(v_listing_status, listing_status),
    sales_status = coalesce(v_sales_status, sales_status),
    video_status = coalesce(v_video_status, video_status),
    last_checked_at = now(),
    raw_metadata = raw_metadata || jsonb_build_object(
      'manual_state_checked_by', nullif(btrim(coalesce(p_checked_by, '')), ''),
      'manual_state_checked_at', now()
    )
  where id = p_listing_id
  returning jsonb_build_object(
    'id', id,
    'listing_status', listing_status,
    'sales_status', sales_status,
    'video_status', video_status,
    'last_checked_at', last_checked_at
  ) into v_result;

  if v_result is null then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  return v_result;
end;
$$;

revoke all on function public.commerce_set_listing_state_v1(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.commerce_set_listing_state_v1(bigint, text, text, text, text) to service_role;

commit;
