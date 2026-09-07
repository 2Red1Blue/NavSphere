# D1 Free: retention safety

Status: **schema9 and the guarded reader/archive API deployed on 2026-09-04; private KV binding, production archive/compaction and scheduling not enabled**. The phase19 section below supersedes the earlier destination proposal; it does not authorize cleanup. Deployment `b0f10b02-5954-4715-ba5c-6ed66bd32fcb` passed the production gate; no paid storage or billing was enabled.
No new Cloudflare resource, paid plan or public archive bucket is required for the audit.

## Run the audit

From the NavSphere directory, using the existing authorized Wrangler session:

Prerequisites: the project's Node.js/pnpm dependencies and an authorized Wrangler session. Offline SQL regression tests also require the `sqlite3` CLI, as does the existing `test:schema` command; CI must install it rather than silently skipping SQL verification.

Those fixtures explicitly enforce D1's 50-byte `LIKE`/`GLOB` pattern limit. A single full ISO timestamp digit pattern exceeds that limit; date and time shape checks must stay separate even if an unconstrained local SQLite query succeeds.

```sh
pnpm run cf:retention-audit
pnpm run cf:retention-audit -- --days 30 --timeout-ms 90000
```

The default planning window is 30 rolling days, not an approved deletion policy. The script freezes one UTC cutoff on `discovered_at`, runs one read-only aggregate query against `content-os-feed` in the `production` environment, and prints an allowlisted JSON report. It does not return article IDs, URLs or bodies. Invalid timestamps are counted separately, never selected for removal. Millisecond cutoff comparisons preserve finer article timestamp fractions and normalize explicit timezones. `--days 90` changes only this audit's planning window: the deployed maintenance API currently uses a fixed 30-day default and the archive CLI has no retention override. Confirm the policy before enabling compaction; a different policy needs an implementation change.

Physical size comes from D1's `meta.size_after`, not estimated body length. The script requires a successful result with zero written rows and `changed_db=false`. Missing/malformed metrics, timeouts and failed commands are errors, never a healthy zero-size database. Exit 0 means the audit completed, **not** that pruning is safe; inspect its capacity status. Exit 2 means audit failure. The optional longer timeout is for management CLI startup/network latency and does not alter the site's production health gate.

## Free limits and operational thresholds

Official limits checked 2026-09-04:

| Measure | Cloudflare Free |
| --- | --- |
| Single D1 database | 500 MB |
| Account D1 storage | 5 GB total |
| Rows read | 5 million per UTC day |
| Rows written | 100,000 per UTC day |
| Time Travel | 7 days |

