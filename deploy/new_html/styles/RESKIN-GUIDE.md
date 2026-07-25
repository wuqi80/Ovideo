# Drama 前端视觉规范（Webflow）

`D:\Codex\Drama\DESIGN.md` 是视觉来源，`design-tokens.css` 与
`tailwind.config.cjs` 是实现契约。创作端、后台和弹窗必须复用同一套令牌，
不得在业务组件中新增独立主题。

## 核心视觉

- 页面与面板：白色 `#ffffff`
- 主文字：近黑 `#080808`
- 主操作：Webflow Blue `#146ef5`
- 边框：`#d8d8d8`，悬停边框 `#898989`
- 次级文字：`#5a5a5a`
- 占位文字：`#ababab`
- 功能色：紫 `#7a3dff`、粉 `#ed52cb`、绿 `#00d722`、橙 `#ff6b00`、
  黄 `#ffae13`、红 `#ee1d36`

兼容旧组件的 `n*`、`b*`、`p*` 等 Tailwind 名称已经映射到上述 Webflow
色板。新组件优先使用语义类：`primary`、`success`、`warning`、`danger`。

## 字体与层级

- 界面字体：`WF Visual Sans Variable`，不可用时回退 `Arial`
- 代码字体：`Inconsolata`
- 标题字重：600；正文和按钮：400–500
- 功能标签：10–15px、500–600、加宽字距
- 正文基准：16px，行高 1.6

中文标签不强制转大写，但应保留标签字距和层级。

## 形状、边界与阴影

- 功能控件：4px 圆角
- 卡片和弹窗：最大 8px 圆角
- 头像、状态点可使用圆形
- 卡片：`1px solid #d8d8d8`
- 重要浮层：统一使用 DESIGN.md 的五层级联阴影

`rounded-xl`、`rounded-2xl`、`rounded-3xl` 在全局契约中均被限制为 8px，
防止历史组件重新出现过度圆角。

## 基础控件

- 输入框、文本域、下拉框统一白底、灰色边框和 4px 圆角
- 聚焦态使用 `#146ef5` 边框及低透明蓝色焦点环
- 主按钮使用 `bg-primary`，悬停为 `#0055d4`
- 透明文字按钮如需 Webflow 位移动效，添加 `button-shift`
- 卡片优先使用 `ui-card`；无阴影表面使用 `ui-surface`
- 小标题或分类标签使用 `ui-eyebrow`

## 弹窗

所有新弹窗必须采用以下结构：

```tsx
<div className="app-modal-backdrop fixed inset-0 ...">
  <div
    role="dialog"
    aria-modal="true"
    aria-label="弹窗标题"
    className="app-modal-surface ..."
  >
    <header className="app-modal-header">...</header>
    <div className="app-modal-body">...</div>
    <footer className="app-modal-footer">...</footer>
  </div>
</div>
```

历史 Tailwind 浮层由全局兼容选择器统一遮罩、圆角、边框、阴影和动效；
修改到对应组件时应补齐上述语义类和无障碍属性。

## 响应式

- 桌面断点：992px
- 平板断点：768px
- 手机断点：479px
- 小屏弹窗自动转为底部面板，内容区域必须允许滚动
- 尊重 `prefers-reduced-motion`

## 禁止事项

- 不得新增超过 8px 的功能元素圆角
- 不得将紫、粉、绿、橙等次级色用于全站主操作
- 不得新增深色页面主题或黑色卡片
- 不得在组件内复制五层阴影值
- 不得为了换肤改动状态、接口、积分、任务、历史版本或生产工作流逻辑
