// ==================== 认证相关 ====================

const Auth = {
    baseURL: '',  // API基础URL
    
    // 获取token
    getToken() {
        return localStorage.getItem('auth_token');
    },
    
    // 获取用户名
    getUsername() {
        return localStorage.getItem('username');
    },
    
    // 设置认证信息
    setAuth(token, username) {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('username', username);
    },
    
    // 清除认证信息
    clearAuth() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
    },
    
    // 检查是否已登录
    isLoggedIn() {
        return !!this.getToken();
    },
    
    // 登录
    async login(username, password) {
        console.log('🔐 尝试登录:', username);
        const response = await fetch(`${this.baseURL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '登录失败');
        }
        
        const result = await response.json();
        this.setAuth(result.token, username);
        console.log('✅ 登录成功，token:', result.token.substring(0, 20) + '...');
        return result;
    },
    
    // 退出登录
    async logout() {
        try {
            await fetch(`${this.baseURL}/api/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.getToken()}` }
            });
        } catch (error) {
            console.error('登出API调用失败:', error);
        }
        this.clearAuth();
        console.log('👋 已退出登录');
    },
    
    // 验证token
    async verifyToken() {
        try {
            const response = await fetch(`${this.baseURL}/api/user/info`, {
                headers: { 'Authorization': `Bearer ${this.getToken()}` }
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }
};

// 导出到全局
window.Auth = Auth;

