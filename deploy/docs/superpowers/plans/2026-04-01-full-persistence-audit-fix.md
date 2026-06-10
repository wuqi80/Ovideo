# 全页面数据持久化修复计划 + WebP 无损转换

> 日期: 2026-04-01
> 基于: 全面审计报告（4 CRITICAL、9 HIGH、8 MEDIUM）

## 背景

经过对所有工作流页面的系统审计，发现大量功能与数据库/API 脱节：
- 用户操作不写库（清空文本、选择图片、情绪参数等）
- 缺少必要的 UI 入口（解锁、删除单图、删除视频等）
- 整页本地状态无持久化（EnhancePage）
- 图片文件过大（PNG 含 ComfyUI 工作流元数据 + 未转 WebP）

## 分期策略

- **Phase A**: 快速修复（前端逻辑错误，1-2 行代码即可修）— 立即执行
- **Phase B**: 功能补全（缺少的 UI 入口和 API 对接）— 逐页执行
- **Phase C**: WebP 无损转换（后端统一处理）— 独立执行
- **Phase D**: EnhancePage 持久化（需 schema 设计）— 需讨论后执行

---

## Phase A: 快速修复（CRITICAL + HIGH 中的简单修）

### A1. DubbingCard 空文本不保存 [C1]
**文件**: `new_html/components/audio/DubbingCard.tsx:79`
**问题**: `if (val && val !== clip.text)` — 空字符串 falsy 跳过保存
**修复**: 改为 `if (val !== undefined && val !== clip.text)`，并在 val 为空时单独处理

```typescript
// 修复前
if (val && val !== clip.text) {

// 修复后
const trimmed = editRef.current?.value.trim() ?? '';
if (trimmed !== clip.text) {
  onOverrideChange(clipKey, { text: trimmed });
  onTextPersist?.(clip.itemId, displaySpeaker, trimmed);
}
```

### A2. handleTextPersist 空文本拼接角色名 [H3]
**文件**: `new_html/pages/AudioStagePage.tsx:170`
**问题**: `speaker ? \`${speaker}：${newText}\` : newText` — 空 text 变成 `"旁白："`
**修复**: 空文本时直接写空字符串

```typescript
// 修复前
const fullDialogue = speaker ? `${speaker}：${newText}` : newText;

// 修复后
const fullDialogue = newText ? (speaker ? `${speaker}：${newText}` : newText) : '';
```

### A3. StoryboardGenPage 选择逻辑 [H2] — 已修复
**状态**: 已在本次会话中修复，待部署。

### A4. deploy 目录同步 [C2] — 已修复
**状态**: 已在本次会话中同步，待部署。

### A5. duration_ms 为 0 时不更新 [M3]
**文件**: `new_html/pages/AudioStagePage.tsx:149`
**问题**: `if (durationMs && ...)` — 0 是 falsy
**修复**: `if (durationMs != null && Number.isFinite(durationMs))`

---

## Phase B: 功能补全

### B1. MaterialPage 添加解锁功能 [H1]
**文件**: `new_html/components/MaterialPage.tsx`
**改动**:
1. 在左侧分镜列表中，为已锁定的分镜显示锁图标
2. 添加 `onUpdateStoryboardItem` prop（从 MaterialsPage 传入）
3. 点击锁图标时调用 `saveStoryboardItem(shotId, { status: 'draft' })`
4. MaterialsPage 需要传入 `onUpdateStoryboardItem` 回调

**涉及文件**:
- `new_html/components/MaterialPage.tsx` — 添加 prop + UI
- `new_html/pages/MaterialsPage.tsx` — 传入回调

### B2. DesignPage 单图删除 [H8]
**文件**: `new_html/pages/DesignPage.tsx`
**改动**: 在每张参考图上添加删除按钮，点击后：
```typescript
const newImages = asset.referenceImages.filter((_, i) => i !== deleteIndex);
await updateAsset(assetId, { reference_images: newImages });
await reload();
```

### B3. 视频段删除 API [H7]
**文件**: `api_routes.py`
**改动**: 暴露已有的 `VideoSegmentDAO.delete` 方法：
```python
@router.delete("/api/video-segments/{segment_id}")
async def delete_video_segment(segment_id: str, user_id: str = Depends(get_current_user)):
    ok = await VideoSegmentDAO.delete(segment_id)
    if not ok:
        raise HTTPException(404, "视频段不存在")
    return {"success": True}
```

### B4. AudioStagePage 情绪/语速参数持久化 [H4]
**分析**: 当前这些参数存在 `localOverrides` 中。两种方案：
- **方案 a**: 在 `storyboard_items` 表添加 `audio_params` JSONB 列存储
- **方案 b**: 保持本地状态（TTS 参数不需要跨会话保存）
**建议**: 方案 b — 这些参数是生成参数而非结果，每次 TTS 可能不同，不必持久化

### B5. MaterialPage no-op 回调清理 [H9]
**文件**: `new_html/components/MaterialPage.tsx`
**改动**: 
- 移除"数据库实时同步中"误导文案 [M8]
- 版本存档相关按钮在 MaterialsPage 路由下隐藏（因为是 no-op）

