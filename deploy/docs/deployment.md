# MY2 (Storyboard Copilot) — 安装部署指南

> 最后更新：2026-05-03

---

## 1. 系统要求

| 组件 | 最低要求 | 推荐 |
|------|---------|------|
| 操作系统 | Ubuntu 20.04+ / CentOS 8+ / Windows WSL2 | Ubuntu 22.04 LTS |
| Python | 3.9+ | 3.11+ |
| Node.js | 18+ | 20 LTS |
| PostgreSQL | 14+ | 14 |
| Redis | 6+ | 7+ |
| 内存 | 4 GB | 8 GB+ |
| 磁盘 | 20 GB | 100 GB+（含生成资源存储） |
| GPU（可选） | NVIDIA GPU + CUDA | 用于 ComfyUI 图片/视频生成 |

---

## 2. 架构总览

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  前端 (Vite)  │────▶│  后端 (FastAPI)    │────▶│  PostgreSQL   │
│  :3000 / :5173│     │  :6006 (:8000)    │     │  :5432        │
└──────────────┘     └───────┬──────────┘     └──────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
               ┌────▼────┐     ┌─────▼─────┐
               │  Redis   │     │  ComfyUI   │
               │  :6379   │     │  Worker(s) │
               └─────────┘     │  :8188+    │
                               └───────────┘
```

| 服务 | 默认端口 | 说明 |
|------|---------|------|
| FastAPI 后端 | 6006 | API 服务、静态文件、管理后台 |
| Vite 前端（开发） | 3000 | 开发模式热更新，代理 `/api` → 后端 |
| PostgreSQL | 5432 | 主数据库，61 张表 |
| Redis | 6379 | 任务队列 + SSE Pub/Sub |
| ComfyUI | 8188, 8189... | GPU Worker 节点（图片/视频生成） |

---

## 3. 快速开始（一键脚本）

如果你在 Linux 环境下，可以使用一键部署脚本：

```bash
# 首次部署（含数据库创建）
sudo bash deploy_database.sh

# 启动全部服务
bash start_cluster.sh
```

脚本会自动完成：检查依赖 → 启动 Redis → 检查/初始化数据库 → 安装 Python 依赖 → 创建目录 → 验证配置 → 启动后端服务。

如需手动逐步安装，请继续阅读以下章节。

---

## 4. 手动安装步骤

### 4.1 安装系统依赖

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv \
    postgresql postgresql-contrib libpq-dev \
    redis-server \
    ffmpeg \
    nodejs npm
```

**验证：**

```bash
python3 --version   # >= 3.9
node --version       # >= 18
psql --version       # >= 14
redis-cli --version  # >= 6
ffmpeg -version
```

### 4.2 配置 PostgreSQL

```bash
# 启动 PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 创建数据库和用户
sudo -u postgres psql <<EOF
CREATE DATABASE my2_db;
CREATE USER my2_user WITH PASSWORD '你的密码';
GRANT ALL PRIVILEGES ON DATABASE my2_db TO my2_user;
\c my2_db
GRANT ALL ON SCHEMA public TO my2_user;
EOF
```

**初始化表结构：**

```bash
# 执行主 schema
PGPASSWORD='你的密码' psql -U my2_user -d my2_db -f deploy/sql/database_schema.sql

# 执行迁移脚本（按顺序）
for f in \
    deploy/sql/db_migration_project_hub.sql \
    deploy/sql/db_migration_add_permissions.sql \
    deploy/sql/db_migration_notifications.sql \
    deploy/sql/db_migration_episodes.sql \
    deploy/sql/db_migration_assets.sql \
    deploy/sql/db_migration_episode_scripts.sql \
    deploy/sql/db_migration_storyboard_items.sql \
    deploy/sql/db_migration_video_segments.sql \
    deploy/sql/db_migration_timeline_tracks.sql \
    deploy/sql/db_migration_audio_tracks.sql \
    deploy/sql/db_migration_admin.sql \
    deploy/sql/db_migration_multi_scripts.sql \
    deploy/sql/db_migration_script_id.sql; do
    PGPASSWORD='你的密码' psql -U my2_user -d my2_db -f "$f" 2>/dev/null || true
done
```

### 4.3 启动 Redis

```bash
# 直接启动（后台模式）
redis-server --daemonize yes

# 验证
redis-cli ping   # 应返回 PONG
```

### 4.4 安装 Python 依赖

