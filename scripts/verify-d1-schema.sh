#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

fresh_db="$tmp_dir/fresh.sqlite"
legacy_db="$tmp_dir/legacy.sqlite"
migration_only_db="$tmp_dir/migration-only.sqlite"

sqlite3 "$fresh_db" < "$project_dir/schema.sql"
contract_columns="'content','featured','topic','type','approved_for_publication','content_format','content_quality','content_hash','content_chars','content_quality_score','content_version','content_extracted_at','content_source','fulltext_publication_allowed','fulltext_revoked_at'"
fresh_columns=$(sqlite3 "$fresh_db" "SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name IN ($contract_columns);")
[ "$fresh_columns" = "15" ]
fresh_version=$(sqlite3 "$fresh_db" "SELECT MAX(version) FROM schema_migrations;")
[ "$fresh_version" = "7" ]
fresh_rate_table=$(sqlite3 "$fresh_db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='submission_rate_limits';")
[ "$fresh_rate_table" = "1" ]

sqlite3 "$legacy_db" < "$project_dir/tests/fixtures/d1-legacy-schema.sql"
for migration in "$project_dir"/migrations/[0-9][0-9][0-9]-*.sql; do
  sqlite3 "$migration_only_db" < "$migration"
  sqlite3 "$legacy_db" < "$migration"
done
migration_only_columns=$(sqlite3 "$migration_only_db" "SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name IN ($contract_columns);")
[ "$migration_only_columns" = "15" ]
migration_only_version=$(sqlite3 "$migration_only_db" "SELECT MAX(version) FROM schema_migrations;")
[ "$migration_only_version" = "7" ]
migration_only_rate_table=$(sqlite3 "$migration_only_db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='submission_rate_limits';")
[ "$migration_only_rate_table" = "1" ]
legacy_columns=$(sqlite3 "$legacy_db" "SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name IN ($contract_columns);")
[ "$legacy_columns" = "15" ]
legacy_version=$(sqlite3 "$legacy_db" "SELECT MAX(version) FROM schema_migrations;")
[ "$legacy_version" = "7" ]
legacy_rate_table=$(sqlite3 "$legacy_db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='submission_rate_limits';")
[ "$legacy_rate_table" = "1" ]

echo "D1 schema verification passed (snapshot + migration-only + legacy upgrade)"
