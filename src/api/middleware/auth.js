import { readDb } from '../../data/db.js';
import { USERS_DB_PATH } from '../../config.js';

/**
 * 首次运行检查中间件。
 * 如果数据库中没有用户，则重定向到设置页面。
 */
export const firstRunCheck = (req, res, next) => {
    const users = readDb(USERS_DB_PATH, []);
    const publicFirstRunPaths = new Set([
        '/api/setup',
        '/api/login',
        '/api/users/check',
        '/api/capabilities',
        '/api/panel-settings/public',
        '/api/panel-settings/background',
        '/setup'
    ]);
    // 如果没有用户，并且请求的不是 setup 或 login 页面/API，则重定向到 setup 页面
    if (users.length === 0 &&
        !publicFirstRunPaths.has(req.path) &&
        !req.path.startsWith('/assets') &&
        !req.path.startsWith('/lang')
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
    if (!req.session.user) {
        return res.status(401).json({ message: 'server.unauthorized' });
    }
    const users = readDb(USERS_DB_PATH, []);
    const currentUser = users.find(user => user.id === req.session.user.id);
    if (!currentUser || (currentUser.sessionVersion || 0) !== (req.session.user.sessionVersion || 0)) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: 'server.unauthorized' });
    }
    req.session.user = {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        sessionVersion: currentUser.sessionVersion || 0
    };
    req.user = req.session.user;
    next();
};

/**
 * 管理员权限检查中间件。
 */
export const isAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ message: 'server.unauthorized' });
    }
    if (req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'server.admin_access_required' });
    }
};
