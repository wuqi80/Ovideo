#!/bin/bash
# 线上安全修复部署：解包已改文件 + 删死代码 + 注入 CORS 域名 + 重启，失败自动回滚。
set -u
cd /home/Administrator/deploy || { echo "NO_REPO"; exit 1; }
TS=$(date +%Y%m%d_%H%M%S)
BAK=/tmp/drama_backup_$TS.tgz

# 1. 备份将被替换/删除的文件（用于回滚）
tar czf "$BAK" \
  core/jwt_auth.py core/db_manager.py core/task_queue.py \
  api_routes.py cluster_main.py cluster_config.py cluster_config_generated.py \
  services/audio_mix_service.py utils/net_guard.py \
  dao_task_history.py dao/business/task_history.py 2>/dev/null
echo "备份: $BAK"

# 2. 解包新文件
tar xzf /tmp/drama_sec.tgz -C /home/Administrator/deploy
echo "新文件已部署"

# 3. 删死代码
rm -f dao_task_history.py dao/business/task_history.py
echo "已删死代码 dao_task_history"

# 4. 注入生产 CORS 域名到 systemd drop-in（与 JWT_SECRET_KEY 并存，幂等）
DROPIN=/etc/systemd/system/drama.service.d/override.conf
if ! sudo grep -q 'CORS_ALLOW_ORIGINS' "$DROPIN" 2>/dev/null; then
  echo 'Environment="CORS_ALLOW_ORIGINS=https://spti.ai,https://messiah.5kcrm.cn"' | sudo tee -a "$DROPIN" >/dev/null
  echo "已注入 CORS_ALLOW_ORIGINS"
fi

# 5. 重启
sudo systemctl daemon-reload
sudo systemctl restart drama
sleep 6

# 6. 健康检查 + 失败自动回滚
ACTIVE=$(systemctl is-active drama)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)
echo "drama=$ACTIVE  health_http=$HTTP"
if [ "$ACTIVE" != "active" ] || [ "$HTTP" != "200" ]; then
  echo "!! 部署后异常，自动回滚"
  tar xzf "$BAK" -C /home/Administrator/deploy
  sudo systemctl restart drama
  sleep 5
  echo "回滚后 drama=$(systemctl is-active drama) http=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)"
  echo "DEPLOY_RESULT=ROLLED_BACK"
  exit 1
fi

# 7. 验证安全修复生效
echo "debug接口(应404)=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/api/debug/auth-status)"
echo "DEPLOY_RESULT=OK  BACKUP=$BAK"
