-- Preço médio vendido por produto no mês: receita de produtos nas listas "mais cresceram" e "mais caíram" (campeões já tinham).
do $do$
declare oid_ oid; def text;
begin
  select p.oid into oid_ from pg_proc p where p.proname='commerce_annual_month_v1' and p.pronamespace='public'::regnamespace;
  def := pg_get_functiondef(oid_);
  if position($a$'base',bu,'links'$a$ in def)=0 then raise exception 'padrao nao encontrado'; end if;
  def := replace(def, $a$'base',bu,'links'$a$, $b$'base',bu,'cur_rev',cr,'base_rev',br,'links'$b$);
  execute def;
end $do$;
