# Project Memory Index

AI reads this file first, then loads specific files based on the task.

## Tech Stack

- **Languages**: javascript, python, rust, sql, typescript
- **Frameworks**: fastapi
- **Modules**: 105 | **API Routes**: 0 | **Tables**: 114

---

## Scenario Routing

### Debugging (bug / error / crash)

1. `docs/api.md`
2. `docs/backend.md`
3. `docs/data-layer-reference.md`
4. `docs/database.md`
5. `docs/faq.md`
6. `docs/frontend.md`
7. `context/routes.json` — API route → handler mapping
8. `context/modules/<name>.json` — specific module context

### Adding features

1. `docs/api.md`
2. `docs/architecture.md`
3. `docs/backend.md`
4. `docs/conventions.md`
5. `docs/data-layer-reference.md`
6. `docs/database.md`
7. `docs/flow.md`
8. `docs/frontend.md`

### Refactoring

1. `docs/architecture.md`
2. `docs/conventions.md`

### Onboarding (new conversation)

1. `docs/architecture.md`
2. `docs/backend.md`
3. `docs/database.md`
4. `docs/flow.md`
5. `docs/frontend.md`

## Document Catalog

| File | Title | Description |
|------|-------|-------------|
| `docs/api.md` | MY2 API Reference | Base URL: `http://<host>:8000` |
| `docs/architecture.md` | MY2 (Storyboard Copilot) — 系统架构 | | 层 | 技术 | 说明 | |
| `docs/backend.md` | MY2 Backend Architecture | | Component | Technology | |
| `docs/conventions.md` | Conventions | | Item | Convention | Example | |
| `docs/data-layer-reference.md` | 统一数据层 — 数据结构与 API 映射参考 | 本文档汇总了项目中所有与数据生成、保存、传输相关的结构和 API。 |
| `docs/database.md` | Database Reference | - **Engine**: PostgreSQL |
| `docs/deployment.md` | MY2 (Storyboard Copilot) — 安装部署指南 | | 组件 | 最低要求 | 推荐 | |
| `docs/faq.md` | FAQ — Known Issues & Solutions | AI 调试时优先搜索此文件。按时间倒序排列。 |
| `docs/flow.md` | Business Flows — MY2 Storyboard Copilot | Six core production flows, each corresponding to a workflow step in the UI. |
| `docs/frontend.md` | Frontend Architecture — MY2 Storyboard Copilot | | Layer | Technology | |
| `docs/vertical-slices.md` | Vertical Slices — MY2 | 每个 page → FE → BE → DB 的完整切片映射。**调试任何"保存失败 / 数据不显示 / 接口报错"问题时，先查这里**——找到对应 page，立刻知道要同时打开哪些 FE/BE/SQL 文件。 |

## Context Files

| File | Type |
|------|------|
| `context/api_calls.json` | index |
| `context/cross_refs.json` | index |
| `context/database.json` | index |
| `context/modules/_root.json` | module |
| `context/modules/admin.json` | module |
| `context/modules/deploy.json` | module |
| `context/modules/deploy__admin.json` | module |
| `context/modules/deploy__new_html.json` | module |
| `context/modules/deploy__new_html____tests__.json` | module |
| `context/modules/deploy__new_html____tests____components.json` | module |
| `context/modules/deploy__new_html____tests____contexts.json` | module |
| `context/modules/deploy__new_html____tests____pages.json` | module |
| `context/modules/deploy__new_html____tests____routing.json` | module |
| `context/modules/deploy__new_html____tests____services.json` | module |
| `context/modules/deploy__new_html____tests____utils.json` | module |
| `context/modules/deploy__new_html__admin.json` | module |
| `context/modules/deploy__new_html__canvas__nodes.json` | module |
| `context/modules/deploy__new_html__components.json` | module |
| `context/modules/deploy__new_html__components__audio.json` | module |
| `context/modules/deploy__new_html__components__multiangle.json` | module |
| `context/modules/deploy__new_html__components__video.json` | module |
| `context/modules/deploy__new_html__contexts.json` | module |
| `context/modules/deploy__new_html__hooks.json` | module |
| `context/modules/deploy__new_html__layouts.json` | module |
| `context/modules/deploy__new_html__pages.json` | module |
| `context/modules/deploy__new_html__prompts.json` | module |
| `context/modules/deploy__new_html__services.json` | module |
| `context/modules/deploy__new_html__test.json` | module |
| `context/modules/deploy__new_html__utils.json` | module |
| `context/modules/deploy__scripts.json` | module |
| `context/modules/deploy__sql.json` | module |
| `context/modules/deploy__static__js.json` | module |
| `context/modules/deploy__tests.json` | module |
| `context/modules/new_html.json` | module |
| `context/modules/new_html1.json` | module |
| `context/modules/new_html1__components.json` | module |
| `context/modules/new_html1__services.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai__providers.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai__providers__fal.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai__providers__grsai.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai__providers__kie.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai__providers__ppio.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__ai__providers__ppio__models.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src-tauri__src__commands.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__commands.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__components.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__components__ui.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__app.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__application.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__domain.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__edges.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__hooks.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__infrastructure.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__models.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__models__image__fal.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__models__image__grsai.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__models__image__kie.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__models__image__ppio.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__models__providers.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__nodes.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__pricing.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__tools.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__tools__annotation.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__ui.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__canvas__ui__tool-editors.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__project.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__settings.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__features__update__application.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__i18n.json` | module |
| `context/modules/new_html2__Storyboard-Copilot-0.1.13__src__stores.json` | module |
| `context/modules/new_html2__sunborad.json` | module |
| `context/modules/new_html2__sunborad__components.json` | module |
| `context/modules/new_html2__sunborad__services.json` | module |
| `context/modules/new_html2__sunborad__src.json` | module |
| `context/modules/new_html____tests__.json` | module |
| `context/modules/new_html____tests____components.json` | module |
| `context/modules/new_html____tests____contexts.json` | module |
| `context/modules/new_html____tests____hooks.json` | module |
| `context/modules/new_html____tests____pages.json` | module |
| `context/modules/new_html____tests____routing.json` | module |
| `context/modules/new_html____tests____services.json` | module |
| `context/modules/new_html____tests____utils.json` | module |
| `context/modules/new_html____tests____utils___fixtures.json` | module |
| `context/modules/new_html__admin.json` | module |
| `context/modules/new_html__canvas__nodes.json` | module |
| `context/modules/new_html__components.json` | module |
| `context/modules/new_html__components__audio.json` | module |
| `context/modules/new_html__components__multiangle.json` | module |
| `context/modules/new_html__components__video.json` | module |
| `context/modules/new_html__contexts.json` | module |
| `context/modules/new_html__hooks.json` | module |
| `context/modules/new_html__layouts.json` | module |
| `context/modules/new_html__pages.json` | module |
| `context/modules/new_html__prompts.json` | module |
| `context/modules/new_html__services.json` | module |
| `context/modules/new_html__test.json` | module |
| `context/modules/new_html__utils.json` | module |
| `context/modules/scripts.json` | module |
| `context/modules/static__js.json` | module |
| `context/modules/temp__ComfyUI-qwenmultiangle.json` | module |
| `context/modules/temp__ComfyUI-qwenmultiangle__web__js.json` | module |
| `context/modules/tests.json` | module |
| `context/project-summary.json` | summary |
| `context/routes.json` | index |

---

_Generated by project-memory skill. Re-run `build_index.py` after updating docs._