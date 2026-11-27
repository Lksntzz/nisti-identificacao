-- Reversão da GA-P02D: remove SOMENTE a função leve de cobertura. commerce_data_quality_v1 e a GA-011 não são tocadas.
drop function if exists public.commerce_data_quality_coverage_v1(text, date, date);
