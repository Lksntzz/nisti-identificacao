# Supabase cutover — A2 D1 mutation inventory

Status: **primary-path migration complete; frozen validation passed; release candidate has writes enabled**.

The application still contains D1 SQL as a temporary compatibility/fallback layer. With
`SUPABASE_READS_ENABLED=1` and `SUPABASE_WRITE_MODE=primary`, the active operational and
administrative paths listed below use Supabase as the authoritative database. The production write
freeze remains enabled until the final frozen smoke-test gate is complete.

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
- Gemini call budget uses the Supabase atomic RPC while Supabase reads are authoritative.

## Remaining D1 code classification

| Module | D1 SQL still present | Primary-mode status |
| --- | --- | --- |
| `src/core-router.js` | product/catalog/reference/notification compatibility SQL | active primary product, image, reference and Admin diagnostic paths bypass D1 |
| `src/mural-router.js` | Mural compatibility reads/writes | active Mural Admin writes and reads have direct Supabase branches |
| `src/occurrences-router.js` | occurrence/training compatibility SQL | create/train/dismiss are direct Supabase-primary |
| `src/recognition-metrics.js` | legacy telemetry/read SQL | primary telemetry and reads are Supabase |
| `src/system-metrics-clean-router.js` | legacy D1 metrics/health path | Supabase-read mode uses Supabase-only database probes |
| `src/web-push.js` | compatibility subscriptions and D1-only debug logs | subscriptions are Supabase-primary; D1 logs are skipped in primary |
| `src/geometric-shadow-evidence-router.js` | legacy evidence/read SQL | active create/link/confirm/summary paths are Supabase |
| `src/gtin-router.js` | GTIN event/link/admin compatibility SQL | scanner events, GTIN link/unlink and admin dismissal are Supabase-primary |
| `src/geometric-shadow-confirmation-router.js` | legacy confirmation SQL | primary confirmation reads/writes are Supabase |
| `src/reference-reindex-router.js` | compatibility embedding SQL | primary pending-reference reads and embedding writes are Supabase |
| `src/product-finish-router.js` | compatibility product update | direct Supabase-primary branch executes before D1 |
| `src/cover-notifications.js` | compatibility notification SQL | primary notification writers/read receipts use Supabase |
| `src/gemini-budget.js` | emergency D1 budget fallback | intentional temporary fallback only for eligible Supabase transport/server failures |

## A2 completion invariants

1. Every JavaScript module containing D1 mutation SQL remains represented by the static inventory test.
2. No operational or administrative mutation may execute D1 when `SUPABASE_WRITE_MODE=primary`.
3. No primary database read should require D1 when `SUPABASE_READS_ENABLED=1`; D1 SQL may remain only
   as an explicit compatibility/emergency path during the confidence window.
4. Primary Supabase RPCs remain `SECURITY INVOKER`, server-only and executable only by `service_role`.
5. Frozen validation completed with green Production Gates and Supabase smoke reads for Scanner data, cadastro/Catálogo state, Mural, Admin health and Commerce synchronization.
6. The release candidate sets `SUPABASE_CUTOVER_WRITE_FREEZE=0`; the D1 binding is intentionally retained in the same release as a compatibility/rollback layer.
7. After writes are released, controlled writes must be verified directly in Supabase before the
   compatibility/fallback removal phase begins.
