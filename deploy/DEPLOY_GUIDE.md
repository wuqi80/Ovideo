# MY2 云端部署运行指南

> 本文档面向云端 AI 自动部署。按照以下步骤顺序执行即可完成部署。

---

## 一、环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Python | 3.9+ | 后端运行时 |
| Node.js | 18+ | 前端构建 |
| PostgreSQL | 14+ | 主数据库 |
| Redis | 6+ | 任务队列 / 缓存 |
| ComfyUI | latest | 图像/视频生成后端 (可选，生成功能依赖) |

---

## 二、目录结构

```
deploy/
├── DEPLOY_GUIDE.md          # 本文档
├── *.py                     # 后端 Python 源码 (约 50 个文件)
├── requirements.txt         # Python 全部依赖 (单文件)
├── pytest.ini               # 测试配置
├── redis.conf               # Redis 配置
├── metadata.json            # 项目元数据
├── comfyui_agent.py         # GPU Agent 脚本 (部署到 GPU 服务器)
├── sql/                     # 数据库迁移脚本
│   ├── database_schema.sql  # 核心表结构
│   ├── db_migration_*.sql   # 增量迁移 (10 个)
│   └── db_migration_admin.sql  # 管理后台表 (Agent/工作流/API配置)
├── admin/                   # 管理后台前端 (独立 HTML/JS/CSS)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/                 # 部署脚本
├── tests/                   # 后端测试
├── workflows/               # ComfyUI 工作流 JSON
└── new_html/                # 前端 React SPA
    ├── package.json
    ├── vite.config.ts
    ├── App.tsx
    ├── pages/
    ├── components/
    ├── contexts/
    ├── services/
    └── ...
```

---

## 三、部署步骤

### 步骤 1: 创建项目目录

```bash
mkdir -p /opt/my2
cd /opt/my2

# 将 deploy/ 的所有内容上传到这里
# 假设所有文件已放在 /opt/my2/
```

### 步骤 2: 安装 Python 依赖

```bash
# 所有依赖已合并为单个文件
pip install -r requirements.txt

```

### 步骤 3: 配置环境变量

在项目根目录创建 `.env` 文件：

```bash
cat > .env << 'EOF'
# ===== 数据库 =====
DB_HOST=localhost
DB_PORT=5432
DB_NAME=my2_db
DB_USER=my2_user
DB_PASSWORD=你的数据库密码
DB_POOL_MIN_SIZE=10
DB_POOL_MAX_SIZE=50

# ===== Redis =====
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ===== JWT 认证 =====
JWT_SECRET_KEY=你的JWT密钥-请更换为随机字符串
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=720

# ===== 存储 =====
STORAGE_TYPE=local
STORAGE_BASE_PATH=./persistent_storage
MAX_UPLOAD_SIZE=1073741824

# ===== ComfyUI (可选) =====
COMFYUI_HOST=127.0.0.1
COMFYUI_PORT=8188

# ===== AI API 密钥 =====
DASHSCOPE_API_KEY=你的DashScope密钥
OPENAI_API_KEY=你的OpenAI密钥

# ===== 系统 =====
LOG_LEVEL=INFO
AUDIO_UPLOAD_DIR=persistent_storage/audio
EOF
```

### 步骤 4: 初始化 PostgreSQL

```bash
# 创建数据库和用户
sudo -u postgres psql << 'EOF'
CREATE USER my2_user WITH PASSWORD '你的数据库密码';
CREATE DATABASE my2_db OWNER my2_user;
GRANT ALL PRIVILEGES ON DATABASE my2_db TO my2_user;
\c my2_db
GRANT ALL ON SCHEMA public TO my2_user;
EOF
```

### 步骤 5: 执行数据库迁移

**必须按顺序执行：**

```bash
export PGPASSWORD="你的数据库密码"

# 1. 核心表结构
psql -U my2_user -d my2_db -h localhost -f sql/database_schema.sql

# 2. 增量迁移 (按依赖顺序)
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_project_hub.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_add_permissions.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_notifications.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_episodes.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_assets.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_episode_scripts.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_storyboard_items.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_video_segments.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_timeline_tracks.sql
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_audio_tracks.sql

# 3. 管理后台表 (Agent/工作流模板/API配置/系统设置/任务历史)
psql -U my2_user -d my2_db -h localhost -f sql/db_migration_admin.sql
```

**如果 psql 不可用，用 Python 执行：**

