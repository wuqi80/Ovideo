#!/bin/bash
# 线上止血 C1：给 drama 服务注入强随机 JWT_SECRET_KEY，关闭硬编码默认密钥后门。
# 密钥在服务器端生成，写入 root-only 的 systemd drop-in，不回显。
set -e
DROPIN=/etc/systemd/system/drama.service.d
sudo mkdir -p "$DROPIN"
if sudo grep -q '^Environment="JWT_SECRET_KEY=' "$DROPIN/override.conf" 2>/dev/null; then
  echo "JWT_SECRET_KEY 已存在于 drop-in，跳过生成（不覆盖）"
else
  SECRET=$(openssl rand -hex 48)
  printf '[Service]\nEnvironment="JWT_SECRET_KEY=%s"\n' "$SECRET" | sudo tee "$DROPIN/override.conf" >/dev/null
  sudo chmod 600 "$DROPIN/override.conf"
  echo "已生成并写入强随机 JWT_SECRET_KEY（drop-in, 600）"
fi
sudo systemctl daemon-reload
sudo systemctl restart drama
sleep 5
echo "drama 状态: $(systemctl is-active drama)"
echo "JWT_SECRET_KEY 现已注入(1=是): $(sudo systemctl show drama -p Environment --value | tr ' ' '\n' | grep -c '^JWT_SECRET_KEY=')"
echo "本地健康检查:"; curl -s -o /dev/null -w "  /api 内网6006 HTTP=%{http_code}\n" http://127.0.0.1:6006/projects || true
