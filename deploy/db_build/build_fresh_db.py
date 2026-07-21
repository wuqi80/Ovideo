#!/usr/bin/env python3
"""
全新空库建库 runner —— 按 db_build/manifest.txt 的依赖顺序执行 schema + 全部迁移。

解决的问题：原本三个部署脚本（deploy_database.sh / db_tool.py / auto_deploy.sh）要么只跑
schema 不跑迁移，要么按文件名字母序跑导致 FK/ALTER 目标表尚未创建而失败。本 runner 用
经过拓扑排序的 manifest，保证全新空库一次跑通。所有迁移均 IF NOT EXISTS，幂等可重复执行。

用法：
    # 连接信息优先从环境变量读，未设置时读取 configs/database.env（与应用一致）
    python db_build/build_fresh_db.py

    # 或仅校验顺序/文件存在，不连库：
    python db_build/build_fresh_db.py --check

退出码：0 成功；非 0 失败（并打印第一条失败的文件与错误）。
"""
import asyncio
import sys
from pathlib import Path

# Windows GBK 控制台兜底：让 emoji/中文输出不报 UnicodeEncodeError（生产 Linux 无影响）
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

DEPLOY_DIR = Path(__file__).resolve().parent.parent  # .../deploy
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from core.db_config_loader import get_db_config_value
from scripts.apply_migrations import apply_migrations, read_manifest as read_ordered_manifest

MANIFEST = Path(__file__).resolve().parent / "manifest.txt"


def read_manifest() -> list[str]:
    return [path.relative_to(DEPLOY_DIR).as_posix() for path in read_manifest_paths()]


def read_manifest_paths() -> list[Path]:
    return read_ordered_manifest(MANIFEST, root=DEPLOY_DIR)


def check(files: list[str]) -> int:
    missing = [f for f in files if not (DEPLOY_DIR / f).is_file()]
    print(f"manifest 共 {len(files)} 个文件")
    if missing:
        print("❌ 缺失文件：")
        for m in missing:
            print(f"   - {m}")
        return 1
    print("✅ 所有文件存在")
    return 0


def db_connection_config() -> dict:
    return {
        "host": get_db_config_value("DB_HOST", "localhost"),
        "port": int(get_db_config_value("DB_PORT", "5432")),
        "database": get_db_config_value("DB_NAME", "my2_db"),
        "user": get_db_config_value("DB_USER", "my2_user"),
        "password": get_db_config_value("DB_PASSWORD", ""),
    }


async def run(files: list[str]) -> int:
    try:
        import asyncpg
    except ImportError:
        print("❌ 需要 asyncpg（应用依赖之一）。请在应用 venv 下运行。")
        return 2

    cfg = db_connection_config()
    print(f"连接 {cfg['user']}@{cfg['host']}:{cfg['port']}/{cfg['database']}")
    try:
        conn = await asyncpg.connect(**cfg)
    except Exception as e:
        print(f"❌ 连接失败：{e}")
        return 3

    try:
        try:
            results = await apply_migrations(
                conn,
                [DEPLOY_DIR / item for item in files],
                root=DEPLOY_DIR,
            )
            for i, (migration_id, state) in enumerate(results, 1):
                print(f"  [{i:>2}/{len(results)}] {state}: {migration_id}")
        except Exception as e:
            print(f"  ❌ migration failed: {type(e).__name__}: {e}")
            return 4
    finally:
        await conn.close()

    print("🎉 建库完成，全部脚本执行成功。")
    return 0


def main() -> int:
    files = read_manifest()
    if "--check" in sys.argv:
        return check(files)
    rc = check(files)
    if rc != 0:
        return rc
    return asyncio.run(run(files))


if __name__ == "__main__":
    raise SystemExit(main())
