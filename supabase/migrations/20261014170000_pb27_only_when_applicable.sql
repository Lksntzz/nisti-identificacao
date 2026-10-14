-- A universal SKU may describe AG, PL, CA and other miolos, not only PB.
-- Do not classify other product families as invalid or in need of PB27 review.
do $fix$
declare v_definition text;
begin
 v_definition := pg_get_functiondef('public.commerce_catalog_year_targets_v1(bigint)'::regprocedure);
 if position('then ''MANUAL_REVIEW''' in v_definition)=0 then
   raise exception 'Unexpected PB27 classification function: no compatible clause';
 end if;
 v_definition := replace(v_definition,
   'when upper(s.sku) !~ ''^PB(25|26)($|_)'' then ''MANUAL_REVIEW''',
   'when upper(s.sku) !~ ''^PB(25|26)($|_)'' then ''NOT_APPLICABLE''');
 if position('then ''NOT_APPLICABLE''' in v_definition)=0 then
   raise exception 'PB27 classification clause did not update';
 end if;
 execute v_definition;
end
$fix$;
