import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/design-tokens.css';  // Webflow 视觉令牌与全站组件契约
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
