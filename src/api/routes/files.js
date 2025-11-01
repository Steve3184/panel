import express from 'express';
import * as fileController from '../controllers/fileController.js';
import { checkFileManagerPermission } from '../middleware/permissions.js';

// { mergeParams: true } 允许此路由访问父路由传递的参数（如 :instanceId）
const router = express.Router({ mergeParams: true });

// 对所有文件操作应用文件管理权限检查
router.use(checkFileManagerPermission);

// --- 文件和目录的读写操作 ---
router.get('/files/*', fileController.listFiles);
router.get('/file-content/*', fileController.getFileContent);
router.get('/download/*', fileController.downloadFile);
router.post('/files/*', fileController.createDirectory); // 创建目录
router.put('/files/*', fileController.createFile);       // 创建/更新文件
router.delete('/files/*', fileController.deletePath);    // 删除文件或目录
router.post('/rename', fileController.renamePath);

// --- 文件上传 ---
router.post('/upload/init', fileController.initUpload);
router.post('/upload/chunk', fileController.uploadChunk);
router.post('/upload/complete', fileController.completeUpload);

// --- 压缩与解压 ---
router.post('/extract', fileController.extractArchive);
router.post('/compress', fileController.compressFiles);

// --- 批量操作 ---
router.post('/copy', fileController.copyFiles);
router.post('/move', fileController.moveFiles);
router.post('/delete-multiple', fileController.deleteMultipleFiles);

export default router;