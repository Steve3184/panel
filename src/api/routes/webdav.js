import express from 'express';
import { handleWebDAV, webdavAuthMiddleware } from '../controllers/webdavController.js';

const router = express.Router();

// WebDAV 路由，处理 /api/dav/:instanceId/* 的所有请求
router.all('/:instanceId/*', webdavAuthMiddleware, handleWebDAV);

export default router;