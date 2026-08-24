# D1 optimization — Phase 2B

Frontend admin polling is split by cost and visibility:

- System and storage metrics refresh at most every 5 minutes while the document is visible.
- Heavy metrics do not refresh while the admin tab is hidden.
- Returning to the tab refreshes heavy metrics only when the 5-minute window is due.
- Unread notification count remains independent at a 30-second visible-only cadence.
- Catalog mutations still trigger an explicit full refresh.

Recognition, Vectorize, Gemini, SKU resolution and telemetry behavior are unchanged.
