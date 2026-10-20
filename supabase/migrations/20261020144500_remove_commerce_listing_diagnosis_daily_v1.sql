-- Migration history is immutable; disable the unused read-only RPC from PR #547.
-- Does not touch listings, sales, SKUs, scanner, or stored traffic reports.
drop function if exists public.commerce_listing_diagnosis_daily_v1(bigint,date,date,text);
