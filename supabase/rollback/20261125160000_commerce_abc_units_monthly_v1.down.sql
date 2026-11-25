-- GA-015 — reversão manual (fora de supabase/migrations; só aplicar se a função precisar sair).
-- A função não cria tabelas, colunas, views nem dados persistentes, e nada depende dela.
drop function if exists public.commerce_abc_units_monthly_v1(text, jsonb);
