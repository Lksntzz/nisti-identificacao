# Supabase cutover — A2 D1 mutation inventory

Status: **Supabase primary authority released in production; compatibility-removal phase in progress**.

The application still contains D1 SQL as a temporary compatibility/recovery layer. With
`SUPABASE_READS_ENABLED=1` and `SUPABASE_WRITE_MODE=primary`, the active operational and
administrative paths listed below use Supabase as the authoritative database. The production write
freeze is released in production after the frozen smoke-test gate completed successfully.

## Direct Supabase-primary paths implemented

- Product create/update/delete, bulk product import, product image and finishes.
- Product GTIN link/unlink and GTIN scanner event writes.
- Product treatment review/approve/redo/failure, manual Mural treatment upload/reset and visual references.
- Product treatment queues, trained-reference diagnostics and cover-index diagnostics.
- Scanner occurrence create/train/dismiss, including reference embedding persistence.
- Recognition telemetry, recognition diagnostics, operator aggregates and operator rename.
- Geometric-shadow evidence create/link/confirm, confirmation lookup and Admin summary.
- User/admin notifications and notification read receipts.
- Push-subscription persistence and active subscription reads; D1 push logs are skipped in primary mode.
- Mural public read receipts and Mural Admin post/collection CRUD, images, metrics, readiness,
  product picker and Gemini reference packages.
- Reference reindex reads/writes.
- NISTI → Commerce synchronization now sources the authoritative NISTI product rows from Supabase.
- Direct product create/update/finish and bulk import trigger Commerce synchronization; primary product deletion removes stale Commerce links.
- System Metrics and System Health use Supabase as the primary database when Supabase reads are enabled.
- Gemini call budget uses Supabase in production; its D1 implementation remains only for explicit non-Supabase compatibility mode.
- Reference reindex is Supabase-only; scheduled maintenance no longer imports the legacy reserve backfill.
- Product finish edits are Supabase-only and continue synchronizing/reconciling Commerce.

## Remaining D1 code classification

`src/core-router.js` no longer contains D1 SQL; product, image, treatment, cover-reference, diagnostics and push-admin database paths are Supabase-only.\n\n`src/cover-notifications.js` and `src/web-push.js` no longer contain D1 SQL; notification reads/writes and push subscription storage use Supabase directly.\n\n`src/occurrences-router.js` no longer contains D1 SQL; occurrence creation, training, listing and dismissal use Supabase directly while R2 and Vectorize remain the image/vector stores.

| Module | D1 SQL still present | Primary-mode status |
| --- | --- | --- |
| `src/mural-router.js` | Mural compatibility reads/writes | active Mural Admin writes and reads have direct Supabase branches |
| `src/recognition-metrics.js` | legacy telemetry/read SQL | primary telemetry and reads are Supabase |
| `src/system-metrics-clean-router.js` | legacy D1 metrics/health path | Supabase-read mode uses Supabase-only database probes |
| `src/geometric-shadow-evidence-router.js` | legacy evidence/read SQL | active create/link/confirm/summary paths are Supabase |
| `src/gtin-router.js` | GTIN event/link/admin compatibility SQL | scanner events, GTIN link/unlink and admin dismissal are Supabase-primary |
| `src/geometric-shadow-confirmation-router.js` | legacy confirmation SQL | primary confirmation reads/writes are Supabase |
| `src/gemini-budget.js` | legacy D1 budget implementation | production uses Supabase with no automatic fallback; D1 is only for explicit non-Supabase compatibility mode |

## A2 completion invariants

1. Every JavaScript module containing D1 mutation SQL remains represented by the static inventory test.
2. No operational or administrative mutation may execute D1 when `SUPABASE_WRITE_MODE=primary`.
3. No primary database read requires D1 when `SUPABASE_READS_ENABLED=1`; the runtime emergency
   fallback/circuit-breaker code has been retired, so D1 cannot silently serve stale data.
4. Primary Supabase RPCs remain `SECURITY INVOKER`, server-only and executable only by `service_role`.
5. Frozen validation completed with green Production Gates and Supabase smoke reads for Scanner data, cadastro/Catálogo state, Mural, Admin health and Commerce synchronization.
6. Production sets `SUPABASE_CUTOVER_WRITE_FREEZE=0`; the D1 binding has been removed from the production Worker and survives only through `wrangler.d1-compat.toml`.
7. Controlled writes have been verified directly in Supabase; compatibility-removal is now the active phase.
8. D1 must not regain data authority without an explicit freeze, resynchronization and reconciliation procedure.

## Compatibility cleanup progress

The production runtime no longer contains D1 branches in `src/product-finish-router.js` or
`src/reference-reindex-router.js`. The scheduled Worker entry point
also no longer imports `src/supabase-reserve-backfill.js`; that module is retained only as a
recovery artifact while D1 remains preserved outside the production Worker.
