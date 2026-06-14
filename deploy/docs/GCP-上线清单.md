# GCP 全新空库上线清单（refactor/v2）

> 目标：在一台全新 GCP 虚机上，从零部署出一套**完全干净**的环境（无任何测试/demo 数据）。
> 适用：本地数据不迁移，线上从空库开始。照着一步步做即可。
>
> 架构：FastAPI 后端（端口 **6006**，同时服务前端 `dist/` 静态包）+ PostgreSQL + Redis。
> 图像/视频/语音全走外部 API 网关（laozhang / Gemini / MiniMax / 百炼 / 火山），**服务器不需要 GPU**。

---

## 0. 服务器选型（GCP）

| 用途 | 机型 | 说明 |
|---|---|---|
| 测试 / 小规模 | `e2-standard-4`（4 vCPU / 16 GB） | 后端 + Postgres + Redis 同机即可 |
| 正式 | `e2-standard-8`（8 vCPU / 32 GB） + Cloud SQL + Memorystore | DB/缓存托管，后端单跑 |

- 磁盘：50 GB+ SSD（生成的图/视频/音频存 `persistent_storage/`，按量增长）。
- 操作系统：Ubuntu 22.04 LTS。
- **不需要 GPU**（出图走 API；除非你要自建 ComfyUI agent 才需要 GPU，另算）。

---

## 1. 前置软件

```bash
sudo apt update && sudo apt install -y python3.12 python3.12-venv python3-pip git postgresql postgresql-contrib redis-server nginx
# Node 20（构建前端）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo systemctl enable --now postgresql redis-server
```

> 用 Cloud SQL / Memorystore 的话，跳过本机 postgresql / redis-server，记下它们的连接地址备用。

---

## 2. 拉代码 + Python 依赖

```bash
git clone git@git.5kcrm.cn:qee/Drama.git
cd Drama/deploy
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 3. 建库 + 跑迁移（产出干净 schema）

```bash
# 建库 + 账号（按需改密码）
sudo -u postgres psql <<'SQL'
CREATE USER my2_user WITH PASSWORD '换成强密码';
CREATE DATABASE my2_db OWNER my2_user;
SQL

# 跑基础 schema，再跑所有迁移（迁移均为 IF NOT EXISTS 守卫，顺序容错；某条因顺序报错就再跑一遍整轮）
export PGPASSWORD='上面的强密码'
psql -h 127.0.0.1 -U my2_user -d my2_db -f database_schema.sql
for f in $(ls db_migration_*.sql | sort); do
  echo ">> $f"; psql -h 127.0.0.1 -U my2_user -d my2_db -f "$f"
