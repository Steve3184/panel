import express from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/authController.js';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();

// 登录频率限制：每15分钟最多20次尝试
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: 'server.too_many_login_attempts' },
    standardHeaders: true,
    legacyHeaders: false,
});

// --- 公共路由 ---
router.post('/setup', authController.setupAdmin);
router.post('/login', loginLimiter, authController.login);
router.get('/users/check', authController.checkAdminExists); // 用于前端设置页面

// --- 受保护的路由 ---
router.post('/logout', isAuthenticated, authController.logout);
router.get('/session', isAuthenticated, authController.getSession);

export default router;