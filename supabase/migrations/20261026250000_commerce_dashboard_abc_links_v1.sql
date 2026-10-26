-- Somente leitura. Curva ABC: cada produto (SKU) passa a trazer 'links' = anuncios que venderam no periodo (plataforma, id, unidades, faturamento).
-- Reescreve a funcao existente por substituicao de texto; falha (sem alterar nada) se algum trecho nao for encontrado.
do $$ declare d text; n text;
begin
 d:=pg_get_functiondef('public.commerce_dashboard_v1(text,integer)'::regprocedure);
 n:=replace(d,'count(*) filter (where cur_units>0) listings','count(*) filter (where cur_units>0) listings,'||chr(10)||'    jsonb_agg(jsonb_build_object(''platform'',platform_code,''external_id'',external_listing_id,''units'',cur_units,''revenue'',round(cur_rev,2)) order by cur_rev desc) filter (where cur_units>0) links');
 if n=d then raise exception 'padrao 1'; end if; d:=n;
 n:=replace(d,'''revenue'',round(revenue,2),''listings'',listings,''cum_pct''','''revenue'',round(revenue,2),''listings'',listings,''links'',coalesce(links,''[]''::jsonb),''cum_pct''');
 if n=d then raise exception 'padrao 2'; end if;
 execute n;
end $$;
