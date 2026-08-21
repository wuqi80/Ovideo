#!/usr/bin/env python3
"""Ostory TV 冒烟测试：登录、安全项与核心流程。base URL 必须显式配置。

用法： python smoke_test.py [BASE_URL] [ADMIN_PASSWORD]
  BASE_URL 默认 http://127.0.0.1:6006
  ADMIN_PASSWORD 默认读取环境变量 ADMIN_PASSWORD；未设置时仅回退到本地开发弱口令 admin123。
  服务端只有显式设置 ALLOW_DEV_ADMIN_PASSWORD=true 时才接受该开发弱口令。
退出码 0=全过，非0=有失败。
"""
import os, sys, json, ssl, time, hmac, hashlib, base64, urllib.request, urllib.error

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else "http://127.0.0.1:6006"
PUBLIC_ONLY = "--public-only" in sys.argv[2:]
password_args = [arg for arg in sys.argv[2:] if arg != "--public-only"]
ADMIN_PW = password_args[0] if password_args else os.getenv("ADMIN_PASSWORD", "admin123")
CTX = ssl.create_default_context()
results = []

def req(path, method="GET", body=None, token=None, timeout=15):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    try:
        r = urllib.request.urlopen(urllib.request.Request(BASE + path, method=method, data=data, headers=h), timeout=timeout, context=CTX)
        return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return None, str(e).encode()


def req_with_network_retry(
    path,
    *,
    method="GET",
    body=None,
    token=None,
    timeout=30,
    attempts=3,
):
    """Retry transport failures without hiding a real HTTP/dependency failure."""
    last_status, last_body = None, b""
    for attempt in range(attempts):
        last_status, last_body = req(
            path,
            method=method,
            body=body,
            token=token,
            timeout=timeout,
        )
        if last_status is not None:
            break
        if attempt + 1 < attempts:
            time.sleep(attempt + 1)
    return last_status, last_body

def check(name, cond, detail=""):
    results.append((name, cond, detail))
    # Keep the smoke test portable across Windows consoles whose active code
    # page cannot encode emoji. The runner captures UTF-8, but operators also
    # invoke this script directly from GBK/CP936 PowerShell sessions.
    marker = "[PASS]" if cond else "[FAIL]"
    print(f"  {marker} {name}" + (f"  [{detail}]" if detail and not cond else ""))
    return cond

def forged_token():
    OLD = "ostory-default-jwt-secret-2026"
    now = int(time.time())
    pb = base64.urlsafe_b64encode(json.dumps({"u": "admin", "exp": now + 3600, "iat": now}, separators=(',', ':')).encode()).decode().rstrip('=')
    return f"{pb}.{hmac.new(OLD.encode(), pb.encode(), hashlib.sha256).hexdigest()}"

def run():
    # Release gate: dependencies and migration ledger must be ready.
    st, b = req_with_network_retry("/health", timeout=30)
    health = {}
    try:
        health = json.loads(b) if b else {}
    except Exception:
        health = {}
    database = health.get("database") or {}
    migrations = database.get("migrations") or {}
    queue = health.get("queue") or {}
    providers = health.get("providers") or {}
    processing_nodes = health.get("processing_nodes") or {}
    health_ok = (
        st == 200
        and health.get("status") == "healthy"
        and health.get("redis") == "healthy"
        and database.get("status") == "healthy"
        and migrations.get("status") == "ready"
    )
    check(
        "release health gate is ready",
        health_ok,
        (
            f"http={st} status={health.get('status')} redis={health.get('redis')} "
            f"database={database.get('status')} migrations={migrations.get('status')} "
            f"queue={queue.get('status')} providers={providers.get('status')} "
            f"processing_nodes={processing_nodes.get('status')}"
        ),
    )

    print(f"=== 冒烟 {BASE} ===")
    tok = None
    if PUBLIC_ONLY:
        check("未配置发布凭据，使用公共与安全冒烟检查", True)
    else:
        # 1. 登录
        st, b = req("/api/login", "POST", {"username": "admin", "password": ADMIN_PW})
        if st == 200:
            try: tok = json.loads(b).get("token")
            except Exception: pass
        check("登录 admin 成功并拿到 token", st == 200 and bool(tok), f"http={st}")
        if not tok:
            return  # 后续都依赖 token

    # 2. 安全项
    st, _ = req_with_network_retry("/api/debug/auth-status", timeout=15)
    check("debug 接口已移除(404)", st == 404, f"http={st}")
    st, _ = req_with_network_retry(
        "/api/auth/register",
        method="POST",
        body={"username": "smoke_x", "password": "x"},
        timeout=15,
    )
    check("公开注册已关闭(403)", st == 403, f"http={st}")
    st, _ = req_with_network_retry("/api/admin/dashboard", timeout=15)
    check("admin 无 token 被拒(401/403)", st in (401, 403), f"http={st}")
    if tok:
        st, _ = req_with_network_retry("/api/admin/dashboard", token=tok, timeout=15)
        check("admin 带 token 可访问(200)", st == 200, f"http={st}")
    st, _ = req_with_network_retry("/api/projects", token=forged_token(), timeout=15)
    check("旧密钥伪造令牌被拒(401)", st == 401, f"http={st}")

    if tok:
        # 3. 核心流程
        st, b = req_with_network_retry("/api/projects", token=tok, timeout=15)
        ok = st == 200
        try: ok = ok and json.loads(b).get("success", False)
        except Exception: ok = False
        check("项目列表 /api/projects 正常", ok, f"http={st}")

        # 只读核查（不写库，避免软删除残留 cruft，保证冒烟可重复跑无副作用）
        st, b = req_with_network_retry(
            "/api/projects?include_archived=false",
            token=tok,
            timeout=15,
        )
        ok = st == 200
        try: ok = ok and isinstance(json.loads(b).get("projects"), list)
        except Exception: ok = False
        check("项目读路径(含过滤参数)正常", ok, f"http={st}")

    # 4. 首页/SPA
    st, b = req_with_network_retry("/projects", timeout=15)
    html = b.decode("utf-8", "ignore") if b else ""
    ok = st == 200 and "Application is not built" not in html and "/assets/" in html
    check("SPA 首页为已构建产物", ok, f"http={st}")

if __name__ == "__main__":
    run()
    passed = sum(1 for _, c, _ in results if c)
    total = len(results)
    print(f"=== 结果: {passed}/{total} 通过 ===")
    sys.exit(0 if passed == total else 1)
