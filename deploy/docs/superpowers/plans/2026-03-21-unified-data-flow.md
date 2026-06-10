# 统一数据流架�?实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 通过后端原子导出 API + EpisodeContext 按需加载 + 音频持久化修复，消除双数据模型导致的连锁数据流问题�?

**Architecture:** 保留 WorkspaceApp 用于剧本编辑（AI/撤销功能复杂）。剧本页通过单个后端事务 API 将数据导出到规范�?DB 表。其他所有工作流页面通过 EpisodeContext 按需加载所需�?DB 数据切片，直接读�?DB，不经过 JSONB blob�?

**Tech Stack:** FastAPI (Python) + asyncpg 事务, React 18 + TypeScript, PostgreSQL 规范化表

---

## File Map

**Create:**
- (none �?all changes are modifications to existing files)

**Modify:**
- `api_routes.py` �?新增 `POST /api/episodes/{eid}/export-script` 原子导出 endpoint
- `dao_storyboard.py` �?新增 `batch_create_transactional(conn, ...)` 支持传入连接
- `dao_episode_script.py` �?新增 `upsert_transactional(conn, ...)` 支持传入连接
- `new_html/services/apiService.ts` �?新增 `exportScript()` 函数
- `new_html/contexts/EpisodeContext.tsx` �?重构为按需加载（`loadSlices`�?
- `new_html/WorkspaceApp.tsx` �?简�?`handleExportStoryboards`
- `new_html/pages/DesignPage.tsx` �?添加导出按钮 + 去除重复 `normalizeAsset`
- `new_html/pages/MaterialsPage.tsx` �?添加导出按钮 + 去除 `localLibrary`
- `new_html/pages/AudioStagePage.tsx` �?添加导出按钮 + TTS/音乐持久化修�?
- `new_html/pages/StoryboardGenPage.tsx` �?添加导出按钮
- `new_html/pages/VideoGenPage.tsx` �?确认已有导出逻辑
- `new_html/App.tsx` �?路由声明顺序调整

---

## Task 1: 后端 �?DAO 支持事务连接

**Files:**
- Modify: `dao_storyboard.py`
- Modify: `dao_episode_script.py`

- [x] **Step 1: dao_storyboard.py 添加 batch_create_transactional**

�?`StoryboardDAO` 类中添加（在 `batch_create` 方法之后）：

```python
@staticmethod
async def batch_create_transactional(conn, episode_id: str, items: list) -> int:
    """在已有事务连接上批量创建分镜，返回创建数�?""
    count = 0
    for item in items:
        item_id = f"sb_{uuid.uuid4().hex[:12]}"
        await conn.execute("""
            INSERT INTO storyboard_items
                (item_id, episode_id, sort_order, scene_heading, action_text,
                 dialogue, camera_movement, image_prompt, video_prompt, bound_assets)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        """,
            item_id, episode_id,
            item.get('sort_order', 0),
            item.get('scene_heading', ''),
            item.get('action_text', ''),
            item.get('dialogue', ''),
            item.get('camera_movement', ''),
            item.get('image_prompt', ''),
            item.get('video_prompt', ''),
            json.dumps(item.get('bound_assets', []), ensure_ascii=False),
        )
        count += 1
    return count
```

- [x] **Step 2: dao_episode_script.py 添加 upsert_transactional**

�?`EpisodeScriptDAO` 类中添加（在 `save_or_update` 方法之后）：

```python
@staticmethod
async def upsert_transactional(
    conn,
    episode_id: str,
    original_content: str = '',
    adapted_script: str = '',
    metadata: Optional[dict] = None,
) -> None:
    """在已有事务连接上 upsert 剧本"""
    script_id = f"script_{uuid.uuid4().hex[:12]}"
    await conn.execute("""
        INSERT INTO episode_scripts
            (script_id, episode_id, original_content, adapted_script, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (episode_id)
        DO UPDATE SET
            original_content = EXCLUDED.original_content,
            adapted_script = EXCLUDED.adapted_script,
            metadata = EXCLUDED.metadata,
            updated_at = CURRENT_TIMESTAMP
    """,
        script_id, episode_id,
        original_content, adapted_script,
        json.dumps(metadata or {}, ensure_ascii=False),
    )
```

