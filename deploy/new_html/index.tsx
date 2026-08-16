import React from 'react';
import ReactDOM from 'react-dom/client';
// 品牌字体（构建期打包，不依赖外网 CDN）：Sora 标题 / Space Mono 编号标签；中文回退系统字体
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './styles/design-tokens.css';  // 分镜工坊视觉令牌与全站组件契约
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
