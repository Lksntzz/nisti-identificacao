# D1 Optimization — Phase 2

This phase hardens the backend against repeated administrative reads while the frontend polling cleanup is handled separately.

## Changes

- `GET /api/products` cache window increased from 60 seconds to 5 minutes.
- Catalog cache remains invalidated after product, image, bulk-import, and reference mutations.
- `GET /api/admin/storage-metrics` now uses a 5-minute in-memory snapshot.
- Concurrent R2 metric requests share the same in-flight measurement instead of scanning the bucket repeatedly.
- Responses expose `x-nisti-cache: hit|miss` for verification.

## Why

The 7-day D1 Insights report showed the product listing and repeated admin counters among the highest `rows_read` consumers. The admin frontend also refreshes infrastructure every 30 seconds, so these server-side guards keep repeated requests from turning into repeated database or R2 scans.

## Validation

After deployment, compare the next 24-hour D1 Insights report with the baseline captured before Phase 1/2. Frontend polling/visibility cleanup remains the next isolated change so its impact can be measured independently.