```bash
# 建议使用虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

核心依赖列表：

| 包 | 版本 | 用途 |
|---|------|------|
| fastapi | 0.109.0 | Web 框架 |
| uvicorn | 0.27.0 | ASGI 服务器 |
| asyncpg | 0.29.0 | PostgreSQL 异步驱动 |
| redis | 5.0.1 | Redis 客户端 |
| openai | >=1.35.0 | DeepSeek/OpenAI 兼容 LLM |
| Pillow | 10.2.0 | 图片处理 |
| aiohttp | 3.9.1 | 异步 HTTP 客户端 |
| python-jose | 3.3.0 | JWT 认证 |
| python-dotenv | 1.0.0 | 环境变量 |

### 4.5 安装前端依赖

```bash
cd new_html
npm install
cd ..
```

### 4.6 创建目录结构

```bash
mkdir -p uploads outputs outputs/agent temp logs
mkdir -p persistent_storage/videos persistent_storage/images persistent_storage/temp persistent_storage/audio persistent_storage/uploads
mkdir -p redis_data
```

---

## 5. 环境变量配置

### 5.1 后端环境变量

通过 `export` 或写入 `.env` 文件配置（后端自动从环境变量读取）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_HOST` | `localhost` | PostgreSQL 地址 |
| `DB_PORT` | `5432` | PostgreSQL 端口 |
| `DB_NAME` | `my2_db` | 数据库名 |
| `DB_USER` | `my2_user` | 数据库用户 |
| `DB_PASSWORD` | — | 数据库密码（**必填**） |
| `DB_POOL_MIN_SIZE` | `10` | 连接池最小连接数 |
| `DB_POOL_MAX_SIZE` | `50` | 连接池最大连接数 |
| `REDIS_HOST` | `localhost` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | — | Redis 密码（无密码可留空） |
| `JWT_SECRET_KEY` | `messiah-default-jwt-secret-2026` | JWT 签名密钥（**生产环境必须修改**） |
| `COMFYUI_HOST` | `127.0.0.1` | ComfyUI 服务地址 |
| `COMFYUI_PORT` | `8188` | ComfyUI 服务端口 |
| `AGENT_ONLY_MODE` | `true` | 是否启用 Agent-Only 模式。`true`（默认）：不创建本地 `ClusterManager`，ComfyUI workflow 任务交给外部 agent；同时启动 N 个 **lite Worker** 消费外部 API 任务（minimax_tts / seedance / kling / vidu / happyhorse / sora2 / veo / wan26 / video_reverse_prompt）。`false`：传统模式，启动完整 ClusterManager + 4 个本地 Worker，会与外部 agent 抢 ComfyUI 任务（**不推荐**，见 docs/faq.md 2026-05-26 "AGENT_ONLY_MODE 二选一陷阱"） |
| `LITE_WORKERS_COUNT` | `2` | `AGENT_ONLY_MODE=true` 时启动的 lite Worker 数量。lite Worker 只消费外部 API 任务，ComfyUI workflow 任务会被丢回 Redis 队列让外部 agent 通过 `/api/agent/poll` 取走。设 `0` 关闭外部 API 任务消费（不推荐，会让 minimax_tts 等死队列）；外部 API 任务并发量大可调到 4-8 |

### 5.2 AI 服务 API Key

可在 `start_cluster.sh` 头部配置，或通过管理后台动态设置：

| 变量 | 说明 | 配置方式 |
|------|------|---------|
| `DEEPSEEK_API_KEY` | DeepSeek 文本/剧本 LLM | 环境变量或管理后台 |
| `ARK_API_KEY` | 豆包(ByteDance) 图片生成 | 环境变量或管理后台 |
| `MINIMAX_API_KEY` | MiniMax TTS 配音/音乐 | 环境变量或管理后台 |
| `GEMINI_TEXT_API_KEY` | Gemini 文本生成代理 | 环境变量或管理后台 |
| `GEMINI_IMAGE_API_KEY` | Gemini 图片生成代理 | 环境变量或管理后台 |
| `DASHSCOPE_API_KEY` | 通义千问 | 环境变量或管理后台 |
| `SORA2_API_KEY` | Sora2 视频生成 | 环境变量或管理后台 |

API Key 支持两种管理方式：
1. **环境变量**：启动时通过 `export` 设置，适合开发/单机
2. **管理后台**：访问 `http://<host>:6006/admin/` → API 配置页面，运行时动态生效（AES 加密存储在 `api_configs` 表）

### 5.3 前端环境变量

前端环境变量写在 `new_html/.env` 中：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek 客户端直连（如需） |
| `VITE_GEMINI_TEXT_API_KEY` | Gemini 文本代理 Key |
| `VITE_GEMINI_IMAGE_API_KEY` | Gemini 图片代理 Key |

---

## 6. 启动服务

### 6.1 启动后端

```bash
# 设置环境变量
export DB_PASSWORD="你的密码"
export DEEPSEEK_API_KEY="sk-xxx"
# ... 其他 API Key

# 启动（前台模式，方便调试）
python3 cluster_main.py

# 或后台模式
nohup python3 cluster_main.py > logs/cluster_main.log 2>&1 &
```

后端监听 `0.0.0.0:6006`（由 `cluster_config.py` 的 `SystemConfig.PORT` 控制）。

