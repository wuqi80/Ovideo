# 修复图片显示：去除 base64 转换 + 修正文件分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端不再将服务器 URL 转为 base64 DataURL（消除 `ERR_BLOCKED_BY_CLIENT` 阻塞），后端按文件扩展名正确分类图片存到 `images/` 而非 `others/`。

**Architecture:** 后端 `save_output_file` 根据扩展名推断文件类型（`.png` → `images/`）。前端接收到 `/storage/images/...` URL 后直接用作 `<img src>` 和 `GeneratedImage.url`，不再调用 `ensureDataUrl` 或 `FileReader.readAsDataURL`。既有的 `thumbnail_only` 加载降级 + `handleViewFullImage` blob 缓存机制无需修改。

**Tech Stack:** TypeScript/React（前端），Python/FastAPI（后端）

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `agent_routes.py` | **Modify** (lines 19-29) | `save_output_file` 按扩展名分类 |
| `comfyui_main.py` | **Modify** (lines 145-154) | `_save_output_file` 同步修改 |
| `new_html/components/GenerationPage.tsx` | **Modify** (4处) | 主生成路径 + 多角度 + 全景 + 抠图 去除 base64 转换 |
| `deploy/` | **Copy** | 同步修改文件 |

---

### Task 1: 后端 — `save_output_file` 按扩展名分类

**Files:**
- Modify: `agent_routes.py` (lines 19-29)
- Modify: `comfyui_main.py` (lines 145-154)

- [ ] **Step 1: 修改 `agent_routes.py` 中的 `save_output_file`**

将 `agent_routes.py` 第 19-29 行替换为：

```python
def save_output_file(content: bytes, task_id: str, filename: str, content_type: str) -> dict:
    """Save file to disk, return URL. Zero DB dependency."""
    ext = Path(filename).suffix.lower()
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}
    VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
    if ext in IMAGE_EXTS:
        category = "images"
    elif ext in VIDEO_EXTS:
        category = "videos"
    else:
        major = content_type.split("/")[0] if content_type else "other"
        category = {"image": "images", "video": "videos"}.get(major, "others")
    year_month = datetime.now().strftime("%Y%m")
    disk_name = f"{task_id}_{filename}"
    rel_path = f"{category}/{year_month}/{disk_name}"
    full_path = Path("persistent_storage") / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return {"url": f"/storage/{rel_path}", "filename": filename, "size": len(content)}
```

- [ ] **Step 2: 修改 `comfyui_main.py` 中的 `_save_output_file`**

将 `comfyui_main.py` 第 145-154 行替换为同样的扩展名优先逻辑：

```python
def _save_output_file(content: bytes, task_id: str, filename: str, content_type: str) -> dict:
    ext = Path(filename).suffix.lower()
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}
    VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
    if ext in IMAGE_EXTS:
        category = "images"
    elif ext in VIDEO_EXTS:
        category = "videos"
    else:
        major = content_type.split("/")[0] if content_type else "other"
        category = {"image": "images", "video": "videos"}.get(major, "others")
    year_month = datetime.now().strftime("%Y%m")
    disk_name = f"{task_id}_{filename}"
    rel_path = f"{category}/{year_month}/{disk_name}"
    full_path = Path("persistent_storage") / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return {"url": f"/storage/{rel_path}", "filename": filename, "size": len(content)}
```

- [ ] **Step 3: 验证后端无语法错误**

Run: `python -c "import ast; ast.parse(open('agent_routes.py', encoding='utf-8').read()); print('OK')"`
Run: `python -c "import ast; ast.parse(open('comfyui_main.py', encoding='utf-8').read()); print('OK')"`
Expected: 两个都输出 `OK`

---

### Task 2: 前端 — 主生成路径去除 base64 转换

**Files:**
- Modify: `new_html/components/GenerationPage.tsx` (lines 685-747)

- [ ] **Step 1: 替换主生成路径的 base64 转换循环**

将 `GenerationPage.tsx` 第 685-747 行（从 `// 转换所有URL为dataURL` 到 `return; // 提前返回`）替换为：

```typescript
              // 直接使用服务器URL，不再转base64（避免 ERR_BLOCKED_BY_CLIENT）
              const newImages: GeneratedImage[] = resultUrls
                  .filter(url => url)
                  .map(url => ({
                      id: uuidv4(),
                      url: url,
                      thumbnail: url,
                      timestamp: Date.now()
                  }));

              if (newImages.length === 0) {
                  throw new Error('未获取到生成结果');
              }

              resultUrl = newImages[0].url;

              onUpdateStoryboardItem(shot.id, (currentItem) => {
                  const existingImages = currentItem.generatedImages || [];
                  const uniqueNewImages = newImages.filter(newImg => 
                      !existingImages.some(existImg => existImg.url === newImg.url)
                  );
                  const updatedImages = [...existingImages, ...uniqueNewImages];
                  return { 
                      generatedImages: updatedImages,
                      selectedImageId: newImages[0].id,
                      generatedImage: resultUrl
                  };
              });

              console.log('💾 生成完成，触发立即保存');
              onForceSave();

              return;
```

**关键变化：**
- 删除了 `fetch → blob → FileReader.readAsDataURL` 循环
- `url` 和 `thumbnail` 都直接使用服务器路径（如 `/storage/images/202603/...`）
- 去重逻辑保留（按 URL 比较）
- `generateThumbnail` 调用被移除（不再需要——图片由浏览器直接从服务器加载）

---

### Task 3: 前端 — 多角度/全景/抠图路径去除 base64 转换

