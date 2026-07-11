import path from 'path';
import { fileURLToPath } from 'url';

if (process.platform !== 'win32') process.umask(0o077);

// ESM 标准中获取 __dirname 的方法
const __filename = fileURLToPath(import.meta.url);
const __dirname_src = path.dirname(__filename);
const __dirname_root = path.join(__dirname_src, '..'); // 项目根目录
const dataRoot = process.env.PANEL_DATA_DIR ? path.resolve(process.env.PANEL_DATA_DIR) : __dirname_root;

// --- 核心配置 ---
export const SALT_ROUNDS = 10;
export const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'bash';

// --- 路径配置 ---
export const DB_PATH = path.join(dataRoot, 'db');
export const USERS_DB_PATH = path.join(DB_PATH, 'users.json');
export const INSTANCES_DB_PATH = path.join(DB_PATH, 'instances.json');
export const WORKSPACES_PATH = path.join(dataRoot, 'workspaces');
export const UPLOAD_TEMP_DIR = path.join(dataRoot, 'uploads_temp');
export const SESSIONS_PATH = path.join(dataRoot, 'sessions');
export const SETTINGS_FILE = path.join(DB_PATH, 'settings.json');
export const BGIMAGE_PATH = path.join(DB_PATH, 'custom_background.jpg');

// --- 前端静态文件路径 ---
export const VUE_DIST_PATH = path.join(__dirname_root, 'frontend', 'dist');
