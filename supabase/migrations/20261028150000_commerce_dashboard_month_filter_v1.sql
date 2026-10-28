-- Filtro "mes especifico" no dashboard comercial (GA): novo parametro p_month ('YYYY-MM', opcional).
-- Com mes: janela = mes civil (mes em andamento vai ate o ultimo dia fechado); comparacao = mes anterior
-- (mes em andamento compara com o mesmo numero de dias do mes anterior). Sem mes: comportamento identico ao atual.
-- So leitura. Reescreve as definicoes atuais por substituicao de texto com checagem (falha se algo nao casar).
create or replace function pg_temp.rep(t text, a text, b text) returns text language plpgsql as $f$
begin
  if position(a in t)=0 then raise exception 'TRECHO_NAO_ENCONTRADO: %', left(a,80); end if;
  return replace(t,a,b);
end $f$;

do $mig$
declare v text; fn text; oldargs text;
begin
  foreach fn in array array['commerce_dashboard_overview_v1','commerce_dashboard_v1'] loop
    select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=fn and pg_get_function_identity_arguments(p.oid)='p_platform text, p_days integer';
    if v is null then raise exception 'FUNCAO_NAO_ENCONTRADA %', fn; end if;
    v:=pg_temp.rep(v,'p_days integer DEFAULT 30)','p_days integer DEFAULT 30, p_month text DEFAULT NULL::text)');
    v:=pg_temp.rep(v,$q$ end days
), base as ($q$,$q$ end days,
         case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then (p_month||'-01')::date end ms
), base as ($q$);
    v:=pg_temp.rep(v,$q$from base
), win as ($q$,$q$from base
), wn as (
  select case when p.ms is not null then p.ms else r.last_day-p.days+1 end ws,
         case when p.ms is not null then least((p.ms+interval '1 month')::date-1,r.last_day) else r.last_day end we,
         case when p.ms is not null then (p.ms-interval '1 month')::date else r.last_day-2*p.days+1 end ps,
         case when p.ms is not null then least((p.ms-interval '1 month')::date+(least((p.ms+interval '1 month')::date-1,r.last_day)-p.ms),p.ms-1) else r.last_day-p.days end pe
  from params p cross join ref r
), win as ($q$);
    v:=pg_temp.rep(v,'from base b cross join params p cross join ref r','from base b cross join params p cross join ref r cross join wn w');
    v:=pg_temp.rep(v,'b.sale_date<=r.last_day-p.days and b.sale_date>r.last_day-2*p.days','b.sale_date between w.ps and w.pe');
    v:=pg_temp.rep(v,'b.sale_date>r.last_day-2*p.days','b.sale_date between w.ps and w.we');
    v:=pg_temp.rep(v,'b.sale_date>r.last_day-p.days','b.sale_date between w.ws and w.we');
    if fn='commerce_dashboard_overview_v1' then
      v:=pg_temp.rep(v,'(select count(distinct sale_date) from base,ref,params where sale_date>ref.last_day-params.days)',
        '(select count(distinct sale_date) from base,wn where sale_date between wn.ws and wn.we)');
    else
      v:=pg_temp.rep(v,$q$'days',(select case when days=36500 then 0 else days end from params),'all',(select days=36500 from params),$q$,
        $q$'days',(select case when ms is not null then (select we-ws+1 from wn) when days=36500 then 0 else days end from params),'all',(select days=36500 and ms is null from params),'month',(select to_char(ms,'YYYY-MM') from params),$q$);
      v:=pg_temp.rep(v,'(select greatest(first_day,last_day-days+1) from ref,params)','(select greatest(first_day,ws) from ref,wn)');
      v:=pg_temp.rep(v,'(select last_day-2*days+1 from ref,params)','(select ps from wn)');
      v:=pg_temp.rep(v,'(select first_day<=last_day-2*days+1 from ref,params)','(select first_day<=ps from ref,wn)');
    end if;
    execute v;
    execute format('drop function public.%I(text,integer)',fn);
    execute format('revoke all on function public.%I(text,integer,text) from public,anon,authenticated',fn);
    execute format('grant execute on function public.%I(text,integer,text) to service_role',fn);
  end loop;
end $mig$;
