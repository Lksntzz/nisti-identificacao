# Supabase cutover — A2 D1 mutation inventory

Status: **Supabase is the production database authority; D1 is retained only as an explicit compatibility/recovery artifact.**

Production uses `SUPABASE_READS_ENABLED=1`, `SUPABASE_WRITE_MODE=primary` and
`SUPABASE_CUTOVER_WRITE_FREEZE=0`. The production Worker has no D1 binding.

## Current production architecture

- Product create/update/delete, bulk import, product images, finishes, GTIN operations, Mural operations, notifications and push subscriptions use Supabase as the authoritative database.
- R2 remains the product/editorial image store.
- Automatic camera-based visual recognition has been retired. Former identification endpoints fail explicitly instead of calling an external model.
- The occurrence training runtime and automatic reference reindex runtime have been removed.
- External Gemini/model runtime calls and model-budget code have been removed. Historical database artifacts are removed by forward migrations rather than by rewriting already-applied migrations.
- Mural product treatment remains operational without generative-model APIs. Contour processor v9 uses the official mask pipeline and manual editorial uploads remain available.
- System Health no longer treats the retired visual index or external-model quota as an operational dependency.
- Product finish edits remain Supabase-only and continue synchronizing/reconciling Commerce.
- `src/core-router.js`, `src/cover-notifications.js` and `src/web-push.js` contain no runtime D1 SQL.

## Remaining D1 compatibility SQL

The following modules still contain legacy D1 SQL for controlled recovery or historical compatibility.
Their active production operational and administrative paths use Supabase when the production
configuration above is enabled.

| Module | Compatibility SQL retained | Production authority |
| --- | --- | --- |
| `src/mural-router.js` | legacy Mural reads/writes | Supabase |
| `src/recognition-metrics.js` | historical telemetry/read compatibility | Supabase |
| `src/system-metrics-clean-router.js` | legacy D1 metrics/health branch | Supabase |
| `src/geometric-shadow-evidence-router.js` | legacy evidence/read SQL | Supabase |
| `src/gtin-router.js` | GTIN event/link/admin compatibility SQL | Supabase |
| `src/geometric-shadow-confirmation-router.js` | legacy confirmation SQL | Supabase |

## A2 invariants

1. Every JavaScript module containing D1 mutation SQL remains represented by the static inventory test.
2. No operational or administrative mutation may execute D1 when `SUPABASE_WRITE_MODE=primary`.
3. No primary database read requires D1 when `SUPABASE_READS_ENABLED=1`.
4. Primary Supabase RPCs remain server-only, `SECURITY INVOKER`, and restricted to `service_role`.
5. D1 must not regain data authority without an explicit write freeze, current-data resynchronization and reconciliation.
6. Historical migrations remain immutable; production schema changes are performed with forward migrations.
7. Removed visual-recognition/model endpoints must fail closed and must never silently reactivate an external-model integration.

## Recovery posture

The legacy D1 database and `wrangler.d1-compat.toml` are preserved only for controlled recovery.
The scheduled production Worker performs no visual-reference reindex or reserve backfill. Any future
D1 recovery requires a deliberate authority switch after data resynchronization and validation.
