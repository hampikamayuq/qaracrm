#!/usr/bin/env bash
set -euo pipefail

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="${BACKUP_DIR:-./backups}"
database_url="${DATABASE_URL:-postgresql://localhost:5432/qara-crm}"
db_name="$(printf '%s' "$database_url" | sed -E 's|.*/([^/?]+).*|\1|')"
backup_file="$backup_dir/$db_name-$timestamp.sql"

mkdir -p "$backup_dir"

if [[ "${BACKUP_DRY_RUN:-false}" == "true" ]]; then
  printf 'Dry run: pg_dump "%s" > "%s"\n' "$database_url" "$backup_file"
  exit 0
fi

pg_dump "$database_url" > "$backup_file"

find "$backup_dir" -maxdepth 1 -name "$db_name-*.sql" -type f -printf '%T@ %p\n' \
  | sort -rn \
  | tail -n +31 \
  | cut -d' ' -f2- \
  | xargs -r rm

printf 'Backup: %s\n' "$backup_file"
