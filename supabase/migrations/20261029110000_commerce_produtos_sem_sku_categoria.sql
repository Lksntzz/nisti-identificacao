-- Classifica pelo nome os produtos que não têm SKU cadastrado (e o DEVNP_CAP4 com "SKU:" colado).
with m(id, cat, sub) as (values
 (1388,'Planner','Planner Devocional'),
 (1407,'Planner','Planner da Noiva'),
 (1408,'Outros','Estojos'),(1409,'Outros','Estojos'),(1410,'Outros','Estojos'),(1411,'Outros','Estojos'),(1412,'Outros','Estojos'),(1413,'Outros','Estojos'),
 (1414,'Adesivos / Etiquetas','Adesivos Chá de Bebê'),
 (1399,'Outros','Kits e Combos'),
 (1400,'Caderno','Caderno de Discos'),
 (1401,'Outros','Kits e Combos'),(1402,'Outros','Kits e Combos'),(1403,'Outros','Kits e Combos'),(1404,'Outros','Kits e Combos'),(1405,'Outros','Kits e Combos'),(1406,'Outros','Kits e Combos'))
update public.commerce_products p set category_id=c.id, subcategory_id=sc.id, updated_at=now()
from m join public.commerce_categories c on c.name=m.cat
join public.commerce_subcategories sc on sc.category_id=c.id and sc.name=m.sub
where p.id=m.id and p.category_id is null;
insert into public.commerce_sku_category_v1(sku_norm, category_id, subcategory_id)
select 'DEVNPCAP4PXP', c.id, sc.id from public.commerce_categories c join public.commerce_subcategories sc on sc.category_id=c.id
where c.name='Planner' and sc.name='Planner Devocional' on conflict (sku_norm) do nothing;
