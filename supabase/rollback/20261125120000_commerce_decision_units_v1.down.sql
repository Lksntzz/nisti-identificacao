-- GA-014 — REVERSÃO da migração 20261125120000_commerce_decision_units_v1.sql.
-- NÃO é uma migração (fica fora de supabase/migrations) e só deve ser executada manualmente, com autorização do dono.
-- A função é só leitura: não cria tabelas, colunas, views nem dados; nada mais depende dela. Remover a função é a reversão completa.
-- Se a aplicação (PR da Central de decisões) já estiver publicada, ela passa a mostrar "consulta indisponível" (falha fechada);
-- para voltar o menu ao estado anterior, reverter também a PR da aplicação.
drop function if exists public.commerce_decision_units_v1(text, date, date, date, date, integer);

-- Conferência depois de executar (deve devolver NULL):
--   select to_regprocedure('public.commerce_decision_units_v1(text,date,date,date,date,integer)');
