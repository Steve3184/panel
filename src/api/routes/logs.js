import express from 'express';
import { listLogs, getLogContent } from '../controllers/logController.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(isAuthenticated);
router.use(isAdmin);

router.get('/', listLogs);
router.get('/:filename', getLogContent);

export default router;