启动时自动完成：
- 创建 `uploads/`、`outputs/`、`temp/`、`logs/` 目录
- 初始化 PostgreSQL 连接池
- 连接 Redis
- 启动 ComfyUI Worker（如有配置）
- 从数据库加载 API 配置到环境变量
- 挂载静态文件路由 `/storage/`

### 6.2 启动前端（开发模式）

```bash
cd new_html
npm run dev
```

Vite 开发服务器监听 `0.0.0.0:3000`，自动代理 `/api` 和 `/uploads` 到后端 `http://localhost:8000`。

### 6.3 前端构建（生产模式）

```bash
cd new_html
npm run build
```

构建产物输出到 `dist/`。后端 FastAPI 可直接 serve `dist/` 下的静态文件。

---

## 7. 生产部署

### 7.1 前端构建 + 后端静态服务

生产环境推荐的部署方式：前端构建为静态文件，由后端 FastAPI 直接提供服务。

```bash
# 1. 构建前端
cd new_html && npm run build && cd ..

# 2. 启动后端（自动 serve dist/）
python3 cluster_main.py
```

所有请求通过后端单端口 (`:6006`) 服务：
- `/api/*` → FastAPI 路由
- `/storage/*` → 文件存储
- `/admin/*` → 管理后台
- `/*` → 前端 SPA

### 7.2 反向代理（Nginx）

