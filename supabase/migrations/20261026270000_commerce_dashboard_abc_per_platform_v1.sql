-- Curva ABC por plataforma: a chave passa a ser plataforma + SKU e a classe (A/B/C)
-- é calculada dentro de cada plataforma. Somente leitura.
do $mig$
declare
  fn text;
  def text;
  oid_ oid;
  par text[];
  pairs text[];
begin
  foreach fn in array array['commerce_dashboard_v1','commerce_dashboard_segment_series_v1'] loop
    select p.oid into oid_ from pg_proc p where p.proname=fn and p.pronamespace='public'::regnamespace and p.pronargs>=2;
    if oid_ is null then raise exception 'funcao % nao encontrada', fn; end if;
    def := pg_get_functiondef(oid_);
    pairs := array[
      array[$a$select coalesce(sku,'ANÚNCIO '||external_listing_id) product_key,$a$, $b$select platform_code,coalesce(sku,'ANÚNCIO '||external_listing_id) product_key,$b$],
      array[$a$from lst where cur_rev>0 group by 1
), ranked as ($a$, $b$from lst where cur_rev>0 group by 1,2
), ranked as ($b$],
      array[$a$sum(revenue) over (order by revenue desc,product_key rows between unbounded preceding and 1 preceding) before_rev,$a$, $b$sum(revenue) over (partition by platform_code order by revenue desc,product_key rows between unbounded preceding and 1 preceding) before_rev,$b$],
      array[$a$sum(revenue) over () total_rev$a$, $b$sum(revenue) over (partition by platform_code) total_rev$b$]
    ];
    if fn='commerce_dashboard_v1' then
      pairs := pairs || array[
        array[$a$), tot as ($a$, $b$), cls_p as (
  select platform_code,cls,count(*) products,sum(units) units,sum(revenue) revenue,
    sum(revenue)/nullif(sum(sum(revenue)) over (partition by platform_code),0)*100 pct
  from abc group by 1,2
), tot as ($b$],
        array[$a$'items',coalesce((select jsonb_agg(jsonb_build_object('key',product_key,$a$, $b$'classes_by_platform',coalesce((select jsonb_object_agg(platform_code,cl) from (
      select platform_code,jsonb_agg(jsonb_build_object('class',cls,'products',products,'units',units,'revenue',round(revenue,2),'revenue_pct',round(pct,1)) order by cls) cl
      from cls_p group by platform_code) z),'{}'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('platform',platform_code,'key',product_key,$b$],
        array[$a$from (select * from abc order by revenue desc,product_key limit 120) x$a$, $b$from (select * from (select a.*,row_number() over (partition by platform_code order by revenue desc,product_key) rn from abc a) y where rn<=120) x$b$]
      ];
    else
      pairs := pairs || array[
        array[$a$select r.product_key,case$a$, $b$select r.platform_code,r.product_key,case$b$],
        array[$a$where a.product_key=coalesce(l.sku,'ANÚNCIO '||l.external_listing_id)$a$, $b$where a.platform_code=l.platform_code and a.product_key=coalesce(l.sku,'ANÚNCIO '||l.external_listing_id)$b$]
      ];
    end if;
    foreach par slice 1 in array pairs loop
      if position(par[1] in def)=0 then raise exception 'padrao nao encontrado em %: %', fn, left(par[1],60); end if;
      def := replace(def, par[1], par[2]);
    end loop;
    execute def;
  end loop;
end $mig$;
