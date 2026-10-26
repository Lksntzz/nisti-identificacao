-- Dashboard: ignora o dia corrente (ainda incompleto) para que a janela "atual"
-- termine no último dia fechado (fuso America/Sao_Paulo). Somente leitura.
do $$
declare
  fn text;
  def text;
  novo text;
  alvo constant text := E'where p.plat=''TODAS'' or v.platform_code=p.plat\n';
  subst constant text := E'where (p.plat=''TODAS'' or v.platform_code=p.plat)\n    and v.sale_date < (now() at time zone ''America/Sao_Paulo'')::date\n';
  oid_ oid;
begin
  foreach fn in array array['commerce_dashboard_v1','commerce_dashboard_series_v1','commerce_dashboard_overview_v1','commerce_dashboard_segment_series_v1'] loop
    select p.oid into oid_ from pg_proc p
      where p.proname=fn and p.pronamespace='public'::regnamespace and p.pronargs>=2;
    if oid_ is null then raise exception 'funcao % nao encontrada', fn; end if;
    def := pg_get_functiondef(oid_);
    if position(alvo in def)=0 then raise exception 'padrao nao encontrado em %', fn; end if;
    novo := replace(def, alvo, subst);
    execute novo;
  end loop;
end $$;