### B6. 素材 ID 格式统一 [M5]
**文件**: `new_html/pages/DesignPage.tsx:93`
**改动**: 将 `${assetId}_img_${i}` 改为 `${assetId}_${i}`，与 `episodeAdapters.ts:216` 一致

### B7. assetsToMaterialLibrary 同名资产处理 [M6]
**文件**: `new_html/utils/episodeAdapters.ts:211`
**改动**: 同名时合并而不是覆盖：
```typescript
if (!lib[key]) lib[key] = [];
// 当前已经是 push，不会覆盖 — 确认这里逻辑正确
```
（经确认，当前代码 `if (!lib[key]) lib[key] = []` + `push` 实际上是合并的，不是覆盖。此项为误报，无需修改。）

---

## Phase C: WebP 无损转换

### C1. worker.py — 生成图片转 WebP 无损
**文件**: `worker.py` `_save_result_file` 方法
**策略**: 替换当前的"剥离 PNG 元数据"为"转换为 WebP 无损"
**改动**:

```python
# 替换当前的 PNG 元数据剥离逻辑
if file_type == 'image' and ext.lower() in ('.png', '.jpg', '.jpeg'):
    try:
        from PIL import Image
        import io
        original_size = len(file_content)
        img = Image.open(io.BytesIO(file_content))
        buf = io.BytesIO()
        img.save(buf, format='WEBP', lossless=True)
        file_content = buf.getvalue()
        ext = '.webp'
        unique_filename = f"{uuid.uuid4().hex[:12]}.webp"
        local_path = upload_dir / unique_filename
        saved = original_size - len(file_content)
        logger.info(f"🗜️ 转换为WebP无损: {original_size} -> {len(file_content)} bytes (节省 {saved} bytes)")
    except Exception as e:
        logger.debug(f"WebP转换跳过: {e}")
```

**效果**: 
- PNG → WebP 无损：通常节省 25-35%
- 同时自动剥离 ComfyUI 工作流元数据（WebP 不携带 PNG tEXt 块）
- `mime_type` 改为 `'image/webp'`

### C2. comfyui_agent.py — 下载输出转 WebP 无损
**文件**: `comfyui_agent.py` `_download_comfyui_output`
**改动**: 替换现有的 `_strip_png_metadata` 为 WebP 无损转换：

```python
@staticmethod
def _convert_to_webp_lossless(path):
    """将 PNG 转换为 WebP 无损格式，同时剥离所有元数据"""
    try:
        from PIL import Image
        original_size = os.path.getsize(path)
        img = Image.open(path)
        webp_path = str(Path(path).with_suffix('.webp'))
        img.save(webp_path, format='WEBP', lossless=True)
        new_size = os.path.getsize(webp_path)
        # 删除原 PNG
        os.remove(path)
        logger.info(f"PNG→WebP lossless: {original_size} -> {new_size} bytes (saved {original_size - new_size})")
        return webp_path
    except Exception as e:
        logger.debug(f"WebP conversion skipped: {e}")
        return path
```

### C3. file_url 路径更新
转换后文件扩展名从 `.png` 变为 `.webp`：
- `file_url` 变为 `/storage/image/user/yyyymm/xxx.webp`
- 前端 `<img>` 标签无需修改（浏览器原生支持 WebP）

---

## Phase D: EnhancePage 持久化（待讨论）

EnhancePage 当前几乎完全是本地状态 [C3, C4, H5, H6]。
完整修复需要：
1. `video_segments` 表添加 `enhanced_video_url` 列
2. 后端添加增强任务提交 API（替换模拟的 `setInterval`）
3. 前端时间轴编辑状态持久化到 DB

**建议**: 这是一个独立的功能模块，需要单独的设计文档。当前不在本计划范围内。

---

## 执行顺序

| 步骤 | 内容 | 涉及文件 | 预估 |
|------|------|----------|------|
| 1 | Phase A (A1+A2+A5) | DubbingCard.tsx, AudioStagePage.tsx | 10 min |
| 2 | Phase C (C1+C2) | worker.py, comfyui_agent.py | 10 min |
| 3 | Phase B1 | MaterialPage.tsx, MaterialsPage.tsx | 20 min |
| 4 | Phase B2 | DesignPage.tsx | 10 min |
| 5 | Phase B3 | api_routes.py | 5 min |
| 6 | Phase B5+B6 | MaterialPage.tsx, DesignPage.tsx | 10 min |
| 7 | Build + deploy 同步 | new_html/, deploy/ | 5 min |

**总计**: ~70 min

---

## 不修改项（说明理由）

| 项 | 理由 |
|----|------|
| H4 情绪/语速参数 | TTS 生成参数不需要跨会话保存，保持本地状态即可 |
| H9 版本存档 no-op | Materials 页无版本管理需求，隐藏相关 UI 即可 |
| L1-L4 | 低优先级功能缺失，不影响核心数据流 |
| EnhancePage 全部 | 需独立设计文档，不在本期 |
