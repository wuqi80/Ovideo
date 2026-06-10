# Gemini API 配置说明

## 🔑 API Key 配置

本系统使用老张API中转站访问Gemini模型，需要两个API Key：

### 1. 文本生成 API Key

**用途**：
- 小说改写为剧本
- 生成分镜描述
- 提取角色和场景
- 优化文本内容

**环境变量**：`VITE_GEMINI_TEXT_API_KEY`

### 2. 图像生成 API Key

**用途**：
- 素材图片生成
- 参考图生成变体
- 多图混合生成

**环境变量**：`VITE_GEMINI_IMAGE_API_KEY`

---

## 📝 配置方法

### 方法1：环境变量（推荐）

在项目根目录创建 `.env` 文件：

```bash
# 文本生成API Key
VITE_GEMINI_TEXT_API_KEY=sk-your-text-api-key

# 图像生成API Key  
VITE_GEMINI_IMAGE_API_KEY=sk-your-image-api-key
```

### 方法2：浏览器localStorage

在浏览器控制台执行：

```javascript
// 设置文本API Key
localStorage.setItem('gemini_text_api_key', 'sk-your-text-api-key');

// 设置图像API Key
localStorage.setItem('gemini_image_api_key', 'sk-your-image-api-key');
```

### 方法3：使用单个通用Key

如果两个key相同，可以只配置一个：

```bash
VITE_GEMINI_PROXY_API_KEY=sk-your-api-key
```

---

## 🎨 图像生成模型

### Gemini 2.5 Flash Image (Nano Banana)
- **模型名称**：`gemini-2.5-flash-image`
- **特点**：快速生成，固定1K分辨率
- **API端点**：`https://api.laozhang.ai/v1beta/models/gemini-2.5-flash-image:generateContent`

### Gemini 3 Pro Image Preview (Nano Banana 2)
- **模型名称**：`gemini-3-pro-image-preview`
- **特点**：高质量，支持1K/2K/4K分辨率
- **API端点**：`https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent`

---

## 📐 支持的纵横比

| 类型 | 纵横比选项 |
|------|-----------|
| 横向 | `21:9`, `16:9`, `4:3`, `3:2` |
| 正方形 | `1:1` |
| 纵向 | `9:16`, `3:4`, `2:3` |
| 其他 | `5:4`, `4:5` |

---

## 📏 支持的分辨率

### Gemini 2.5 Flash Image
- **固定分辨率**：1K (1024px)
- ⚠️ 不支持 `imageSize` 参数

### Gemini 3 Pro Image Preview

| 纵横比 | 1K 分辨率 | 2K 分辨率 | 4K 分辨率 |
|--------|-----------|-----------|-----------|
| 1:1 | 1024×1024 | 2048×2048 | 4096×4096 |
| 16:9 | 1376×768 | 2752×1536 | 5504×3072 |
| 9:16 | 768×1376 | 1536×2752 | 3072×5504 |
| 4:3 | 1200×896 | 2400×1792 | 4800×3584 |
| 3:4 | 896×1200 | 1792×2400 | 3584×4800 |

### 分辨率选择建议

- **1K**：适合网页展示、社交媒体、快速预览
- **2K**：适合高质量打印、专业展示
- **4K**：适合大型打印、专业设计、极致细节

---

## 🔧 API 调用示例

### 文生图

```typescript
const images = await generateGeminiImageViaProxy({
    model: 'gemini-3-pro-image-preview',
    prompt: '一只可爱的橘猫',
    aspectRatio: '1:1',
    imageSize: '2K'
});
```

### 图生图（参考图变体）

```typescript
const images = await generateGeminiImageViaProxy({
    model: 'gemini-2.5-flash-image',
    prompt: '把这张图变成梵高星空风格的油画',
    references: [imageDataUrl],
    aspectRatio: '16:9',
    imageSize: '1K'  // flash模型此参数无效
});
```

### 多图混合

```typescript
const images = await generateGeminiImageViaProxy({
    model: 'gemini-3-pro-image-preview',
    prompt: '将这两张图融合成一个艺术作品',
    references: [image1DataUrl, image2DataUrl],
    aspectRatio: '1:1',
    imageSize: '2K'
});
```

---

## 🚀 获取API Key

访问老张API中转站官网：**https://api.laozhang.ai**

---

## ⚠️ 注意事项

1. **分辨率限制**：
   - `gemini-2.5-flash-image` 固定1K，设置 `imageSize` 参数无效
   - `gemini-3-pro-image-preview` 支持1K/2K/4K

2. **参考图数量**：
   - 最多支持5张参考图
   - 过多的参考图可能影响生成质量

3. **超时设置**：
   - 默认超时时间：180秒（3分钟）
   - 大分辨率（4K）可能需要更长时间

4. **环境变量生效**：
   - 修改 `.env` 后需要重启开发服务器
   - 执行：`npm run dev`