如需 Nginx 做前置代理：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:6006;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE 长连接
    location /api/tasks/events {
        proxy_pass http://127.0.0.1:6006;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # WebSocket（如有 ComfyUI 需要）
    location /ws {
        proxy_pass http://127.0.0.1:6006;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 7.3 进程管理（systemd）

创建 systemd 服务文件 `/etc/systemd/system/my2.service`：

```ini
[Unit]
Description=MY2 Storyboard Copilot Backend
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/path/to/MY2
Environment="DB_PASSWORD=你的密码"
Environment="DEEPSEEK_API_KEY=sk-xxx"
Environment="JWT_SECRET_KEY=你的JWT密钥"
ExecStart=/path/to/venv/bin/python3 cluster_main.py
Restart=always
RestartSec=5
StandardOutput=append:/path/to/MY2/logs/cluster_main.log
StandardError=append:/path/to/MY2/logs/cluster_main.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable my2
sudo systemctl start my2
sudo systemctl status my2
```

### 7.4 安全注意事项

| 项目 | 说明 |
|------|------|
| `JWT_SECRET_KEY` | 生产环境必须更换为强随机字符串 |
| `DB_PASSWORD` | 不要使用默认密码，使用强密码 |
| CORS | 默认白名单为 `https://spti.ai` 与本地开发地址；生产如需扩展用 `CORS_ALLOW_ORIGINS` 配置，禁止 `["*"] + credentials` |
| HTTPS | 生产环境必须通过 Nginx + Let's Encrypt 配置 HTTPS |
| 文件存储 | `persistent_storage/` 目录需定期备份 |
| API Key | 不要将 Key 提交到 Git；使用环境变量或管理后台管理 |

---

## 8. ComfyUI Worker 配置（可选）

如需 GPU 图片/视频生成功能，需要配置 ComfyUI Worker。

### 8.1 安装 ComfyUI

参考 [ComfyUI 官方文档](https://github.com/comfyanonymous/ComfyUI) 安装。

### 8.2 配置集群节点

编辑 `cluster_config.py` 中的 `ClusterConfig.NODES`：

```python
NODES = [
    ComfyUINode(
        id="gpu0-image",
        host="127.0.0.1",       # ComfyUI 服务地址
        port=8188,               # ComfyUI 服务端口
        node_type="image",       # image / video / all
        priority=3,              # 优先级（越高越优先）
        max_concurrent=2,        # 最大并发数
        enabled=True
    ),
    # 可添加更多节点...
]
```

节点类型：
- `image`：图片生成节点
- `video`：视频生成节点
- `all`：同时支持图片和视频

### 8.3 远程 Worker 部署

如有远程 GPU 服务器，可通过 `servers_config.yaml` 配置自动部署：

```yaml
servers:
  - host: 192.168.1.100
    port: 8188
    ssh_user: deploy
    ssh_password: xxx
    start_script: /opt/comfyui/start.sh
```

---

## 9. 数据库维护

### 9.1 备份

```bash
pg_dump -U my2_user -d my2_db -F c -f backup_$(date +%Y%m%d).dump
```

### 9.2 恢复

```bash
pg_restore -U my2_user -d my2_db -c backup_20260503.dump
```

### 9.3 迁移

新增迁移脚本放在 `deploy/sql/` 下，命名规则 `db_migration_<功能名>.sql`。执行：

```bash
PGPASSWORD='密码' psql -U my2_user -d my2_db -f deploy/sql/db_migration_xxx.sql
```

---

## 10. 目录结构说明

```
MY2/
├── cluster_main.py           # 后端主入口（FastAPI）
├── api_routes.py             # 数据 CRUD API
├── agent_routes.py           # Agent 管理 API
├── admin_routes.py           # 管理后台 API
├── worker.py                 # ComfyUI Worker
├── db_manager.py             # 数据库连接池
├── cluster_config.py         # 集群/Redis/系统配置
├── config.py                 # ComfyUI/存储配置
├── jwt_auth.py               # JWT 认证
├── dao_*.py                  # 数据访问层（20+ 文件）
├── requirements.txt          # Python 依赖
├── start_cluster.sh          # 一键启动脚本
├── deploy_database.sh        # 数据库初始化脚本
│
├── new_html/                 # 前端源码（React + TypeScript + Vite）
│   ├── package.json
│   ├── vite.config.ts
│   ├── .env                  # 前端环境变量
│   ├── App.tsx               # 路由入口
│   ├── pages/                # 页面组件
│   ├── components/           # 通用组件
│   ├── services/             # API 调用层
│   ├── hooks/                # React Hooks
│   ├── contexts/             # React Context
│   └── utils/                # 工具函数
│
├── deploy/                   # 部署镜像（后端+前端+SQL 完整副本）
│   ├── sql/                  # 数据库 schema + 迁移脚本
│   ├── scripts/              # 部署辅助脚本
│   ├── auto_deploy.sh        # 一键自动部署
│   └── new_html/             # 前端副本
│
├── admin/                    # 管理后台静态文件
├── persistent_storage/       # 持久化文件存储
│   ├── images/
│   ├── videos/
│   ├── audio/
│   └── temp/
├── uploads/                  # 用户上传临时目录
├── outputs/                  # 生成结果临时目录
└── logs/                     # 日志目录
    ├── cluster_main.log
    ├── cluster.log
    └── frontend.log
```

---

## 11. 常用运维命令

### 服务管理

```bash
# 启动
bash start_cluster.sh

# 停止后端
pkill -f cluster_main.py

# 停止前端开发服务器
pkill -f "npm run dev"
pkill -f "node.*vite"

# 查看日志
tail -f logs/cluster_main.log    # 后端日志
tail -f logs/cluster.log         # 集群日志
```

### 数据库

```bash
# 连接数据库
psql -U my2_user -d my2_db

# 查看表列表
psql -U my2_user -d my2_db -c "\dt"

# 查看用户
psql -U my2_user -d my2_db -c "SELECT user_id, username, is_active FROM users;"

# 清理僵尸任务（也可通过管理后台操作）
curl -X POST http://localhost:6006/api/admin/tasks/cleanup
```

### Redis

```bash
redis-cli ping                          # 测试连接
redis-cli info memory                   # 内存使用
redis-cli llen comfyui:task_queue       # 任务队列长度
redis-cli keys "comfyui:task:*"         # 查看任务键
```

---

## 12. 管理员账号

生产环境必须通过环境变量显式配置管理员密码：

```bash
ADMIN_PASSWORD=<强密码，至少 8 位>
```

如果 `ADMIN_PASSWORD` 未配置，内置 `admin` 登录会被禁用。仅本地开发可显式设置
`ALLOW_DEV_ADMIN_PASSWORD=true` 后使用临时开发弱口令 `admin / admin123`。

---

## 13. 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面（开发模式） | `http://localhost:3000` |
| 前端界面（Vite 默认） | `http://localhost:5173` |
| 后端 API | `http://localhost:6006` |
| API 文档（Swagger） | `http://localhost:6006/docs` |
| 管理后台 | `http://localhost:6006/admin/` |

---

## 14. 故障排查

| 症状 | 排查步骤 |
|------|---------|
| 后端启动失败 | 检查 `logs/cluster_main.log`，确认 PostgreSQL 和 Redis 已启动 |
| 数据库连接失败 | 确认 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` 环境变量正确 |
| Redis 连接失败 | 运行 `redis-cli ping`，确认 Redis 服务正常 |
| 前端代理 404 | 确认后端已启动在 `:6006` 或 `:8000`，检查 `vite.config.ts` 的 proxy 配置 |
| AI 生图/文字功能不可用 | 检查对应 API Key 是否配置，访问管理后台查看 API 配置状态 |
| ComfyUI 任务卡住 | 检查 ComfyUI 节点是否在线，查看管理后台仪表盘队列状态 |
| SSE 连接断开 | 检查 Nginx `proxy_read_timeout`，确保 SSE 端点不被超时断开 |
| 文件上传失败 | 检查 `persistent_storage/` 目录权限，Nginx `client_max_body_size` 设置 |

更多已知问题和修复方案参见 `docs/faq.md`。
