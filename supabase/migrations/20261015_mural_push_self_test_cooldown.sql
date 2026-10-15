-- One self-test to the current verified operator session and browser subscription.
-- Service role only; does not change Mural release permissions.
create or replace function public.nisti_claim_operator_push_self_test_v1(p_user_id text)
returns jsonb language plpgsql set search_path='public' as $$
declare v_claimed text;
begin
  if p_user_id is null or p_user_id !~ '^op_[0-9a-fA-F-]{36}$' then
    return jsonb_build_object('status','invalid_operator');
  end if;
  insert into public.mural_push_test_cooldowns(user_id,claimed_at)
  values (p_user_id,now())
  on conflict (user_id) do update
    set claimed_at=excluded.claimed_at
    where mural_push_test_cooldowns.claimed_at < now()-interval '90 seconds'
  returning user_id into v_claimed;
  if v_claimed is null then
    return jsonb_build_object('status','cooldown','retry_after_seconds',90);
  end if;
  return jsonb_build_object('status','ready');
end $$;
revoke execute on function public.nisti_claim_operator_push_self_test_v1(text) from public,anon,authenticated;
grant execute on function public.nisti_claim_operator_push_self_test_v1(text) to service_role;