done
```

迁移里的 `INSERT` 全是**必要配置默认值**（系统配置 / 积分规则 / API 占位卡）——**零用户内容**，这就是「完全干净」的库。

---

## 4. 配置密钥（仓库里没有，必须自己填）

复制模板，填入团队负责人提供的真实密钥：

```bash
cp .env.example .env
nano .env
```

至少需要的变量（变量名固定，值找团队要）：

| 变量 | 用途 |
|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | 数据库连接（DB_NAME=my2_db, DB_USER=my2_user）|
| `REDIS_HOST` `REDIS_PORT` | Redis |
| `DEEPSEEK_API_KEY` | DeepSeek 文本（化神推断兜底）|
| `GEMINI_TEXT_API_KEY` `GEMINI_IMAGE_API_KEY` `GEMINI_API_KEY` | Gemini 文本/图像（化神）走 laozhang 网关 |
| `MINIMAX_API_KEY` | MiniMax 配音 TTS + 视频 |
| `ARK_API_KEY` | 火山方舟（豆包/Seedance）|
| `DASHSCOPE_API_KEY` | 阿里百炼（Wan/Kling/Vidu）|
| `SORA2_API_KEY` | Sora2（laozhang 网关）|
| `SUPER_ADMIN_PASSWORD` | 超级管理员 lllsdhr 密码 |
| `LITE_WORKERS_COUNT` | 轻 worker 数（建议 2~4）|
| `AGENT_ONLY_MODE` | `false`（无 ComfyUI agent 时）|

> 安全：`.env` 已被 gitignore，**绝不要提交**。密钥来源分散（部分在数据库 API 配置表里，上线后也可在后台「系统设置 › API 厂商配置」补填）。

---

## 5. 构建前端

```bash
cd new_html
npm install
npm run build   # 产物输出到 ../dist（后端 6006 直接服务它）
cd ..
```

> `dist/` 是 gitignore 的，**必须现场构建**。以后更新代码 → `git pull` → 重新 `npm run build` 即可（index.html 已设 no-cache，用户普通刷新就能拿到新版）。

---

## 6. 启动后端（systemd 守护）

`/etc/systemd/system/drama.service`：

```ini
[Unit]
Description=Drama backend (FastAPI 6006)
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Drama/deploy
EnvironmentFile=/home/ubuntu/Drama/deploy/.env
ExecStart=/home/ubuntu/Drama/deploy/.venv/bin/uvicorn cluster_main:app --host 0.0.0.0 --port 6006
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now drama
sudo systemctl status drama   # 看「Application startup complete」「Uvicorn running」
```

---

## 7. 反向代理 + 防火墙

Nginx（`/etc/nginx/sites-available/drama`）：

```nginx
server {
    listen 80;
    server_name your.domain.com;
    client_max_body_size 200m;
    location / {
        proxy_pass http://127.0.0.1:6006;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # 生成类请求耗时长，超时拉高，避免 504
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/drama /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

- GCP 防火墙：放行 **80/443**（不要直接对外暴露 6006）。
- 域名 + HTTPS：`sudo certbot --nginx`（装 `python3-certbot-nginx`）。

---

## 8. ⚠️ 安全：改默认管理员密码（上线必做）

默认 `admin / admin123` —— **任何人都能进后台，必须改**：

```bash
# 方式一：改代码里的默认密码（cluster_main.py DEFAULT_USERS['admin']）后重启
# 方式二（推荐）：上线后用 admin 登录 → 后台「账号管理」给 admin 重置一个强密码
```

> `require_admin` 内置允许 `admin / lllsdhr`，启动时 `seed_admin_roles` 自动把它们的角色校正为 admin/super_admin —— **admin 开箱即可进后台，无需手动改库**。

---

## 9. 上线验证（冒烟）

逐项确认：

- [ ] `systemctl status drama` 正常，日志有 `Application startup complete`
- [ ] 浏览器开域名 → 登录页正常 → admin 登录成功
- [ ] 后台 `/admin` 各面板能打开（账号/积分/素材/审计/系统设置）
- [ ] 「系统设置 › API 厂商配置」把缺的真实密钥补上、点测试通过
- [ ] 新建一个项目 → 跑一遍：剧本 → 设计出图（**默认化神，走 API 不卡**）→ 配音 → 分镜 → 视频
- [ ] 改完默认 admin 密码

---

## 10. 日常更新流程

```bash
cd /home/ubuntu/Drama && git pull
cd deploy && source .venv/bin/activate && pip install -r requirements.txt   # 依赖有变才需要
# 若有新迁移：再跑一遍第 3 步的迁移循环（IF NOT EXISTS 幂等，安全）
cd new_html && npm install && npm run build && cd ..
sudo systemctl restart drama
```

> index.html 不缓存、JS 带哈希永久缓存 —— 更新后用户**普通刷新**即可拿到新版。

---

## 备注

- 出图默认走**化神（Gemini 网关）**，无需 GPU。`练气/筑基/K神` 等 ComfyUI 档位需自建 GPU agent，不接会卡——UI 里已对这些档位做了「需 GPU Agent」提示。
- 长任务（批量配音/视频）走 worker 异步 + 轮询，已规避反代 idle 超时；反代 `proxy_read_timeout` 仍建议 ≥600s。
- 数据库/Redis 用托管服务（Cloud SQL / Memorystore）时，只需把第 3、4 步的连接地址换成托管实例地址。
