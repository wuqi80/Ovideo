#!/bin/bash
# 线上部署 C3(admin 端点全局鉴权 + app.js 带 token)：备份+解包+重启+后端鉴权验证+失败回滚。
set -u
cd /home/Administrator/deploy || { echo "NO_REPO"; exit 1; }
TS=$(date +%Y%m%d_%H%M%S)
BAK=/tmp/drama_backup_c3_$TS.tgz
tar czf "$BAK" admin_routes.py admin/app.js admin/index.html dist 2>/dev/null
echo "备份: $BAK"

tar xzf /tmp/drama_c3.tgz -C /home/Administrator/deploy
echo "新文件(admin_routes/app.js/index.html/dist)已部署"

sudo systemctl restart drama
sleep 6
ACTIVE=$(systemctl is-active drama)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)
# C3 后端验证：无 token 调 admin 应 401/403
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/api/admin/dashboard)
echo "drama=$ACTIVE  health=$HTTP  admin无token=$NOAUTH"

if [ "$ACTIVE" != "active" ] || [ "$HTTP" != "200" ] || { [ "$NOAUTH" != "401" ] && [ "$NOAUTH" != "403" ]; }; then
  echo "!! 异常(服务挂/健康非200/admin未鉴权)，自动回滚"
  tar xzf "$BAK" -C /home/Administrator/deploy
  sudo systemctl restart drama; sleep 5
  echo "回滚后 drama=$(systemctl is-active drama) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)"
  echo "DEPLOY_RESULT=ROLLED_BACK"; exit 1
fi
echo "C3 后端生效：admin 端点无 token 已被拒($NOAUTH)"
echo "DEPLOY_RESULT=OK BACKUP=$BAK"
