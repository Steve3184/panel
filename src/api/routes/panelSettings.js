import express from 'express';
import * as panelSettingsController from '../controllers/panelSettingsController.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', panelSettingsController.getPanelSettings);
router.post('/', isAuthenticated, isAdmin, panelSettingsController.updatePanelSettings);
router.post('/restart', isAuthenticated, isAdmin, panelSettingsController.restartPanel);

export default router;