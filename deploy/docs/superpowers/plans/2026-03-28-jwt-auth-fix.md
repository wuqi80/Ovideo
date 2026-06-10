# JWT 无状态认证 — 修复登录后 401 跳回登录页

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将认证从内存字典 `active_sessions` 改为 HMAC 签名的 JWT 令牌，消除 `cluster_main.py` 和 `api_routes.py` 之间的会话同步依赖，修复登录成功后 API 返回 401 的问题。

**Architecture:** 创建独立的 `jwt_auth.py` 模块（零外部依赖），提供 `create_token` / `verify_token` 函数。`cluster_main.py` 和 `api_routes.py` 各自导入此模块独立验证令牌，不再需要跨模块共享字典引用。保留一个轻量 `_online_users` 字典仅用于 admin 面板在线状态显示。

**Tech Stack:** Python 标准库 (`hmac`, `hashlib`, `json`, `base64`, `time`)

---

## 文件结构

- **新建:** `jwt_auth.py` — JWT 令牌签发与验证（约 60 行）
- **修改:** `cluster_main.py` — 替换 26 处 `active_sessions` 引用
- **修改:** `api_routes.py` — 替换 `get_current_user` + 删除 `_active_sessions`
- **同步:** `deploy/jwt_auth.py`, `deploy/cluster_main.py`, `deploy/api_routes.py`

---

### Task 1: 创建 jwt_auth.py 模块

**Files:**
- Create: `jwt_auth.py`

- [ ] **Step 1: 创建 jwt_auth.py**

```python
"""
JWT 无状态令牌认证模块
使用 HMAC-SHA256 签名，零外部依赖
"""
import hmac
import hashlib
import json
import base64
import time
import os
import logging

logger = logging.getLogger(__name__)

_secret_key: str = ""

def init(secret_key: str = ""):
    """初始化签名密钥"""
    global _secret_key
    _secret_key = secret_key or os.environ.get("JWT_SECRET_KEY", "messiah-default-jwt-secret-2026")
    logger.info("✅ JWT 认证模块已初始化")

def create_token(username: str, ttl: int = 86400) -> str:
    """
    创建签名令牌
    Args:
        username: 用户名
        ttl: 过期时间（秒），默认 24 小时
    Returns:
        格式: {base64_payload}.{hex_signature}
    """
    now = int(time.time())
    payload = json.dumps({"u": username, "exp": now + ttl, "iat": now}, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    sig = hmac.new(_secret_key.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"

def verify_token(token: str) -> str | None:
    """
    验证令牌签名和过期时间
    Args:
        token: Bearer token 字符串
    Returns:
        验证成功返回 username，失败返回 None
    """
    if not token or '.' not in token:
        return None
    try:
        payload_b64, sig = token.rsplit('.', 1)
        expected = hmac.new(_secret_key.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        data = json.loads(base64.urlsafe_b64decode(payload_b64))
        if data.get("exp", 0) < time.time():
            logger.debug(f"Token 已过期: {data.get('u')}")
            return None
        return data.get("u")
    except Exception as e:
        logger.debug(f"Token 验证失败: {e}")
        return None
```

- [ ] **Step 2: 验证模块可独立运行**

在终端运行快速测试：

```bash
cd h:\MY2
python -c "
import jwt_auth
jwt_auth.init('test-secret')
token = jwt_auth.create_token('admin')
print('Token:', token[:30], '...')
user = jwt_auth.verify_token(token)
print('Verified user:', user)
assert user == 'admin', 'FAIL'
print('PASS')
"
```

Expected: 输出 `Verified user: admin` 和 `PASS`

---

### Task 2: 修改 cluster_main.py — 认证核心函数

**Files:**
- Modify: `cluster_main.py:450-590` (认证定义区域)

- [ ] **Step 1: 替换 L450-452（active_sessions 定义）**

将：
```python
# 认证
security = HTTPBearer(auto_error=False)
active_sessions = {}
```