---

## Task 2: 后端 �?原子导出 API endpoint

**Files:**
- Modify: `api_routes.py`

- [x] **Step 1: �?api_routes.py 顶部导入�?DAO 方法**

找到现有�?import 区域，确认已导入 `StoryboardDAO` �?`EpisodeScriptDAO`。如果没有，添加�?

```python
from dao_storyboard import StoryboardDAO
from dao_episode_script import EpisodeScriptDAO
```

- [x] **Step 2: 添加请求体模�?*

�?`api_routes.py` 现有 Pydantic model 定义区域之后添加�?

```python
class ExportScriptRequest(BaseModel):
    project_id: str
    original_content: str = ""
    script_content: str = ""
    storyboard_items: List[dict] = []
    characters: List[dict] = []  # [{name, description}]
    scenes: List[dict] = []      # [{name, description}]
```

- [x] **Step 3: 添加原子导出 endpoint**

�?`api_routes.py` �?storyboard 相关 endpoint 附近添加�?

```python
@router.post("/api/episodes/{episode_id}/export-script")
async def export_script(episode_id: str, req: ExportScriptRequest, user_id: str = Depends(get_current_user)):
    """原子导出：单事务写入 episode_scripts + storyboard_items + assets"""
    db = get_db_manager()
    if not db:
        raise HTTPException(500, "数据库不可用")

    async with db.acquire() as conn:
        async with conn.transaction():
            # 1. UPSERT episode_scripts
            await EpisodeScriptDAO.upsert_transactional(
                conn, episode_id,
                original_content=req.original_content,
                adapted_script=req.script_content,
                metadata={
                    'extracted_characters': [c.get('name', '') for c in req.characters],
                    'extracted_scenes': [s.get('name', '') for s in req.scenes],
                },
            )

            # 2. DELETE old storyboard items
            await conn.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1", episode_id
            )

            # 3. BATCH INSERT new storyboard items
            created = await StoryboardDAO.batch_create_transactional(
                conn, episode_id, req.storyboard_items
            )

            # 4. UPSERT assets (characters + scenes)
            for char in req.characters:
                name = char.get('name', '').strip()
                if not name:
                    continue
                await conn.execute("""
                    INSERT INTO assets (asset_id, project_id, episode_id, asset_type, name, description, created_by)
                    VALUES ($1, $2, $3, 'character', $4, $5, $6)
                    ON CONFLICT ON CONSTRAINT assets_project_type_name_key DO NOTHING
                """,
                    f"asset_{uuid.uuid4().hex[:12]}",
                    req.project_id, episode_id,
                    name, char.get('description', ''), user_id,
                )

            for scene in req.scenes:
                name = scene.get('name', '').strip()
                if not name:
                    continue
                await conn.execute("""
                    INSERT INTO assets (asset_id, project_id, episode_id, asset_type, name, description, created_by)
                    VALUES ($1, $2, $3, 'scene', $4, $5, $6)
                    ON CONFLICT ON CONSTRAINT assets_project_type_name_key DO NOTHING
                """,
                    f"asset_{uuid.uuid4().hex[:12]}",
                    req.project_id, episode_id,
                    name, scene.get('description', ''), user_id,
                )

    return {
        "success": True,
        "storyboard_items_created": created,
        "characters_count": len(req.characters),
        "scenes_count": len(req.scenes),
    }
```

- [x] **Step 3b: 确认 assets 表的唯一约束**

检�?`db_migration_assets.sql` 是否�?`(project_id, asset_type, name)` 的唯一约束。如果没有，需要先执行�?

```sql
-- 仅在约束不存在时执行
ALTER TABLE assets ADD CONSTRAINT assets_project_type_name_key
    UNIQUE (project_id, asset_type, name);
```

如果约束名不同（或不存在），�?`ON CONFLICT ON CONSTRAINT ...` 改为 `ON CONFLICT (project_id, asset_type, name) DO NOTHING`�?

---

## Task 3: 前端 �?apiService 添加 exportScript

**Files:**
- Modify: `new_html/services/apiService.ts`

