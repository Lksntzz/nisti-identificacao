insert into public.commerce_sku_alias_v1(old_sku,new_sku,note) values ('CONFINGLOPP','CONFINGLOPXP','Caderno de gestão: código antigo CONFINGLOPP virou CONFIN_GLO_PXP')
on conflict (old_sku) do update set new_sku=excluded.new_sku,note=excluded.note;
