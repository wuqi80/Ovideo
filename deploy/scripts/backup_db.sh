#!/bin/bash
# Database backup using peer authentication. DB_NAME and BACKUP_DIR are
# deployment-owned so this script remains portable.
set -e
DB_NAME="${DB_NAME:-ostory_db}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/${DB_NAME}_${TS}.sql.gz"
sudo -u postgres pg_dump "$DB_NAME" | gzip > "$OUT"
# 只保留最近 14 天
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +14 -delete 2>/dev/null || true
echo "$(date -u) backup -> $OUT ($(du -h "$OUT" | cut -f1))"