```python
import asyncio, asyncpg, glob, os

async def run_migrations():
    conn = await asyncpg.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', '5432')),
        database=os.getenv('DB_NAME', 'my2_db'),
        user=os.getenv('DB_USER', 'my2_user'),
        password=os.getenv('DB_PASSWORD', '你的数据库密码')
    )

    sql_order = [
        'sql/database_schema.sql',
        'sql/db_migration_project_hub.sql',
        'sql/db_migration_add_permissions.sql',
        'sql/db_migration_notifications.sql',
        'sql/db_migration_episodes.sql',
        'sql/db_migration_assets.sql',
        'sql/db_migration_episode_scripts.sql',
        'sql/db_migration_storyboard_items.sql',
        'sql/db_migration_video_segments.sql',
        'sql/db_migration_timeline_tracks.sql',
        'sql/db_migration_audio_tracks.sql',
        'sql/db_migration_admin.sql',
    ]

    for f in sql_order:
        if os.path.exists(f):
            print(f'执行 {f} ...')
            sql = open(f, 'r', encoding='utf-8').read()
            try:
                await conn.execute(sql)
                print(f'  OK')
            except Exception as e:
                print(f'  跳过 (可能已存在): {e}')

    await conn.close()
    print('迁移完成')

asyncio.run(run_migrations())
```

### 步骤 6: 初始化存储目录

```bash
mkdir -p persistent_storage/audio
mkdir -p persistent_storage/uploads
mkdir -p persistent_storage/video
mkdir -p uploads
mkdir -p outputs
mkdir -p outputs/agent
mkdir -p temp
mkdir -p history
mkdir -p logs
```

### 步骤 7: 启动 Redis

```bash
# 使用项目提供的配置（或系统默认）
redis-server redis.conf --daemonize yes

# 验证
redis-cli ping
# 应返回 PONG
```

### 步骤 8: 构建前端

```bash
cd new_html

# 安装依赖
npm install

# 创建前端环境变量（如果需要 Gemini 浏览器端调用）
cat > .env << 'EOF'
EOF

# 构建生产版本
npm run build
# 输出到 ../dist/

cd ..
```

### 步骤 9: 启动后端

```bash
# 方式 A: 使用 cluster_main.py (推荐, 包含完整功能)
python cluster_main.py

# 方式 B: 使用 uvicorn 直接启动
# uvicorn cluster_main:app --host 0.0.0.0 --port 8000

# 后台运行
nohup python cluster_main.py > logs/server.log 2>&1 &
```

**服务端口说明：**

| 端口 | 用途 |
|------|------|
| 8000 | 后端 API + 静态文件服务 |
| 8000/admin/ | ComfyUI 集群管理后台 |
| 3000 | 前端 Vite 开发服务器 (仅开发时) |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 8188 | ComfyUI 节点（单入口、串行模型切换） |

### 步骤 10: 验证部署

```bash
# 1. 检查后端健康
curl http://localhost:8000/api/health
# 应返回 {"status": "ok"} 或类似

# 2. 访问前端
# 生产模式: http://你的IP:8000 (后端直接提供 dist/ 静态文件)
# 开发模式: cd new_html && npm run dev  → http://你的IP:3000

# 3. 检查数据库连接
python -c "
import asyncio
from db_manager import init_db_manager
async def check():
    db = await init_db_manager()
    result = await db.fetchval('SELECT 1')
    print(f'数据库连接: OK (结果={result})')
    await db.disconnect()
asyncio.run(check())
"

# 4. 检查管理后台
# 浏览器访问: http://你的IP:8000/admin/
```

### 步骤 11: 管理后台

后端启动后，管理后台自动可用：

```
http://你的IP:8000/admin/
```

功能包括：
- **集群管理** — 注册 GPU Agent、查看状态、生成 Token
- **工作流模板** — 上传/编辑 ComfyUI 工作流 JSON、配置占位符
- **API 配置** — 管理 AI API (Gemini/Deepseek 等)、设置代理模式
- **仪表盘** — 实时监控 Agent 状态、任务队列、健康状况

### 步骤 12: GPU Agent 部署

在每台 GPU 服务器上部署 Agent 脚本：

```bash
# 1. 复制 Agent 脚本到 GPU 服务器
scp comfyui_agent.py user@gpu-server:/opt/agent/

# 2. 安装依赖 (仅需 requests)
pip install requests

# 3. 在管理后台 (步骤 11) 创建 Agent 获取 Token

# 4. 启动 Agent (指定后端地址、Token、ComfyUI 端口)
python comfyui_agent.py \
  --server http://后端IP:8000 \
  --token sk-agent-xxxxxxxx \
  --ports 8188

# 后台运行
nohup python comfyui_agent.py \
  --server http://后端IP:8000 \
  --token sk-agent-xxxxxxxx \
  --ports 8188 \
  > /var/log/comfyui-agent.log 2>&1 &
```

Agent 会自动：
- 向后端注册并报告心跳 (每 3 秒)
- 扫描本地 ComfyUI 实例健康状态
- 轮询任务队列并执行 (ComfyUI 生图/视频 或 AI API 代理请求)
- 上传结果文件回后端

---

## 四、运行测试

### 后端测试

```bash
# 运行不依赖数据库的测试 (推荐先跑)
python -m pytest tests/test_smoke.py tests/test_audio_provider.py -v

# 运行全部后端测试 (需要数据库连接)
python -m pytest tests/ -v

# 带覆盖率
python -m pytest tests/ -v --tb=short
```

