import express from 'express';
import http from 'http';
import expressWs from 'express-ws';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { EventEmitter } from 'events';

import { VUE_DIST_PATH, USERS_DB_PATH, DB_PATH, WORKSPACES_PATH, UPLOAD_TEMP_DIR } from './config.js';
import { firstRunCheck, isAuthenticated } from './api/middleware/auth.js';
import apiRouter from './api/routes/index.js';
import { initializeInstancesState } from './core/instanceManager.js';
import { startMonitoring } from './core/monitoring.js';
import { setupWebSocket } from './websocket/handler.js';

import i18n from './utils/i18n.js';
import { readDb } from './data/db.js';
import { panelSettings } from './api/controllers/panelSettingsController.js';

// --- 初始化 Express 和 WebSocket ---
const app = express();
const server = http.createServer(app);
expressWs(app, server);

// --- 配置中间件 ---
app.use(express.json()); // 解析 JSON 请求体

// 允许所有来源的跨域请求
app.use(cors());

const FileStore = FileStoreFactory(session);

const sessionParser = session({
    store: new FileStore({
        path: './sessions',
        ttl: 86400,
        retries: 1,
        factor: 1,
        minTimeout: 50,
        maxTimeout: 100,
        logFn: function(){}
    }),
    secret: process.env.SESSION_SECRET || 'a-very-secret-key-that-should-be-in-env-vars',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // 在生产环境中应设为 true 并使用 HTTPS
})

app.use(sessionParser);

app.use(firstRunCheck); // 检查是否首次运行

// --- 静态文件服务 ---
if (fs.existsSync(path.join(VUE_DIST_PATH, 'index.html'))) {
    app.use(express.static(VUE_DIST_PATH));
    console.log('Serving Vue app from:', VUE_DIST_PATH);
} else {
    console.warn('Vue app (frontend/dist/index.html) not found. Server may not function correctly.');
}

let userCount = readDb(USERS_DB_PATH, []).length;
const userEvents = new EventEmitter();
userEvents.on('userAdded', () => {
    userCount++;
});

app.set('userEvents', userEvents);

app.use((req, res, next) => {
    if (req.method === 'GET' && req.path === '/setup') {
        return res.sendFile(path.join(VUE_DIST_PATH, 'index.html'));
    }

    if (userCount === 0 && (req.path == '/login' || req.path == '/')) {
        return res.redirect('/setup');
    }
    next();
});

// --- API 路由 ---
app.use('/api', apiRouter);

// --- WebSocket 设置 ---
setupWebSocket(app, sessionParser);

const INDEX_HTML_PATH = path.join(VUE_DIST_PATH, 'index.html');

app.get('*', (req, res) => {
    res.sendFile(INDEX_HTML_PATH, (err) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.status(404).send('File not found.');
            } else if (!res.headersSent) {
                res.status(500).send('Internal Server Error');
            }
        }
    });
});


// --- 启动服务器 ---

const lang = process.env.PANEL_LANG || 'en';
i18n.setLang(lang);

// 确保必要的目录存在
await fs.ensureDir(DB_PATH);
await fs.ensureDir(WORKSPACES_PATH);
await fs.ensureDir(UPLOAD_TEMP_DIR);
await fs.ensureDir('./sessions');

const PORT = process.env.PORT || panelSettings.panelPort || 3000;
server.listen(PORT, async () => {
    console.log(i18n.t('server.server_running', { port: PORT }));
    
    const users = readDb(USERS_DB_PATH, []);
    if (users.length === 0) {
        console.log(i18n.t('server.setup_admin_account_warn', { url: `http://localhost:${PORT}/setup` }));
    }

    // 启动时初始化实例状态 (自动启动、附加到现有容器等)
    await initializeInstancesState();

    // 启动性能监控
    startMonitoring();
});