#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

fresh_db="$tmp_dir/fresh.sqlite"
legacy_db="$tmp_dir/legacy.sqlite"
migration_only_db="$tmp_dir/migration-only.sqlite"

run_sqlite() {
  # Match D1's GLOB/LIKE ceiling and enforce retained topic foreign keys.
  # Silence only the .limit diagnostic, not SQL failures or query results.
  sqlite_output=$(sqlite3 -bail -cmd '.limit like_pattern_length 50' \
    -cmd 'PRAGMA foreign_keys = ON;' "$@") || return "$?"
  printf '%s\n' "$sqlite_output" | sed '/^ like_pattern_length 50$/d'
}

run_sqlite "$fresh_db" < "$project_dir/schema.sql"
run_sqlite "$legacy_db" < "$project_dir/tests/fixtures/d1-legacy-schema.sql"
for migration in "$project_dir"/migrations/[0-9][0-9][0-9]-*.sql; do
  run_sqlite "$migration_only_db" < "$migration"
  run_sqlite "$legacy_db" < "$migration"
done

contract_columns="'content','featured','topic','type','approved_for_publication','content_format','content_quality','content_hash','content_chars','content_quality_score','content_version','content_extracted_at','content_source','fulltext_publication_allowed','fulltext_revoked_at','original_url','original_url_provenance','fulltext_control_version','content_archive_key','content_archive_sha256','content_archive_version','content_archive_bytes','content_archived_at'"
for database in "$fresh_db" "$migration_only_db" "$legacy_db"; do
  columns=$(run_sqlite "$database" "SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name IN ($contract_columns);")
  [ "$columns" = "23" ]
  version=$(run_sqlite "$database" 'SELECT MAX(version) FROM schema_migrations;')
  [ "$version" = "10" ]
  operational_tables=$(run_sqlite "$database" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('submission_rate_limits', 'feed_archive_daily_budget');")
  [ "$operational_tables" = "2" ]
  rights_trigger=$(run_sqlite "$database" "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='articles_fulltext_control_revision';")
  [ "$rights_trigger" = "1" ]
  editorial_columns=$(run_sqlite "$database" "SELECT COUNT(*) FROM pragma_table_info('article_editorials') WHERE name IN ('url_hash','revision','state','publication_json','manifest_sha256','approval_digest','review_sha256','approved_by','approved_at','published_at','withdrawn_at','withdrawal_reason');")
  [ "$editorial_columns" = "12" ]
  editorial_fk=$(run_sqlite "$database" "SELECT COUNT(*) FROM pragma_foreign_key_list('article_editorials') WHERE \"table\"='articles' AND \"from\"='url_hash' AND \"to\"='url_hash' AND on_delete='RESTRICT';")
  [ "$editorial_fk" = "1" ]
  [ -z "$(run_sqlite "$database" 'PRAGMA foreign_key_check;')" ]
done

echo "D1 schema verification passed (snapshot + migration-only + legacy upgrade)"
