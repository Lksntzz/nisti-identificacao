-- Reversão da GA-P02C: remove SOMENTE a v3. A v2 e o cache não são tocados.
drop function if exists public.commerce_categories_v3(text,integer,text,integer,integer);
delete from public.commerce_read_cache_v1 where cache_key like 'commerce_categories_v3|%';
