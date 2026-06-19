#!/bin/bash
# 线上部署：清理幽灵账号（DEFAULT_USERS只保留admin，SUPER_ADMIN改为admin，admin白名单去掉lllsdhr）
# 备份+部署+重启+冒烟+自动回滚
set -u
cd /home/Administrator/deploy || { echo "NO_REPO"; exit 1; }
PY=/home/Administrator/deploy/.venv/bin/python
SMOKE_PW="${SUPER_ADMIN_PASSWORD:-Liu3753650@}"

route_count() { curl -s http://127.0.0.1:6006/openapi.json | $PY -c "import sys,json; d=json.load(sys.stdin); print(sum(len(m) for m in d['paths'].values()))" 2>/dev/null; }

BEFORE=$(route_count)
echo "部署前路由数: $BEFORE"
TS=$(date +%Y%m%d_%H%M%S); BAK=/tmp/drama_backup_ghost_$TS.tgz
tar czf "$BAK" cluster_main.py admin_routes.py 2>/dev/null
echo "备份: $BAK"

tar xzf /tmp/drama_ghost_cleanup.tgz -C /home/Administrator/deploy
echo "cluster_main.py + admin_routes.py 已部署"

sudo systemctl restart drama
sleep 6
ACTIVE=$(systemctl is-active drama)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)
AFTER=$(route_count)
echo "drama=$ACTIVE health=$HTTP  路由 部署前=$BEFORE 部署后=$AFTER"

if [ "$ACTIVE" != "active" ] || [ "$HTTP" != "200" ] || [ "$AFTER" != "$BEFORE" ] || [ -z "$AFTER" ]; then
  echo "!! 异常，自动回滚"
  tar xzf "$BAK" -C /home/Administrator/deploy
  sudo systemctl restart drama; sleep 5
  echo "回滚后 drama=$(systemctl is-active drama)"
  echo "DEPLOY_RESULT=ROLLED_BACK"; exit 1
fi
echo "路由不变量保持($AFTER=$BEFORE)"

# 冒烟
$PY /tmp/smoke_test.py http://127.0.0.1:6006 "$SMOKE_PW"
SMOKE=$?
if [ $SMOKE -ne 0 ]; then
  echo "!! 冒烟失败，自动回滚"
  tar xzf "$BAK" -C /home/Administrator/deploy
  sudo systemctl restart drama; sleep 5
  echo "DEPLOY_RESULT=SMOKE_ROLLED_BACK"; exit 1
fi
echo "DEPLOY_RESULT=OK BACKUP=$BAK"
