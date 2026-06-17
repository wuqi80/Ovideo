#!/bin/bash
# 线上部署 H7(API key 真加密) + H8(前端不泄 key)：备份+解包+设 ENC_KEY+重启+失败回滚。
set -u
cd /home/Administrator/deploy || { echo "NO_REPO"; exit 1; }

echo "=== 部署前线上 bundle apiKey 注入值 ==="
grep -ohE 'apiKey:"[^"]{0,30}' dist/assets/*.js 2>/dev/null | head -2
echo "=== 部署前是否含真实 AIza key ==="
grep -ohE 'AIza[A-Za-z0-9_-]{10}' dist/assets/*.js 2>/dev/null | head -1 || echo "none"

TS=$(date +%Y%m%d_%H%M%S)
BAK=/tmp/drama_backup_h7h8_$TS.tgz
tar czf "$BAK" dao/admin/api_config.py dist 2>/dev/null
echo "备份: $BAK"

tar xzf /tmp/drama_h7h8.tgz -C /home/Administrator/deploy
echo "新文件(api_config.py + dist)已部署"

# 设置 API_CONFIG_ENC_KEY（服务器端生成 Fernet 密钥写入 drop-in，幂等）
DROPIN=/etc/systemd/system/drama.service.d/override.conf
if ! sudo grep -q 'API_CONFIG_ENC_KEY' "$DROPIN" 2>/dev/null; then
  ENCKEY=$(/home/Administrator/deploy/.venv/bin/python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())")
  echo "Environment=\"API_CONFIG_ENC_KEY=$ENCKEY\"" | sudo tee -a "$DROPIN" >/dev/null
  echo "已注入 API_CONFIG_ENC_KEY"
else
  echo "API_CONFIG_ENC_KEY 已存在，跳过"
fi

sudo systemctl daemon-reload
sudo systemctl restart drama
sleep 6
ACTIVE=$(systemctl is-active drama)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)
echo "drama=$ACTIVE http=$HTTP"
if [ "$ACTIVE" != "active" ] || [ "$HTTP" != "200" ]; then
  echo "!! 异常，自动回滚"
  tar xzf "$BAK" -C /home/Administrator/deploy
  sudo systemctl restart drama; sleep 5
  echo "回滚后 drama=$(systemctl is-active drama) http=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)"
  echo "DEPLOY_RESULT=ROLLED_BACK"; exit 1
fi
echo "=== 部署后 bundle apiKey 注入值（应 DISABLED_CLIENT_KEY）==="
grep -ohE 'apiKey:"[^"]{0,30}' dist/assets/*.js 2>/dev/null | head -2
echo "DEPLOY_RESULT=OK BACKUP=$BAK"