Sources: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 result metadata](https://developers.cloudflare.com/d1/worker-api/return-object/).

The audit uses a conservative decimal 500,000,000-byte planning ceiling: normal below 70%, warning from 70%, critical from 85%, limit from 100%. These warning thresholds are our operational policy, not Cloudflare limits. There is no growth-rate forecast from one measurement. The report does not measure all account databases or account-wide daily quotas. A query's `rows_read` is the audit's own read cost; Wrangler's rolling-24-hour counters must not be labelled as current UTC-day remaining quota. DELETE and index updates consume write quota too.

The aggregate scans the article table to validate timestamps. Run on demand initially; once a scheduler is chosen, at most once daily by default, not on every public request or pipeline substep. Inspect `query.rowsRead` and reduce cadence or replace the full scan with a measured incremental strategy if the dataset approaches the daily read allowance.

Measured 2026-09-04 around 03:05 UTC: **6,234,112 bytes**, 521 articles, 520 approved and zero full-text publication permission. The initial exploratory 30-day count was 368; run the strict audit for a fresh count. These are observations, not a claim of available archive capacity or authorization to publish full text.

## Why age-based row deletion is disabled (phase18 findings)

- `/feed/{id}` reads `/api/feed/{id}`; the phase19 reader can retrieve a cold body but still requires its `articles` identity/control row. Deleting that row breaks an already delivered link.
- Prepare and bulk ingestion depend on the existing row to retain revocation state. An absent row can be inserted again. Bulk ingestion also does not currently guarantee sticky article-level withdrawal.
- Revoke/restore operate on `articles`. Approval, full-text revocation and archived identity must outlive the hot row.
- `article_topics` cascades on article deletion. Restore must preserve relationships as well as article bodies.
- Raw `SELECT *` exported into a public Git repository could expose unapproved, legacy-unverified or revoked bodies. Removing an API response cannot retract public Git history.
- A SQL recovery backup is not a serving archive, and D1 Time Travel is not long-term archival.

The old monthly raw-delete example was removed from `schema.sql`. This is a comment-only correction, not a database migration.

## Required archive sequence

1. Choose a **private** durable destination and retention policy. R2 Standard has a [free allowance](https://developers.cloudflare.com/r2/pricing/), but is metered beyond it; do not silently enable billing or claim an unconditional zero-cost guarantee. A private Git repository can hold limited backups, but is not by itself a low-latency, revocable reader backend. Destination creation/configuration needs the user's choice.
2. Create a fixed-cutoff manifest with stable IDs, complete row fingerprints, schema version and topic relationships. Export a private recovery snapshot separately from a permission-filtered public projection. Use content-addressed/versioned objects and merge month shards idempotently.
3. Re-download and verify schema, checksums, ID sets, counts and relationships. Publish the index only after every object is verified; re-read that index. Failed export/upload/index verification means no deletion.
4. Deploy cold lookup **behind the same `/api/feed/{id}`** and keep existing IDs. Preserve independent small identity/approval/revocation records in D1; apply denials before reading or returning archived content. Prepare and bulk ingestion must not reinsert or reapprove archived/withdrawn identities.
5. Define historical list, search, daily navigation and statistics semantics. Test old delivered links, permission withdrawal, restore, archive outage, duplicate runs and partial failures using a temporary local database.
6. Only then prune exact verified manifest IDs with complete state checks/concurrency protection. A broad date DELETE or `content_version`-only guard is insufficient: metadata and revocation can change independently.
7. After a successful recovery rehearsal and confirmed policy, add daily checks and bounded archive batches to an explicitly chosen scheduler. Monthly object partitions do not imply monthly checks; monthly checks of a 30-day cutoff can retain nearly 60 days.

At the phase18 checkpoint, code had no archive destination, cold reader, pruning command or new scheduler. The phase19 code is now deployed with all archive writes disabled; live private-storage integration, cold recovery acceptance, confirmed retention and scheduling remain gated. Do not manually run a broad deletion to simulate archival.

## Phase19: private body archive on Workers KV

The implementation keeps every `articles` row, ID, source link, title/summary/search fields, publication controls and topic relationship in D1. Only `content` moves. Same-ID detail can read the private body through the server binding; no public KV URL or archive key appears in the response. This follows [linkding's separate bookmark assets](https://github.com/sissbruecker/linkding/blob/master/bookmarks/models.py) and its [database-plus-assets backup requirement](https://linkding.link/backups/), without importing its browser/Django stack. Native Workers KV bindings need no added runtime dependency.

Measured body workload:169 bodies /5,164,065 UTF-8 bytes within the6,234,112-byte D1 database;27 preliminary old-body candidates. KV [Free allowances](https://developers.cloudflare.com/kv/platform/pricing/) include1GB stored data,100,000 reads/day and1,000 writes/day. These are account-wide, not reserved for this project. Account analytics reported three empty namespaces on2026-09-04; subscription lookup was403, so API checks alone did not establish the product plan. Respect the user's stated Free boundary and verify the dashboard before enabling any resource; no R2 or billing activation is part of this implementation.

### Storage state and safety

Migration009 adds five nullable current-pointer fields and a monotonic rights-control version. Archive SHA-256 is separate from editorial `content_hash`: legacyNULLhash/quality/rights remain unchanged. The rights trigger advances on explicit approval, permission or revoke-marker updates, even repeated same-second revokes. Ingest resets the pointer atomically only when accepting a replacement body; cold content is not treated as absent. Prepare remains create-only.

- `stage`: immutable content-addressed KV object, bounded readback/hash verification, full body/control/source snapshot CAS publishes pointer while retaining D1 body. Existing objects are never overwritten on a retry. Failed/uncertain puts still consume one reserved attempt in `feed_archive_daily_budget`; cap100 per UTCday. No automatic POST retries.
- `compact`: separate server flag required, article older than30days, pointer staged for at least24hours, fresh verified KV read and byte-for-byte hot comparison, full snapshot CAS sets only `content=NULL`. No article/topic DELETE. The24h delay is conservative, not a guarantee of global KV availability; each clear still verifies the object.
- `rehydrate`: exact-ID verified cold body back into D1 under snapshot CAS. Does not change quality, editorial version, source, approval or full-text permission; keeps the archive copy.
- Public detail checks D1 approval, verified Markdown and explicit unrevoked permission before KV. It rechecks the current snapshot after retrieval. Missing/corrupt/quota-failed KV yields non-cacheable retryable503, never fabricated content or automatic republication. Both hot/cold detail and client fetch use `no-store`.
- Explicit full-text `restore` is a separate authenticated operation: validates current hot/cold content, then CAS-updates rights only. A concurrent revoke leaves permission denied. Bytes already delivered to a browser cannot be retracted.

Private immutable object keys use `feed-body/v1/{url_hash}/{content_version}/{sha256}` and schema1 JSON envelopes. No expiration/deletion API exists in the storage port. Old superseded or orphan objects still occupy KV quota; they are not automatically garbage-collected. Keep a private full D1 recovery snapshot paired with the KV objects, including topic data. This is body-storage reduction, not a promise of bounded metadata growth forever; inspect physical D1 `size_after` after rollout (freed pages can be reused without the allocated size immediately shrinking).

### Deployment and explicit rollout

1. Complete independent review and local schema/SQL/concurrency/build/browser gates. Export a fresh private D1 backup and rehearse restoration of metadata, topics and legacy bodies. Do not commit raw snapshots or bodies to public Git.
2. Verify WorkersFree/KV allowance; create/select a **private project namespace** only within that plan. Configure the Pages production `CONTENT_ARCHIVE` KV binding separately; no namespace ID or enable flag is currently written in `wrangler.toml`. Existing unrelated namespaces must not be reused implicitly.
3. Apply migrations008and009 before deploying this combined API; readers/health require schema9. Keep `CONTENT_ARCHIVE_ENABLED` and `CONTENT_ARCHIVE_COMPACT_ENABLED` absent/false. Confirm the same-ID reader, upstream source links and deny-before-KV on a controlled fixture. Wait for previous public300s cache entries to expire or purge them before promising the new no-store behavior.
4. Set `CONTENT_ARCHIVE_ENABLED=true` only after the binding/recovery checks. Stage one known old ID and verify its pointer/object while the hot body remains. Perform a controlled cold-read/recovery rehearsal; check allowed/denied/revoked cases, identity and digest, not merely HTTP200.
5. After policy confirmation, enable `CONTENT_ARCHIVE_COMPACT_ENABLED=true` separately. Its meaning is operator attestation that private backup and deployed-reader rehearsal passed; the API cannot independently verify an external backup. The CLI requires separate confirmations too. Start with one staged ID older than24h; verify again afterward before widening batches.
6. Only after a successful live rehearsal choose the supported daily automation mechanism. None has been installed; no production clearing has run. Keep daily physical-capacity checks and bound batches to20 IDs per invocation/100 KV write attempts per UTCday. A failure stops the current CLI batch; resume after inspecting the explicit result, never widen CAS predicates.

### Operator commands (after the above rollout)

The CLI uses Node's native dotenv loader (Node20.12+), reading only the parent project `.env` keys `CONTENT_OS_API_KEY` and `FEED_API_URL`. Process environment retains precedence. Credentials never appear in arguments or reports; HTTPS only, redirects rejected,20s request timeout including response,64KiB reply cap. A default invocation is read-only:

```sh
pnpm run cf:archive
pnpm run cf:archive -- --mode stage --limit 20
# Exact IDs are copied from the private operator inventory, never recomputed.
pnpm run cf:archive -- --mode compact --id <existing-article-id> --confirmed-recovery --confirmed-cold-reader
pnpm run cf:archive -- --mode rehydrate --id <existing-article-id>
```

`BATCH_COMPLETED` means only the selected bounded batch; `moreCandidates:true` means the inventory was truncated or more candidates exceeded the batch limit, not that every remaining item is ready to clear. Invalid dates are never eligible. Candidate queries use the shared strict ISO/calendar/timezone classifier, followed by TypeScript validation and a second per-item retention check.

The inventory and CLI report `scanned` (up to 200 candidate rows), `truncated` (candidate-window coverage), and `invalidDates` (a separate complete count of malformed discovery timestamps among **all rows still holding a D1 body**, staged or unstaged). The invalid count can exceed `scanned`; it is not a list of actionable candidates and does not itself set `moreCandidates`. Valid recent/future rows do not fill the old-candidate window. Missing or malformed counters fail the CLI instead of being displayed as zero; validated counters remain visible if a subsequent batch operation fails. This aggregate scans hot-body metadata, so run operational inventory on demand or on the measured daily schedule, never on public reads. Review persistent invalid dates rather than interpreting a partial inventory as all archived.

Deploy the matching worker before using the updated CLI: an older inventory response without these counters is deliberately rejected. The three inventory queries are not a transaction snapshot; concurrent ingestion can skew the displayed counters, while each maintenance operation still rechecks its complete current row before writing. This audit is not a cold-ID or recovery manifest.

An uncertain POST may have staged/cleared successfully; inspect the current state before retrying. CLI does not print bodies, raw KV keys or unknown server fields.