### 前端测试

```bash
cd new_html

# 运行全部前端测试
npx vitest run

# 带覆盖率
npx vitest run --coverage

cd ..
```

### 预期测试结果

| 测试集 | 数量 | 说明 |
|-------|------|------|
| tests/test_smoke.py | 2 | 后端基础断言 |
| tests/test_audio_provider.py | 5 | 音频服务 (mock, 无需API) |
| tests/test_dao_*.py (9个) | ~40 | DAO 层 (需要数据库，含 Agent/工作流/API配置) |
| __tests__/smoke.test.ts | 2 | 前端基础断言 |
| __tests__/services/apiService.test.ts | 11 | API 接口 (mock) |
| __tests__/contexts/EpisodeContext.test.tsx | 5 | 集上下文 |
| __tests__/routing/routing.test.tsx | 8 | 路由验证 |
| **总计** | **~58** | |

---

## 五、生产部署建议

### 使用 systemd 管理进程

```bash
cat > /etc/systemd/system/my2.service << 'EOF'
[Unit]
Description=MY2 API Server
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/my2
ExecStart=/usr/bin/python3 cluster_main.py
Restart=always
RestartSec=5
Environment=PYTHONDONTWRITEBYTECODE=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable my2
systemctl start my2
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /opt/my2/dist;
        try_files $uri $uri/ /index.html;
    }

    # 管理后台
    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API 代理 (含 /api/admin/, /api/agent/)
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 上传文件代理
    location /uploads/ {
        proxy_pass http://127.0.0.1:8000;
        client_max_body_size 1G;
    }

    # WebSocket 代理 (SSE / WS)
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 六、常见问题

### Q: 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
systemctl status postgresql

# 检查用户权限
sudo -u postgres psql -c "\du"

# 检查 pg_hba.conf 允许本地连接
# 确保有: local all my2_user md5
```

### Q: Redis 连接失败

```bash
redis-cli ping
# 如果无响应: redis-server --daemonize yes
```

### Q: 前端构建失败

```bash
cd new_html
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Q: pip install 网络问题

```bash
# 使用清华源
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/
```

### Q: 端口被占用

```bash
# 查看占用
lsof -i :8000
# 杀掉
kill -9 <PID>
```

### Q: 迁移 SQL 报 "already exists"

这是正常的。迁移脚本使用 `IF NOT EXISTS`，重复执行不会出错。忽略这些警告即可。

---

## 七、一键部署脚本

如果你想全自动执行以上所有步骤，运行：

```bash
#!/bin/bash
set -e

echo "=== MY2 自动部署 ==="

# 1. 安装 Python 依赖
echo "[1/8] 安装 Python 依赖..."
pip install -r requirements.txt -q

# 2. 创建目录
echo "[2/8] 创建目录..."
mkdir -p persistent_storage/audio persistent_storage/uploads persistent_storage/video
mkdir -p uploads outputs outputs/agent temp history logs

# 3. 启动 Redis
echo "[3/8] 启动 Redis..."
redis-server --daemonize yes 2>/dev/null || echo "Redis 已在运行"

# 4. 初始化数据库
echo "[4/8] 初始化数据库..."
if command -v psql &> /dev/null; then
    for f in sql/database_schema.sql sql/db_migration_project_hub.sql sql/db_migration_add_permissions.sql sql/db_migration_notifications.sql sql/db_migration_episodes.sql sql/db_migration_assets.sql sql/db_migration_episode_scripts.sql sql/db_migration_storyboard_items.sql sql/db_migration_video_segments.sql sql/db_migration_timeline_tracks.sql sql/db_migration_audio_tracks.sql sql/db_migration_admin.sql; do
        [ -f "$f" ] && psql -U $DB_USER -d $DB_NAME -h ${DB_HOST:-localhost} -f "$f" 2>/dev/null || true
    done
else
    echo "psql 不可用，请手动执行 sql/ 目录下的迁移脚本"
fi

# 5. 构建前端
echo "[5/8] 构建前端..."
cd new_html
npm install --silent
npm run build
cd ..

# 6. 运行测试
echo "[6/8] 运行后端测试..."
python -m pytest tests/test_smoke.py tests/test_audio_provider.py -v

echo "[7/8] 运行前端测试..."
cd new_html && npx vitest run && cd ..

# 8. 启动服务
echo "[8/8] 启动后端服务..."
nohup python cluster_main.py > logs/server.log 2>&1 &
echo "服务已启动 PID=$!"

echo "=== 部署完成 ==="
echo "后端: http://0.0.0.0:8000"
echo "管理后台: http://0.0.0.0:8000/admin/"
echo "前端: 访问后端地址即可 (dist/ 由后端提供)"
```

将以上内容保存为 `auto_deploy.sh` 并执行 `bash auto_deploy.sh`。
