# Supabase cutover — A2 D1 mutation inventory

Status: **in progress**. This inventory is intentionally conservative: a mutation stays listed until the
Supabase-primary path bypasses D1 or the route is explicitly retired.

## Direct Supabase-primary paths already implemented

- Product create/update/delete, bulk products, product image and finishes.
- Product GTIN link/unlink.
- Product treatment review/approve/redo/failure and visual references.
- New-cover notifications.
- Scanner GTIN event writes and Mural read receipts.
- Gemini call budget while Supabase reads are authoritative.

The D1 SQL that remains in these modules is a compatibility path for non-primary modes and must remain
unreachable when `SUPABASE_WRITE_MODE=primary`.

## D1 mutation blockers found by the final static audit

| Module | D1 tables | Classification | Cutover action |
| --- | --- | --- | --- |
| `src/mural-router.js` | mural_posts, mural_post_reads, mural_collections, mural_collection_products, mural_product_images | operational/admin | migrate admin Mural reads + writes before unfreezing |
| `src/occurrences-router.js` | scan_occurrences, cover_visual_references, cover_reference_embeddings | operational/admin | make occurrence create/train/dismiss Supabase-primary |
| `src/recognition-metrics.js` | recognition_daily, recognition_events | operational telemetry | record telemetry directly in Supabase primary mode |
| `src/system-metrics-clean-router.js` | recognition_events | admin | rename operator directly in Supabase primary mode |
| `src/web-push.js` | push_subscriptions, push_logs | operational/telemetry | move subscription state to Supabase; make push logs non-D1 |
| `src/geometric-shadow-evidence-router.js` | geometric_shadow_evidence | operational telemetry | direct Supabase evidence/link/confirm path |
| `src/geometric-shadow-confirmation-router.js` | geometric_shadow_evidence | operational telemetry | direct Supabase confirmation path |
| `src/reference-reindex-router.js` | cover_reference_embeddings | maintenance | read pending references and persist embeddings in Supabase |
| `src/core-router.js` | products, product_platforms, product_gtins, cover_visual_references, cover_reference_embeddings, mural_product_images, notifications | mixed | direct-primary routes already bypass most blocks; residual notification/test and legacy branches must be reviewed |
| `src/product-finish-router.js` | products | compatibility | already bypassed in primary mode |
| `src/cover-notifications.js` | notifications, notification_reads | compatibility | primary notification paths exist; verify every mark/read path |
| `src/gemini-budget.js` | gemini_call_budget | emergency fallback | remove D1 fallback only after the cutover confidence window |

## Rules for A2 completion

1. Every D1 mutation site is represented by the static confinement test.
2. A route classified operational or administrative cannot execute a D1 mutation when
   `SUPABASE_WRITE_MODE=primary`.
3. Compatibility SQL may remain temporarily only behind an explicit non-primary branch.
4. Maintenance routes must be migrated or explicitly disabled before the D1 binding is removed.
5. No change to `SUPABASE_CUTOVER_WRITE_FREEZE` is allowed while any blocker above remains open.
