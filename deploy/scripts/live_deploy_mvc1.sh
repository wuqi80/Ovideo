#!/bin/bash
# 线上部署 MVC增量1(schemas抽取)：备份+解包+重启+路由不变量(281)校验+冒烟+失败回滚。
set -u
cd /home/Administrator/deploy || { echo "NO_REPO"; exit 1; }
PY=/home/Administrator/deploy/.venv/bin/python
route_count() { curl -s http://127.0.0.1:6006/openapi.json | $PY -c "import sys,json; d=json.load(sys.stdin); print(sum(len(m) for m in d['paths'].values()))" 2>/dev/null; }

BEFORE=$(route_count)
echo "部署前路由数: $BEFORE"
TS=$(date +%Y%m%d_%H%M%S); BAK=/tmp/drama_backup_mvc1_$TS.tgz
tar czf "$BAK" cluster_main.py 2>/dev/null   # schemas/ 是新建,回滚时删掉即可
echo "备份: $BAK"

tar xzf /tmp/drama_mvc1.tgz -C /home/Administrator/deploy
echo "cluster_main.py + schemas/ 已部署"

sudo systemctl restart drama
sleep 6
ACTIVE=$(systemctl is-active drama)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)
AFTER=$(route_count)
echo "drama=$ACTIVE health=$HTTP  路由 部署前=$BEFORE 部署后=$AFTER"

if [ "$ACTIVE" != "active" ] || [ "$HTTP" != "200" ] || [ "$AFTER" != "$BEFORE" ] || [ -z "$AFTER" ]; then
  echo "!! 异常(服务/健康/路由数不一致)，自动回滚"
  tar xzf "$BAK" -C /home/Administrator/deploy
  rm -rf /home/Administrator/deploy/schemas
  sudo systemctl restart drama; sleep 5
  echo "回滚后 drama=$(systemctl is-active drama) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)"
  echo "DEPLOY_RESULT=ROLLED_BACK"; exit 1
fi
echo "路由不变量保持($AFTER=$BEFORE)，零功能变更"
echo "DEPLOY_RESULT=OK BACKUP=$BAK"
