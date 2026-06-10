#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用户同步脚本
用途：将config中的所有用户同步到数据库，确保外键约束不会失败
"""

import asyncio
import logging
from db_manager import get_db_manager, init_db_manager
from dao_user import UserDAO

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 从cluster_main.py复制的用户列表
DEFAULT_USERS = {
    'admin': 'admin123',
    'user': 'user123',
    'demo': 'demo123',
    '米赛亚01': 'messiah2025@01',
    '米赛亚02': 'messiah2025@02',
    '米赛亚03': 'messiah2025@03',
    '米赛亚04': 'messiah2025@04',
    'lllsdhr': 'changeme',  # tuomin: real pwd moved to env/runtime
    '刘龙': 'password123'  # 添加报错中的用户
}

DEFAULT_PERMISSIONS = {
    "allowedModels": [
        "gemini-2.5-flash",
        "gemini-2.5-flash-image", 
        "wan2-i2v",
        "wan2-morph",
        "sora2-i2v",
        "veo-i2v",
        "minimax-i2v"
    ],
    "priority": "normal",
    "canExport": True
}

async def main():
    """主函数"""
    logger.info("开始同步用户到数据库...")
    
    try:
        # 1. 初始化数据库连接
        await init_db_manager()
        db = get_db_manager()
        
        # 2. 确保permissions字段存在
        logger.info("检查permissions字段...")
        await db.execute("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb
        """)
        logger.info("✅ permissions字段已就绪")
        
        # 3. 同步所有用户
        created_count = 0
        updated_count = 0
        
        for username, password in DEFAULT_USERS.items():
            logger.info(f"处理用户: {username}")
            
            # 检查用户是否已存在
            existing_user = await UserDAO.get_user_by_username(username)
            
            if not existing_user:
                # 创建新用户
                logger.info(f"  创建新用户: {username}")
                user = await UserDAO.create_user(
                    username=username,
                    password=password,
                    email=f"{username}@local.com",
                    user_id=username  # 使用username作为user_id
                )
                if user:
                    created_count += 1
                    logger.info(f"  ✅ 用户 {username} 创建成功")
                    
                    # 设置默认权限
                    await UserDAO.update_user_permissions(username, DEFAULT_PERMISSIONS)
                    logger.info(f"  ✅ 用户 {username} 权限已设置")
                else:
                    logger.error(f"  ❌ 用户 {username} 创建失败")
            else:
                logger.info(f"  用户 {username} 已存在（ID: {existing_user['user_id']}）")
                
                # 检查权限
                permissions = existing_user.get('permissions')
                if not permissions or permissions == {} or not permissions.get('allowedModels'):
                    logger.info(f"  更新用户 {username} 的权限...")
                    await UserDAO.update_user_permissions(username, DEFAULT_PERMISSIONS)
                    updated_count += 1
                    logger.info(f"  ✅ 用户 {username} 权限已更新")
                else:
                    logger.info(f"  用户 {username} 已有权限配置")
        
        logger.info(f"\n✅ 用户同步完成:")
        logger.info(f"  - 新创建: {created_count} 个用户")
        logger.info(f"  - 更新权限: {updated_count} 个用户")
        
        # 4. 验证结果
        logger.info("\n验证结果：")
        users = await db.fetch("""
            SELECT user_id, username, email, is_active, permissions
            FROM users
            ORDER BY created_at DESC
        """)
        logger.info(f"数据库中共有 {len(users)} 个用户：")
        for user in users:
            perms = user['permissions']
            status = "✅" if user['is_active'] else "❌"
            
            # JSONB字段可能是dict或str，需要处理
            if isinstance(perms, str):
                try:
                    import json
                    perms = json.loads(perms)
                except:
                    perms = None
            
            if isinstance(perms, dict) and perms.get('allowedModels'):
                models = perms.get('allowedModels', [])
                logger.info(f"  {status} {user['username']} ({user['user_id']}): {len(models)} 个可用模型")
            else:
                logger.info(f"  {status} {user['username']} ({user['user_id']}): 无权限配置 (类型: {type(perms).__name__}, 值: {perms})")
        
    except Exception as e:
        logger.error(f"❌ 用户同步失败: {e}", exc_info=True)
        return 1
    
    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)