**Files:**
- Modify: `new_html/components/GenerationPage.tsx` (3处)

这三个函数都使用了相同的模式：`ensureDataUrl(resultUrl)` 将服务器URL转为base64。改为直接使用URL。

- [ ] **Step 1: 修改 `handleHumanMultiAngle`（多角度生成）**

将 `GenerationPage.tsx` 约第 1179-1197 行的 newImages 构建逻辑：
```typescript
        const newImages: GeneratedImage[] = [];
        for (const resultUrl of resultUrls) {
            if (!resultUrl) {
                console.warn('⚠️ 跳过空的结果URL');
                continue;
            }
            try {
                const dataUrl = await ensureDataUrl(resultUrl);
                if (dataUrl) {
                    newImages.push({
                        id: uuidv4(),
                        url: dataUrl,
                        timestamp: Date.now()
                    });
                }
            } catch (e) {
                console.error('❌ 转换图片URL失败:', resultUrl, e);
            }
        }
```

替换为：

```typescript
        const newImages: GeneratedImage[] = resultUrls
            .filter(url => url)
            .map(url => ({
                id: uuidv4(),
                url: url,
                thumbnail: url,
                timestamp: Date.now()
            }));
```

- [ ] **Step 2: 修改 `handleAroundAngle`（全景角度生成）**

将 `GenerationPage.tsx` 约第 1241-1260 行的 newImages 构建逻辑（与 Step 1 相同的模式）：

```typescript
        const newImages: GeneratedImage[] = [];
        for (const resultUrl of resultUrls) {
            if (!resultUrl) {
                console.warn('⚠️ 跳过空的结果URL');
                continue;
            }
            try {
                const dataUrl = await ensureDataUrl(resultUrl);
                if (dataUrl) {
                    newImages.push({
                        id: uuidv4(),
                        url: dataUrl,
                        timestamp: Date.now()
                    });
                }
            } catch (e) {
                console.error('❌ 转换图片URL失败:', resultUrl, e);
            }
        }
```

替换为：

```typescript
        const newImages: GeneratedImage[] = resultUrls
            .filter(url => url)
            .map(url => ({
                id: uuidv4(),
                url: url,
                thumbnail: url,
                timestamp: Date.now()
            }));
```

- [ ] **Step 3: 修改 `handleMatting`（抠图）**

将 `GenerationPage.tsx` 约第 1308-1316 行：

```typescript
        const newImages: GeneratedImage[] = [];
        for (const url of resultUrls) {
            const dataUrl = await ensureDataUrl(url);
            newImages.push({
                id: uuidv4(),
                url: dataUrl,
                timestamp: Date.now()
            });
        }
```

替换为：

```typescript
        const newImages: GeneratedImage[] = resultUrls
            .filter(url => url)
            .map(url => ({
                id: uuidv4(),
                url: url,
                thumbnail: url,
                timestamp: Date.now()
            }));
```

**注意：** `ensureDataUrl` 函数本身不删除——它仍被用于将现有图片转为 base64 以上传到 ComfyUI（如 `handleHumanMultiAngle` 中的 `const baseImage = await ensureDataUrl(imageUrl);`）。只是不再对 OUTPUT URLs 调用它。

---

### Task 4: 同步到 deploy 目录

**Files:**
- Copy: `agent_routes.py` → `deploy/agent_routes.py`
- Copy: `comfyui_main.py` → `deploy/comfyui_main.py`

- [ ] **Step 1: 复制修改的后端文件到 deploy/**

```powershell
Copy-Item agent_routes.py deploy/agent_routes.py -Force
Copy-Item comfyui_main.py deploy/comfyui_main.py -Force
```

注意：`GenerationPage.tsx` 是前端源码，需要 `npm run build` 生成 dist/ 后部署。deploy/ 只同步后端 Python 文件。

- [ ] **Step 2: 验证 deploy 文件一致**

```powershell
$files = @("agent_routes.py", "comfyui_main.py")
foreach ($f in $files) {
    $h1 = (Get-FileHash $f).Hash
    $h2 = (Get-FileHash "deploy/$f").Hash
    if ($h1 -eq $h2) { Write-Output "$f OK" } else { Write-Output "$f MISMATCH!" }
}
```

Expected: 全部 OK

---

## 验证清单

部署后验证：

1. **图片生成** — 前端点击"开始生成"，Console 不再出现 `ERR_BLOCKED_BY_CLIENT`
2. **图片显示** — loading 结束后，4张图片立即显示在网格中
3. **URL 格式** — Console 日志中 `提取的URLs` 显示 `/storage/images/...`（不是 `others/`）
4. **查看大图** — 点击图片可以查看高清原图（通过 `handleViewFullImage` 的 blob 缓存机制）
5. **保存恢复** — 刷新页面后，图片仍然显示（通过 `generated_images` 保存的服务器 URL 恢复）
6. **多角度/抠图** — 其他生成功能（多角度、全景、抠图）也正常显示结果
7. **左侧面板缩略图** — 镜头卡片上的小缩略图正常显示

## 不修改的部分

- `ensureDataUrl` 函数保留 — 用于将服务器图片转为 base64 以上传到 ComfyUI
- `ensureDataUrlAsPng` 函数保留 — 同上，PNG 格式转换
- `handleViewFullImage` 保留 — 已经正确处理服务器URL（fetch → blob URL → 缓存）
- `thumbnail_only` 后端逻辑保留 — 前端恢复时已有 `url = img.url || img.thumbnail` 降级
- 用户上传图片的 `FileReader.readAsDataURL` 保留 — 这是本地文件读取，不涉及服务器URL
