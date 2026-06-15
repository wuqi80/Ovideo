#!/bin/bash
# 每日数据库备份：pg_dump（peer auth，免密码）→ ~/backups，保留最近 14 天。
# 由 cron 每天 03:00 调用（见 crontab）。手动跑：bash ~/deploy/scripts/backup_db.sh
set -e
BACKUP_DIR="/home/Administrator/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/my2_db_${TS}.sql.gz"
sudo -u postgres pg_dump my2_db | gzip > "$OUT"
# 只保留最近 14 天
find "$BACKUP_DIR" -name "my2_db_*.sql.gz" -mtime +14 -delete 2>/dev/null || true
echo "$(date -u) backup -> $OUT ($(du -h "$OUT" | cut -f1))"
