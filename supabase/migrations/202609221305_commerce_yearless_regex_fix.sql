begin;

create or replace function public.commerce_yearless_match_key_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(
    btrim(
      regexp_replace(
        coalesce(public.commerce_match_key_v1(p_value), ''),
        '\m20(2[0-9]|3[0-9])\M',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

revoke all on function public.commerce_yearless_match_key_v1(text) from public, anon, authenticated;
grant execute on function public.commerce_yearless_match_key_v1(text) to service_role;

commit;
