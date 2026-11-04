-- Agenda Planner do Professor: final BB é o mesmo produto do BXB. Não altera vendas.
insert into public.commerce_sku_alias_v1 (old_sku, new_sku, note) values
 ('PNJPROFLZBB','PNJPROFLZBXB','Agenda Planner do Professor: código antigo BB é o mesmo produto do BXB')
on conflict do nothing;
-- Também removidas (a pedido, com backup em bak_product_skus_confin_alias_20261104): as linhas
-- CONFIN_COL_BB e CONFIN_BCO_BB de commerce_product_skus, cadastradas por engano; o alias correto fica em commerce_sku_alias_v1.
