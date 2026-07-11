import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { handleWebDAV, webdavAuthMiddleware, webdavPathSafetyMiddleware } from '../controllers/webdavController.js';

const router = express.Router();
const webdavAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { message: 'server.too_many_auth_attempts' }
});

// WebDAV 路由，处理 /api/dav/:instanceId/* 的所有请求
router.all('/:instanceId', webdavAuthLimiter, webdavAuthMiddleware, webdavPathSafetyMiddleware, handleWebDAV);
router.all('/:instanceId/*path', webdavAuthLimiter, webdavAuthMiddleware, webdavPathSafetyMiddleware, handleWebDAV);

export default router;
