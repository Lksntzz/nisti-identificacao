-- Filtro de ano no Dashboard: p_month aceita 'YYYY' (ano inteiro, ou acumulado até a última data importada no ano corrente)
-- e compara com o ano anterior pelo mesmo número de dias. Patch via pg_get_functiondef nas 3 funções:
-- commerce_dashboard_v1, commerce_dashboard_overview_v1, commerce_dashboard_series_v2.
-- params ganha a coluna "span" (interval '1 month' ou '1 year') e todas as janelas passam a usar p.span.
do $do$
declare r record; def text; nd text; n int := 0;
  pat text := $p$case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then (p_month||'-01')::date end ms$p$;
  rep text := $p$case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then (p_month||'-01')::date when p_month ~ '^20[0-9]{2}$' then make_date(p_month::int,1,1) end ms,
         case when p_month ~ '^20[0-9]{2}$' then interval '1 year' else interval '1 month' end span$p$;
begin
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace='public'::regnamespace
           and p.proname in ('commerce_dashboard_v1','commerce_dashboard_overview_v1','commerce_dashboard_series_v2') loop
    def := pg_get_functiondef(r.oid);
    if position(pat in def)=0 then continue; end if;
    nd := replace(def, pat, '@@MS@@');
    nd := replace(nd, 'interval ''1 month''', 'p.span');
    nd := replace(nd, '@@MS@@', rep);
    if position('p.span' in nd)=0 then raise exception 'janela nao alterada em %', r.proname; end if;
    execute nd; n := n+1;
  end loop;
  if n <> 3 then raise exception 'esperava 3 funcoes, atualizou %', n; end if;
end $do$;