- [x] **Step 1: �?apiService.ts 末尾添加 exportScript 函数**

在文件末尾（其他 export function 之后）添加：

```typescript
export async function exportScript(episodeId: string, data: {
    project_id: string;
    original_content: string;
    script_content: string;
    storyboard_items: any[];
    characters: { name: string; description: string }[];
    scenes: { name: string; description: string }[];
}) {
    const response = await fetch(`${API_BASE}/api/episodes/${episodeId}/export-script`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(response, 'exportScript');
}
```

---

## Task 4: 前端 �?WorkspaceApp 导出逻辑简�?

**Files:**
- Modify: `new_html/WorkspaceApp.tsx`

- [x] **Step 1: 更新 import**

�?WorkspaceApp.tsx �?import 区域�?
- 添加: `import { exportScript } from './services/apiService';`
- 移除不再需要的导入（如�?`extractToAssets`, `deleteAllStoryboardItems`, `batchCreateStoryboardItems` 仅用于导出逻辑�?

- [x] **Step 2: 替换 handleExportStoryboards 函数�?*

找到 `handleExportStoryboards`（约 L1723-1795），将整个函数体替换为：

```typescript
const handleExportStoryboards = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
        const pathSegments = location.pathname.split('/');
        const epIdx = pathSegments.indexOf('ep');
        if (epIdx >= 0 && pathSegments[epIdx + 1]) {
            const projIdx = pathSegments.indexOf('projects');
            const pid = projIdx >= 0 ? pathSegments[projIdx + 1] : '';
            const eid = pathSegments[epIdx + 1];
            if (pid && eid && selectedFile) {
                let charNames = selectedFile.extractedCharacters || [];
                let sceneNames = selectedFile.extractedScenes || [];
                if ((!charNames.length || !sceneNames.length) && selectedFile.storyboard?.items) {
                    const sbChars = new Set<string>();
                    const sbScenes = new Set<string>();
                    for (const item of selectedFile.storyboard.items) {
                        if (item.characters) item.characters.forEach(c => { if (c) sbChars.add(c); });
                        if (item.scene) sbScenes.add(item.scene);
                    }
                    if (!charNames.length) charNames = Array.from(sbChars);
                    if (!sceneNames.length) sceneNames = Array.from(sbScenes);
                }

                const dbItems = (selectedFile.storyboard?.items || []).map((item, idx) => ({
                    sort_order: idx,
                    scene_heading: item.originalText || item.scene || '',
                    action_text: item.scriptSegment || '',
                    dialogue: item.dialogue || '',
                    camera_movement: item.cameraMovement || '',
                    image_prompt: item.imagePrompt || '',
                    video_prompt: item.videoPrompt || '',
                    bound_assets: [
                        ...(item.characters || []).map((c: string) => `char:${c}`),
                        ...(item.scene ? [`scene:${item.scene}`] : []),
                    ],
                }));

                try {
                    await exportScript(eid, {
                        project_id: pid,
                        original_content: selectedFile.originalContent || '',
                        script_content: selectedFile.scriptContent || '',
                        storyboard_items: dbItems,
                        characters: charNames.map(n => ({ name: n, description: '' })),
                        scenes: sceneNames.map(n => ({ name: n, description: '' })),
                    });
                    console.log(`�?原子导出完成: ${dbItems.length} 个分镜`);
                } catch (e) {
                    console.error('导出失败:', e);
                    alert('导出失败: ' + (e instanceof Error ? e.message : '未知错误'));
                    return;
                }
                routerNavigate(`/projects/${pid}/ep/${eid}/workflow/design`);
                return;
            }
        }
        handleViewSwitch(AppView.Materials);
    } finally {
        setIsExporting(false);
    }
};
```

---

## Task 5: EpisodeContext 按需加载

**Files:**
- Modify: `new_html/contexts/EpisodeContext.tsx`

- [x] **Step 1: 添加 DataSlice 类型�?loadSlices 到接�?*

替换 `EpisodeContextValue` 接口（约 L125-142）：

