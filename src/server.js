import express from 'express';
import http from 'http';
import expressWs from 'express-ws';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import fs from 'fs-extra';
import path from 'path';
import helmet from 'helmet';
import { EventEmitter } from 'events';

import { VUE_DIST_PATH, USERS_DB_PATH, DB_PATH, WORKSPACES_PATH, UPLOAD_TEMP_DIR, SESSIONS_PATH } from './config.js';
import { firstRunCheck } from './api/middleware/auth.js';
import apiRouter from './api/routes/index.js';
import { initializeInstancesState } from './core/instanceManager.js';
import { startMonitoring } from './core/monitoring.js';
import { setupWebSocket } from './websocket/handler.js';

import i18n from './utils/i18n.js';
import { readDb } from './data/db.js';
import { panelSettings, panelSettingsReady } from './api/controllers/panelSettingsController.js';
import { initLogger } from './utils/logger.js';
import { hardenDataPermissions, loadSessionSecret, validateRequestOrigin } from './utils/security.js';
import { initializeShellSandboxCapability } from './core/sandboxCapability.js';

initLogger();

await hardenDataPermissions([DB_PATH, SESSIONS_PATH, WORKSPACES_PATH, UPLOAD_TEMP_DIR]);
await fs.emptyDir(UPLOAD_TEMP_DIR);
const sessionSecret = await loadSessionSecret();
const sandboxCapability = await initializeShellSandboxCapability();
console.log(`Shell sandbox: ${sandboxCapability.supported ? `${sandboxCapability.source} ${sandboxCapability.version}` : `unavailable (${sandboxCapability.reason})`}`);
await panelSettingsReady;

// --- 初始化 Express 和 WebSocket ---
const app = express();
const server = http.createServer(app);
expressWs(app, server, { wsOptions: { maxPayload: 3 * 1024 * 1024 } });
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

// --- 配置中间件 ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Monaco Editor requires eval() for its worker compilation
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            // Bootstrap and Monaco inject inline styles
            styleSrc: ["'self'", "'unsafe-inline'"],
            // data: for base64 logos/backgrounds, blob: for Monaco worker URLs
            imgSrc: ["'self'", "data:", "blob:"],
            // WebSocket connections back to this same server
            connectSrc: ["'self'", "ws:", "wss:"],
            fontSrc: ["'self'", "data:"],
            // Monaco workers are loaded as blob: URLs
            workerSrc: ["'self'", "blob:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            // Prevent the panel from being embedded in iframes on other origins
            frameAncestors: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));

const FileStore = FileStoreFactory(session);

const sessionParser = session({
    store: new FileStore({
        path: SESSIONS_PATH,
        ttl: 86400,
        retries: 1,
        factor: 1,
        minTimeout: 50,
        maxTimeout: 100,
        secret: sessionSecret,
        logFn: function(){}
    }),
    name: 'panel.sid',
    secret: sessionSecret,
    proxy: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: 'auto',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    }
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
userEvents.on('userRemoved', () => {
    userCount = Math.max(0, userCount - 1);
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
app.use('/api', validateRequestOrigin, apiRouter);

// API 404 未匹配的路由 -> 返回 JSON 而非 HTML
app.use('/api', (req, res) => {
    res.status(404).json({ message: 'server.api_not_found' });
});

// --- WebSocket 设置 ---
setupWebSocket(app, sessionParser);

const INDEX_HTML_PATH = path.join(VUE_DIST_PATH, 'index.html');

app.get('/{*splat}', (req, res) => {
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
const PORT = process.env.PORT || panelSettings.panelPort || 3000;
server.listen(PORT, async () => {
    console.log(i18n.t('server.server_running', { port: PORT }));
    
    const users = readDb(USERS_DB_PATH, []);
    if (users.length === 0) {
        console.log(i18n.t('server.setup_admin_account_warn', { url: `http://localhost:${PORT}/setup` }));
    }

    if (process.env.NODE_ENV !== 'test') {
        // 启动时初始化实例状态 (自动启动、附加到现有容器等)
        await initializeInstancesState();
        startMonitoring();
    }
});
