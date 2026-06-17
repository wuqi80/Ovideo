#!/bin/bash
# 关闭 DB 路径的弱口令：admin 改为强密码哈希(从 /tmp/admin_pw.txt 计算)，user/demo 随机化。
# 登录有「硬编码 DEFAULT_USERS + DB 哈希」两条路径，C2 的 env 只挡住前者，DB 哈希需单独更新。
# 无任何密钥字面量（哈希均在脚本内由 sha256 计算）。
set -u
[ -f /tmp/admin_pw.txt ] || { echo "缺 /tmp/admin_pw.txt"; exit 1; }
h() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
NEW_HASH=$(h "$(cat /tmp/admin_pw.txt)")
W_ADMIN=$(h 'admin123'); W_USER=$(h 'user123'); W_DEMO=$(h 'demo123')
P() { sudo -u postgres psql -d my2_db -tAc "$1"; }

echo "=== 改前：DB 里弱口令账号 ==="
P "SELECT user_id FROM users WHERE password_hash IN ('$W_ADMIN','$W_USER','$W_DEMO')"

P "UPDATE users SET password_hash='$NEW_HASH', updated_at=CURRENT_TIMESTAMP WHERE user_id='admin'" >/dev/null
R1=$(h "$(head -c24 /dev/urandom | base64)"); R2=$(h "$(head -c24 /dev/urandom | base64)")
P "UPDATE users SET password_hash='$R1' WHERE user_id='user'" >/dev/null
P "UPDATE users SET password_hash='$R2' WHERE user_id='demo'" >/dev/null
echo "已更新：admin→强密码哈希；user/demo→随机哈希(禁用)"

echo "=== 改后：仍是 admin123 哈希的账号（应空）==="
P "SELECT user_id FROM users WHERE password_hash='$W_ADMIN'"
echo "DONE"
