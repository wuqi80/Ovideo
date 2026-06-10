#!/bin/bash
# ============================================
# MY2 数据库改造一键部署脚本
# ============================================

set -e  # 遇到错误立即退出

echo "=========================================="
echo "MY2 数据库改造部署脚本"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}警告: 建议使用sudo运行此脚本${NC}"
fi

# ============================================
# 第一步: 安装依赖
# ============================================
echo -e "${GREEN}[1/6] 安装系统依赖...${NC}"
apt-get update
apt-get install -y ffmpeg postgresql postgresql-contrib libpq-dev python3-dev

echo -e "${GREEN}[1/6] 安装Python依赖...${NC}"
pip install asyncpg aiofiles pillow ffmpeg-python

# ============================================
# 第二步: 配置PostgreSQL
# ============================================
echo -e "${GREEN}[2/6] 配置PostgreSQL...${NC}"

# 检查PostgreSQL是否运行
if ! systemctl is-active --quiet postgresql; then
    systemctl start postgresql
    systemctl enable postgresql
fi

# 创建数据库和用户
echo -e "${YELLOW}创建数据库和用户...${NC}"
sudo -u postgres psql << EOF
-- 如果已存在则先删除
DROP DATABASE IF EXISTS my2_db;
DROP USER IF EXISTS my2_user;

-- 创建新的数据库和用户
CREATE DATABASE my2_db;
CREATE USER my2_user WITH PASSWORD 'CHANGE_ME_DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE my2_db TO my2_user;

-- 设置默认权限
\c my2_db
GRANT ALL ON SCHEMA public TO my2_user;
EOF

echo -e "${GREEN}数据库和用户创建成功${NC}"

# ============================================
# 第三步: 创建数据库表
# ============================================
echo -e "${GREEN}[3/6] 创建数据库表结构...${NC}"

if [ -f "database_schema.sql" ]; then
    PGPASSWORD='CHANGE_ME_DB_PASSWORD' psql -U my2_user -d my2_db -f database_schema.sql
    echo -e "${GREEN}数据库表创建成功${NC}"
else
    echo -e "${RED}错误: 找不到 database_schema.sql 文件${NC}"
    exit 1
fi

# ============================================
# 第四步: 创建环境变量文件
# ============================================
echo -e "${GREEN}[4/6] 创建环境变量配置...${NC}"

cat > .env << 'EOF'
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=my2_db
DB_USER=my2_user
DB_PASSWORD=CHANGE_ME_DB_PASSWORD
DB_POOL_MIN_SIZE=10
DB_POOL_MAX_SIZE=50

# Redis配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# 集群配置
CLUSTER_URL=http://localhost:8000
EOF

echo -e "${GREEN}.env 文件创建成功${NC}"

# ============================================
# 第五步: 创建必要的目录
# ============================================
echo -e "${GREEN}[5/6] 创建存储目录...${NC}"

mkdir -p persistent_storage/{images,videos,temp}
mkdir -p logs
mkdir -p redis_data

chmod -R 755 persistent_storage
chmod -R 755 logs
chmod -R 755 redis_data

echo -e "${GREEN}目录创建成功${NC}"

# ============================================
# 第六步: 验证安装
# ============================================
echo -e "${GREEN}[6/6] 验证安装...${NC}"

# 检查数据库连接
echo -e "${YELLOW}检查数据库连接...${NC}"
if PGPASSWORD='CHANGE_ME_DB_PASSWORD' psql -U my2_user -d my2_db -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 数据库连接成功${NC}"
else
    echo -e "${RED}✗ 数据库连接失败${NC}"
    exit 1
fi

# 检查表是否创建
echo -e "${YELLOW}检查数据库表...${NC}"
TABLE_COUNT=$(PGPASSWORD='CHANGE_ME_DB_PASSWORD' psql -U my2_user -d my2_db -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
if [ "$TABLE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ 发现 $TABLE_COUNT 个数据库表${NC}"
else
    echo -e "${RED}✗ 未找到数据库表${NC}"
    exit 1
fi

# 检查Python包
echo -e "${YELLOW}检查Python依赖...${NC}"
python3 << 'PYEOF'
try:
    import asyncpg
    import aiofiles
    import PIL
    import ffmpeg
    print("\033[0;32m✓ Python依赖检查通过\033[0m")
except ImportError as e:
    print(f"\033[0;31m✗ 缺少Python包: {e}\033[0m")
    exit(1)
PYEOF

# ============================================
# 完成
# ============================================
echo ""
echo "=========================================="
echo -e "${GREEN}部署完成!${NC}"
echo "=========================================="
echo ""
echo "下一步:"
echo "1. 确保Redis正在运行: redis-server redis.conf &"
echo "2. 启动集群: bash start_cluster.sh"
echo "3. 访问: http://localhost:8000"
echo ""
echo "数据库信息:"
echo "  - 数据库: my2_db"
echo "  - 用户: my2_user"
echo "  - 密码: CHANGE_ME_DB_PASSWORD"
echo ""
echo -e "${YELLOW}注意: 请妥善保管数据库密码!${NC}"
echo ""

# 显示快速命令
cat << 'EOF'
常用命令:
  - 查看数据库表: psql -U my2_user -d my2_db -c "\dt"
  - 查看用户数据: psql -U my2_user -d my2_db -c "SELECT * FROM users;"
  - 查看存储统计: psql -U my2_user -d my2_db -c "SELECT * FROM user_storage_stats;"
  - 重置数据库: psql -U my2_user -d my2_db -f database_schema.sql
EOF
