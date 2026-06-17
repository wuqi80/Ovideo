#!/bin/bash
# 线上只读勘察（不改任何东西）
cd /home/Administrator/deploy 2>/dev/null || { echo "NO_REPO"; exit 1; }
echo "=== git branch ==="; git rev-parse --abbrev-ref HEAD 2>/dev/null
echo "=== git head ==="; git log --oneline -2 2>/dev/null
echo "=== node ==="; (which node >/dev/null 2>&1 && node -v) || echo "no-node"
echo "=== dist ==="; ls -la dist/index.html 2>/dev/null || echo "no-dist"
echo "=== projects.is_deleted (1=有,0=无) ==="
sudo -u postgres psql -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='projects' AND column_name='is_deleted'" my2_db 2>/dev/null || echo "psql-failed"
echo "=== JWT_SECRET_KEY 是否已设(1=有,0=无) ==="
sudo systemctl show drama -p Environment --value 2>/dev/null | tr ' ' '\n' | grep -c '^JWT_SECRET_KEY='
echo "=== EnvironmentFiles ==="; systemctl show drama -p EnvironmentFiles --value 2>/dev/null
echo "=== drama 状态 ==="; systemctl is-active drama 2>/dev/null
