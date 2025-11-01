import { readDb } from '../../data/db.js';
import { USERS_DB_PATH } from '../../config.js';

/**
 * 首次运行检查中间件。
 * 如果数据库中没有用户，则重定向到设置页面。
 */
export const firstRunCheck = (req, res, next) => {
    const users = readDb(USERS_DB_PATH, []);
    // 如果没有用户，并且请求的不是 setup 或 login 页面/API，则重定向到 setup 页面
    if (users.length === 0 &&
        req.path !== '/api/setup' &&
        req.path !== '/api/login' &&
        !req.path.startsWith('/css') &&
        !req.path.startsWith('/js') &&
        !req.path.startsWith('/frontend') && // 允许访问 Vue 资源
        req.path !== '/setup' && // 允许访问设置页面
        req.path !== '/' // 允许访问根路径
    ) {
        return res.redirect('/setup');
    }
    next();
};

/**
 * 认证中间件。
 * 检查用户是否已登录。
 */
export const isAuthenticated = (req, res, next) => {
    const publicPaths = ['/', '/api/login', '/api/setup', '/api/users/check', '/setup', '/login'];
    // 允许访问静态资源和公共API
    if (publicPaths.includes(req.path)) {
        return next();
    }
    if (!req.session.user) {
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(401).json({ message: 'server.unauthorized' });
        }
        return res.redirect('/login');
    }
    next();
};

/**
 * 管理员权限检查中间件。
 */
export const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'server.admin_access_required' });
    }
};