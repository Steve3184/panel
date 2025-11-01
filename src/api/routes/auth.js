import express from 'express';
import * as authController from '../controllers/authController.js';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();

// --- 公共路由 ---
router.post('/setup', authController.setupAdmin);
router.post('/login', authController.login);
router.get('/users/check', authController.checkAdminExists); // 用于前端设置页面

// --- 受保护的路由 ---
router.post('/logout', isAuthenticated, authController.logout);
router.get('/session', isAuthenticated, authController.getSession);

export default router;