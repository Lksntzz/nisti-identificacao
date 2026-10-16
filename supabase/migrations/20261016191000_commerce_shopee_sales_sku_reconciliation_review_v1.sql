-- Shopee: reviewed historical aliases for sales SKUs not present among active ads.
-- A title or year change is ONLY a suggestion, never an automatic attribution.
-- Does not change SKU, product, scanner or historical sales rows.

create table if not exists public.commerce_shopee_sales_sku_alias_reviews_v1 (
  source_sku_norm text primary key,
  listing_product_id bigint not null references public.commerce_listing_products(id) on delete restrict,
  active boolean not null default true,
  evidence text not null check(length(btrim(evidence)) between 8 and 500),
  approved_by text not null,
  approved_at timestamptz not null default now(),
  revoked_by text,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint shopee_sales_alias_sku_length check(length(source_sku_norm) between 1 and 160)
);
create index if not exists shopee_sales_alias_variation_idx
  on public.commerce_shopee_sales_sku_alias_reviews_v1(listing_product_id) where active;
alter table public.commerce_shopee_sales_sku_alias_reviews_v1 enable row level security;
revoke all on public.commerce_shopee_sales_sku_alias_reviews_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_sales_sku_alias_reviews_v1 to service_role;

-- Only unambiguous ACTIVE variation owners can receive a historical alias.
-- Direct owner wins; aliases cannot hijack a SKU already used by any active variation.
create or replace view public.commerce_shopee_sku_owner_reviewed_v1
with (security_invoker=true)
as
with variants as (
  select lp.id as listing_product_id,lp.listing_id,l.external_listing_id,
    lp.variation_id,public.commerce_nisti_sku_norm_v1(lp.platform_sku) as norm
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
    and nullif(public.commerce_nisti_sku_norm_v1(lp.platform_sku),'') is not null
), uniques as (
  select norm,min(listing_product_id) listing_product_id
  from variants group by norm having count(*)=1
), direct as (
  select v.norm as source_sku_norm,v.norm as canonical_sku_norm,
    v.listing_product_id,v.listing_id,v.external_listing_id,v.variation_id,
    'DIRECT'::text as mapping_type
  from variants v join uniques u on u.listing_product_id=v.listing_product_id
), reviewed as (
  select a.source_sku_norm,v.norm as canonical_sku_norm,
    v.listing_product_id,v.listing_id,v.external_listing_id,v.variation_id,
    'REVIEWED'::text as mapping_type
  from public.commerce_shopee_sales_sku_alias_reviews_v1 a
  join variants v on v.listing_product_id=a.listing_product_id
  join uniques u on u.listing_product_id=v.listing_product_id
  where a.active and not exists (
    select 1 from variants used where used.norm=a.source_sku_norm
  )
)
select * from direct
union all select * from reviewed;
revoke all on public.commerce_shopee_sku_owner_reviewed_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_sku_owner_reviewed_v1 to service_role;

