-- Final PP e final PXP são o mesmo produto (Caderno Meu Controle Financeiro). Não altera vendas.
insert into public.commerce_sku_alias_v1 (old_sku, new_sku, note) values
 ('CONFINMOEPP','CONFINMOEPXP','Caderno Meu Controle Financeiro: código antigo PP é o mesmo produto do PXP')
on conflict do nothing;
