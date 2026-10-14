-- Keep Mercado Livre identities isolated by seller account.
-- NULL means historically unattributed; never guess an account from a URL or SKU.
create table if not exists public.commerce_marketplace_accounts (
  marketplace_id bigint not null references public.commerce_marketplaces(id) on delete restrict,
  code text not null,
  label text not null,
  created_at timestamptz not null default now(),
  primary key(marketplace_id, code),
  constraint commerce_marketplace_account_code_ck check(code ~ '^[A-Z0-9_]+$')
);
insert into public.commerce_marketplace_accounts(marketplace_id,code,label)
select m.id, a.code,a.label from public.commerce_marketplaces m
cross join (values ('ANTIGO','Mercado Livre — Conta Antiga'),('NOVO','Mercado Livre — Conta Nova')) a(code,label)
where m.code='MERCADO_LIVRE'
on conflict(marketplace_id,code) do update set label=excluded.label;

alter table public.commerce_listings add column if not exists account_code text;
alter table public.commerce_import_batches add column if not exists account_code text;
alter table public.commerce_marketplace_snapshots add column if not exists account_code text;

-- The existing source-row linkage is explicit evidence for the OLD account only.
-- Never attribute remaining rows or MLBU URL-only ads automatically.
with proven as (
 select r.matched_listing_id listing_id, min(f.account_code) account_code
 from public.commerce_source_rows r
 join public.commerce_source_files f on f.id=r.source_file_id
 where r.matched_listing_id is not null and f.marketplace_code='MERCADO_LIVRE'
 and f.account_code in ('ANTIGO','NOVO')
 group by r.matched_listing_id
 having count(distinct f.account_code)=1
)
update public.commerce_listings l set account_code=p.account_code
from proven p join public.commerce_marketplaces m on m.code='MERCADO_LIVRE'
where l.id=p.listing_id and l.marketplace_id=m.id and l.account_code is null;

alter table public.commerce_listings
  add constraint commerce_listings_account_fk foreign key(marketplace_id,account_code)
  references public.commerce_marketplace_accounts(marketplace_id,code);
alter table public.commerce_import_batches
  add constraint commerce_import_batches_account_fk foreign key(marketplace_id,account_code)
  references public.commerce_marketplace_accounts(marketplace_id,code);
alter table public.commerce_marketplace_snapshots
  add constraint commerce_marketplace_snapshots_account_fk foreign key(marketplace_id,account_code)
  references public.commerce_marketplace_accounts(marketplace_id,code);

-- Account-aware uniqueness includes the explicitly unassigned legacy namespace.
create unique index commerce_listings_account_external_id_uq
  on public.commerce_listings(marketplace_id, coalesce(account_code,'__UNASSIGNED__'),btrim(external_listing_id))
  where external_listing_id is not null and btrim(external_listing_id)<>'';
create unique index commerce_listings_account_url_uq
  on public.commerce_listings(marketplace_id, coalesce(account_code,'__UNASSIGNED__'),canonical_url);
drop index if exists public.commerce_listings_external_id_uq;
drop index if exists public.commerce_listings_url_uq;
create index commerce_listings_account_status_idx on public.commerce_listings(marketplace_id,account_code,listing_status);
create index commerce_import_batches_account_idx on public.commerce_import_batches(marketplace_id,account_code,created_at desc);

-- Uploads must select the exact account; other marketplaces keep NULL account.
create or replace function public.commerce_create_import_batch_v2(
 p_marketplace_code text,p_source_filename text,p_source_sha256 text,p_created_by text,p_account_code text
) returns bigint language plpgsql set search_path to 'public' as $$
declare v_marketplace_id bigint;v_batch_id bigint;v_account text := nullif(upper(btrim(coalesce(p_account_code,''))),'');
begin
 select id into v_marketplace_id from public.commerce_marketplaces
 where upper(code)=upper(btrim(coalesce(p_marketplace_code,''))) and is_active=true;
 if v_marketplace_id is null then raise exception 'marketplace_not_found' using errcode='22023'; end if;
 if upper(btrim(p_marketplace_code))='MERCADO_LIVRE' then
  if v_account not in ('ANTIGO','NOVO') or v_account is null then
    raise exception 'mercado_livre_account_required' using errcode='22023';
  end if;
 else
  if v_account is not null then raise exception 'account_not_supported_for_marketplace' using errcode='22023'; end if;
 end if;
 v_batch_id:=public.commerce_create_import_batch_v1(p_marketplace_code,p_source_filename,p_source_sha256,p_created_by);
 update public.commerce_import_batches set account_code=v_account where id=v_batch_id;
 return v_batch_id;
end $$;

revoke execute on function public.commerce_create_import_batch_v2(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_create_import_batch_v2(text,text,text,text,text) to service_role;