create or replace function public.commerce_shopee_confirm_sku_alias_v1(
  p_source_sku text,p_listing_product_id bigint,p_evidence text,
  p_actor text,p_confirmed boolean
) returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_sku text;v_target record;v_existing record;v_source_count integer;v_target_count integer;
begin
  v_sku:=public.commerce_nisti_sku_norm_v1(p_source_sku);
  if not p_confirmed or nullif(v_sku,'') is null or length(v_sku)>160
     or p_listing_product_id is null or p_listing_product_id<=0
     or length(btrim(coalesce(p_evidence,''))) not between 8 and 500
  then raise exception 'É necessário confirmar um SKU, a variação e a justificativa.';end if;
  if not exists (
    select 1 from public.commerce_sales_rows r
    join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
    where r.platform_code='SHOPEE'
      and public.commerce_nisti_sku_norm_v1(r.sku_norm)=v_sku
  ) then raise exception 'SKU não pertence às vendas Shopee atuais.'; end if;

  select lp.id,public.commerce_nisti_sku_norm_v1(lp.platform_sku) canonical_sku,
    l.external_listing_id
  into v_target
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where lp.id=p_listing_product_id and m.code='SHOPEE'
    and l.listing_status='ACTIVE' and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
    and nullif(public.commerce_nisti_sku_norm_v1(lp.platform_sku),'') is not null;
  if not found then raise exception 'Selecione uma variação ativa da Shopee com SKU próprio.';end if;

  select count(*) into v_target_count
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  where l.marketplace_id=(select id from public.commerce_marketplaces where code='SHOPEE')
    and l.listing_status='ACTIVE' and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
    and public.commerce_nisti_sku_norm_v1(lp.platform_sku)=v_target.canonical_sku;
  if v_target_count<>1 then
    raise exception 'O SKU da variação escolhida é compartilhado; revise a identidade.';
  end if;

  select count(*) into v_source_count
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  where l.marketplace_id=(select id from public.commerce_marketplaces where code='SHOPEE')
    and l.listing_status='ACTIVE' and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
    and public.commerce_nisti_sku_norm_v1(lp.platform_sku)=v_sku;
  if v_source_count>0 then
    raise exception 'O SKU antigo ainda consta em anúncios ativos. Não é possível atribuí-lo por alias.';
  end if;

  select * into v_existing from public.commerce_shopee_sales_sku_alias_reviews_v1
  where source_sku_norm=v_sku for update;
  if found and v_existing.active and v_existing.listing_product_id<>p_listing_product_id then
    raise exception 'SKU já confirmado para outra variação. Revogue o vínculo anterior primeiro.';
  end if;

  insert into public.commerce_shopee_sales_sku_alias_reviews_v1(
    source_sku_norm,listing_product_id,active,evidence,approved_by,approved_at,
    revoked_by,revoked_at,updated_at
  ) values (
    v_sku,p_listing_product_id,true,btrim(p_evidence),left(coalesce(nullif(btrim(p_actor),''),'Administrador'),120),
    now(),null,null,now()
  ) on conflict(source_sku_norm) do update set
    listing_product_id=excluded.listing_product_id,
    active=true,evidence=excluded.evidence,
    approved_by=excluded.approved_by,approved_at=excluded.approved_at,
    revoked_by=null,revoked_at=null,updated_at=now();
  return jsonb_build_object('source_sku',v_sku,'listing_product_id',p_listing_product_id,
    'external_listing_id',v_target.external_listing_id,'active',true);
end $fn$;

create or replace function public.commerce_shopee_revoke_sku_alias_v1(
  p_source_sku text,p_actor text
) returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_sku text;v_rows integer;
begin
  v_sku:=public.commerce_nisti_sku_norm_v1(p_source_sku);
  if nullif(v_sku,'') is null then raise exception 'SKU inválido.';end if;
  update public.commerce_shopee_sales_sku_alias_reviews_v1
  set active=false,revoked_at=now(),
    revoked_by=left(coalesce(nullif(btrim(p_actor),''),'Administrador'),120),
    updated_at=now()
  where source_sku_norm=v_sku and active;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'Vínculo aprovado não encontrado ou já revogado.';end if;
  return jsonb_build_object('source_sku',v_sku,'active',false);
end $fn$;

