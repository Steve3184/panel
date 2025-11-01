import express from 'express';
import * as userController from '../controllers/userController.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// 应用于此路由下的所有路径，确保只有已登录的管理员可以访问
router.use(isAuthenticated, isAdmin);

router.get('/', userController.getAllUsers);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.put('/:id/password', userController.updateUserPassword);
router.delete('/:id', userController.deleteUser);

export default router;