替换为：
```python
# 认证
security = HTTPBearer(auto_error=False)
import jwt_auth
jwt_auth.init()

# 在线用户追踪（仅用于 admin 面板显示，不用于认证）
_online_users: dict = {}
```

- [ ] **Step 2: 替换 L540-547（create_session_token）**

将：
```python
def create_session_token(username: str) -> str:
    import secrets
    token = secrets.token_urlsafe(32)
    active_sessions[token] = {
        'username': username,
        'created_at': datetime.now()
    }
    return token
```

替换为：
```python
def create_session_token(username: str) -> str:
    _online_users[username] = datetime.now()
    return jwt_auth.create_token(username)
```

- [ ] **Step 3: 替换 L549-555（verify_session）**

将：
```python
def verify_session(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[str]:
    if not credentials:
        return None
    token = credentials.credentials
    if token in active_sessions:
        return active_sessions[token]['username']
    return None
```

替换为：
```python
def verify_session(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[str]:
    if not credentials:
        return None
    username = jwt_auth.verify_token(credentials.credentials)
    if username:
        _online_users[username] = datetime.now()
    return username
```

- [ ] **Step 4: require_auth 不需要修改**

`require_auth`（L557-589）依赖 `verify_session` 的返回值，无需改动。

---

### Task 3: 修改 cluster_main.py — logout 端点

**Files:**
- Modify: `cluster_main.py:1241-1247`

- [ ] **Step 1: 替换 logout 函数**

将：
```python
@app.post("/api/logout")
async def logout(username: str = Depends(require_auth)):
    tokens_to_remove = [t for t, s in active_sessions.items() if s['username'] == username]
    for token in tokens_to_remove:
        del active_sessions[token]
    
    return {"success": True, "message": "登出成功"}
```

替换为：
```python
@app.post("/api/logout")
async def logout(username: str = Depends(require_auth)):
    _online_users.pop(username, None)
    return {"success": True, "message": "登出成功"}
```

---

### Task 4: 修改 cluster_main.py — save_workspace_beacon 端点

**Files:**
- Modify: `cluster_main.py:1697-1703`

- [ ] **Step 1: 替换 beacon 端点 token 验证**

将 L1700-1703：
```python
    try:
        if token not in active_sessions:
            return {"success": False, "message": "token无效"}
        username = active_sessions[token]['username']
```

替换为：
```python
    try:
        username = jwt_auth.verify_token(token)
        if not username:
            return {"success": False, "message": "token无效"}
```

---

### Task 5: 修改 cluster_main.py — SSE 任务流端点

**Files:**
- Modify: `cluster_main.py:1762-1767`

- [ ] **Step 1: 替换 SSE 端点 token 验证**

将 L1765-1767：
```python
    if token not in active_sessions:
        raise HTTPException(status_code=401, detail="未认证")
    username = active_sessions[token]['username']
```

替换为：
```python
    username = jwt_auth.verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="未认证")
```

---

### Task 6: 修改 cluster_main.py — 缩略图 & ComfyUI 代理端点

**Files:**
- Modify: `cluster_main.py:2863-2875` (缩略图)
- Modify: `cluster_main.py:2946-2957` (ComfyUI 代理)

这两个端点有相同的双模式 token 验证模式（Header 或 query param）。

- [ ] **Step 1: 替换缩略图端点 L2863-2875**

将：
```python
        # 验证token
        username = None
        if credentials:
            auth_token = credentials.credentials
            if auth_token in active_sessions:
                username = active_sessions[auth_token]['username']
        elif token:
            if token in active_sessions:
                username = active_sessions[token]['username']
        
        if not username:
            raise HTTPException(status_code=401, detail="需要登录")
```

替换为：
```python
        username = None
        if credentials:
            username = jwt_auth.verify_token(credentials.credentials)
        if not username and token:
            username = jwt_auth.verify_token(token)
        if not username:
            raise HTTPException(status_code=401, detail="需要登录")
```

- [ ] **Step 2: 替换 ComfyUI 代理端点 L2946-2957**

