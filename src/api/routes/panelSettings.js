import express from 'express';
import * as panelSettingsController from '../controllers/panelSettingsController.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import Busboy from 'busboy';

const router = express.Router();

router.get('/', panelSettingsController.getPanelSettings);
router.post('/', isAuthenticated, isAdmin, panelSettingsController.updatePanelSettings);
router.post('/restart', isAuthenticated, isAdmin, panelSettingsController.restartPanel);

router.post('/background', isAuthenticated, isAdmin, panelSettingsController.uploadBackgroundImage);
router.get('/background', panelSettingsController.getBackgroundImage);
router.delete('/background', isAuthenticated, isAdmin, panelSettingsController.deleteBackgroundImage);

export default router;