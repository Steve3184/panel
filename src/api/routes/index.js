import express from 'express';
import authRoutes from './auth.js';
import userRoutes from './users.js';
import instanceRoutes from './instances.js';
import panelSettingsRoutes from './panelSettings.js'; // 导入 panelSettings 路由
import webdavRoutes from './webdav.js'; // 导入 WebDAV 路由
import logRoutes from './logs.js';

const router = express.Router();

// 将各类路由挂载到主 API 路由上
router.use('/', authRoutes); // 挂载在 /api/
router.use('/users', userRoutes); // 挂载在 /api/users
router.use('/instances', instanceRoutes); // 挂载在 /api/instances
router.use('/panel-settings', panelSettingsRoutes); // 挂载在 /api/panel-settings
router.use('/dav', webdavRoutes); // 挂载在 /api/dav
router.use('/logs', logRoutes); // 挂载在 /api/logs

export default router;