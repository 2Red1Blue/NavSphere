# D1 schema lifecycle

`schema.sql` is the canonical version-10 snapshot for local verification and CI.
Do not load it into a remote D1 database. Remote databases, including a brand
new empty database, must use Wrangler migrations starting at `000` so Wrangler's
own `d1_migrations` ledger remains authoritative.

Before applying migrations to an existing remote database, use the production
gate's read-only `wrangler d1 execute --remote --env production --json` SELECT
queries to inspect `d1_migrations` and the required article columns. The
convenience `cf:migrations:list` command is useful interactively, but it may
create the Wrangler ledger table when absent and is therefore not a strict
no-write readiness check. The Pages deploy command intentionally does not
apply migrations automatically.

Files in this directory create or upgrade a production database in numeric
order. Migration `000` is a no-op for a legacy database whose base `articles`
table already exists. Cloudflare's own D1 migration tracking prevents an
already-applied numbered file from running twice. Historical migration files
are immutable; the application-level `schema_migrations` marker is introduced
by migration 004 only to identify the canonical snapshot generation.

The verification script exercises three independent paths:

1. a fresh database loaded from `schema.sql`;
2. an empty database created entirely through migrations 000-010;
3. the legacy fixture upgraded through migrations 000-010.

After migration 004, existing rows remain private until they are explicitly
republished by the approved pipeline.

Migration 008 adds nullable `original_url` and `original_url_provenance` as a
paired navigation contract. Allowed evidence is `aihot_rss_description`,
`aihot_api_v1`, or `legacy_flash`; it does not transfer publication rights or
change collection `url`/`url_hash`. Existing rows remain unchanged apart from
the two empty fields. Backfills use separately reviewed, guarded offline SQL;
normal prepare remains create-only and ingestion rejects conflicting evidence.

Migration 009 adds five nullable private body-pointer fields, a monotonic
`fulltext_control_version`, and the `feed_archive_daily_budget` write-attempt
ledger. Pointers must be wholly absent or complete and match the existing
content version. Archive integrity uses its own SHA-256 field; legacy editorial
hashes and quality remain unchanged. The rights-update trigger increments the
control version even for repeated same-second revocations. No article, body,
metadata, approval, revocation or topic join is deleted or changed by migration.
This migration does not create a KV namespace, enable archival or clear bodies;
the separately gated lifecycle is documented in `docs/d1-retention.md`.

Migration010 adds the bounded `article_editorials` table only. It uses the
existing article URL hash as primary/foreign key with ON DELETE RESTRICT.
Drafts and complete review records stay private locally. The current published
brief or withdrawal tombstone has its own monotonic revision and does not
change original article content, scores, global approval or fulltext rights.
The new reader joins this table, so migration010 must be verified before
deploying the matching reader. `FEED_EDITORIAL_ENABLED` defaults off; applying
the migration does not approve or publish any draft. See
`docs/editorial-publishing.md` for the explicit local workflow and release gates.

Migration010 deliberately fails if `article_editorials` already exists. A table
name or matching column list does not prove its constraints are correct; do not
drop that table or manually mark the migration applied to bypass the failure.
Inspect its definition and existing data before deciding a separate recovery.
Wrangler's migration ledger prevents reapplying a successful migration; direct
SQL replay is not a supported idempotent operation. The local snapshot retains
its separate fresh-database initialization behavior.
