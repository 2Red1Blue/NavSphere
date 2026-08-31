# D1 schema lifecycle

`schema.sql` is the canonical version-5 snapshot for local verification and CI.
Do not load it into a remote D1 database. Remote databases, including a brand
new empty database, must use Wrangler migrations starting at `000` so Wrangler's
own `d1_migrations` ledger remains authoritative.

Before applying migrations to an existing remote database, run
`pnpm run cf:migrations:list` and verify that its Wrangler migration ledger
matches the database's actual schema. The Pages deploy command intentionally
does not apply migrations automatically.

Files in this directory create or upgrade a production database in numeric
order. Migration `000` is a no-op for a legacy database whose base `articles`
table already exists. Cloudflare's own D1 migration tracking prevents an
already-applied numbered file from running twice. Historical migration files
are immutable; the application-level `schema_migrations` marker is introduced
by migration 004 only to identify the canonical snapshot generation.

The verification script exercises two independent paths:

1. a fresh database loaded from `schema.sql`;
2. an empty database created entirely through migrations 000-005;
3. the legacy fixture upgraded through migrations 000-005.

After migration 004, existing rows remain private until they are explicitly
republished by the approved pipeline.
