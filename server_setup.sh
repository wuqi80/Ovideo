#!/bin/bash
# Drama 服务器一键部署脚本（GCP / Ubuntu 24.04）
# ⚠️ 模板：下方所有 __FILL_ME__ / your-xxx 占位符需替换为真实值后再运行。
#    真实密钥请勿提交进仓库（参考 local_start.ps1 / start_cluster.sh，均已 gitignore）。
# 用法：bash ~/server_setup.sh
set -e

DEPLOY_DIR="/home/Administrator/deploy"
DOMAIN="drama.rongyansuanli.com"
DB_NAME="my2_db"
DB_USER="my2_user"
DB_PASS="__FILL_ME__"            # 数据库密码

echo "=========================================="
echo "  Drama 服务器部署开始"
echo "=========================================="

# ── 1. 安装 Node.js 20 ──────────────────────────────────────────────
echo "[1/8] 安装 Node.js 20..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node $(node -v), npm $(npm -v)"

# ── 1.5 构建前端（dist/ 由 vite 输出，后端直接 serve）──────────────────
echo "[1.5/8] 构建前端..."
cd "${DEPLOY_DIR}/new_html"
npm ci --no-audit --no-fund 2>&1 | tail -3 || npm install --no-audit --no-fund 2>&1 | tail -3
npm run build 2>&1 | tail -5
cd "${DEPLOY_DIR}"
echo "前端构建完成 → dist/"

# ── 2. 配置 PostgreSQL ──────────────────────────────────────────────
echo "[2/8] 配置 PostgreSQL..."
sudo systemctl start postgresql
sudo systemctl enable postgresql

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME};"

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

# ── 3. 初始化数据库表 ────────────────────────────────────────────────
echo "[3/8] 初始化数据库表..."
cd "${DEPLOY_DIR}"
export PGPASSWORD="${DB_PASS}"

psql -U "${DB_USER}" -d "${DB_NAME}" -h localhost -f sql/database_schema.sql 2>/dev/null || true

for f in \
    sql/db_migration_project_hub.sql \
    sql/db_migration_add_permissions.sql \
    sql/db_migration_notifications.sql \
    sql/db_migration_episodes.sql \
    sql/db_migration_assets.sql \
    sql/db_migration_episode_scripts.sql \
    sql/db_migration_storyboard_items.sql \
    sql/db_migration_video_segments.sql \
    sql/db_migration_timeline_tracks.sql \
    sql/db_migration_audio_tracks.sql \
    sql/db_migration_unified_files.sql \
    sql/db_migration_multi_scripts.sql \
    sql/db_migration_script_id.sql \
    sql/db_migration_character_voices.sql \
    sql/db_migration_admin.sql \
    sql/db_migration_clean_storyboard_data_urls.sql \
    sql/db_migration_storyboard_audio_mix.sql \
    sql/db_migration_gpt_image_providers.sql \
    sql/db_migration_api_config_category.sql \
    sql/db_migration_media_library.sql \
    sql/db_migration_credits.sql \
    sql/db_migration_video_reverse.sql \
    sql/db_migration_admin_users_groups.sql \
    sql/db_migration_admin_extra.sql \
    sql/db_migration_organizations.sql \
    sql/db_migration_visibility_columns.sql \
    sql/db_migration_episode_script_segments.sql \
    sql/db_migration_storyboard_pipeline_fields.sql \
    sql/db_migration_media_library_folders.sql; do
    psql -U "${DB_USER}" -d "${DB_NAME}" -h localhost -f "$f" 2>/dev/null || true
done
unset PGPASSWORD
echo "数据库初始化完成"

# ── 4. 启动 Redis ────────────────────────────────────────────────────
echo "[4/8] 启动 Redis..."
sudo systemctl start redis-server
sudo systemctl enable redis-server
redis-cli ping

# ── 5. Python 虚拟环境 + 依赖 ────────────────────────────────────────
echo "[5/8] 安装 Python 依赖..."
cd "${DEPLOY_DIR}"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt -q
echo "Python 依赖安装完成"

# ── 6. 创建目录 ──────────────────────────────────────────────────────
echo "[6/8] 创建目录结构..."
mkdir -p logs uploads outputs outputs/agent temp temp/uploads history
mkdir -p persistent_storage/audio persistent_storage/uploads \
         persistent_storage/video persistent_storage/image
chmod -R 755 "${DEPLOY_DIR}"

# ── 7. 配置 Nginx ────────────────────────────────────────────────────
echo "[7/8] 配置 Nginx..."
sudo tee /etc/nginx/sites-available/drama > /dev/null <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:6006;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location /api/tasks/events {
        proxy_pass http://127.0.0.1:6006;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:6006;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/drama /etc/nginx/sites-enabled/drama
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
sudo systemctl enable nginx

# ── 8. 创建 systemd 服务 ─────────────────────────────────────────────
# ⚠️ 下方所有 __FILL_ME__ 替换为真实密钥（参考 local_start.ps1）。
echo "[8/8] 创建 systemd 服务..."
sudo tee /etc/systemd/system/drama.service > /dev/null <<SERVICE
[Unit]
Description=Drama AI Backend
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=Administrator
WorkingDirectory=${DEPLOY_DIR}
Environment="PYTHONUTF8=1"
Environment="DB_HOST=localhost"
Environment="DB_PORT=5432"
Environment="DB_NAME=${DB_NAME}"
Environment="DB_USER=${DB_USER}"
Environment="DB_PASSWORD=${DB_PASS}"
Environment="SUPER_ADMIN_PASSWORD=__FILL_ME__"
Environment="REDIS_HOST=localhost"
Environment="REDIS_PORT=6379"
Environment="AGENT_ONLY_MODE=true"
Environment="LITE_WORKERS_COUNT=2"
Environment="CLUSTER_URL=http://${DOMAIN}"
Environment="GEMINI_API_KEY=__FILL_ME__"
Environment="DEEPSEEK_API_KEY=__FILL_ME__"
Environment="ARK_API_KEY=__FILL_ME__"
Environment="GEMINI_TEXT_API_KEY=__FILL_ME__"
Environment="GEMINI_IMAGE_API_KEY=__FILL_ME__"
Environment="MINIMAX_API_KEY=__FILL_ME__"
Environment="SORA2_API_KEY=__FILL_ME__"
Environment="DASHSCOPE_API_KEY=__FILL_ME__"
ExecStart=${DEPLOY_DIR}/.venv/bin/python -m uvicorn cluster_main:app --host 0.0.0.0 --port 6006
Restart=always
RestartSec=5
StandardOutput=append:${DEPLOY_DIR}/logs/backend.log
StandardError=append:${DEPLOY_DIR}/logs/backend.log

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable drama
sudo systemctl start drama

echo ""
echo "=========================================="
echo "  部署完成！"
echo "  访问地址：http://${DOMAIN}"
echo "  管理后台：http://${DOMAIN}/admin/"
echo "  账号：admin / admin123"
echo "=========================================="
echo ""
echo "查看日志：sudo journalctl -u drama -f"
echo "服务状态：sudo systemctl status drama"
