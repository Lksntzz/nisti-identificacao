-- Rascunho automatico no Mural: quando um produto NOVO tem imagem tratada aprovada e EAN valido,
-- cria UMA comunicacao (kind=notice) em RASCUNHO avisando que o produto tem EAN e pode ser identificado.
-- Nada e publicado sozinho: o admin revisa e publica. Idempotente (um aviso por produto).
-- Nao altera tabelas existentes; so cria uma tabela de controle e uma funcao (service_role).

create table if not exists public.nisti_mural_ean_announcements_v1 (
 product_id bigint primary key references public.products(id) on delete cascade,
 post_id bigint references public.mural_posts(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.nisti_mural_ean_announcements_v1 enable row level security;
revoke all on public.nisti_mural_ean_announcements_v1 from public,anon,authenticated;
grant select on public.nisti_mural_ean_announcements_v1 to service_role;

create or replace function public.nisti_mural_ean_draft_v1(p_product_id bigint, p_max_age_days int default 14)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public
as $fn$
declare
 v_prod record; v_img text; v_gtin text; v_post bigint; v_title text; v_name text; v_n int;
begin
 if p_product_id is null or p_product_id<=0 then return jsonb_build_object('status','invalid'); end if;
 select id,nome,variacao,created_at into v_prod from public.products where id=p_product_id;
 if not found then return jsonb_build_object('status','not_found'); end if;
 if v_prod.created_at < now()-make_interval(days=>greatest(coalesce(p_max_age_days,14),1)) then
   return jsonb_build_object('status','not_new'); end if;
 select gtin into v_gtin from public.product_gtins
  where product_id=p_product_id and active is true and gtin ~ '^[0-9]{13}$' order by id limit 1;
 if v_gtin is null then return jsonb_build_object('status','no_ean'); end if;
 select processed_image_key into v_img from public.mural_product_images
  where product_id=p_product_id and status='approved' and nullif(btrim(processed_image_key),'') is not null;
 if v_img is null then return jsonb_build_object('status','no_image'); end if;

 -- trava de idempotencia: so o primeiro chamador cria o rascunho
 insert into public.nisti_mural_ean_announcements_v1(product_id) values (p_product_id) on conflict do nothing;
 get diagnostics v_n=row_count;
 if v_n=0 then return jsonb_build_object('status','already'); end if;

 v_name:=coalesce(nullif(btrim(v_prod.nome),''),'Produto NISTI');
 if nullif(btrim(v_prod.variacao),'') is not null then v_name:=v_name||' - '||btrim(v_prod.variacao); end if;
 v_title:=left('Novo produto com EAN: '||v_name,90);
 insert into public.mural_posts(kind,status,title,subtitle,body,badge,badge_tone,notice_level,created_by)
 values ('notice','draft',v_title,
   'Já pode ser identificado pelo EAN',
   left('Este produto está com EAN cadastrado e pode ser identificado ao ler o código de barras. EAN: '||v_gtin||'.',700),
   'NOVO EAN','launch','info','sistema:ean-automatico')
 returning id into v_post;
 update public.nisti_mural_ean_announcements_v1 set post_id=v_post where product_id=p_product_id;
 return jsonb_build_object('status','created','post_id',v_post,'processed_image_key',v_img,'title',v_title);
end $fn$;
revoke all on function public.nisti_mural_ean_draft_v1(bigint,int) from public,anon,authenticated;
grant execute on function public.nisti_mural_ean_draft_v1(bigint,int) to service_role;
