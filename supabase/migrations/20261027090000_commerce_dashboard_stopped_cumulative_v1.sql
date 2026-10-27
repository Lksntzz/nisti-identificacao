-- "Pararam de vender" passa a ser cumulativo: anúncio ATIVO com 3+ unidades vendidas no histórico
-- e nenhuma venda no período do filtro (7/30/60/90 dias). Quem está parado há mais tempo continua na lista
-- dos filtros menores. Somente leitura.
do $mig$
declare
  def text; oid_ oid; s int; e int; novo text;
begin
  select p.oid into oid_ from pg_proc p where p.proname='commerce_dashboard_overview_v1' and p.pronamespace='public'::regnamespace and p.pronargs>=2;
  if oid_ is null then raise exception 'overview nao encontrada'; end if;
  def := pg_get_functiondef(oid_);
  s := position($a$'stopped',coalesce((select$a$ in def);
  e := position($a$'unlinked',jsonb_build_object($a$ in def);
  if s=0 or e=0 or e<=s then raise exception 'marcadores nao encontrados'; end if;
  novo := $b$'stopped',coalesce((select jsonb_agg(jsonb_build_object('listing_id',x.id,'platform',x.src,'external_id',x.external_listing_id,
      'title',x.title,'units_ever',x.total_units,'revenue_ever',round(x.total_rev,2),'last_sale',x.last_sale,
      'days_since',(select last_day from ref)-x.last_sale) order by x.last_sale desc,x.total_units desc,x.id desc)
      from (select c.id,c.src,c.external_listing_id,l.title,h.last_sale,h.total_units,h.total_rev from cat c
            join active_sales a on a.id=c.id join public.commerce_listings l on l.id=c.id
            join hist h on h.platform_code=c.src and h.external_listing_id=c.external_listing_id
            where c.listing_status='ACTIVE' and a.cur_units=0 and h.total_units>=3
            order by h.last_sale desc,h.total_units desc,c.id desc limit 300) x),'[]'::jsonb),
  'stopped_total',(select count(*) from cat c join active_sales a on a.id=c.id
      join hist h on h.platform_code=c.src and h.external_listing_id=c.external_listing_id
      where c.listing_status='ACTIVE' and a.cur_units=0 and h.total_units>=3),
  $b$;
  def := left(def,s-1)||novo||substr(def,e);
  if position($a$sum(b.units) total_units$a$ in def)=0 then raise exception 'hist nao encontrado'; end if;
  def := replace(def,$a$sum(b.units) total_units$a$,$b$sum(b.units) total_units,sum(b.product_revenue) total_rev$b$);
  execute def;

  select p.oid into oid_ from pg_proc p where p.proname='commerce_dashboard_segment_series_v1' and p.pronamespace='public'::regnamespace and p.pronargs>=2;
  if oid_ is null then raise exception 'segment nao encontrada'; end if;
  def := pg_get_functiondef(oid_);
  if position($a$l.cur_units=0 and l.prev_units>=3)$a$ in def)=0 then raise exception 'padrao stopped nao encontrado'; end if;
  def := replace(def,$a$l.cur_units=0 and l.prev_units>=3)$a$,$b$l.cur_units=0
          and (select coalesce(sum(h.units),0) from base h where h.platform_code=l.platform_code and h.external_listing_id=l.external_listing_id)>=3)$b$);
  execute def;
end $mig$;
