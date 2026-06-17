#!/bin/bash
# 线上部署 C2(内置账号密码 env 可覆盖) + 设强密码：备份+解包+注入ENV+重启+验证+回滚。
# admin 密码从 /tmp/admin_pw.txt 读取（不硬编码进脚本/git）。
set -u
cd /home/Administrator/deploy || { echo "NO_REPO"; exit 1; }
[ -f /tmp/admin_pw.txt ] || { echo "缺 /tmp/admin_pw.txt"; exit 1; }
ADMIN_PW=$(cat /tmp/admin_pw.txt)

TS=$(date +%Y%m%d_%H%M%S); BAK=/tmp/drama_backup_c2_$TS.tgz
tar czf "$BAK" cluster_main.py 2>/dev/null
echo "备份: $BAK"
tar xzf /tmp/drama_c2.tgz -C /home/Administrator/deploy
echo "cluster_main.py 已部署"

DROPIN=/etc/systemd/system/drama.service.d/override.conf
if ! sudo grep -q 'ADMIN_PASSWORD=' "$DROPIN" 2>/dev/null; then
  PY=/home/Administrator/deploy/.venv/bin/python
  USER_PW=$($PY -c "import secrets;print(secrets.token_urlsafe(24))")
  DEMO_PW=$($PY -c "import secrets;print(secrets.token_urlsafe(24))")
  { printf 'Environment="ADMIN_PASSWORD=%s"\n' "$ADMIN_PW"
    printf 'Environment="USER_PASSWORD=%s"\n' "$USER_PW"
    printf 'Environment="DEMO_PASSWORD=%s"\n' "$DEMO_PW"; } | sudo tee -a "$DROPIN" >/dev/null
  echo "已注入 ADMIN/USER/DEMO_PASSWORD（user/demo 设随机=禁用弱口令）"
else
  echo "ADMIN_PASSWORD 已存在，跳过注入"
fi

sudo systemctl daemon-reload
sudo systemctl restart drama
sleep 6
ACTIVE=$(systemctl is-active drama)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)
OLD=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' http://127.0.0.1:6006/api/login)
NEW=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary @<(printf '{"username":"admin","password":"%s"}' "$ADMIN_PW") http://127.0.0.1:6006/api/login)
echo "drama=$ACTIVE health=$HTTP  admin123登录(应401)=$OLD  新密码登录(应200)=$NEW"

if [ "$ACTIVE" != "active" ] || [ "$HTTP" != "200" ] || [ "$NEW" != "200" ]; then
  echo "!! 异常，自动回滚代码"
  tar xzf "$BAK" -C /home/Administrator/deploy
  sudo systemctl restart drama; sleep 5
  echo "回滚后 drama=$(systemctl is-active drama) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6006/projects)"
  echo "DEPLOY_RESULT=ROLLED_BACK"; exit 1
fi
echo "DEPLOY_RESULT=OK BACKUP=$BAK"
