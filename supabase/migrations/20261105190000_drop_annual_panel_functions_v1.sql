-- Remove as funções SQL do painel "Comparação anual", retirado do GA no PR #839.
-- Nenhuma delas é chamada por outra função, view ou gatilho (conferido no banco antes de apagar).
-- Mantidas: commerce_annual_compare_v1, commerce_annual_compare_coverage_v1 (usada pelas telas de Categorias)
-- e commerce_annual_family_report_v1 (rotas de famílias ainda existem).
-- As definições originais continuam nas migrações anteriores do repositório.
drop function if exists public.commerce_annual_day_products_v1(text, date, date);
drop function if exists public.commerce_annual_days_v1(text, integer, integer, integer, integer);
drop function if exists public.commerce_annual_launches_v1(text, integer, integer);
drop function if exists public.commerce_annual_listing_insights_v1(text, integer, integer, integer, integer, text, text);
drop function if exists public.commerce_annual_listing_months_v1(text, integer, integer);
drop function if exists public.commerce_annual_month_health_v1(text, integer, integer, integer);
drop function if exists public.commerce_annual_month_listings_v1(text, integer, integer, integer, date, text, text, text, integer, integer);
drop function if exists public.commerce_annual_month_v1(text, integer, integer, integer);
drop function if exists public.commerce_annual_period_products_v1(text, date, date, date, date);
drop function if exists public.commerce_annual_seasonality_v1(text, integer, integer);
drop function if exists public.commerce_annual_window_v1(text, date, date, date, date);
