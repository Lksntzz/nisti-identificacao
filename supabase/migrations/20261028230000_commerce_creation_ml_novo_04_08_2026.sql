-- Datas de cadastro informadas pelo usuário (04/08/2026) para anúncios exclusivos do Mercado Livre Novo.
insert into public.commerce_listing_creation_v1 (platform, external_listing_id, product_ref, title, created_on, source)
select 'ML', v.id, v.ref, v.title, date '2026-08-04', 'informado-pelo-usuario-2026-10-28'
from (values
  ('MLB5033568041','NOVO-0001','Caderneta Vacinação Menino - Versão Atualizada - Safari'),
  ('MLB7412780970','NOVO-0001','Caderneta Vacinação Menino - Versão Atualizada - Safari'),
  ('MLB7381293540','NOVO-0002','Caderneta Vacinação Menina - Rosa')
) v(id,ref,title)
where not exists (select 1 from public.commerce_listing_creation_v1 c where c.platform='ML' and c.external_listing_id=v.id);
