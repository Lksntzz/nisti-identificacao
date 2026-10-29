-- Produtos do mês: top 10 que mais cresceram/caíram (com categoria) e total do mês para calcular o peso de cada produto.
do $do$
declare oid_ oid; def text;
begin
  select p.oid into oid_ from pg_proc p where p.proname='commerce_annual_month_v1' and p.pronamespace='public'::regnamespace;
  def := pg_get_functiondef(oid_);
  if position($a$r_up<=5 and d>0$a$ in def)=0 or position($b$r_dn<=5 and d<0$b$ in def)=0 then raise exception 'padrao nao encontrado'; end if;
  def := replace(def, 'r_up<=5 and d>0', 'r_up<=10 and d>0');
  def := replace(def, 'r_dn<=5 and d<0', 'r_dn<=10 and d<0');
  def := replace(def, $x$jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu) order by r_up$x$, $x$jsonb_build_object('sku',sku,'name',pname,'category',cname,'cur',cu,'base',bu) order by r_up$x$);
  def := replace(def, $x$jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu) order by r_dn$x$, $x$jsonb_build_object('sku',sku,'name',pname,'category',cname,'cur',cu,'base',bu) order by r_dn$x$);
  def := replace(def, $x$'top',case when$x$, $x$'month_total',(select jsonb_build_object('cur',coalesce(sum(cu),0),'base',coalesce(sum(bu),0)) from skus),'top',case when$x$);
  execute def;
end $do$;