create or replace function public.commerce_shopee_sku_reconciliation_queue_v1(
  p_search text default null,p_state text default 'PENDING',
  p_limit integer default 20,p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with filter as (
  select nullif(left(btrim(coalesce(p_search,'')),120),'') query,
    case when upper(p_state)='APPROVED' then 'APPROVED' else 'PENDING' end state,
    greatest(1,least(coalesce(p_limit,20),50)) lim,
    greatest(0,least(coalesce(p_offset,0),10000)) offs
), sales as (
  select public.commerce_nisti_sku_norm_v1(r.sku_norm) sku,
    sum(r.units)::bigint units,round(sum(r.product_revenue),2)::numeric revenue,
    (array_agg(coalesce(r.product_name,'') order by r.units desc))[1] title,
    count(distinct r.period_start)::int months
  from public.commerce_sales_rows r
  join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
  where r.platform_code='SHOPEE' group by 1
), variants as (
  select lp.id variation_id,lp.listing_id,l.external_listing_id,l.title listing_title,
    lp.variation_name,lp.platform_sku,
    public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
), owners as (
  select norm,count(*) owners from variants
  where norm is not null group by norm
), candidates as (
  select s.sku,
    case
      when s.sku~'^PB(25|26)' then 'PB27'||substr(s.sku,5)
      when s.sku~'^AGMT(25|26)' then 'AGMT27'||substr(s.sku,7)
      when s.sku~'^PLAN(25|26)' then 'PLAN27'||substr(s.sku,7)
      when s.sku~'^CONFIN(25|26)' then 'CONFIN27'||substr(s.sku,9)
      else null end proposed
  from sales s
), suggested as (
  select c.sku,max(v.variation_id) as suggested_variation_id,
    max(v.external_listing_id) as suggested_listing_id,
    max(v.listing_title) as suggested_listing_title,
    max(v.variation_name) as suggested_variation_name,
    max(v.platform_sku) as suggested_sku
  from candidates c
  join variants v on v.norm=c.proposed
  group by c.sku having count(*)=1
), classified as (
  select s.sku,s.units,s.revenue,s.title,s.months,
    case when coalesce(o.owners,0)>1 then 'DUPLICATE_SKU'
      when a.source_sku_norm is not null then 'APPROVED'
      else 'MISSING_ACTIVE_SKU' end status,
    a.listing_product_id approved_variation_id,
    a.evidence,a.approved_by,a.approved_at,
    v.external_listing_id approved_listing_id,
    v.platform_sku approved_sku,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_variation_id else null end suggested_variation_id,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_listing_id else null end suggested_listing_id,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_listing_title else null end suggested_listing_title,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_variation_name else null end suggested_variation_name,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_sku else null end suggested_sku
  from sales s
  left join owners o on o.norm=s.sku
  left join public.commerce_shopee_sales_sku_alias_reviews_v1 a
    on a.source_sku_norm=s.sku and a.active
  left join variants v on v.variation_id=a.listing_product_id
  left join suggested sg on sg.sku=s.sku
  where coalesce(o.owners,0)<>1
), searched as (
  select c.* from classified c cross join filter f
  where (f.state='APPROVED' and c.status='APPROVED'
    or f.state='PENDING' and c.status<>'APPROVED')
    and (f.query is null or c.sku ilike '%'||f.query||'%'
      or c.title ilike '%'||f.query||'%')
), page as (
  select * from searched order by units desc,sku
  limit(select lim from filter) offset(select offs from filter)
)
select jsonb_build_object(
  'pending_skus',(select count(*) from classified where status<>'APPROVED'),
  'pending_units',(select coalesce(sum(units),0) from classified where status<>'APPROVED'),
  'pending_revenue',(select coalesce(sum(revenue),0) from classified where status<>'APPROVED'),
  'candidate_skus',(select count(*) from classified where status='MISSING_ACTIVE_SKU' and suggested_variation_id is not null),
  'approved_skus',(select count(*) from classified where status='APPROVED'),
  'total',(select count(*) from searched),
  'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.units desc,p.sku) from page p),'[]'::jsonb)
);
$fn$;

create or replace function public.commerce_shopee_sku_candidate_search_v1(
  p_search text,p_limit integer default 20
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with f as(select nullif(left(btrim(coalesce(p_search,'')),120),'') q,
  greatest(1,least(coalesce(p_limit,20),30)) lim),
c as (
  select lp.id variation_id,l.external_listing_id,l.title listing_title,
    lp.platform_sku,lp.variation_name,lp.variation_id source_variation_id,
    count(*) over(partition by public.commerce_nisti_sku_norm_v1(lp.platform_sku)) as sku_uses
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
)
select coalesce((select jsonb_agg(to_jsonb(c) order by c.listing_title,c.variation_id)
  from (select c.* from c cross join f
  where f.q is not null and length(f.q)>=2
    and (c.external_listing_id ilike '%'||f.q||'%'
      or c.listing_title ilike '%'||f.q||'%'
      or c.platform_sku ilike '%'||f.q||'%'
      or c.variation_name ilike '%'||f.q||'%')
  order by c.listing_title,c.variation_id limit(select lim from f)) c),'[]'::jsonb);
$fn$;

revoke all on function public.commerce_shopee_confirm_sku_alias_v1(text,bigint,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_confirm_sku_alias_v1(text,bigint,text,text,boolean)
  to service_role;
revoke all on function public.commerce_shopee_revoke_sku_alias_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_revoke_sku_alias_v1(text,text)
  to service_role;
revoke all on function public.commerce_shopee_sku_reconciliation_queue_v1(text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_sku_reconciliation_queue_v1(text,text,integer,integer)
  to service_role;
revoke all on function public.commerce_shopee_sku_candidate_search_v1(text,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_sku_candidate_search_v1(text,integer)
  to service_role;
