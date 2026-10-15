-- Independent Mural push deliveries, at most one mobile notification per operator and post.
-- No deliveries are queued for pre-release publications. Worker enforces the release gate.
create table if not exists public.mural_push_deliveries (
  post_id bigint not null references public.mural_posts(id) on delete cascade,
  operator_user_id text not null,
  subscription_id bigint,
  state text not null default 'claimed' check(state in ('claimed','sent','failed')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(post_id,operator_user_id)
);
create index if not exists mural_push_deliveries_claimed_idx on public.mural_push_deliveries(state,claimed_at);

create or replace function public.nisti_claim_mural_push_targets_v1(p_post_id bigint)
returns jsonb language plpgsql set search_path='public' as $$
declare v_post record; v_targets jsonb;
begin
  select id,kind,title,subtitle,body,notice_level into v_post
  from public.mural_posts
  where id=p_post_id and status='published'
    and kind in ('collection','notice','product')
    and published_at is not null and published_at<=now()
    and (expires_at is null or expires_at>now());
  if not found then
    return jsonb_build_object('eligible',false,'targets','[]'::jsonb);
  end if;
  with devices as (
    select distinct on (user_id) id,user_id,endpoint,p256dh,auth
    from public.push_subscriptions
    where user_id ~ '^op_[0-9a-fA-F-]{36}$'
      and endpoint is not null and p256dh is not null and auth is not null
    order by user_id,updated_at desc,id desc
  ), claimed as (
    insert into public.mural_push_deliveries (post_id,operator_user_id,subscription_id)
    select p_post_id,devices.user_id,devices.id from devices
    on conflict (post_id,operator_user_id) do nothing
    returning operator_user_id,subscription_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'operator_user_id',claimed.operator_user_id,'id',d.id,
    'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth)),'[]'::jsonb)
  into v_targets
  from claimed
  join public.push_subscriptions d on d.id=claimed.subscription_id;
  return jsonb_build_object('eligible',true,'kind',v_post.kind,
    'title',v_post.title,'subtitle',v_post.subtitle,'body',v_post.body,
    'notice_level',v_post.notice_level,'targets',coalesce(v_targets,'[]'::jsonb));
end $$;

create or replace function public.nisti_complete_mural_push_delivery_v1(
  p_post_id bigint,p_operator_user_id text,p_sent boolean)
returns boolean language plpgsql set search_path='public' as $$
begin
  update public.mural_push_deliveries
    set state=case when p_sent then 'sent' else 'failed' end,
        completed_at=now()
  where post_id=p_post_id and operator_user_id=p_operator_user_id
    and state='claimed';
  return found;
end $$;

revoke all on table public.mural_push_deliveries from public,anon,authenticated;
revoke execute on function public.nisti_claim_mural_push_targets_v1(bigint) from public,anon,authenticated;
revoke execute on function public.nisti_complete_mural_push_delivery_v1(bigint,text,boolean) from public,anon,authenticated;
grant select,insert,update,delete on table public.mural_push_deliveries to service_role;
grant execute on function public.nisti_claim_mural_push_targets_v1(bigint) to service_role;
grant execute on function public.nisti_complete_mural_push_delivery_v1(bigint,text,boolean) to service_role;