```typescript
type DataSlice = 'script' | 'storyboardItems' | 'assets' | 'audioTracks' | 'videoSegments' | 'characterVoices';

interface EpisodeContextValue {
    episodeId: string;
    projectId: string;
    isLoading: boolean;
    error: string | null;
    script: EpisodeScript | null;
    storyboardItems: StoryboardItemDB[];
    assets: AssetItem[];
    audioTracks: AudioTrack[];
    videoSegments: VideoSegment[];
    characterVoices: CharacterVoice[];
    loadSlices: (...slices: DataSlice[]) => Promise<void>;
    reload: () => Promise<void>;
    updateStoryboardDuration: (itemId: string, durationMs: number) => Promise<void>;
    saveScript: (data: { original_content?: string; adapted_script?: string; metadata?: Record<string, any> }) => Promise<void>;
    saveStoryboardItem: (itemId: string, data: Record<string, any>) => Promise<void>;
    createStoryboardItems: (items: any[]) => Promise<void>;
    extractToAssets: (characters: any[], scenes: any[]) => Promise<void>;
}
```

- [x] **Step 2: 更新 context 默认�?*

�?`createContext<EpisodeContextValue>({...})` 中添加：

```typescript
loadSlices: async () => {},
```

- [x] **Step 3: 重构 EpisodeProvider �?loadData 为按需加载**

替换 `loadData` 及其 useEffect（约 L185-231）：

```typescript
const loadedSlicesRef = useRef<Set<DataSlice>>(new Set());

const loadSlices = useCallback(async (...slices: DataSlice[]) => {
    if (!episodeId) return;
    setIsLoading(true);
    setError(null);

    slices.forEach(s => loadedSlicesRef.current.add(s));

    const loaders: Record<DataSlice, () => Promise<void>> = {
        script: async () => {
            const res = await getEpisodeScript(episodeId).catch(() => ({ success: false, script: null }));
            if (res.success && res.script) setScript(normalizeEpisodeScript(res.script));
        },
        storyboardItems: async () => {
            const res = await getStoryboardItems(episodeId).catch(() => ({ success: false, items: [] }));
            if (res.success) setStoryboardItems((res.items || []).map(normalizeStoryboardItem));
        },
        assets: async () => {
            const res = await getAssets(projectId, episodeId).catch(() => ({ success: false, assets: [] }));
            if (res.success) setAssets((res.assets || []).map(normalizeAsset));
        },
        audioTracks: async () => {
            const res = await getAudioTracks(episodeId).catch(() => ({ success: false, tracks: [] }));
            if (res.success) setAudioTracks((res.tracks || []).map(normalizeAudioTrack));
        },
        videoSegments: async () => {
            const res = await getVideoSegments(episodeId).catch(() => ({ success: false, segments: [] }));
            if (res.success) setVideoSegments((res.segments || []).map(normalizeVideoSegment));
        },
        characterVoices: async () => {
            const res = await getCharacterVoices(projectId).catch((e) => {
                console.warn('character_voices 加载失败:', e);
                return { success: false, voices: [] };
            });
            if (res.success && Array.isArray(res.voices)) {
                setCharacterVoices(res.voices.map(normalizeCharacterVoice));
            } else {
                setCharacterVoices([]);
            }
        },
    };

    try {
        await Promise.all(slices.map(s => loaders[s]()));
    } catch (e: any) {
        setError(e.message || '加载集数据失�?);
    } finally {
        setIsLoading(false);
    }
}, [episodeId, projectId]);

const reload = useCallback(async () => {
    const slices = Array.from(loadedSlicesRef.current);
    if (slices.length > 0) {
        await loadSlices(...slices);
    }
}, [loadSlices]);

// 不再自动加载全部数据 �?由各页面声明需要的 slices
// 保留�?episodeId 变化的监听，清空旧数�?
useEffect(() => {
    loadedSlicesRef.current.clear();
    setScript(null);
    setStoryboardItems([]);
    setAssets([]);
    setAudioTracks([]);
    setVideoSegments([]);
    setCharacterVoices([]);
    setIsLoading(false);
}, [episodeId]);
```

- [x] **Step 4: �?Provider value 中暴�?loadSlices**

�?`<EpisodeContext.Provider value={{...}}>` 中添�?`loadSlices`�?

```typescript
loadSlices,
reload,
```