同样的模式，将：
```python
        username = None
        if credentials:
            auth_token = credentials.credentials
            if auth_token in active_sessions:
                username = active_sessions[auth_token]['username']
        elif token:
            if token in active_sessions:
                username = active_sessions[token]['username']
        
        if not username:
            raise HTTPException(status_code=401, detail="需要登录")
```

替换为：
```python
        username = None
        if credentials:
            username = jwt_auth.verify_token(credentials.credentials)
        if not username and token:
            username = jwt_auth.verify_token(token)
        if not username:
            raise HTTPException(status_code=401, detail="需要登录")
```

---

### Task 7: 修改 cluster_main.py — Admin 面板用户在线状态

**Files:**
- Modify: `cluster_main.py:4945` (isOnline)
- Modify: `cluster_main.py:4964-4966` (降级用户列表)
- Modify: `cluster_main.py:5034` (activeUsers 统计)

- [ ] **Step 1: 替换 isOnline 检查 L4945**

将：
```python
'isOnline': user['username'] in [s['username'] for s in active_sessions.values()],
```

替换为：
```python
'isOnline': user['username'] in _online_users and (datetime.now() - _online_users[user['username']]).seconds < 1800,
```

- [ ] **Step 2: 替换降级用户列表 L4964-4966**

将：
```python
        if not users_list:
            logger.warning("⚠️ 数据库用户列表为空，使用内存session降级数据")
            session_usernames = list(set([s['username'] for s in active_sessions.values()]))
```

替换为：
```python
        if not users_list:
            logger.warning("⚠️ 数据库用户列表为空，使用在线用户降级数据")
            session_usernames = list(_online_users.keys())
```

- [ ] **Step 3: 替换 activeUsers 统计 L5034**

将：
```python
'activeUsers': len(active_sessions),
```

替换为：
```python
'activeUsers': len(_online_users),
```

---

### Task 8: 修改 cluster_main.py — 删除 set_active_sessions 调用

**Files:**
- Modify: `cluster_main.py:5633-5638`

- [ ] **Step 1: 删除旧的引用传递代码**

将 L5633-5638：
```python
# ==================== 注册数据库API路由 ====================
# 🆕 在所有旧路由注册完成后，注册数据库API路由（避免路由冲突）
# 首先设置active_sessions引用，让api_routes能够验证token
from api_routes import set_active_sessions
set_active_sessions(active_sessions)
logger.info("✅ 已共享active_sessions到api_routes")
```

替换为：
```python
# ==================== 注册数据库API路由 ====================
# 🆕 在所有旧路由注册完成后，注册数据库API路由（避免路由冲突）
# api_routes 使用 jwt_auth 独立验证令牌，无需共享会话状态
```

---

### Task 9: 修改 api_routes.py — 核心认证逻辑

**Files:**
- Modify: `api_routes.py:42-50` (删除 _active_sessions)
- Modify: `api_routes.py:125-165` (get_current_user)
- Modify: `api_routes.py:171-184` (debug endpoint)

- [ ] **Step 1: 替换 L42-50（删除旧会话机制）**

将：
```python
# ============================================
# 会话存储（从cluster_main共享）
# ============================================
_active_sessions = None

def set_active_sessions(sessions_dict):
    """设置活跃会话字典的引用（从cluster_main传入）"""
    global _active_sessions
    _active_sessions = sessions_dict
```

替换为：
```python
# ============================================
# JWT 令牌认证
# ============================================
import jwt_auth
```

- [ ] **Step 2: 替换 L129-165（get_current_user）**

将整个函数替换为：
```python
async def get_current_user(request: Request) -> str:
    """从请求的 JWT 令牌中获取当前用户ID"""
    authorization = request.headers.get("Authorization")
    if not authorization:
        raise HTTPException(status_code=401, detail="未授权")
    
    token = authorization.replace("Bearer ", "")
    username = jwt_auth.verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Token已失效或不存在，请重新登录")
    return username
```

- [ ] **Step 3: 替换 L672-674（文件下载 token 验证）**

将：
```python
        # 🔒 可选的用户权限验证（如果提供了 token）
        if token and _active_sessions is not None:
            if token in _active_sessions:
                username = _active_sessions[token].get('username')
```

