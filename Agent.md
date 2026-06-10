# Agent.md - 本地部署记录

更新时间：2026-06-07  
工作目录：`D:\Codex\Drama`  
应用代码目录：`D:\Codex\Drama\deploy`

## 当前本地部署状态

本地部署已跑通，访问地址：

```text
http://localhost:6006/projects
```

基础账号：

```text
admin / admin123
```

当前运行组件：

| 组件 | 本地形态 | 状态 |
| --- | --- | --- |
| PostgreSQL | Docker 容器 `drama-postgres`，端口 `5432` | 已启动 |
| Redis | Docker 容器 `drama-redis`，端口 `6379` | 已启动 |
| FastAPI 后端 | `deploy/.venv` + `uvicorn cluster_main:app`，端口 `6006` | 已启动 |
| React 前端 | `deploy/new_html` 构建到 `deploy/dist`，由后端托管 | 已构建并可访问 |

## 部署相关新增文件

以下文件是为了让本地部署可重复执行而新增：

| 文件 | 说明 |
| --- | --- |
| `deploy/local_start.ps1` | 本地启动脚本：启动/复用 PostgreSQL、Redis，准备 Python 虚拟环境，按需构建前端并启动后端 |
| `deploy/local_verify.ps1` | 本地验证脚本：检查健康接口、登录、项目列表和浏览器渲染 |
| `deploy/local_stop.ps1` | 本地停止脚本：停止 `6006` 后端进程；加 `-StopInfra` 可停止数据库和 Redis 容器 |
| `deploy/scripts/verify_local_browser.mjs` | Edge 无头浏览器验证脚本：登录后打开项目页、确认页面文本、生成截图 |
| `Agent.md` | 本文件，记录部署缺失项、补齐项和验证结论 |