---

## Task 6: 各工作流页面声明数据需�?

**Files:**
- Modify: `new_html/pages/DesignPage.tsx`
- Modify: `new_html/pages/MaterialsPage.tsx`
- Modify: `new_html/pages/AudioStagePage.tsx`
- Modify: `new_html/pages/StoryboardGenPage.tsx`
- Modify: `new_html/pages/VideoGenPage.tsx`
- Modify: `new_html/pages/GenerationPage.tsx`
- Modify: `new_html/pages/EnhancePage.tsx`

每个页面在组件顶部添�?`useEffect` 声明自己需要的数据切片�?

- [x] **Step 1: DesignPage �?加载 assets + script**

�?`DesignPage` 组件�?`useEpisode()` 调用之后，添加：

```typescript
const { episodeId, projectId, assets: rawAssets, script, isLoading, error, reload, loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('assets', 'script');
}, [loadSlices]);
```

- [x] **Step 2: MaterialsPage �?加载 storyboardItems + assets + script**

```typescript
const { ..., loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('storyboardItems', 'assets', 'script');
}, [loadSlices]);
```

- [x] **Step 3: AudioStagePage �?加载 5 �?slices**

```typescript
const { ..., loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('storyboardItems', 'assets', 'characterVoices', 'script', 'audioTracks');
}, [loadSlices]);
```

- [x] **Step 4: StoryboardGenPage �?加载 storyboardItems + assets + script**

```typescript
const { ..., loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('storyboardItems', 'assets', 'script');
}, [loadSlices]);
```

- [x] **Step 5: VideoGenPage �?加载 storyboardItems**

```typescript
const { ..., loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('storyboardItems');
}, [loadSlices]);
```

- [x] **Step 6: GenerationPage �?加载 storyboardItems + audioTracks + videoSegments**

```typescript
const { ..., loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('storyboardItems', 'audioTracks', 'videoSegments');
}, [loadSlices]);
```

- [x] **Step 7: EnhancePage �?加载 videoSegments + storyboardItems**

```typescript
const { ..., loadSlices } = useEpisode();

useEffect(() => {
    loadSlices('videoSegments', 'storyboardItems');
}, [loadSlices]);
```

---

## Task 7: 各页面「导出到下一步」按�?

**Files:**
- Modify: `new_html/pages/DesignPage.tsx`
- Modify: `new_html/pages/MaterialsPage.tsx`
- Modify: `new_html/pages/AudioStagePage.tsx`
- Modify: `new_html/pages/StoryboardGenPage.tsx`

- [x] **Step 1: DesignPage �?添加「导出到素材绑定」按�?*

�?DesignPage �?header 区域（或页面底部），添加导出按钮�?

```typescript
const [exporting, setExporting] = useState(false);

const handleExportNext = useCallback(async () => {
    setExporting(true);
    try {
        await reload();
        navigate(`/projects/${projectId}/ep/${episodeId}/workflow/materials`);
    } finally {
        setExporting(false);
    }
}, [reload, navigate, projectId, episodeId]);
```

JSX 按钮（放在页面顶部操作栏）：

```tsx
<button
    onClick={handleExportNext}
    disabled={exporting}
    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
>
    {exporting ? <Loader size={14} className="animate-spin" /> : <ArrowRight size={14} />}
    导出到素材绑�?
</button>
```

- [x] **Step 2: MaterialsPage �?添加「导出到声音与配音」按�?*

相同模式，导航到 `audio`�?

```typescript
const handleExportNext = useCallback(async () => {
    setExporting(true);
    try {
        await reload();
        navigate(`/projects/${projectId}/ep/${episodeId}/workflow/audio`);
    } finally {
        setExporting(false);
    }
}, [reload, navigate, projectId, episodeId]);
```

- [x] **Step 3: AudioStagePage �?添加「导出到分镜生成」按�?*

AudioStagePage 已经有导出按钮的基础结构（导航到 storyboard）。确认或添加�?

```typescript
const handleExportNext = useCallback(async () => {
    setExporting(true);
    try {
        await reload();
        navigate(`/projects/${projectId}/ep/${episodeId}/workflow/storyboard`);
    } finally {
        setExporting(false);
    }
}, [reload, navigate, projectId, episodeId]);
```

