# 前端换肤转换指南（refactor/v2 · 暗 → Atlassian 浅色）

P2 批量换肤时，把组件里的暗色 Tailwind class 按下表替换为 Atlassian 浅色令牌。
**只改 className/样式，绝不改 React 逻辑、state、handler、props、数据流。**

## 一、底色 / 表面 / 边框

| 旧（暗） | 新（Atlassian 浅） | 含义 |
| --- | --- | --- |
| `bg-gray-950` | `bg-n20` | 页面底色 |
| `bg-gray-900` | `bg-n0` | 顶栏/表面（白） |
| `bg-gray-800` `bg-gray-800/60` | `bg-n0`（卡片/输入，配 `border-n40`） | 面板/卡片 |
| `bg-gray-800/50`（骨架） | `bg-n30` | 占位/凹陷 |
| `bg-gray-700/50`（标签底） | `bg-n30` | tag 背景 |
| `border-gray-800` `border-gray-700` | `border-n40` | 标准边框 |
| `border-gray-800/50` | `border-n40` / `border-n30` | 浅分隔 |
| hover `hover:bg-gray-700` `hover:bg-gray-800` | `hover:bg-n20` | hover 底 |

## 二、文字

| 旧 | 新 | 含义 |
| --- | --- | --- |
| `text-gray-100` `text-white` | `text-n800` | 主文字 |
| `text-gray-300` | `text-n700` | 次主文字 |
| `text-gray-400` | `text-n200` / `text-n300` | 次要文字 |
| `text-gray-500` | `text-n100` / `text-n300` | 弱化/占位 |

## 三、强调色（统一收敛到 primary）

| 旧 | 新 |
| --- | --- |
| `bg-purple-600 hover:bg-purple-500` / `bg-indigo-600` | `bg-primary hover:bg-primary-hover text-white` |
| `text-purple-400` `text-indigo-300/400` | `text-primary` |
| 活跃态 `bg-indigo-600/15 text-indigo-400` | `bg-primary-light text-primary` |
| `focus:border-purple-500` | `focus:border-primary focus:ring-2 focus:ring-primary/20` |
| `hover:border-purple-500/50` | `hover:border-primary` |
| `accent`（radio/checkbox） | 加 `accent-primary` |

## 四、功能色

| 旧 | 新 |
| --- | --- |
| `text-emerald-400` `text-green-*` | `text-success`（=g300 #36B37E） |
| `text-red-400` | `text-danger`（=r300） + hover 底 `hover:bg-r50` |
| `text-yellow-500` | `text-warning`（=y300） |
| 蓝色 badge `bg-blue-900/40 text-blue-300 border-blue-800/50` | `bg-b50 text-b400 border-b75` |

## 五、形状 / 阴影

| 旧 | 新 | 说明 |
| --- | --- | --- |
| `rounded-lg` `rounded-xl` | `rounded`(4px) 或 `rounded-md`(卡片) | Atlassian 基准 4px |
| 卡片无阴影 / 自定义 | `shadow-card`，hover `shadow-atlas` | 三档阴影令牌 |
| 弹窗/菜单 | `shadow-bottom` | 浮层阴影 |
| 弹窗遮罩 `bg-black/60` | `bg-n900/50` + `animate-fadeIn`，面板 `animate-scaleIn` | |
| 滚动容器 | 加 `scrollbar-atlas` | 浅色细滚动条 |

## 六、输入控件（Atlassian 风格）

```
className="bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100
           focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
```

## 参考样板
已完成换肤、可直接对照的样板：
- `layouts/WorkflowLayout.tsx`（顶栏外壳）
- `components/ProjectHub.tsx`（列表/卡片/工具栏/弹窗/右键菜单 全套）
