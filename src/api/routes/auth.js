import express from 'express';
import * as authController from '../controllers/authController.js';
import { isAuthenticated } from '../middleware/auth.js';
import { rateLimit } from 'express-rate-limit';

const router = express.Router();
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { message: 'server.too_many_auth_attempts' }
});

// --- 公共路由 ---
router.post('/setup', authLimiter, authController.setupAdmin);
router.post('/login', authLimiter, authController.login);
router.get('/users/check', authLimiter, authController.checkAdminExists); // 用于前端设置页面
router.get('/capabilities', authController.getCapabilities);

// --- 受保护的路由 ---
router.post('/logout', isAuthenticated, authController.logout);
router.get('/session', isAuthenticated, authController.getSession);

export default router;
