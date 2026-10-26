-- Somente leitura. Em 'stopped': inclui last_sale, sobe o limite de 10 para 200 e adiciona 'stopped_total' (contagem real).
-- Reescreve a funcao existente por substituicao de texto; falha (sem alterar nada) se algum trecho nao for encontrado.
do $$ declare d text; n text;
begin
 d:=pg_get_functiondef('public.commerce_dashboard_overview_v1(text,integer)'::regprocedure);
 n:=replace(d,'''title'',title,''units_previous'',prev_units,''revenue_previous'',round(prev_rev,2)) order by prev_rev desc)','''title'',title,''units_previous'',prev_units,''revenue_previous'',round(prev_rev,2),''last_sale'',last_sale) order by prev_rev desc)');
 if n=d then raise exception 'padrao 1'; end if; d:=n;
 n:=replace(d,'from (select * from lst where listing_status=''ACTIVE'' and cur_units=0 and prev_units>=3 order by prev_rev desc limit 10) x','from (select l.*,h.last_sale from lst l left join hist h on h.platform_code=l.platform_code and h.external_listing_id=l.external_listing_id where l.listing_status=''ACTIVE'' and l.cur_units=0 and l.prev_units>=3 order by l.prev_rev desc limit 200) x');
 if n=d then raise exception 'padrao 2'; end if; d:=n;
 n:=replace(d,'  ''unlinked'',jsonb_build_object(','  ''stopped_total'',(select count(*) from lst where listing_status=''ACTIVE'' and cur_units=0 and prev_units>=3),'||chr(10)||'  ''unlinked'',jsonb_build_object(');
 if n=d then raise exception 'padrao 3'; end if;
 execute n;
end $$;