替换为：
```python
        # 🔒 可选的用户权限验证（如果提供了 token）
        if token:
            username = jwt_auth.verify_token(token)
            if username:
```

注意：`if username:` 后面的缩进内容（L675-680）保持不变。

- [ ] **Step 4: 替换 L171-184（debug endpoint）**

将：
```python
@router.get("/api/debug/auth-status")
async def debug_auth_status(request: Request):
    """调试：检查认证状态"""
    authorization = request.headers.get("Authorization")
    token = authorization.replace("Bearer ", "") if authorization else None
    
    return {
        "has_authorization_header": authorization is not None,
        "token_prefix": token[:10] if token else None,
        "active_sessions_initialized": _active_sessions is not None,
        "active_sessions_count": len(_active_sessions) if _active_sessions else 0,
        "token_in_sessions": token in _active_sessions if (_active_sessions and token) else False,
        "available_tokens_prefix": [t[:10] for t in list(_active_sessions.keys())[:5]] if _active_sessions else []
    }
```

替换为：
```python
@router.get("/api/debug/auth-status")
async def debug_auth_status(request: Request):
    """调试：检查认证状态"""
    authorization = request.headers.get("Authorization")
    token = authorization.replace("Bearer ", "") if authorization else None
    username = jwt_auth.verify_token(token) if token else None
    
    return {
        "has_authorization_header": authorization is not None,
        "token_prefix": token[:20] + "..." if token else None,
        "jwt_valid": username is not None,
        "jwt_username": username,
        "auth_method": "jwt"
    }
```

---

### Task 10: 同步到 deploy 文件夹 + 验证

**Files:**
- Copy: `jwt_auth.py` → `deploy/jwt_auth.py`
- Sync: `deploy/cluster_main.py` (从修改后的源复制)
- Sync: `deploy/api_routes.py` (从修改后的源复制)

- [ ] **Step 1: 复制文件到 deploy**

```powershell
copy h:\MY2\jwt_auth.py h:\MY2\deploy\jwt_auth.py
copy h:\MY2\cluster_main.py h:\MY2\deploy\cluster_main.py
copy h:\MY2\api_routes.py h:\MY2\deploy\api_routes.py
```

- [ ] **Step 2: 验证 deploy 文件中不再引用 active_sessions**

```powershell
rg "active_sessions" h:\MY2\deploy\cluster_main.py
rg "_active_sessions|set_active_sessions" h:\MY2\deploy\api_routes.py
```

Expected: `cluster_main.py` 中只有 `_online_users` 相关代码，`api_routes.py` 中零匹配。

- [ ] **Step 3: 前端不需要修改（验证兼容性）**

JWT token 格式与原 token 均为字符串，前端存储和发送方式不变：
- `localStorage.getItem('auth_token')` → 读取 JWT 字符串
- `Authorization: Bearer {token}` → 发送 JWT 字符串
- 登录 API 响应格式不变: `{success: true, token: "...", username: "..."}`

无需构建前端。

---

## 部署说明

1. 将 `deploy/` 文件夹同步到远程服务器
2. 可选：设置环境变量 `JWT_SECRET_KEY`（不设则使用默认值）
3. 重启后端服务
4. 用户需重新登录（旧 token 格式不兼容 JWT 签名验证）
5. 登录后所有 API 应正常工作，不再出现 401

## 注意事项

- `comfyui_main.py` 也有独立的 `active_sessions`（7 处引用），但它是独立的 ComfyUI 后端服务，不参与主 Web 应用的登录流程。可后续单独迁移，本次不涉及。
- 旧格式 token（`secrets.token_urlsafe(32)` 生成）无法通过 JWT 验证，所以部署后所有用户需重新登录。这不是问题，因为当前根本无法正常使用。

## 回滚方案

如果需要回滚，恢复 `cluster_main.py` 和 `api_routes.py` 的旧版本即可。`jwt_auth.py` 模块无副作用，保留不影响系统。
