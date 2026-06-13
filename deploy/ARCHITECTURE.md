# 后端目录结构（refactor/v2 P3 分层重组）

84 个平铺 .py 文件已按职责重组为分层包结构（保留 `deploy/` 顶层）。
**重组方式**：`git mv` 移动真实实现到新包，旧根路径保留**兼容 shim**（`from 新路径 import *`），
因此所有既有导入仍可用，零破坏（`import cluster_main` 全图 + 运行时 smoke 均通过）。

## 新结构

```
deploy/
├── cluster_main.py            # FastAPI 入口（路由注册 + lifespan + 静态挂载）
├── api_routes.py / admin_routes.py / *_routes.py   # 路由（暂未拆分，见“后续”）
├── api_router.py / config.py / cluster_config*.py  # 入口级配置（未动）
│
├── core/                      # 核心基础设施
│   ├── db_manager.py          # asyncpg 连接池
│   ├── database_config.py     # DB 配置
│   ├── jwt_auth.py            # JWT 鉴权
│   ├── task_queue.py          # Redis 任务队列
│   ├── worker.py              # Worker（lite/full 模式，外部 API 任务消费）
│   └── cluster_manager.py     # 集群管理
│
├── services/                  # 业务服务层
│   ├── task_service.py / credit_service.py / file_service.py
│   ├── media_library_service.py / video_reverse_service.py
│   ├── audio_mix_service.py / audio_provider.py
│   ├── admin_audit_service.py / image_webp_service.py
│
├── dao/                       # 数据访问层（按域分包）
│   ├── user/        (user)
│   ├── content/     (content, file, entity_file)
│   ├── creative/    (canvas, storyboard, episode*, asset, audio_track, timeline, media_library*, character_voice, video_segment)
│   ├── admin/       (api_config, agent, system_settings, workflow_template, admin_audit)
│   ├── business/    (task, task_history, credit, notification, video_reverse)
│   └── organization/(organization, project_group, resource_share)
│
├── external_api/              # 外部 AI 服务客户端
│   ├── video/   (minimax, sora2, veo, dashscope, wan2, seedance)
│   └── audio/   (minimax_audio)
│
├── pipeline/                  # 生成管线编排
│   ├── comfyui_main.py / comfyui_agent.py
│   └── workflow_config.py / workflow_handler.py / workflow_manager.py
│
├── utils/                     # 通用工具
│   ├── file_optimization.py / image_processor.py / storage_manager.py
│
├── sql/                       # DB schema + 迁移（未动）
├── tests/                     # 测试（未动）
└── （根部 dao_*.py / *_api.py / *_service.py / 等 = 兼容 shim）
```

## 兼容 shim 说明
- 旧导入如 `from minimax_api import get_minimax_client`、`from dao_storyboard import ...` 全部仍可用（根部 shim 重导出）。
- 新代码请用新路径：`from external_api.video.minimax import get_minimax_client`、`from dao.creative.storyboard import ...`。
- 后续可逐步把 routes/worker 等的导入改成新路径，再删除 shim。

## 有意保留在根（未移动）
- **运维脚本**：`migrate_*.py` / `diagnose_*.py` / `db_tool.py` / `check_permissions.py` /
  `sync_users_to_db.py` / `init_user_permissions.py` / `fix_user_ids.py` / `auto_deploy_cluster.py` —
  它们不在应用导入图内、为手动运行；移动会改变调用路径，价值低风险高，故保留。

## 后续（本次未做，最高风险/边际价值低）
- 拆分巨型路由文件 `api_routes.py`(3133 行) / `admin_routes.py`(1750 行) 为 `routes/<domain>.py`。
- 抽取内联 Pydantic 模型到 `models/<domain>.py`。
  这两项需要细致拆分 + 大量回归，建议单独立项、有完整 smoke 覆盖时再做。