- [x] **Step 4: StoryboardGenPage �?确认导出按钮**

StoryboardGenPage 已经�?`handleExportNext` 函数。确认它导航�?`video`�?

---

## Task 8: AudioStagePage 音频持久化修�?

**Files:**
- Modify: `new_html/pages/AudioStagePage.tsx`

- [x] **Step 1: AudioPreviewTab �?TTS 成功后持久化音频 URL**

找到 `runGenerate` 函数（约 L619-649），�?`setLocalAudio(...)` 之后添加持久化调用�?

在这一行之后：
```typescript
setLocalAudio(p => ({ ...p, [key]: { url: resolveUrl(url), durationMs } }));
```

添加�?
```typescript
// 持久化音�?URL �?DB
const updateFields: Record<string, any> = {};
if (clip.type === 'narration') {
    updateFields.narration_audio_url = url;
} else {
    updateFields.dialogue_audio_url = url;
}
if (durationMs && Number.isFinite(durationMs)) {
    updateFields.audio_duration_ms = durationMs;
}
try {
    await apiUpdateStoryboardItem(clip.itemId, updateFields);
} catch (persistErr) {
    console.error('持久化音频URL失败:', persistErr);
}
```

同时需要确�?`apiUpdateStoryboardItem` 被导入。在文件顶部�?import 中添加：

```typescript
import {
    generateSpeech, createCharacterVoice, updateCharacterVoice, deleteCharacterVoice,
    minimaxVoiceDesign, minimaxVoiceClone, minimaxTTS, minimaxMusic, minimaxLyrics,
    minimaxFileUpload, minimaxGetVoice, minimaxDeleteVoice,
    updateStoryboardItem as apiUpdateStoryboardItem,
    createAudioTrack,
} from '../services/apiService';
```

并且删除已有�?`updateStoryboardDuration` 调用（约 L641-643），因为 `audio_duration_ms` 已经在上面的 `updateFields` 中一并更新了�?

```typescript
// 删除这段（已合并到上面的持久化逻辑中）�?
// if (durationMs && Number.isFinite(durationMs)) {
//     await updateStoryboardDuration(clip.itemId, durationMs);
// }
```

- [x] **Step 2: MusicTab �?音乐生成后持久化�?audio_tracks**

找到 `handleGenerateMusic` 函数（约 L899-913），�?`setMusicResult(...)` 之后添加�?

```typescript
if (res.audio_url) {
    setMusicResult({ url: resolveUrl(res.audio_url), durationMs: res.duration_ms || 0 });
    // 持久化到 audio_tracks �?
    try {
        await createAudioTrack(episodeId, {
            track_type: 'bgm',
            name: `AI 音乐 ${new Date().toLocaleTimeString()}`,
            audio_url: res.audio_url,
            duration_ms: res.duration_ms || 0,
        });
        await reload();
    } catch (persistErr) {
        console.error('持久化音乐失�?', persistErr);
    }
}
```

MusicTab �?props �?`createAudioTrack` 需要通过 import 获取（已�?Step 1 中添加了 import）。同时确�?`episodeId` �?`reload` 已经作为 props 传入 MusicTab�?

---

## Task 9: 数据源统一修复

**Files:**
- Modify: `new_html/pages/MaterialsPage.tsx`
- Modify: `new_html/pages/DesignPage.tsx`

- [x] **Step 1: MaterialsPage 去除 localLibrary**

找到 `localLibrary` 相关代码（约 L36-43）：

```typescript
// 删除这些行：
const [localLibrary, setLocalLibrary] = useState<MaterialLibrary | null>(null);
const effectiveLibrary = localLibrary ?? materialLibraryFromDb;

const prevDbLibRef = useRef(materialLibraryFromDb);
if (prevDbLibRef.current !== materialLibraryFromDb) {
    prevDbLibRef.current = materialLibraryFromDb;
    setLocalLibrary(null);
}
```

替换为直接使�?DB 数据�?

```typescript
const effectiveLibrary = materialLibraryFromDb;
```

