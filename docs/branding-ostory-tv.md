# Ostory TV 品牌与内容规范

Ostory TV 是面向普通创作者的 AI 视频创作平台，对外主域名为
`https://tv.ostory.ai`。

## 核心表达

- 主名称：**Ostory TV**
- 产品名称：**Ostory TV · AI 视频创作平台**
- 品牌主张：**把一个想法，变成一部好故事**
- 一句话说明：不用懂复杂工具，也能把创意、剧本、角色、分镜、画面、配音和剪辑一步步做成完整视频。

产品文案应优先描述用户要完成的事情与下一步操作，避免把模型、节点、参数和技术架构放在首层。标准创作链路是：创意 → 剧本 → 角色与场景 → 分镜 → 画面与视频 → 配音与字幕 → 剪辑与成片。

## 视觉识别

标志由圆角方形、字母 O 的圆环、播放三角和右上角灵感点组成。紫罗兰到暖橙的渐变延续 NewUI 的创作氛围，圆环代表一个故事从想法到成片的完整闭环。

- 浅色界面：`deploy/static/branding/ostory-tv-logo-on-light.svg`
- 深色界面：`deploy/static/branding/ostory-tv-logo-on-dark.svg`
- 紧凑位置：`deploy/static/branding/ostory-tv-mark.svg`
- PNG 与 favicon：运行 `python deploy/scripts/generate_ostory_brand_assets.py` 生成

禁止在公开页面重新使用旧品牌名称、旧域名或旧标志。内部兼容字段、数据库结构和环境变量如果与既有运行协议绑定，可以保留，但不得作为用户可见文案。