运行脚本时如遇到 Windows 脚本执行策略限制，使用：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\local_start.ps1
powershell.exe -ExecutionPolicy Bypass -File .\local_verify.ps1
```

## 部署相关生成目录和产物

以下目录/文件是本地部署过程中生成或刷新出来的运行产物：

| 路径 | 说明 |
| --- | --- |
| `deploy/.venv` | 后端 Python 虚拟环境 |
| `deploy/new_html/node_modules` | 前端依赖目录，由 Docker `node:20-alpine` 执行 `npm ci` 生成 |
| `deploy/dist` | 前端生产构建目录，已从 `deploy/new_html` 重新构建 |
| `deploy/dist/assets/index-DAEewdMq.js` | 当前前端主 bundle |
| `deploy/dist/assets/utils-CeXEL_Kc.js` | 当前前端工具 chunk |
| `deploy/logs/local-backend.out.log` | 后端标准输出日志 |
| `deploy/logs/local-backend.err.log` | 后端启动和访问日志 |
| `deploy/logs/projects-auth-page.png` | 已登录项目页浏览器验证截图 |
| `deploy/uploads`、`deploy/outputs`、`deploy/temp`、`deploy/history` | 后端运行所需本地目录 |
| `deploy/persistent_storage` | 后端持久化存储目录 |

## 数据库补齐情况

本地数据库使用容器 `drama-postgres`，数据库已执行主 schema 和所有本地迁移 SQL。

已确认：

```text
public schema 表数量：44
```

关键迁移范围包括：

| 迁移类别 | 状态 |
| --- | --- |
| 基础项目/文件/任务/用户表 | 已执行 |
| Project Hub / Episodes / Assets / Storyboard / Timeline / Audio | 已执行 |
| Admin / Agent / API 配置 / 系统设置 | 已执行 |
| 组织、项目组、资源分享 | 已执行 |
| Credits 积分系统 | 已执行 |
| Media Library 和 folders | 已执行 |
| Video Reverse | 已执行 |
| Episode script segments / storyboard pipeline fields / audio mix | 已执行 |

数据库里保留了一个部署自测项目：

```text
local-deploy-smoke-20260607-114540
```

之前因 PowerShell 编码导致名称变成问号的测试项目已归档，默认项目列表不会显示。

## 已发现并处理的部署缺失

| 缺失/问题 | 处理方式 |
| --- | --- |
| 系统 PATH 中没有可用 `python` | 使用 Codex 内置 Python 创建 `deploy/.venv` |
| 系统 PATH 中没有可用 `npm/pnpm/corepack` | 使用 Docker `node:20-alpine` 在 `deploy/new_html` 内安装依赖和构建 |
| 后端启动依赖 Redis，缺失时会退出 | 新建并启动 `drama-redis` 容器 |
| 后端需要 PostgreSQL，数据库本身不会自动迁移 | 新建 `drama-postgres` 容器并手动执行 schema/migrations |
| 部分 SQL 迁移存在顺序依赖 | 按依赖顺序执行，先创建 `credits`、`media_library_items` 等被依赖表，再执行扩展迁移 |
| `deploy/new_html/vite.config.ts` 开发代理指向 `localhost:8000`，而后端实际端口是 `6006` | 本地部署使用生产构建 `deploy/dist` 并由 FastAPI `6006` 托管，绕开开发代理不一致问题 |
| Windows 控制台 GBK 对后端 emoji 日志会报编码噪音 | 启动脚本设置 `PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8` |
| Edge/Node 对 `localhost` 偶发解析或 CDP 初始化不稳定 | 浏览器验证脚本默认使用 `127.0.0.1:6006`，CDP 端口随机化并增加重试 |

## 仍缺失或待生产配置的部分

这些不是本地基础部署阻断项，但会影响完整生成能力或生产可用性：

| 缺失项 | 影响 |
| --- | --- |
| AI API Key 未配置：`DEEPSEEK_API_KEY`、`ARK_API_KEY`、`GEMINI_TEXT_API_KEY`、`GEMINI_IMAGE_API_KEY`、`MINIMAX_API_KEY` 等 | 文本生成、图像生成、TTS、视频生成等外部 AI 功能不可用或只能显示占位 |
| ComfyUI / 外部 Agent 未接入 | 本地部署以 `AGENT_ONLY_MODE=true`、`LITE_WORKERS_COUNT=0` 启动，ComfyUI 工作流任务不会被本机执行 |
| 生产 `.env` 尚未标准化 | 当前本地脚本直接设置运行环境变量；上云或服务器部署时应整理 `.env` 或进程管理配置 |
| 前端完整 Vitest 套件存在既有失败 | 部署级 smoke 通过，但完整测试有 fixture 缺失、旧文案断言、mock 未同步等问题，需要另行修测试 |
| npm audit 报 11 个依赖漏洞 | 不阻塞本地部署；生产前建议单独评估并升级依赖 |
| `deploy/DEPLOY_GUIDE.md` 和部分 shell 脚本偏 Linux/旧端口说明 | 本地 Windows 部署以本文件和 `local_*.ps1` 为准；后续可统一文档 |

## 已完成自测

部署级自测结果：

| 检查项 | 结果 |
| --- | --- |
| 后端依赖导入 | 通过 |
| 后端 smoke：`pytest tests/test_smoke.py -q` | `2 passed` |
| 前端 smoke：`vitest run __tests__/smoke.test.ts` | `2 passed` |
| 前端生产构建：`npm run build` | 通过 |
| `/health` | `healthy` |
| `/projects` | 返回前端 HTML，引用当前构建产物 |
| `/assets/index-DAEewdMq.js` | `200 OK` |
| `/api/login` | 登录成功，返回 token |
| `/api/user/info` | 鉴权成功 |
| `/api/projects` 创建和列表读取 | 成功 |
| Edge 无头浏览器已登录项目页渲染 | 成功，截图见 `deploy/logs/projects-auth-page.png` |

## 常用命令

启动本地部署：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_start.ps1
```

启动并重新构建前端：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_start.ps1 -BuildFrontend
```

验证本地部署：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_verify.ps1
```

停止后端：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_stop.ps1
```

停止后端并停止本地基础设施容器：

```powershell
cd D:\Codex\Drama\deploy
powershell.exe -ExecutionPolicy Bypass -File .\local_stop.ps1 -StopInfra
```