同时移除 `setLocalLibrary` 的所有引用（搜索整个文件确认）�?

- [x] **Step 2: DesignPage 去除重复 normalizeAsset**

找到 DesignPage 中的 `normalizeAsset` 函数（约 L70-86），删除整个函数�?

替换�?`rawAssets` �?normalize 调用。在 `useEpisode()` 中获取的 `assets` 已经�?normalize 过的，所以：

找到类似这行�?
```typescript
const { ..., assets: rawAssets, ... } = useEpisode();
```

以及后续的：
```typescript
const assets = useMemo(() => rawAssets.map(normalizeAsset), [rawAssets]);
```

改为直接使用 context 返回�?assets�?
```typescript
const { ..., assets, ... } = useEpisode();
```

删除 `rawAssets` 别名和对本地 `normalizeAsset` 的所有引用�?

---

## Task 10: 路由声明顺序调整

**Files:**
- Modify: `new_html/App.tsx`

- [x] **Step 1: 调整路由声明顺序**

找到 workflow 子路由（�?L94-105），将路由声明调整为与导航栏一致的顺序�?

```tsx
<Route path="workflow" element={<WorkflowLayout />}>
    <Route index element={<Navigate to="script" replace />} />
    <Route path="script" element={<ScriptPage />} />
    <Route path="design" element={<DesignPage />} />
    <Route path="materials" element={<MaterialsPage />} />
    <Route path="audio" element={<AudioStagePage />} />
    <Route path="storyboard" element={<StoryboardGenPage />} />
    <Route path="generation" element={<GenerationPage />} />
    <Route path="video" element={<VideoGenPage />} />
    <Route path="enhance" element={<EnhancePage />} />
    <Route path="history" element={<HistoryPage />} />
</Route>
```

---

## Task 11: 分镜时长提示系统

**背景**: 剧本 AI 生成 `时间�?秒` �?`storyboardParser` 解析�?`duration: "3�?` �?但导出时丢弃。配音后 `audio_duration_ms` 可能超过设计时长。需要：保存设计时长、对比实际时长、显示提示�?

**Files:**
- Modify: `db_migration_storyboard_items.sql` �?新增 `planned_duration_ms` �?
- Modify: `new_html/types.ts` �?`StoryboardItemDB` 增加 `plannedDurationMs`
- Modify: `new_html/WorkspaceApp.tsx` �?导出时解�?`duration` �?`planned_duration_ms`
- Modify: `dao_storyboard.py` �?INSERT/UPDATE 支持 `planned_duration_ms`
- Modify: `new_html/pages/AudioStagePage.tsx` �?时长对比提示 UI
- Modify: `new_html/pages/StoryboardGenPage.tsx` �?时长对比提示 UI
- Modify: `new_html/contexts/EpisodeContext.tsx` �?normalize 处理新字�?

- [x] **Step 1: DB �?添加 planned_duration_ms �?*

```sql
ALTER TABLE storyboard_items ADD COLUMN IF NOT EXISTS planned_duration_ms INTEGER;
```

同步更新 `db_migration_storyboard_items.sql` �?CREATE TABLE（在 `audio_duration_ms` 之后添加）：

```sql
planned_duration_ms INTEGER,        -- 设计阶段预估时长（毫秒）
```

- [x] **Step 2: 后端 DAO �?支持 planned_duration_ms**

`dao_storyboard.py`：在 `ALLOWED_UPDATE_FIELDS` 列表中加�?`'planned_duration_ms'`�?

�?`batch_create` �?`batch_create_transactional` �?INSERT 语句中加�?`planned_duration_ms` 列�?

- [x] **Step 3: 前端类型 �?StoryboardItemDB 添加字段**

`new_html/types.ts`�?

```typescript
export interface StoryboardItemDB {
  // ... existing fields ...
  audioDurationMs: number | null;
  plannedDurationMs: number | null;   // 新增：设计阶段预估时�?
}
```

- [x] **Step 4: EpisodeContext �?normalize 处理新字�?*

�?`normalizeStoryboardItem` 中添加：

```typescript
plannedDurationMs: raw.planned_duration_ms ?? raw.plannedDurationMs ?? null,
```

