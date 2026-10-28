-- Cadastro de anúncios por mês: data de criação do anúncio (informada pela planilha "Análise de Anúncios Nisti Print").
-- Uma linha por item do banco (código do anúncio). O produto agrupa os itens (ex.: vários MLB do mesmo catálogo).
create table if not exists public.commerce_listing_creation_v1 (
  platform text not null check (platform in ('SHOPEE','ML')),
  external_listing_id text not null,
  product_ref text not null,
  title text not null,
  created_on date not null,
  source text not null default 'planilha-analise-anuncios',
  updated_at timestamptz not null default now(),
  primary key (platform, external_listing_id)
);
create index if not exists commerce_listing_creation_v1_month_idx on public.commerce_listing_creation_v1 (created_on);
alter table public.commerce_listing_creation_v1 enable row level security;
revoke all on public.commerce_listing_creation_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.commerce_listing_creation_v1 to service_role;

insert into public.commerce_listing_creation_v1 (platform, external_listing_id, product_ref, title, created_on) values
  ('SHOPEE','57807706007','PROD-0001','Caderneta de Vacinação Menino Personalizado Coleção Príncipe Urso',date '2026-03-25'),
  ('SHOPEE','49657790147','PROD-0002','Caderneta De Vacinação Menino Personalizada com Nome Capa Dura Versão Atualizada',date '2026-03-26'),
  ('SHOPEE','55407766548','PROD-0002','Caderneta De Vacinação Menino Personalizada com Nome Capa Dura Versão Atualizada',date '2026-03-26'),
  ('SHOPEE','40229566139','PROD-0010','Nisti Print Caderno De Anotações Capa Dura Coleção Jardim',date '2026-03-27'),
  ('SHOPEE','55157825048','PROD-0010','Nisti Print Caderno De Anotações Capa Dura Coleção Jardim',date '2026-03-27'),
  ('SHOPEE','55507809925','PROD-0010','Nisti Print Caderno De Anotações Capa Dura Coleção Jardim',date '2026-03-27'),
  ('SHOPEE','55957809990','PROD-0010','Nisti Print Caderno De Anotações Capa Dura Coleção Jardim',date '2026-03-27'),
  ('SHOPEE','45957991040','PROD-0003','Caderneta De Vacinação Menina  Capa Dura Versão Atualizada Encanto Rosé',date '2026-03-30'),
  ('SHOPEE','48558047281','PROD-0004','Caderneta De Vacinação Menino Capa Dura Versão Atualizada',date '2026-03-31'),
  ('SHOPEE','41830043442','PROD-0009','NISTI PRINT | CADERNO DEVOCIONAL PLANNER ESTUDO DIÁRIO DA BÍBLIA COM CAPA DURA',date '2026-04-14'),
  ('SHOPEE','48308843154','PROD-0008','Caderno de Receitas Com Capa Dura - Coleção - Capivara',date '2026-04-14'),
  ('SHOPEE','53458818736','PROD-0007','Nisti Print Caderno De Anotações Capa Dura Coleção Capivara',date '2026-04-14'),
  ('SHOPEE','41380126507','PROD-0006','Caderneta de Vacinação Menina Personalizado C/ Nome - Jardim Encantado',date '2026-04-16'),
  ('SHOPEE','44708989031','PROD-0005','Caderneta de Vacinação Menina Personalizado C/ nome',date '2026-04-16'),
  ('SHOPEE','55659179953','PROD-0011','Agenda Permanente Shine - Organize Sua Rotina C/ Estilo e Qualidade',date '2026-04-20'),
  ('SHOPEE','53959770238','PROD-0027','Nisti Print Caderno Planner Devocional Com Capa Dura Coleção Propósito',date '2026-04-30'),
  ('SHOPEE','55059763337','PROD-0026','Caderno Planner Devocional Com Capa Dura Jardim Da Fé',date '2026-04-30'),
  ('ML','MLB4790258101','PROD-0025','Nisti Print Caderno Scrapbook Para Colagem de Fotos Capa Dura',date '2026-06-05'),
  ('ML','MLB4790268523','PROD-0025','Nisti Print Caderno Scrapbook Para Colagem de Fotos Capa Dura',date '2026-06-05'),
  ('ML','MLB6984238588','PROD-0025','Nisti Print Caderno Scrapbook Para Colagem de Fotos Capa Dura',date '2026-06-05'),
  ('SHOPEE','53662012592','PROD-0017','Caderneta de Vacinação Menino Personalizado Coleção Linho',date '2026-06-10'),
  ('SHOPEE','56262008605','PROD-0016','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Safari',date '2026-06-10'),
  ('ML','MLB4794270403','PROD-0022','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Bosque Encantado',date '2026-06-18'),
  ('ML','MLB4819062093','PROD-0018','Nisti Print Caderno De Controle Financeiro - Planeje Controle Realize',date '2026-06-18'),
  ('ML','MLB4819075051','PROD-0018','Nisti Print Caderno De Controle Financeiro - Planeje Controle Realize',date '2026-06-18'),
  ('ML','MLB4819075513','PROD-0018','Nisti Print Caderno De Controle Financeiro - Planeje Controle Realize',date '2026-06-18'),
  ('ML','MLB4819075515','PROD-0018','Nisti Print Caderno De Controle Financeiro - Planeje Controle Realize',date '2026-06-18'),
  ('ML','MLB4832230989','PROD-0022','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Bosque Encantado',date '2026-06-18'),
  ('ML','MLB4832481207','PROD-0023','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Jardim Boutique',date '2026-06-18'),
  ('ML','MLB6997846822','PROD-0023','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Jardim Boutique',date '2026-06-18'),
  ('ML','MLB6999091968','PROD-0024','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Pequeno Encanto',date '2026-06-18'),
  ('ML','MLB6999141340','PROD-0024','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Pequeno Encanto',date '2026-06-18'),
  ('ML','MLB6999141342','PROD-0024','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Pequeno Encanto',date '2026-06-18'),
  ('ML','MLB7046050474','PROD-0018','Nisti Print Caderno De Controle Financeiro - Planeje Controle Realize',date '2026-06-18'),
  ('ML','MLB7070652172','PROD-0024','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Pequeno Encanto',date '2026-06-18'),
  ('ML','MLB7071171668','PROD-0024','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Pequeno Encanto',date '2026-06-18'),
  ('ML','MLB7071178856','PROD-0024','Nisti Print Caderneta De Vacinação Menina Personalizada C/ Nome - Pequeno Encanto',date '2026-06-18'),
  ('ML','MLB7041443052','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('ML','MLB7041450608','PROD-0021','Nisti Print Caderno De Controle Financeiro - Black Finance',date '2026-06-22'),
  ('ML','MLB7041456000','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('ML','MLB7041469146','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('ML','MLB7041470080','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('ML','MLB7041470082','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('ML','MLB7041476912','PROD-0021','Nisti Print Caderno De Controle Financeiro - Black Finance',date '2026-06-22'),
  ('ML','MLB7041476914','PROD-0021','Nisti Print Caderno De Controle Financeiro - Black Finance',date '2026-06-22'),
  ('ML','MLB7085246768','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('ML','MLB7116007078','PROD-0037','Caderno De Controle Financeiro - Conquista Financeira',date '2026-06-22'),
  ('SHOPEE','41831964761','PROD-0015','Nisti Print Caderno De Anotações Personalizado Com Folhas Pautadas - Laços e Cerejas',date '2026-06-22'),
  ('SHOPEE','52962626954','PROD-0014','Nisti Print Caderneta De Vacinação Personalizada com Nome - Jardim Das Fadas',date '2026-06-22'),
  ('SHOPEE','28845094238','PROD-0012','Nisti Print Caderno De Discos Folhas Reposicionáveis Capa Dura - Caramelo',date '2026-06-23'),
  ('ML','MLB4819054771','PROD-0021','Nisti Print Caderno De Controle Financeiro - Black Finance',date '2026-06-26'),
  ('ML','MLB7058529064','PROD-0020','Nisti Print Caderno De Controle Financeiro - Planejamento Pessoal',date '2026-06-29'),
  ('ML','MLB7059034814','PROD-0020','Nisti Print Caderno De Controle Financeiro - Planejamento Pessoal',date '2026-06-29'),
  ('ML','MLB7059034816','PROD-0020','Nisti Print Caderno De Controle Financeiro - Planejamento Pessoal',date '2026-06-29'),
  ('ML','MLB4861757373','PROD-0029','Caderneta de Vacinação Menino Personalizado Coleção Minimalista Azul',date '2026-06-30'),
  ('ML','MLB4865635083','PROD-0029','Caderneta de Vacinação Menino Personalizado Coleção Minimalista Azul',date '2026-06-30'),
  ('ML','MLB4865635087','PROD-0029','Caderneta de Vacinação Menino Personalizado Coleção Minimalista Azul',date '2026-06-30'),
  ('ML','MLB7069472346','PROD-0029','Caderneta de Vacinação Menino Personalizado Coleção Minimalista Azul',date '2026-06-30'),
  ('ML','MLB7069472348','PROD-0029','Caderneta de Vacinação Menino Personalizado Coleção Minimalista Azul',date '2026-06-30'),
  ('ML','MLB7069526028','PROD-0030','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Minimalista Verde',date '2026-06-30'),
  ('ML','MLB7069526030','PROD-0030','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Minimalista Verde',date '2026-06-30'),
  ('ML','MLB7069654840','PROD-0030','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Minimalista Verde',date '2026-06-30'),
  ('ML','MLB7616015006','PROD-0030','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Minimalista Verde',date '2026-06-30'),
  ('ML','MLB7630585692','PROD-0029','Caderneta de Vacinação Menino Personalizado Coleção Minimalista Azul',date '2026-06-30'),
  ('ML','MLB4836812253','PROD-0028','Caderneta de Vacinação Menino Personalizado Com Nome',date '2026-07-01'),
  ('ML','MLB4836915885','PROD-0028','Caderneta de Vacinação Menino Personalizado Com Nome',date '2026-07-01'),
  ('ML','MLB4880878901','PROD-0031','Caderno Diário de Leitura - Leitura Encantada',date '2026-07-01'),
  ('ML','MLB7079097812','PROD-0031','Caderno Diário de Leitura - Leitura Encantada',date '2026-07-01'),
  ('ML','MLB7079097814','PROD-0031','Caderno Diário de Leitura - Leitura Encantada',date '2026-07-01'),
  ('ML','MLB7079266654','PROD-0031','Caderno Diário de Leitura - Leitura Encantada',date '2026-07-01'),
  ('ML','MLB4865470155','PROD-0033','Nisti Print Caderneta de Vacinação Menina C/ Nome - Jardim Encantado',date '2026-07-08'),
  ('ML','MLB4865622851','PROD-0032','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Minimalista Cinza',date '2026-07-08'),
  ('ML','MLB4871134969','PROD-0032','Nisti Print Caderneta de Vacinação Menino Personalizado Coleção Minimalista Cinza',date '2026-07-08'),
  ('ML','MLB4887832833','PROD-0036','Nisti Print Caderneta De Vacina Personalizado Com Nome Menina Borboleta',date '2026-07-13'),
  ('ML','MLB4894665525','PROD-0038','Nisti Print Caderneta De Vacinação Safari Personalizado Capa Dura',date '2026-07-14'),
  ('ML','MLB5113628183','PROD-0039','Nisti Print Caderneta De Vacinação Personalizado Capa Dura Atulizado',date '2026-07-15'),
  ('ML','MLB7176793922','PROD-0039','Nisti Print Caderneta De Vacinação Personalizado Capa Dura Atulizado',date '2026-07-15'),
  ('ML','MLB7176814996','PROD-0039','Nisti Print Caderneta De Vacinação Personalizado Capa Dura Atulizado',date '2026-07-15'),
  ('SHOPEE','43882926550','PROD-0040','Nisti Print Caderneta Da Gestante Personalizado Com Nome Atualizado 2026',date '2026-07-23'),
  ('SHOPEE','47465115879','PROD-0041','Caderneta Da Gestante Personalizado Com Nome - Jardim Encantado',date '2026-07-30'),
  ('SHOPEE','58115140767','PROD-0042','Caderneta De Vacinação Menino Personalizada com Nome Capa Dura Versão Atualizada',date '2026-07-30'),
  ('ML','MLB4974549257','PROD-0043','Caderneta de Vacinação Menino Personalizado - Listrado',date '2026-07-31'),
  ('ML','MLB4976458315','PROD-0047','Agenda Diária 2027 Capa Dura Negócios e Organização Pessoal',date '2026-07-31'),
  ('ML','MLB7301706214','PROD-0043','Caderneta de Vacinação Menino Personalizado - Listrado',date '2026-07-31'),
  ('ML','MLB7301719104','PROD-0043','Caderneta de Vacinação Menino Personalizado - Listrado',date '2026-07-31'),
  ('ML','MLB7304667048','PROD-0047','Agenda Diária 2027 Capa Dura Negócios e Organização Pessoal',date '2026-07-31'),
  ('ML','MLB7304667050','PROD-0047','Agenda Diária 2027 Capa Dura Negócios e Organização Pessoal',date '2026-07-31'),
  ('SHOPEE','43633164130','PROD-0044','Nisti Print Caderneta de Vacinação Menino Atualizado Verde - Fosco',date '2026-07-31'),
  ('SHOPEE','43983164609','PROD-0045','Nisti Print Agenda Executiva 2027 Capa Dura Diária Anual',date '2026-07-31'),
  ('SHOPEE','48165239366','PROD-0046','Caderno 2027 De Anotações - 200 Pág. - Carbono',date '2026-07-31'),
  ('ML','MLB7330315116','PROD-0050','Agenda Executiva Personalizado 2027 Capa Dura Diária Anual',date '2026-08-04'),
  ('SHOPEE','42681481989','PROD-0049','Caderno Planner Devocional Masculino 200 Pag  Coleção Fé',date '2026-08-04'),
  ('SHOPEE','53215423653','PROD-0051','Agenda 2027 Personalizada Capa Dura Diária Anual Edição Executiva',date '2026-08-04'),
  ('SHOPEE','55565431106','PROD-0048','Agenda Executiva 2027 Capa Dura Diária Anual Personalizada',date '2026-08-04'),
  ('SHOPEE','51315570756','PROD-0052','Agenda Manicure 2027 Pedicure Agendamentos com Pagamento',date '2026-08-06'),
  ('ML','MLB5015365555','PROD-0054','Agenda Manicure 2027 Agendamentos com Pagamento - ROSE',date '2026-08-07'),
  ('ML','MLB5015365557','PROD-0054','Agenda Manicure 2027 Agendamentos com Pagamento - ROSE',date '2026-08-07'),
  ('ML','MLB7358153106','PROD-0053','genda Manicure 2027 Agendamentos com Pagamento - VINHO',date '2026-08-07'),
  ('ML','MLB7358165818','PROD-0053','genda Manicure 2027 Agendamentos com Pagamento - VINHO',date '2026-08-07')
on conflict (platform, external_listing_id) do update
  set product_ref=excluded.product_ref, title=excluded.title, created_on=excluded.created_on, updated_at=now();

-- Desempenho desde o cadastro, por mês de criação. Somente leitura, apenas service_role.
create or replace function public.commerce_listing_cohorts_v1(p_platform text default 'TODAS')
returns jsonb
language sql
stable
set search_path to 'public'
as $f$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML') then upper(p_platform) else 'TODAS' end plat,
         (now() at time zone 'America/Sao_Paulo')::date today
), sales as (
  select v.external_listing_id, v.sale_date, v.units, v.product_revenue
  from public.commerce_current_sales_listing_daily_v1 v, params p where v.sale_date < p.today
), lastday as (select max(sale_date) d from sales),
prod as (
  select c.platform, c.product_ref, min(c.created_on) created_on, (array_agg(c.title order by c.created_on, c.external_listing_id))[1] title,
         count(*) items
  from public.commerce_listing_creation_v1 c, params p
  where p.plat='TODAS' or c.platform=p.plat
  group by c.platform, c.product_ref
), agg as (
  select pr.platform, pr.product_ref, pr.title, pr.created_on, pr.items,
    (select d from lastday) - pr.created_on + 1 age_days,
    coalesce(sum(s.units),0) units, coalesce(sum(s.product_revenue),0) revenue,
    min(s.sale_date) first_sale,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 7),0) u7,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 14),0) u14,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 28),0) u28,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 56),0) u56,
    coalesce(sum(s.units) filter (where s.sale_date > (select d from lastday) - 28),0) u_last28
  from prod pr
  left join public.commerce_listing_creation_v1 ci on ci.platform=pr.platform and ci.product_ref=pr.product_ref
  left join sales s on s.external_listing_id=ci.external_listing_id
  group by pr.platform, pr.product_ref, pr.title, pr.created_on, pr.items
)
select jsonb_build_object(
  'platform',(select plat from params),
  'last_day',(select d from lastday),
  'months',coalesce((select jsonb_agg(m order by m->>'month') from (
    select jsonb_build_object('month',date_trunc('month',created_on)::date,
      'products',count(*),'units',sum(units),'revenue',round(sum(revenue),2),
      'items',jsonb_agg(jsonb_build_object(
        'platform',platform,'product_ref',product_ref,'title',title,'created_on',created_on,'age_days',age_days,'listings',items,
        'units',units,'revenue',round(revenue,2),
        'days_to_first_sale',case when first_sale is null then null else first_sale-created_on end,
        'u7',case when age_days>=7 then u7 end,'u14',case when age_days>=14 then u14 end,
        'u28',case when age_days>=28 then u28 end,'u56',case when age_days>=56 then u56 end,
        'u_last28',u_last28) order by created_on, units desc)) m
    from agg group by date_trunc('month',created_on)) t),'[]'::jsonb));
$f$;
revoke all on function public.commerce_listing_cohorts_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v1(text) to service_role;
