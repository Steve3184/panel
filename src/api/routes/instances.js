import express from 'express';
import * as instanceController from '../controllers/instanceController.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import { checkInstancePermission } from '../middleware/permissions.js';
import fileRoutes from './files.js'; // 导入文件路由

const router = express.Router();

// 所有实例相关操作都需要登录
router.use(isAuthenticated);

// --- 实例的 CRUD ---
router.get('/', instanceController.getAllInstances);
router.post('/', isAdmin, instanceController.createInstance); // 只有管理员能创建
router.put('/:id', checkInstancePermission, instanceController.updateInstance);
router.delete('/:id', checkInstancePermission, instanceController.deleteInstanceController);

// --- 实例操作 ---
router.post('/:id/action', checkInstancePermission, instanceController.handleInstanceAction);

// --- 实例权限管理 (仅限管理员) ---
router.get('/:instanceId/permissions', isAdmin, instanceController.getInstancePermissions);
router.put('/:instanceId/permissions/:userId', isAdmin, instanceController.updateInstancePermissions);

// --- Docker Compose ---
router.get('/:id/containers', checkInstancePermission, instanceController.getComposeContainers);

// --- 挂载文件管理路由 ---
// 将所有 /api/instances/:instanceId/ 下的请求（匹配 fileRoutes 中定义的）
// 转发给 fileRoutes 处理器
router.use('/:instanceId', fileRoutes);

export default router;