- [x] **Step 5: 导出时解析时长字符串为毫�?*

�?`WorkspaceApp.tsx` �?`handleExportStoryboards`（或新的原子导出逻辑）中，将 `item.duration`（如 `"3�?`、`"1.5�?`）解析为毫秒�?

```typescript
function parseDurationToMs(durationStr?: string): number | null {
    if (!durationStr) return null;
    const match = durationStr.match(/([\d.]+)\s*�?);
    if (match) return Math.round(parseFloat(match[1]) * 1000);
    return null;
}

// �?dbItems 映射中使用：
const dbItems = selectedFile.storyboard.items.map((item, idx) => ({
    // ...existing fields...
    planned_duration_ms: parseDurationToMs(item.duration),
}));
```

同时更新 `batch_create_transactional` �?INSERT 参数以接�?`planned_duration_ms`�?

- [x] **Step 6: AudioStagePage �?时长对比提示 UI**

在音频预�?Tab 的每个分镜卡片中，当 `audioDurationMs > plannedDurationMs` 时显示黄色警告：

```tsx
{item.plannedDurationMs && item.audioDurationMs && item.audioDurationMs > item.plannedDurationMs && (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-900/30 border border-amber-600/40 text-amber-400 text-xs">
        <AlertTriangle size={12} />
        <span>
            音频 {(item.audioDurationMs / 1000).toFixed(1)}s 超过设计 {(item.plannedDurationMs / 1000).toFixed(1)}s
            （建议拆分或调整�?
        </span>
    </div>
)}
```

同时�?Tab 顶部显示汇总提示：

```tsx
const overDurationItems = storyboardItems.filter(
    i => i.plannedDurationMs && i.audioDurationMs && i.audioDurationMs > i.plannedDurationMs
);
{overDurationItems.length > 0 && (
    <div className="px-4 py-2 bg-amber-900/20 border-b border-amber-600/30 text-amber-400 text-sm">
        �?{overDurationItems.length} 个镜头的音频时长超过设计时长
    </div>
)}
```

- [x] **Step 7: StoryboardGenPage �?时长对比提示 UI**

同样逻辑，在分镜生成页的卡片中也显示对比。此�?`audioDurationMs` 来自音频页的持久化数据：

```tsx
{item.plannedDurationMs && (
    <div className="text-xs text-gray-500">
        设计 {(item.plannedDurationMs / 1000).toFixed(1)}s
        {item.audioDurationMs && (
            <span className={item.audioDurationMs > item.plannedDurationMs ? 'text-amber-400 ml-2' : 'text-green-400 ml-2'}>
                实际音频 {(item.audioDurationMs / 1000).toFixed(1)}s
                {item.audioDurationMs > item.plannedDurationMs ? ' �? : ' �?}
            </span>
        )}
    </div>
)}
```

---

## Task 12: 构建与验�?

- [x] **Step 1: 前端构建**

```bash
cd new_html && npm run build
```

预期：构建成功，�?TypeScript 错误�?

- [x] **Step 2: 部署文件同步**

将修改的后端文件�?dist 目录同步�?deploy/�?

- [x] **Step 3: 端到端验�?*

验证清单�?
1. 剧本�?�?点击「导出到设计」→ 设计页显示人�?场景 assets
2. 设计�?�?生成图片后点击「导出到素材绑定」→ 素材绑定页显示分�?+ 已设计的图片
3. 素材绑定�?�?绑定素材后点击「导出到声音与配音」→ 音频页显示角色列�?+ 分镜对白
4. 音频�?�?生成 TTS �?刷新页面 �?音频 URL 仍在（持久化验证�?
5. 音频�?�?生成音乐 �?刷新页面 �?BGM 列表显示新生成的音乐
6. 音频�?�?点击「导出到分镜生成」→ 分镜生成页显示完整数�?
7. 分镜生成�?�?点击「导出到视频生成」→ 视频页显示有图的分镜
8. **新增**: 剧本导出的分镜带�?`时间�?秒` �?音频�?TTS 后如果音频超�?3 秒，显示黄色提示
9. **新增**: 分镜生成页也显示设计时长 vs 实际音频时长的对�?
