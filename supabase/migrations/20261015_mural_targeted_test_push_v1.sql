-- QA push is independent of the Mural public-release gate.
-- Resolve one single named operator from actual scanner sessions + push subscriptions.
-- No generic broadcast or arbitrary recipient ID from the browser is supported.
create table if not exists public.mural_push_test_cooldowns (
  user_id text primary key,
  claimed_at timestamptz not null default now()
);

create or replace function public.nisti_claim_adm_lukas_mural_push_test_v1()
returns jsonb language plpgsql set search_path='public' as $$
declare
  v_operator_id text;
  v_operator_count integer;
  v_device record;
  v_claimed text;
begin
  select count(distinct s.user_id),max(s.user_id)
    into v_operator_count,v_operator_id
  from public.push_subscriptions s
  where s.user_id ~ '^op_[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from public.gtin_scan_events g
      where g.operator_id=s.user_id and upper(btrim(g.operator_name))='ADM LUKAS'
    );
  if v_operator_count=0 then
    return jsonb_build_object('status','not_registered');
  end if;
  if v_operator_count<>1 then
    return jsonb_build_object('status','ambiguous_operator','registered_profiles',v_operator_count);
  end if;

  select id,endpoint,p256dh,auth into v_device
    from public.push_subscriptions
    where user_id=v_operator_id
    order by updated_at desc,id desc limit 1;
  if v_device.id is null then
    return jsonb_build_object('status','not_registered');
  end if;

  insert into public.mural_push_test_cooldowns(user_id,claimed_at)
  values(v_operator_id,now())
  on conflict(user_id) do update set claimed_at=excluded.claimed_at
    where mural_push_test_cooldowns.claimed_at < now()-interval '90 seconds'
  returning user_id into v_claimed;
  if v_claimed is null then
    return jsonb_build_object('status','cooldown','retry_after_seconds',90);
  end if;
  return jsonb_build_object(
    'status','ready','operator_user_id',v_operator_id,
    'subscription',jsonb_build_object(
      'endpoint',v_device.endpoint,'p256dh',v_device.p256dh,'auth',v_device.auth));
end $$;

revoke all on table public.mural_push_test_cooldowns from public,anon,authenticated;
grant select,insert,update on table public.mural_push_test_cooldowns to service_role;
revoke execute on function public.nisti_claim_adm_lukas_mural_push_test_v1() from public,anon,authenticated;
grant execute on function public.nisti_claim_adm_lukas_mural_push_test_v1() to service_role;
