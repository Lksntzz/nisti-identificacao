-- Final BB (sem referência do tassel) e final BXB são o mesmo produto.
-- Mecanismo oficial de unificação: commerce_sku_alias_v1 (usado por commerce_sku_canon_v1). Não altera vendas.
insert into public.commerce_sku_alias_v1 (old_sku, new_sku, note) values
 ('CONFINCOLBB','CONFINCOLBXB','Planner Minhas Contas Organizadas: código antigo BB é o mesmo produto do BXB'),
 ('CONFINBCOBB','CONFINBCOBXB','Caderno Minhas Contas Organizadas: código antigo BB é o mesmo produto do BXB')
on conflict do nothing;
