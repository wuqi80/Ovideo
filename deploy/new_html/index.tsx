import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/design-tokens.css';  // refactor/v2：设计令牌（CSS 变量 + 浅色滚动条），打包进构建
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