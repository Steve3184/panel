const express = require('express');
const http = require('http');
const expressWs = require('express-ws');
const session = require('express-session');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const os = require('os');
const pty = require('node-pty');
const osUtils = require('os-utils');
const pidusage = require('pidusage');
const psTree = require('ps-tree');
const Docker = require('dockerode'); // Import dockerode
const docker = new Docker(); // Initialize Docker client
const Busboy = require('busboy'); // Import busboy
const axios = require('axios'); // Import axios for CDN file downloads
const i18n = require('./server_i18n'); // Import server-side i18n module

// 导入解压/压缩库
const decompress = require('decompress');
const sevenBin = require('7zip-bin');
const SevenZip = require('node-7z');
const archiver = require('archiver'); // 导入 archiver 库
const { default: decompressTar } = require('@xhmikosr/decompress-tar');
const { default: decompressTarGz } = require('@xhmikosr/decompress-targz');
const { default: decompressTarBz2 } = require('@xhmikosr/decompress-tarbz2');
const { default: decompressTarXz } = require('@felipecrs/decompress-tarxz');

const pathTo7zip = sevenBin.path7za
// 运行时数据存储，用于文件上传
const activeUploads = new Map(); // K: uploadId, V: { instanceId, fileName, filePath, totalChunks, receivedChunks, fileSize, targetPath, writeStream }

// =================================================================
// 初始化与配置
// =================================================================
const app = express();
const server = http.createServer(app);
expressWs(app, server);

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'db');
const USERS_DB_PATH = path.join(DB_PATH, 'users.json');
const INSTANCES_DB_PATH = path.join(DB_PATH, 'instances.json');
const WORKSPACES_PATH = path.join(__dirname, 'workspaces');
const CDN_CACHE_PATH = path.join(__dirname, 'cdn_cache'); // CDN 缓存目录
fs.ensureDirSync(CDN_CACHE_PATH); // 确保 CDN 缓存目录存在

// 确保目录存在
fs.ensureDirSync(DB_PATH);
fs.ensureDirSync(WORKSPACES_PATH);
fs.ensureFileSync(USERS_DB_PATH);
fs.ensureFileSync(INSTANCES_DB_PATH);

// 运行时数据存储
const activeInstances = new Map(); // K: instanceId, V: { pty, ... }
const clients = new Set(); // 所有连接的 WebSocket 客户端
const editingFiles = new Map(); // K: filePath, V: { instanceId, absolutePath, wsClient } // 存储正在编辑的文件及其关联的 WebSocket 客户端
const editingFileClients = new Set(); // 新增：存储所有正在进行文件编辑的 WebSocket 客户端

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const SALT_ROUNDS = 10;

// =================================================================
// 中间件
// =================================================================
app.use(express.json());
const sessionParser = session({
    secret: 'a-very-secret-key-that-should-be-in-env-vars',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // 在生产中应设为 true 并使用 HTTPS
});
app.use(sessionParser);

// 首次运行检查中间件
app.use((req, res, next) => {
    const users = readDb(USERS_DB_PATH, []);
    // 如果没有用户，并且请求的不是 setup 或 login 页面/API，则重定向到 setup 页面
    if (users.length === 0 &&
        req.path !== '/setup.html' &&
        req.path !== '/api/setup' &&
        req.path !== '/login.html' &&
        req.path !== '/api/login' &&
        !req.path.startsWith('/css') &&
        !req.path.startsWith('/js')
    ) {
        return res.redirect('/setup.html')
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
// 认证中间件
const isAuthenticated = (req, res, next) => {
    const publicPaths = ['/login.html', '/setup.html', '/api/login', '/api/setup', '/api/users/check']; // 添加 /api/users/check
    if (publicPaths.includes(req.path) || req.path.startsWith('/css') || req.path.startsWith('/js')) {
        return next();
    }
    if (!req.session.user) {
        // 如果是 API 请求，返回 401 Unauthorized
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(401).json({ message: 'server.unauthorized' });
        }
        return res.redirect('/login.html');
    }
    next();
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'server.admin_access_required' });
    }
};

// =================================================================
// 数据库辅助函数
// =================================================================
function readDb(filePath, defaultValue = []) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data ? JSON.parse(data) : defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

function writeDb(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// =================================================================
// 文件管理辅助函数和中间件
// =================================================================

const UPLOAD_TEMP_DIR = path.join(__dirname, 'uploads_temp');
fs.ensureDirSync(UPLOAD_TEMP_DIR); // 确保上传临时目录存在

/**
 * 获取实例工作目录内的绝对路径，并防止路径遍历攻击。
 * @param {string} instanceId 实例ID
 * @param {string} relativePath 相对于实例工作目录的路径
 * @returns {string} 绝对路径
 */
function getFileAbsolutePath(instanceId, relativePath = '') {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) {
        throw new Error('Instance not found');
    }

    const instanceCwd = instance.cwd || path.join(WORKSPACES_PATH, instanceId);
    const absolutePath = path.join(instanceCwd, relativePath);

    // 安全检查: 确保文件路径在实例的工作目录内
    if (!absolutePath.startsWith(instanceCwd)) {
        throw new Error('Access denied: Path outside of instance working directory.');
    }

    return absolutePath;
}

/**
 * 文件管理权限检查中间件
 */
const checkFileManagerPermission = (req, res, next) => {
    const { instanceId } = req.params;
    const user = req.session.user;
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }

    // Admins always have full control
    if (user.role === 'admin') {
        req.instanceConfig = instance;
        req.instancePermission = { terminal: 'full-control', fileManagement: true }; // Admin always has full file management
        return next();
    }

    const userPermissions = instance.permissions?.[user.id];

    if (!userPermissions || userPermissions.fileManagement !== true) {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    req.instanceConfig = instance; // Attach instance config for later use
    req.instancePermission = userPermissions; // Attach all user's permissions for later use
    next();
};

// =================================================================
// 实例管理核心函数
// =================================================================
async function startInstance(instanceConfig) {
    if (activeInstances.has(instanceConfig.id)) {
        console.log(i18n.t('server.instance_session_already_running', { name: instanceConfig.name, id: instanceConfig.id }));
        // 重置 isUserTriggeredStop 标志，因为实例正在启动
        const existingSession = activeInstances.get(instanceConfig.id);
        existingSession.isUserTriggeredStop = false;
        return;
    }

    const instanceCwd = instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceConfig.id);
    fs.ensureDirSync(instanceCwd);

    let term;
    let commandToExecute = instanceConfig.command;
    let effectiveCwd = instanceCwd;

    // --- Docker 实例逻辑 ---
    if (instanceConfig.type === 'docker') {
        const dockerConfig = instanceConfig.dockerConfig || {};
        const containerName = dockerConfig.containerName || `runner-${instanceConfig.id}`;
        const image = dockerConfig.image;
        if (!image) throw new Error(`Docker 实例 ${instanceConfig.name} 未指定镜像 (image)。`);

        const execCommand = dockerConfig.command ? dockerConfig.command.split(/\s+/) : null;
        effectiveCwd = dockerConfig.workingDir || '/workspace';
        let container;
        let attachMode = false;

        try {
            const existingContainer = docker.getContainer(containerName);
            const inspectData = await existingContainer.inspect();
            if (inspectData.State.Running) {
                console.log(i18n.t('server.found_running_container_attaching', { containerName: containerName }));
                container = existingContainer;
                attachMode = true;
            }
        } catch (error) {
            if (error.statusCode !== 404) {
                console.error(i18n.t('server.check_existing_container_error', { containerName: containerName }), error.message);
            }
        }

        if (!attachMode) {
            console.log(i18n.t('server.no_running_container_creating_new', { containerName: containerName }));
            const portBindings = {};
            const exposedPorts = {};
            (dockerConfig.ports || []).forEach(p => {
                const [hostPort, containerPortInfo] = p.split(':');
                const [containerPort, containerProtocol] = containerPortInfo.split('/')
                portBindings[`${containerPort || hostPort}/${containerProtocol ? 'udp' : 'tcp'}`] = [{ HostIP: '0.0.0.0', HostPort: hostPort || '' }];
                exposedPorts[`${containerPort || hostPort}/${containerProtocol ? 'udp' : 'tcp'}`] = {};
            });

            const binds = [`${instanceCwd}:${effectiveCwd}`];
            (dockerConfig.volumes || []).forEach(volume => binds.push(volume));

            try {
                container = await docker.createContainer({
                    Image: image,
                    name: containerName,
                    Tty: true,
                    OpenStdin: true,
                    WorkingDir: effectiveCwd,
                    HostConfig: { Binds: binds, PortBindings: portBindings, AutoRemove: true },
                    ExposedPorts: exposedPorts,
                    Env: Object.entries(instanceConfig.env || {}).map(([key, value]) => `${key}=${value}`),
                    Cmd: execCommand, // 直接使用最终命令
                });
                await container.start();
                console.log(i18n.t('server.new_container_created_and_started', { containerName: containerName, id: container.id }));
            } catch (err) {
                if (err.statusCode === 409) {
                    console.log(i18n.t('server.container_exists_stopped_starting', { containerName: containerName }));
                    container = docker.getContainer(containerName);
                    // 在重启前，可能需要确保容器的Cmd是我们想要的，但这比较复杂，
                    // 简单起见，我们假设存在的容器配置是正确的
                    await container.start();
                } else {
                    console.error(i18n.t('server.create_start_container_failed_log', { containerName: containerName }), err);
                    throw new Error(i18n.t('server.create_start_container_failed_error', { message: err.message }));
                }
            }
        }

        instanceConfig.dockerContainerId = container.id;

        const stream = await container.attach({
            stream: true,
            stdin: true,
            stdout: true,
            stderr: true,
        });

        commandToExecute = i18n.t('server.attached_to_container', { execCommand: execCommand });

        // 创建 pty 兼容的包装器
        term = {
            pid: container.id, // 使用容器 ID 作为伪 PID
            write: (data) => stream.write(data),
            on: (event, handler) => {
                if (event === 'data') stream.on('data', handler);
                if (event === 'exit') {
                    // 这个逻辑现在完全正确了，因为我们监控的是容器本身的状态
                    container.wait().then(() => handler()).catch(() => handler());
                }
            },
            resize: (cols, rows) => {
                if (cols > 0 && rows > 0) {
                    // 附加到主进程时，使用 container.resize
                    container.resize({ h: rows, w: cols }).catch(err => console.error(i18n.t('server.resize_container_tty_failed_log'), err.message));
                }
            },
            kill: (signal) => {
                if (signal === 'SIGKILL') {
                    container.kill().catch(err => console.error(i18n.t('server.force_stop_container_failed_log', { id: container.id }), err.message));
                } else {
                    container.stop().catch(err => console.error(i18n.t('server.stop_container_failed_log', { id: container.id }), err.message));
                }
            }
        };

    } else { // --- 非 Docker 实例逻辑 (保持不变) ---
        const ptyOptions = {
            name: 'xterm-color', cols: 80, rows: 30, cwd: instanceCwd,
            env: { ...process.env, ...(instanceConfig.env || {}) }
        };
        term = pty.spawn(shell, ['-c', commandToExecute], ptyOptions);
    }

    // --- 通用会话创建逻辑 ---
    const session = {
        id: instanceConfig.id, pty: term, listeners: new Set(),
        history: `\x1b[32m${i18n.t('server.instance_started_log', { command: commandToExecute })}\x1b[0m\r\n\r\n`,
        isUserTriggeredStop: false, // 新增：标记是否是用户主动停止
        isUserTriggeredRestart: false,
        restartAttempts: 0, // 新增：重启尝试次数
        restartTimer: null, // 新增：重启计时器
        restartTimeout: null, // 新增：重启超时计时器
    };
    activeInstances.set(instanceConfig.id, session);

    broadcast({ type: 'event', event: 'instance-started', id: instanceConfig.id });

    term.on('data', (data) => {
        const output = data.toString('utf8');
        session.history += output;
        session.listeners.forEach(ws => send(ws, { type: 'output', id: instanceConfig.id, data: output }));
    });

    term.on('exit', async (code) => { // 接收退出码
        console.log(i18n.t('server.instance_process_container_exited', { name: instanceConfig.name, id: instanceConfig.id, code: code }));

        // 清除任何待处理的重启计时器
        if (session.restartTimer) {
            clearTimeout(session.restartTimer);
            session.restartTimer = null;
        }
        if (session.restartTimeout) {
            clearTimeout(session.restartTimeout);
            session.restartTimeout = null;
        }

        // Ensure active session is removed
        activeInstances.delete(instanceConfig.id);
        broadcast({ type: 'event', event: 'instance-stopped', id: instanceConfig.id });

        const instances = readDb(INSTANCES_DB_PATH);
        const currentInstanceIndex = instances.findIndex(i => i.id === instanceConfig.id);
        if (currentInstanceIndex !== -1) {
            const currentInstance = instances[currentInstanceIndex];
            // Clear dockerContainerId if it was a docker instance
            if (currentInstance.type === 'docker') {
                delete currentInstance.dockerContainerId;
                writeDb(INSTANCES_DB_PATH, instances); // Save the updated instance config
            }

            if (currentInstance.autoDeleteOnExit) {
                await deleteInstance(instanceConfig.id, true);
            }

            // --- 自动重启逻辑 ---
            // 只有在不是用户主动停止，并且设置了 autoRestart 选项时才尝试自动重启
            if ((!session.isUserTriggeredStop && currentInstance.autoRestart) || session.isUserTriggeredRestart) {
                session.restartAttempts++;
                const delay = Math.min(session.restartAttempts * 1000, 30000); // 最长 30 秒延迟
                console.log(i18n.t('server.instance_will_restart_in_seconds', { name: instanceConfig.name, id: instanceConfig.id, delay: delay / 1000, attempts: session.restartAttempts }));
                session.restartTimer = setTimeout(async () => {
                    try {
                        await startInstance(currentInstance);
                        session.restartAttempts = 0; // 成功重启后重置尝试次数
                        clearTimeout(session.restartTimer);
                    } catch (error) {
                        console.error(i18n.t('server.auto_restart_instance_failed', { name: instanceConfig.name, id: instanceConfig.id }), error.message);
                        // 如果重启失败，继续尝试，直到达到最大尝试次数或用户手动干预
                    }
                }, delay);
                session.isUserTriggeredRestart = false;
            } else {
                // 如果是用户主动停止，或者没有设置 autoRestart，则重置尝试次数
                session.restartAttempts = 0;
            }
        }
    });

    console.log(i18n.t('server.instance_session_established', { name: instanceConfig.name, id: instanceConfig.id }));
    const instances = readDb(INSTANCES_DB_PATH);
    const currentInstanceIndex = instances.findIndex(i => i.id === instanceConfig.id);
    if (currentInstanceIndex !== -1) {
        let currentInstance = instances[currentInstanceIndex];
        if (currentInstance.type === 'docker') {
            instances[currentInstanceIndex] = instanceConfig;
            writeDb(INSTANCES_DB_PATH, instances); // Save the updated instance config
        }
    }
}

async function stopInstance(instanceId, signal = 'SIGTERM', isUserTriggered = false, isRestart = false) { // 默认非用户触发
    const activeSession = activeInstances.get(instanceId);
    const instanceConfig = readDb(INSTANCES_DB_PATH).find(i => i.id === instanceId);

    if (!instanceConfig) {
        console.warn(i18n.t('server.attempt_to_stop_non_existent_instance', { instanceId: instanceId }));
        return;
    }

    if (activeSession) {
        // 设置用户触发停止标志
        activeSession.isUserTriggeredStop = isUserTriggered;
        activeSession.isUserTriggeredRestart = isRestart;
        // 清除任何待处理的重启计时器
        if (activeSession.restartTimer) {
            clearTimeout(activeSession.restartTimer);
            activeSession.restartTimer = null;
        }
        if (activeSession.restartTimeout) {
            clearTimeout(activeSession.restartTimeout);
            activeSession.restartTimeout = null;
        }

        if (instanceConfig.type !== 'docker') {
            // 对于非 Docker 实例，通过 pty 包装器来停止
            if (signal === 'SIGTERM') {
                activeSession.pty.write('\x03'); // 发送 Ctrl+C
            } else {
                activeSession.pty.kill(signal);
            }
        } else {
            // 对于 Docker 实例，直接调用其 kill 方法
            activeSession.pty.kill(signal);
        }
    }

    // 如果没有活动会话 (例如，只停止一个未附加的容器)
    if (instanceConfig.type === 'docker') {
        const containerName = instanceConfig.dockerConfig.containerName || `runner-${instanceConfig.id}`;
        try {
            const container = docker.getContainer(containerName);
            const inspectData = await container.inspect();
            if (inspectData.State.Running) {
                console.log(i18n.t('server.stopping_docker_container', { containerName: containerName }));
                if (signal === 'SIGKILL') {
                    await container.kill();
                } else {
                    await container.stop();
                }
                console.log(i18n.t('server.container_stopped', { containerName: containerName }));
            }
        } catch (error) {
            if (error.statusCode === 404) {
                console.log(i18n.t('server.container_not_found_on_stop', { instanceId: instanceId, containerName: containerName }));
            } else {
                console.error(i18n.t('server.stop_docker_container_failed', { containerName: containerName }), error.message);
            }
        }
    }
}

async function deleteInstance(instanceId, deleteData = true) {
    // 确保实例已停止，标记为用户触发停止
    await stopInstance(instanceId, 'SIGKILL', true);

    let instances = readDb(INSTANCES_DB_PATH);
    const instanceToDelete = instances.find(i => i.id === instanceId);

    if (instanceToDelete) {
        if (instanceToDelete.type === 'docker') {
            const containerName = instanceToDelete.dockerConfig.containerName || `runner-${instanceToDelete.id}`;
            try {
                const container = docker.getContainer(containerName);
                await container.remove({ force: true });
                console.log(i18n.t('server.docker_container_deleted', { containerName: containerName }));
            } catch (err) {
                if (err.statusCode === 404) {
                    console.log(i18n.t('server.container_not_found_on_delete', { instanceId: instanceId, containerName: containerName }));
                } else {
                    console.error(i18n.t('server.delete_docker_container_failed', { containerName: containerName }), err.message);
                }
            }
        }

        if (deleteData) {
            const cwd = instanceToDelete.cwd || path.join(WORKSPACES_PATH, instanceId);
            if (cwd.startsWith(WORKSPACES_PATH)) {
                fs.removeSync(cwd);
                console.log(i18n.t('server.instance_working_directory_deleted', { instanceId: instanceId }));
            }
        }

        instances = instances.filter(i => i.id !== instanceId);
        writeDb(INSTANCES_DB_PATH, instances);
        broadcast({ type: 'event', event: 'instance-deleted', id: instanceId });
        console.log(i18n.t('server.instance_removed_from_db', { instanceId: instanceId }));
    }
}

async function initializeInstancesState() {
    console.log(i18n.t('server.initializing_instance_state'));
    const instances = readDb(INSTANCES_DB_PATH, []);

    // 第一步：检查并附加到任何已在运行的 Docker 容器
    for (const instance of instances) {
        if (instance.type === 'docker') {
            const containerName = instance.dockerConfig.containerName || `runner-${instance.id}`;
            try {
                const container = docker.getContainer(containerName);
                const data = await container.inspect();
                if (data.State.Running && !activeInstances.has(instance.id)) {
                    console.log(i18n.t('server.detected_running_docker_instance_attaching', { name: instance.name }));
                    await startInstance(instance);
                }
            } catch (error) {
                // 容器不存在，忽略
                if (error.statusCode !== 404) {
                    console.error(i18n.t('server.error_initializing_instance_check', { name: instance.name, error: error.message }));
                }
            }
        }
    }

    // 第二步：启动标记为“自动启动”且当前未运行的实例
    for (const instance of instances) {
        if (instance.autoStartOnBoot && !activeInstances.has(instance.id)) {
            console.log(i18n.t('server.auto_starting_instance', { name: instance.name }));
            try {
                await startInstance(instance);
            } catch (error) {
                console.error(i18n.t('server.auto_start_instance_failed', { name: instance.name, id: instance.id }), error.message);
            }
        }
    }
    console.log(i18n.t('server.instance_state_initialization_complete'));
}

// =================================================================
// Docker 辅助函数
// =================================================================

// 计算 Docker 容器 CPU 使用率
// 参考：https://docs.docker.com/engine/api/v1.43/#tag/Container-Top/operation/ContainerTop
function calculateCpuUsage(stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || os.cpus().length;

    if (systemDelta > 0 && cpuDelta > 0) {
        return ((cpuDelta / systemDelta) * numCpus * 100.0).toFixed(2);
    }
    return 0;
}

// 计算 Docker 容器内存使用
function calculateMemoryUsage(stats) {
    const usage = stats.memory_stats.usage;
    const limit = stats.memory_stats.limit;
    return (usage / (1024 * 1024)).toFixed(2); // MB
}


// =================================================================
// WebSocket 通信
// =================================================================
function send(ws, data) {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(data, excludeClients = new Set()) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === 1 && !excludeClients.has(client)) {
            client.send(message);
        }
    });
}

// =================================================================
// API 路由
// =================================================================

// --- 认证 API ---
app.post('/api/setup', (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    if (users.length > 0) {
        return res.status(403).json({ message: 'server.setup_already_completed' });
    }
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'server.username_password_required' });
    }
    const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);
    const adminUser = {
        id: uuidv4(),
        username,
        passwordHash: hashedPassword,
        role: 'admin'
    };
    writeDb(USERS_DB_PATH, [adminUser]);
    res.status(201).json({ message: 'server.ok' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readDb(USERS_DB_PATH, []);
    const user = users.find(u => u.username === username);
    if (user && bcrypt.compareSync(password, user.passwordHash)) {
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ message: 'server.ok' });
    } else {
        res.status(401).json({ message: 'server.invalid_credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'server.ok' });
});

app.get('/api/session', isAuthenticated, (req, res) => {
    res.json({ user: req.session.user });
});

// JS CDN Cache

// --- CDN 缓存路由 ---
app.get('/cdn/*', async (req, res) => {
    const filename = req.params[0]; // 获取通配符匹配的完整路径
    const localFilePath = path.join(CDN_CACHE_PATH, filename);

    try {
        // 检查本地缓存是否存在
        if (await fs.pathExists(localFilePath)) {
            // 如果存在，直接从本地文件系统返回
            return res.sendFile(localFilePath);
        }

        // 如果不存在，从 CDN 下载
        console.log(i18n.t('server.downloading_file_from_cdn', { filename: filename }));
        let cdnUrl;
        if (filename.startsWith('z4/')) {
            cdnUrl = `https://s4.zstatic.net/ajax/libs/${filename.substring(3)}`;
        } else if (filename.startsWith('jsdelivr/')) {
            cdnUrl = `https://cdn.jsdelivr.net/npm/${filename.substring(9)}`;
        } else {
            cdnUrl = `https://cdn.jsdelivr.net/npm/${filename}`;
        }
        console.log(i18n.t('server.constructed_cdn_url', { cdnUrl: cdnUrl })); // 添加日志
        const response = await axios.get(cdnUrl, { responseType: 'arraybuffer' });

        await fs.ensureDir(path.dirname(localFilePath));
        // 保存到本地缓存
        await fs.writeFile(localFilePath, response.data);
        console.log(i18n.t('server.file_cached_locally', { filename: filename }));

        // 返回文件
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/javascript');
        res.send(response.data);

    } catch (error) {
        console.error(i18n.t('server.cache_failed', { filename: filename, error: error.message }));
        if (error.response && error.response.status === 404) {
            return res.status(404).send('server.cache_not_found');
        }
        res.status(500).send('server.failed_to_retrieve');
    }
});



// --- 实例 API ---
app.use('/api/instances', isAuthenticated); // 保护所有实例路由

// Helper to check instance permissions
const checkInstancePermission = (req, res, next) => {
    const { id } = req.params;
    const user = req.session.user;
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === id);

    if (!instance) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }

    // Admins always have full control
    if (user.role === 'admin') {
        req.instanceConfig = instance; // Attach instance config for later use
        return next();
    }

    const permission = instance.permissions?.[user.id]?.terminal; // Get terminal permission

    if (!permission) {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    req.instanceConfig = instance; // Attach instance config for later use
    req.instancePermission = permission; // Attach permission for later use
    next();
};

app.get('/api/instances', (req, res) => {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const user = req.session.user;
    let viewableInstances = instances;

    // If user is admin, they can see all instances
    if (user.role !== 'admin') {
        viewableInstances = instances.filter(i => i.permissions && i.permissions[user.id]);
    }

    const result = viewableInstances.map(i => ({
        ...i,
        status: activeInstances.has(i.id) ? 'running' : 'stopped'
    }));
    res.json(result);
});

app.post('/api/instances', isAuthenticated, (req, res) => { // Admin only for creating instances
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    const { name, command, cwd, type, autoStartOnBoot, autoDeleteOnExit, autoRestart, env, dockerConfig } = req.body;
    if (!command && type !== 'docker') return res.status(400).json({ message: 'server.command_required' });
    if (type === 'docker' && !dockerConfig?.image) return res.status(400).json({ message: 'server.image_required' });

    const id = uuidv4();
    const newInstance = {
        id,
        name: name || uuidv4().substring(0, 8),
        type: type || 'shell',
        command,
        cwd: cwd || path.join(WORKSPACES_PATH, id),
        autoStartOnBoot: !!autoStartOnBoot,
        autoDeleteOnExit: !!autoDeleteOnExit,
        autoRestart: !!autoRestart, // 新增：自动重启选项
        env: env || {},
        dockerConfig: dockerConfig || {},
        // Admin user gets full control for terminal and file management
        permissions: {} // Initialize as empty object
    };
    // If an instance is created by an admin, the admin automatically gets full control.
    // Permissions will be assigned explicitly for other users.
    newInstance.permissions[req.session.user.id] = { terminal: 'full-control', fileManagement: true };


    const instances = readDb(INSTANCES_DB_PATH, []);
    instances.push(newInstance);
    writeDb(INSTANCES_DB_PATH, instances);

    broadcast({ type: 'event', event: 'instance-created', instance: { ...newInstance, status: 'stopped' } });
    res.status(201).json(newInstance);
});

app.put('/api/instances/:id', isAuthenticated, checkInstancePermission, (req, res) => {
    const { id } = req.params;
    const { env, dockerConfig, permissions, ...otherUpdates } = req.body; // Prevent direct update of permissions via this route
    const updates = {
        ...otherUpdates,
        env: env || {},
        dockerConfig: dockerConfig || {}
    };

    const instances = readDb(INSTANCES_DB_PATH, []);
    const instanceIndex = instances.findIndex(i => i.id === id);

    if (instanceIndex === -1) return res.status(404).json({ message: 'server.instance_not_found' });

    // Only allow admin to update certain fields like autoStartOnBoot, autoDeleteOnExit, type, command, dockerConfig, env
    if (req.session.user.role !== 'admin') {
        const disallowedUpdates = ['autoStartOnBoot', 'autoDeleteOnExit', 'autoRestart', 'type', 'command', 'dockerConfig', 'env'];
        for (const field of disallowedUpdates) {
            if (updates[field] !== undefined && updates[field] !== instances[instanceIndex][field]) {
                return res.status(403).json({ message: 'server.no_field_perms' });
            }
        }
    }

    instances[instanceIndex] = { ...instances[instanceIndex], ...updates };
    writeDb(INSTANCES_DB_PATH, instances);
    broadcast({ type: 'event', event: 'instance-updated', instance: instances[instanceIndex] });
    res.json(instances[instanceIndex]);
});

app.delete('/api/instances/:id', isAuthenticated, checkInstancePermission, async (req, res) => {
    const { id } = req.params;
    const { deleteData } = req.query;
    const instanceConfig = req.instanceConfig; // From checkInstancePermission

    // Admin can delete any instance
    // Non-admin users can delete if they have full-control AND the instance is not marked as 'undeletable'
    if (req.session.user.role !== 'admin') {
        if (req.instancePermission !== 'full-control') {
            return res.status(403).json({ message: 'server.no_perms' });
        }
    }

    await stopInstance(id, 'SIGKILL');
    const shouldDeleteData = deleteData === 'true';
    await deleteInstance(id, shouldDeleteData);

    res.status(204).send();
});

app.post('/api/instances/:id/action', isAuthenticated, checkInstancePermission, async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    const instanceConfig = req.instanceConfig; // From checkInstancePermission
    const userPermission = req.instancePermission; // From checkInstancePermission

    // Define allowed actions based on permission levels
    const allowedActions = {
        'read-only': [],
        'read-write': [],
        'read-write-ops': ['start', 'stop', 'restart', 'interrupt', 'terminate', 'force-restart'],
        'full-control': ['start', 'stop', 'restart', 'interrupt', 'terminate', 'force-restart']
    };

    if (req.session.user.role !== 'admin' && !allowedActions[userPermission]?.includes(action)) {
        return res.status(403).json({ message: 'server.no_action_perms'});
    }
    try {
        switch (action) {
            case 'start':
                await startInstance(instanceConfig);
                break;
            case 'interrupt':
                const activeSession = activeInstances.get(id);
                if (activeSession && instanceConfig.type === 'docker') {
                    activeSession.pty.write('\x03');
                } else {
                    await stopInstance(id, 'SIGTERM', false); // 非用户触发
                }
                break;
            case 'stop':
                await stopInstance(id, 'SIGTERM', true); // 用户触发
                break;
            case 'terminate':
                await stopInstance(id, 'SIGKILL', true); // 用户触发
                break;
            case 'restart':
                // 普通重启，设置 300 秒超时
                const RESTART_TIMEOUT_MS = 300 * 1000; // 300 秒
                const session = activeInstances.get(id);
                if (session) {
                    // 清除旧的重启超时计时器
                    if (session.restartTimeout) {
                        clearTimeout(session.restartTimeout);
                    }
                    session.restartTimeout = setTimeout(async () => {
                        console.warn(`实例 ${instanceConfig.name} (${id}) 在 ${RESTART_TIMEOUT_MS / 1000} 秒内未重启，将强制关闭并重新启动。`);
                        await stopInstance(id, 'SIGKILL', false); // 非用户触发的强制关闭
                        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
                        await startInstance(instanceConfig);
                    }, RESTART_TIMEOUT_MS);
                }

                await stopInstance(id, 'SIGTERM', false, true); // 非用户触发
                // 移除立即启动的逻辑，让 exit 事件处理自动重启
                break;
            case 'force-restart':
                await stopInstance(id, 'SIGKILL', true); // 用户触发
                await new Promise(resolve => setTimeout(resolve, 1000));
                await startInstance(instanceConfig);
                break;
            default:
                return res.status(400).json({ message: 'server.invalid_action' });
        }
    } catch (e) {
        console.error(e);
        res.json({ message: 'server.action_failed' })
        return;
    }
    res.json({ message: 'server.action_initiated' });
});

// --- 文件管理 API ---
// 保护所有文件管理路由
app.use('/api/instances/:instanceId/files', isAuthenticated, checkFileManagerPermission);

// GET /api/instances/:instanceId/files - 列出文件和目录
app.get('/api/instances/:instanceId/files/*', async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || ''; // 获取通配符匹配的路径
        const absolutePath = getFileAbsolutePath(instanceId, relativePath);

        const stats = await fs.stat(absolutePath);

        if (stats.isDirectory()) {
            const files = await fs.readdir(absolutePath);
            const fileDetails = await Promise.all(files.map(async (file) => {
                const filePath = path.join(absolutePath, file);
                const fileRelativePath = path.join(relativePath, file);
                try {
                    const fileStats = await fs.stat(filePath);
                    return {
                        name: file,
                        path: fileRelativePath,
                        isDirectory: fileStats.isDirectory(),
                        isFile: fileStats.isFile(),
                        size: fileStats.size,
                        mtime: fileStats.mtime, // Modified time
                        birthtime: fileStats.birthtime // Creation time
                    };
                } catch (error) {
                    console.warn(i18n.t('server.failed_to_get_file_info', { filePath: filePath }), error.message);
                    return null;
                }
            }));
            res.json(fileDetails.filter(Boolean)); // 过滤掉null值
        } else if (stats.isFile()) {
            // 如果请求的是文件本身，我们不在这里返回文件内容，只返回文件信息。
            // 文件内容获取由单独的API处理。
            res.json({
                name: path.basename(absolutePath),
                path: relativePath,
                isDirectory: false,
                isFile: true,
                size: stats.size,
                mtime: stats.mtime,
                birthtime: stats.birthtime
            });
        } else {
            res.status(400).json({ message: 'server.unknown_type' });
        }

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'server.file_not_found' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_list_files', error: error.message });
    }
});

// GET /api/instances/:instanceId/file-content/* - 获取文件内容
app.get('/api/instances/:instanceId/file-content/*', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const absolutePath = getFileAbsolutePath(instanceId, relativePath);

        // 检查文件是否存在且是文件
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) {
            return res.status(400).json({ message: 'server.path_not_file' });
        }

        const MAX_FILE_SIZE_FOR_EDIT = 2 * 1024 * 1024; // 2MB

        if (stats.size > MAX_FILE_SIZE_FOR_EDIT) {
            return res.status(413).json({ message: 'server.file_too_large_for_edit' });
        }

        const content = await fs.readFile(absolutePath, 'utf8');
        res.status(200).json({ content });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'server.file_not_found' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_get_file_content', error: error.message });
    }
});

// GET /api/instances/:instanceId/download/* - 下载文件
app.get('/api/instances/:instanceId/download/*', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || ''; // 获取通配符匹配的路径
        const absolutePath = getFileAbsolutePath(instanceId, relativePath);

        // 检查文件是否存在且是文件
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) {
            return res.status(400).json({ message: 'server.path_not_file' });
        }

        // 检查用户是否有下载权限 (read-only 权限足够下载)
        // checkFileManagerPermission 已经确保了用户对实例有至少 read-only 权限
        // 如果需要更细致的权限控制，可以在这里添加

        // 设置下载文件名
        const fileName = path.basename(absolutePath);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', 'application/octet-stream'); // 或者根据文件类型设置更具体的 Content-Type

        // 发送文件
        res.download(absolutePath, fileName, (err) => {
            if (err) {
                // 如果在文件传输过程中发生错误
                console.error(err);
                if (!res.headersSent) { // 只有在响应头未发送时才发送错误
                    res.status(500).json({ message: 'server.failed_to_download_file', error: err.message });
                }
            }
        });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'server.file_not_found' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_download_file', error: error.message });
    }
});

// POST /api/instances/:instanceId/files - 创建目录
app.post('/api/instances/:instanceId/files/*', async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const { name } = req.body; // New directory name

        if (!name) {
            return res.status(400).json({ message: 'server.directory_name_required' });
        }

        const newDirPath = path.join(relativePath, name);
        const absolutePath = getFileAbsolutePath(instanceId, newDirPath);

        await fs.ensureDir(absolutePath); // 创建目录，如果父目录不存在也会创建
        res.status(201).json({ message: 'server.ok', path: newDirPath, isDirectory: true });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'EEXIST') {
            return res.status(409).json({ message: 'server.directory_already_exists' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_create_directory', error: error.message });
    }
});

// PUT /api/instances/:instanceId/files/* - 创建或更新文件 (用于创建新文件)
app.put('/api/instances/:instanceId/files/*', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || ''; // 父目录路径
        const { name, content } = req.body; // 文件名和内容

        if (!name) {
            return res.status(400).json({ message: 'server.file_name_required' });
        }

        const filePath = path.join(relativePath, name); // 完整的文件相对路径
        const absolutePath = getFileAbsolutePath(instanceId, filePath);

        // 确保目标目录存在
        await fs.ensureDir(path.dirname(absolutePath));

        await fs.writeFile(absolutePath, content || ''); // 写入文件内容，如果 content 为空则创建空文件
        res.status(201).json({ message: 'server.ok', path: filePath, isFile: true });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_create_file', error: error.message });
    }
});

// DELETE /api/instances/:instanceId/files - 删除文件或目录
app.delete('/api/instances/:instanceId/files/*', async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';

        if (!relativePath) {
            return res.status(400).json({ message: 'server.file_or_directory_path_required' });
        }

        const absolutePath = getFileAbsolutePath(instanceId, relativePath);

        // 防止删除实例根目录
        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);
        if (absolutePath === instanceCwd) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }

        await fs.remove(absolutePath); // 删除文件或目录
        res.status(204).send(); // No Content

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'server.file_not_found' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_delete_file_or_directory', error: error.message });
    }
});

// POST /api/instances/:instanceId/rename - 重命名文件或目录
app.post('/api/instances/:instanceId/rename', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { oldPath, newName } = req.body;

        if (!oldPath || !newName) {
            return res.status(400).json({ message: 'server.old_path_new_name_required' });
        }

        const oldAbsolutePath = getFileAbsolutePath(instanceId, oldPath);
        const newAbsolutePath = path.join(path.dirname(oldAbsolutePath), newName);

        // 安全检查：确保新路径仍在实例工作目录内
        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);
        if (!newAbsolutePath.startsWith(instanceCwd)) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }

        await fs.move(oldAbsolutePath, newAbsolutePath, { overwrite: true }); // 使用 move 进行重命名
        res.status(200).json({ message: 'server.ok' });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'server.file_not_found' });
        }
        if (error.code === 'EEXIST') {
            return res.status(409).json({ message: 'server.name_already_exists' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_rename', error: error.message });
    }
});

// --- 文件上传 API ---
// POST /api/instances/:instanceId/upload/init - 初始化文件上传
app.post('/api/instances/:instanceId/upload/init', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { fileName, fileSize, targetDirectory } = req.body; // targetDirectory 是相对路径

        if (!fileName || typeof fileSize !== 'number' || fileSize <= 0) {
            return res.status(400).json({ message: 'server.invalid_file_details' });
        }

        // 4GB 限制
        const MAX_FILE_SIZE = 16 * 1024 * 1024 * 1024;
        if (fileSize > MAX_FILE_SIZE) {
            return res.status(413).json({ message: 'server.file_size_exceeds_limit' });
        }

        const uploadId = uuidv4();
        const tempFilePath = path.join(UPLOAD_TEMP_DIR, uploadId); // 临时文件的路径

        // 确保目标路径在实例工作目录内
        const targetPath = getFileAbsolutePath(instanceId, path.join(targetDirectory || '.', fileName));
        const targetDir = path.dirname(targetPath);
        fs.ensureDirSync(targetDir); // 确保目标目录存在

        activeUploads.set(uploadId, {
            instanceId,
            fileName,
            fileSize,
            tempFilePath,
            targetPath,
            receivedChunks: new Set(), // 存储已接收的分块索引
            totalChunks: Math.ceil(fileSize / (1024 * 1024)), // 假设分块大小为 1MB
            receivedSize: 0,
            writeStream: fs.createWriteStream(tempFilePath, { flags: 'w' }) // 以写入模式打开文件
        });

        res.status(200).json({ uploadId, message: 'server.upload_initiated' });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_initiate_upload', error: error.message });
    }
});

// POST /api/instances/:instanceId/upload/chunk - 上传文件分块
app.post('/api/instances/:instanceId/upload/chunk', isAuthenticated, checkFileManagerPermission, (req, res) => {
    const busboy = Busboy({ headers: req.headers });
    let uploadId;
    let chunkIndex;
    let chunkBuffer;

    busboy.on('field', (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) => {
        if (fieldname === 'uploadId') uploadId = val;
        if (fieldname === 'chunkIndex') chunkIndex = parseInt(val, 10);
    });

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        const upload = activeUploads.get(uploadId);

        if (!upload) {
            file.resume(); // Consume the file stream to prevent it from hanging
            return res.status(404).json({ message: 'server.upload_not_found_or_expired' });
        }

        if (upload.receivedChunks.has(chunkIndex)) {
            file.resume(); // Consume the file stream to prevent it from hanging
            return res.status(409).json({ message: 'server.chunk_already_received' });
        }

        file.on('data', (data) => {
            upload.writeStream.write(data);
            upload.receivedSize += data.length; // Accumulate received size
        });

        file.on('end', () => {
            upload.receivedChunks.add(chunkIndex);
            res.status(200).json({ message: 'server.ok', receivedSize: upload.receivedSize });
        });

        file.on('error', (err) => {
            console.error(err);
            // Ensure uploadId is removed to prevent further invalid chunks
            activeUploads.delete(uploadId);
            upload.writeStream.end(); // Close the stream
            fs.removeSync(upload.tempFilePath); // Delete the temporary file
            res.status(500).json({ message: 'server.failed_to_write_chunk', error: err.message });
        });
    });

    busboy.on('finish', () => {
        // Busboy finished parsing the request
    });

    busboy.on('error', (err) => {
        console.error(err);
        res.status(500).json({ message: 'server.file_upload_chunk_failed_parsing', error: err.message });
    });

    req.pipe(busboy);
});


// POST /api/instances/:instanceId/upload/complete - 完成文件上传
app.post('/api/instances/:instanceId/upload/complete', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    try {
        const { instanceId } = req.params; // For permission check, although not strictly used here
        const { uploadId } = req.body;

        if (!uploadId) {
            return res.status(400).json({ message: 'server.upload_id_required' });
        }

        const upload = activeUploads.get(uploadId);

        if (!upload) {
            return res.status(404).json({ message: 'server.upload_not_found_or_expired' });
        }

        // 关闭写入流
        upload.writeStream.end();

        // 确保所有分块都已接收 (简单检查，实际可能需要更严谨的校验)
        if (upload.receivedChunks.size !== upload.totalChunks) {
            // 这只是一个简单的检查，如果文件很大，totalChunks 可能不是整数
            // 更严谨的做法是检查 receivedSize 是否等于 fileSize
            if (upload.receivedSize !== upload.fileSize) {
                return res.status(400).json({ message: 'server.not_all_chunks_received' });
            }
        }

        // 将临时文件移动到目标位置
        await fs.move(upload.tempFilePath, upload.targetPath, { overwrite: true });

        // 清理 activeUploads 记录
        activeUploads.delete(uploadId);

        // 计算相对于实例工作目录的路径
        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);
        const relativeFilePath = path.relative(instanceCwd, upload.targetPath);

        res.status(200).json({ message: 'server.file_uploaded_successfully', fileName: upload.fileName, filePath: relativeFilePath });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'server.failed_to_complete_upload', error: error.message });
    }
});


// POST /api/instances/:instanceId/extract - 解压文件
app.post('/api/instances/:instanceId/extract', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    const { instanceId } = req.params;
    const { filePath, destinationPath } = req.body; // filePath 是要解压的相对路径，destinationPath 是目标目录相对路径

    if (!filePath) {
        return res.status(400).json({ message: 'server.file_path_required' });
    }

    try {
        const absoluteFilePath = getFileAbsolutePath(instanceId, filePath);
        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destinationPath || path.dirname(filePath)); // 默认解压到同级目录

        // 确保目标目录存在
        await fs.ensureDir(absoluteDestinationPath);

        const fileExtension = path.extname(filePath).toLowerCase();
        const baseName = path.basename(filePath);
        const extractId = uuidv4(); // 为每个解压任务生成一个唯一ID

        // 立即发送 202 Accepted 响应，表示请求已接受并在后台处理
        res.status(202).json({ message: 'server.file_extract_request_accepted', extractId: extractId });

        const sendProgress = (progress) => {
            broadcast({
                type: 'file-extract-progress',
                extractId: extractId,
                instanceId: instanceId,
                fileName: baseName,
                destinationPath: destinationPath || path.dirname(filePath),
                status: 'in-progress',
                progress: progress // 0-100
            });
        };

        const sendCompletion = (status, message) => {
            broadcast({
                type: 'file-extract-status',
                extractId: extractId,
                instanceId: instanceId,
                fileName: baseName,
                destinationPath: destinationPath || path.dirname(filePath),
                status: status,
                message: message
            });
            // 解压成功后，可以考虑广播文件系统变化通知，让前端刷新列表
            if (status === 'success') {
                broadcast({
                    type: 'file-change',
                    instanceId: instanceId,
                    path: destinationPath || path.dirname(filePath),
                });
            }
        };

        try {
            if (fileExtension === '.7z' || fileExtension === '.zip') {
                const sevenZStream = SevenZip.extractFull(absoluteFilePath, absoluteDestinationPath, {
                    $progress: true,
                    $bin: pathTo7zip
                });

                let lastProgress = -1;
                sevenZStream.on('progress', (progress) => {
                    if (lastProgress < progress.percent)  {
                        sendProgress(progress.percent);
                        lastProgress = progress.percent;
                    }
                });

                sevenZStream.on('end', () => {
                    console.log(i18n.t('server.file_extracted_success_log', { filePath: filePath, absoluteDestinationPath: absoluteDestinationPath }));
                    sendCompletion('success', 'server.file_extracted_success');
                });

                sevenZStream.on('error', (err) => {
                    console.error(i18n.t('server.file_extract_failed_log', { filePath: filePath }), err);
                    sendCompletion('error', 'server.file_extract_failed');
                });

            } else if (filePath.toLowerCase().endsWith('.tar.gz') || filePath.toLowerCase().endsWith('.tgz') || filePath.toLowerCase().endsWith('.tar.xz') || filePath.toLowerCase().endsWith('.tar')) {
                // decompress 库支持多种 tar 格式
                // decompress 库本身不直接提供进度事件，需要通过文件数量来模拟
                const files = await decompress(absoluteFilePath, absoluteDestinationPath, {
                    plugins: [
                        decompressTar(),
                        decompressTarGz(),
                        decompressTarBz2(), // 如果需要支持 .tar.bz2
                        decompressTarXz() // 如果需要支持 .tar.xz
                    ]
                });

                // 模拟进度：假设解压文件数量可以作为进度指标
                // 这是一个简化的进度，实际可能需要更复杂的逻辑
                let extractedCount = 0;
                const totalFiles = files.length; // decompress 返回解压的文件列表

                if (totalFiles === 0) {
                    sendProgress(100); // 如果没有文件，直接完成
                } else {
                    files.forEach((file, index) => {
                        extractedCount++;
                        sendProgress(Math.round((extractedCount / totalFiles) * 100));
                    });
                }

                console.log(i18n.t('server.file_extracted_success_log', { filePath: filePath, absoluteDestinationPath: absoluteDestinationPath }));
                sendCompletion('success', 'server.file_extracted_success');

            } else {
                return res.status(400).json({ message: 'server.unsupported_archive_type' });
            }

        } catch (error) {
            if (error.message.includes('Instance not found')) {
                sendCompletion('error', 'server.instance_not_found');
                return res.status(404).json({ message: 'server.instance_not_found' });
            }
            if (error.message.includes('Access denied')) {
                sendCompletion('error', 'server.no_perms');
                return res.status(403).json({ message: 'server.access_denied_outside' });
            }
            if (error.code === 'ENOENT') {
                sendCompletion('error', 'server.file_or_directory_not_found_error');
                return res.status(404).json({ message: 'server.file_or_directory_not_found' });
            }
            console.error('server.extract_api_internal_error_log', error);
            sendCompletion('error', 'server.extract_api_internal_error');
            // 如果在 exec 之前发生错误，仍然需要发送 HTTP 响应
            if (!res.headersSent) {
                res.status(500).json({ message: 'server.extract_api_internal_error', error: error.message });
            }
        }

    } catch (error) {
        // 如果在 exec 之前发生错误，仍然需要发送 HTTP 响应
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'server.file_or_directory_not_found' });
        }
        console.error('server.extract_api_internal_error_log', error);
        res.status(500).json({ message: 'server.extract_api_internal_error', error: error.message });
    }
});

// POST /api/instances/:instanceId/compress - 压缩文件
app.post('/api/instances/:instanceId/compress', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    const { instanceId } = req.params;
    const { filesToCompress, destinationPath, outputName, format, level } = req.body;

    if (!filesToCompress || filesToCompress.length === 0 || !outputName || !format) {
        return res.status(400).json({ message: 'server.missing_compress_details' });
    }

    try {
        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destinationPath || ''); // 默认当前路径
        const absoluteOutputFilePath = path.join(absoluteDestinationPath, outputName);

        // 确保目标路径在实例工作目录内
        if (!absoluteOutputFilePath.startsWith(absoluteDestinationPath)) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }

        await fs.ensureDir(absoluteDestinationPath); // 确保目标目录存在

        const filesToCompressAbsolutePaths = filesToCompress.map(file => getFileAbsolutePath(instanceId, file));

        const compressId = uuidv4(); // 为每个压缩任务生成一个唯一ID

        // 立即发送 202 Accepted 响应，表示请求已接受并在后台处理
        res.status(202).json({ message: 'server.file_compress_request_accepted', compressId: compressId });

        const sendProgress = (progress) => {
            broadcast({
                type: 'file-compress-progress',
                compressId: compressId,
                instanceId: instanceId,
                filesToCompress: filesToCompress,
                destinationPath: destinationPath || '',
                outputName: outputName,
                status: 'in-progress',
                progress: progress // 0-100
            });
        };

        const sendCompletion = (status, message) => {
            broadcast({
                type: 'file-compress-status',
                compressId: compressId,
                instanceId: instanceId,
                destinationPath: destinationPath || '',
                outputName: outputName,
                status: status,
                message: message
            });
            // 压缩成功后，广播文件系统变化通知，让前端刷新列表
            if (status === 'success') {
                broadcast({
                    type: 'file-change',
                    instanceId: instanceId,
                    path: destinationPath || '' // 广播目标路径
                });
            }
        };

        const compressionLevel = Math.max(0, Math.min(9, level || 5)); // 确保压缩级别在 0-9 之间

        switch (format) {
            case 'zip':
            case '7z':
                // 使用 node-7z 库的 add 方法
                const sevenZAddStream = SevenZip.add(absoluteOutputFilePath, filesToCompressAbsolutePaths, {
                    recursive: true, // 递归添加文件和文件夹
                    $progress: true,
                    $bin: pathTo7zip,
                    mx: compressionLevel // 压缩级别
                });
                let lastProgress = -1;
                sevenZAddStream.on('progress', (progress) => {
                    if (lastProgress < progress.percent)  {
                        sendProgress(progress.percent);
                        lastProgress = progress.percent;
                    }
                });

                sevenZAddStream.on('end', () => {
                    console.log(i18n.t('server.file_compressed_success_log', { absoluteOutputFilePath: absoluteOutputFilePath }));
                    sendProgress(100);
                    sendCompletion('success', i18n.t('server.file_compressed_success', { outputName: outputName }));
                });

                sevenZAddStream.on('error', (err) => {
                    console.error(i18n.t('server.file_compress_failed_log', { outputName: outputName }), err);
                    sendCompletion('error', i18n.t('server.file_compress_failed', { outputName: outputName, message: err.message }));
                });
                return; // 阻止继续执行 exec
            case 'tar.gz': {
                const archive = archiver('tar', {
                    gzip: true,
                    gzipOptions: { level: compressionLevel }
                });

                const output = fs.createWriteStream(absoluteOutputFilePath);
                archive.pipe(output);

                let totalSize = 0;
                let processedSize = 0;

                for (const filePath of filesToCompressAbsolutePaths) {
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;
                }

                archive.on('progress', (progress) => {
                    processedSize = progress.fs.processedBytes;
                    if (totalSize > 0) {
                        const percent = Math.round((processedSize / totalSize) * 100);
                        sendProgress(percent);
                    }
                });

                archive.on('error', (err) => {
                    console.error(i18n.t('server.file_compress_failed_log', { outputName: outputName }), err);
                    sendCompletion('error', i18n.t('server.file_compress_failed', { outputName: outputName, message: err.message }));
                });

                output.on('close', () => {
                    console.log(i18n.t('server.file_compressed_success_log', { absoluteOutputFilePath: absoluteOutputFilePath }));
                    sendProgress(100);
                    sendCompletion('success', i18n.t('server.file_compressed_success', { outputName: outputName }));
                });

                for (const filePath of filesToCompressAbsolutePaths) {
                    const stat = await fs.stat(filePath);
                    const entryName = path.relative(absoluteDestinationPath, filePath);
                    if (stat.isDirectory()) {
                        archive.directory(filePath, entryName);
                    } else {
                        archive.file(filePath, { name: entryName });
                    }
                }

                archive.finalize();
                return;
            }
            case 'tar.xz': {
                // 对于 tar.xz，archiver 不直接支持 xz 压缩，需要通过管道连接到 xz 进程
                const archive = archiver('tar'); // 创建 tar 归档，不进行 gzip 压缩

                const outputStream = fs.createWriteStream(absoluteOutputFilePath);
                const xzProcess = require('child_process').spawn('xz', ['-z', '-T0', `-`]); // -T0 使用所有可用核心，-z 压缩，-c 输出到 stdout
                
                archive.pipe(xzProcess.stdin); // archiver 的输出作为 xz 进程的输入
                xzProcess.stdout.pipe(outputStream); // xz 进程的输出写入文件

                let totalSize = 0;
                let processedSize = 0;

                for (const filePath of filesToCompressAbsolutePaths) {
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;
                }

                archive.on('progress', (progress) => {
                    processedSize = progress.fs.processedBytes;
                    if (totalSize > 0) {
                        const percent = Math.round((processedSize / totalSize) * 100);
                        sendProgress(percent - 1);
                    }
                });

                archive.on('error', (err) => {
                    console.error(i18n.t('server.tar_archive_creation_failed_log', { outputName: outputName }), err);
                    sendCompletion('error', 'server.tar_archive_creation_failed');
                    xzProcess.kill(); // 终止 xz 进程
                });

                xzProcess.on('error', (err) => {
                    console.error(i18n.t('server.xz_compression_process_failed_log', { outputName: outputName }), err);
                    sendCompletion('error', 'server.xz_compression_process_failed');
                });

                xzProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(i18n.t('server.file_compressed_success_log', { absoluteOutputFilePath: absoluteOutputFilePath }));
                        sendProgress(100);
                        sendCompletion('success', 'server.file_compressed_success');
                    } else {
                        console.error(i18n.t('server.xz_compression_process_nonzero_exit', { outputName: outputName, code: code }));
                        sendCompletion('error', 'server.xz_compression_process_nonzero_exit_message');
                    }
                });

                outputStream.on('error', (err) => {
                    console.error(i18n.t('server.write_xz_output_failed_log', { outputName: outputName }), err);
                    sendCompletion('error', i18n.t('server.write_xz_output_failed', { outputName: outputName, message: err.message }));
                });

                for (const filePath of filesToCompressAbsolutePaths) {
                    const stat = await fs.stat(filePath);
                    const entryName = path.relative(absoluteDestinationPath, filePath);
                    if (stat.isDirectory()) {
                        archive.directory(filePath, entryName);
                    } else {
                        archive.file(filePath, { name: entryName });
                    }
                }

                archive.finalize();
                return;
            }
            default:
                sendCompletion('error', 'server.unsupported_compress_format');
                return;
        }
    } catch (error) {
        if (error.message.includes('Instance not found')) {
            sendCompletion('error', 'server.instance_not_found');
            return;
        }
        if (error.message.includes('Access denied')) {
            sendCompletion('error', 'server.no_perms');
            return;
        }
        if (error.code === 'ENOENT') {
            sendCompletion('error', 'server.file_or_directory_not_found');
            return;
        }
        console.error('server.compress_api_internal_error_log', error);
        sendCompletion('error', 'server.compress_api_internal_error', { error: error.message });
    }
});

// POST /api/instances/:instanceId/copy - 复制文件或目录
app.post('/api/instances/:instanceId/copy', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    const { instanceId } = req.params;
    const { files, destination } = req.body; // files 是要复制的相对路径数组，destination 是目标目录的相对路径

    if (!files || files.length === 0 || !destination) {
        return res.status(400).json({ message: 'server.missing_copy_details' });
    }

    try {
        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destination);
        await fs.ensureDir(absoluteDestinationPath); // 确保目标目录存在

        const copyOperations = files.map(async (file) => {
            const absoluteSourcePath = getFileAbsolutePath(instanceId, file);
            const fileName = path.basename(file);
            const absoluteTargetPath = path.join(absoluteDestinationPath, fileName);

            // 检查源路径和目标路径是否在同一个实例工作目录内（getFileAbsolutePath 已处理）
            // 检查是否尝试将文件复制到其自身，或其子目录
            if (absoluteSourcePath === absoluteTargetPath) {
                throw new Error('server.cannot_copy_to_self');
            }
            if (absoluteTargetPath.startsWith(absoluteSourcePath + path.sep)) {
                throw new Error('server.cannot_copy_to_subdirectory');
            }

            await fs.copy(absoluteSourcePath, absoluteTargetPath, { overwrite: true });
            return fileName;
        });

        const copiedFiles = await Promise.all(copyOperations);

        res.status(200).json({ message: 'server.copy_success', copiedFiles });

        // 广播文件系统变化通知，让前端刷新列表
        broadcast({
            type: 'file-change',
            instanceId: instanceId,
            path: destination
        });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        console.error('server.copy_file_or_directory_failed_log', error);
        res.status(500).json({ message: 'server.copy_file_or_directory_failed', error: error.message });
    }
});

// POST /api/instances/:instanceId/delete-multiple - 批量删除文件或目录
app.post('/api/instances/:instanceId/delete-multiple', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    const { instanceId } = req.params;
    const { filePaths } = req.body; // filePaths 是要删除的相对路径数组

    if (!filePaths || filePaths.length === 0) {
        return res.status(400).json({ message: 'server.missing_delete_paths' });
    }

    try {
        const deletedItems = [];
        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);

        for (const relativePath of filePaths) {
            const absolutePath = getFileAbsolutePath(instanceId, relativePath);

            // 防止删除实例根目录
            if (absolutePath === instanceCwd) {
                console.warn(i18n.t('server.attempt_delete_instance_root_blocked', { relativePath: relativePath }));
                continue; // 跳过此项，继续删除其他文件
            }

            await fs.remove(absolutePath); // 删除文件或目录
            deletedItems.push(relativePath);
        }

        if (deletedItems.length === 0 && filePaths.length > 0) {
            return res.status(400).json({ message: 'server.failed_to_delete_any_items' });
        }

        res.status(200).json({ message: 'server.delete_success', deletedItems });

        // 广播文件系统变化通知，让前端刷新列表。
        // 对于删除操作，需要通知每个被删除项目所在的目录。
        const affectedDirs = new Set(deletedItems.map(item => path.dirname(item)));
        affectedDirs.forEach(dir => {
            broadcast({
                type: 'file-change',
                instanceId: instanceId,
                path: dir
            });
        });

    } catch (error) {
        if (error.message.includes('Instance not found') || error.message.includes('Access denied')) {
            return res.status(403).json({ message: error.message });
        }
        if (error.code === 'ENOENT') {
            // 如果文件不存在，我们仍然认为它“被删除”了，所以不会抛出错误，而是继续
            console.warn('server.delete_non_existent_warn', { path: error.path });
            return res.status(200).json({ message: 'server.delete_partial_success', error: error.message });
        }
        console.error('server.bulk_delete_failed_log', error);
        res.status(500).json({ message: 'server.bulk_delete_failed', error: error.message });
    }
});

// POST /api/instances/:instanceId/move - 移动（剪切）文件或目录
app.post('/api/instances/:instanceId/move', isAuthenticated, checkFileManagerPermission, async (req, res) => {
    const { instanceId } = req.params;
    const { files, destination } = req.body; // files 是要移动的相对路径数组，destination 是目标目录的相对路径

    if (!files || files.length === 0 || !destination) {
        return res.status(400).json({ message: 'server.missing_move_details' });
    }

    try {
        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destination);
        await fs.ensureDir(absoluteDestinationPath); // 确保目标目录存在

        const moveOperations = files.map(async (file) => {
            const absoluteSourcePath = getFileAbsolutePath(instanceId, file);
            const fileName = path.basename(file);
            const absoluteTargetPath = path.join(absoluteDestinationPath, fileName);

            // 检查源路径和目标路径是否在同一个实例工作目录内（getFileAbsolutePath 已处理）
            // 检查是否尝试将文件移动到其自身，或其子目录
            if (absoluteSourcePath === absoluteTargetPath) {
                throw new Error('server.cannot_move_to_self');
            }
            if (absoluteTargetPath.startsWith(absoluteSourcePath + path.sep)) {
                throw new Error('server.cannot_move_to_subdirectory');
            }

            await fs.move(absoluteSourcePath, absoluteTargetPath, { overwrite: true });
            return fileName;
        });

        const movedFiles = await Promise.all(moveOperations);

        res.status(200).json({ message: 'server.move_success', movedFiles });

        // 广播文件系统变化通知，让前端刷新列表。需要通知源目录和目标目录。
        // 对于移动操作，源目录文件会消失，目标目录文件会增加。
        const sourceDirs = new Set(files.map(file => path.dirname(file)));
        sourceDirs.forEach(dir => {
            broadcast({
                type: 'file-change',
                instanceId: instanceId,
                path: dir
            });
        });
        broadcast({
            type: 'file-change',
            instanceId: instanceId,
            path: destination
            });

    } catch (error) {
        if (error.message.includes('Instance not found')) {
            return res.status(404).json({ message: 'server.instance_not_found' });
        }
        if (error.message.includes('Access denied')) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }
        console.error('server.move_file_or_directory_failed_log', error);
        res.status(500).json({ message: 'server.move_file_or_directory_failed', error: error.message });
    }
});

// --- 用户管理 API (管理员权限) ---
app.use('/api/users', isAuthenticated, isAdmin); // 保护所有用户路由

app.get('/api/users', (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    // 不返回密码哈希
    res.json(users.map(({ passwordHash, ...user }) => user));
});

app.post('/api/users', async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'server.username_password_required' });
    }
    const users = readDb(USERS_DB_PATH, []);
    if (users.some(u => u.username === username)) {
        return res.status(409).json({ message: 'server.username_already_exists' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = {
        id: uuidv4(),
        username,
        passwordHash: hashedPassword,
        role: role || 'user' // 默认为普通用户
    };
    users.push(newUser);
    writeDb(USERS_DB_PATH, users);
    res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, password, role } = req.body;
    if (!username && !password && !role) {
        return res.status(400).json({ message: 'server.no_update_data_provided' });
    }

    let users = readDb(USERS_DB_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) return res.status(404).json({ message: 'server.user_not_found' });

    // 阻止用户修改自己的角色
    if (role !== undefined && req.session.user.role !== 'admin') {
        // 如果当前用户不是管理员，并且尝试修改角色
        return res.status(403).json({ message: 'server.forbidden_admin_only_change_roles' });
    }

    // 阻止管理员修改自己的角色 (不能自降为普通用户)
    if (id === req.session.user.id && req.session.user.role === 'admin' && role && role !== 'admin') {
        return res.status(403).json({ message: 'server.cannot_demote_admin_account' });
    }

    const updatedUser = { ...users[userIndex] };
    if (username) updatedUser.username = username;
    if (password) updatedUser.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    if (role) updatedUser.role = role;

    users[userIndex] = updatedUser;
    writeDb(USERS_DB_PATH, users);
    res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role });
});

app.put('/api/users/:id/role', isAuthenticated, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !['user', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'server.invalid_role_provided' });
    }

    let users = readDb(USERS_DB_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) return res.status(404).json({ message: 'server.user_not_found' });

    // Prevent admin from changing their own role
    if (id === req.session.user.id && users[userIndex].role === 'admin' && role !== 'admin') {
        return res.status(403).json({ message: 'server.cannot_demote_admin_account' });
    }

    users[userIndex].role = role;
    writeDb(USERS_DB_PATH, users);

    // If the updated user is the current logged-in user, update their session
    if (id === req.session.user.id) {
        req.session.user.role = role;
    }

    res.json({ id: users[userIndex].id, username: users[userIndex].username, role: users[userIndex].role });
});

app.put('/api/users/:id/password', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;
    const currentUser = req.session.user; // Current logged-in user

    // 1. Validate new password is provided
    if (!newPassword) {
        return res.status(400).json({ message: 'server.new_password_required' });
    }

    let users = readDb(USERS_DB_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);

    // 2. Check if target user exists
    if (userIndex === -1) {
        return res.status(404).json({ message: 'server.user_not_found' });
    }
    const targetUser = users[userIndex]; // Target user whose password is being changed

    // 3. Authorization Logic:
    // If current user is changing their own password
    if (currentUser.id === id) {
        // Both regular users and admins changing their own password must provide and verify old password
        if (!oldPassword) {
            return res.status(400).json({ message: 'server.old_password_required' });
        }
        if (!await bcrypt.compare(oldPassword, targetUser.passwordHash)) {
            return res.status(401).json({ message: 'server.incorrect_old_password' });
        }
    } else { // 如果是管理员修改其他用户的密码
        if (currentUser.role !== 'admin') {
            return res.status(403).json({ message: 'server.no_perms' });
        }
        // 管理员修改其他用户密码时，不需要旧密码
        console.log(i18n.t('server.admin_changing_user_password', { adminUsername: currentUser.username, targetUsername: targetUser.username }));
    }

    // 4. Update password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    targetUser.passwordHash = hashedPassword;
    writeDb(USERS_DB_PATH, users);
    res.json({ message: 'server.password_updated_successfully' });
});

app.put('/api/users/:id/username', isAuthenticated, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ message: 'server.username_required' });
    }

    let users = readDb(USERS_DB_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'server.user_not_found' });
    }

    // Check if new username already exists
    if (users.some(u => u.username === username && u.id !== id)) {
        return res.status(409).json({ message: 'server.username_already_exists' });
    }

    const oldUsername = users[userIndex].username;
    users[userIndex].username = username;
    writeDb(USERS_DB_PATH, users);

    // If the updated user is the current logged-in user, update their session username
    if (id === req.session.user.id) {
        req.session.user.username = username;
    }

    res.json({ message: 'server.ok' });
});

app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    let users = readDb(USERS_DB_PATH, []);

    // Prevent admin from deleting themselves
    if (id === req.session.user.id) {
        return res.status(403).json({ message: 'server.cannot_delete_admin_account' });
    }

    const initialLength = users.length;
    users = users.filter(u => u.id !== id);
    if (users.length === initialLength) {
        return res.status(404).json({ message: 'server.user_not_found' });
    }
    writeDb(USERS_DB_PATH, users);

    // Remove user's permissions from all instances
    let instances = readDb(INSTANCES_DB_PATH, []);
    instances.forEach(instance => {
        if (instance.permissions) {
            delete instance.permissions[id];
        }
    });
    writeDb(INSTANCES_DB_PATH, instances);

    res.status(204).send();
});

// --- 实例权限管理 API (管理员权限) ---
app.put('/api/instances/:instanceId/permissions/:userId', isAuthenticated, isAdmin, (req, res) => {
    const { instanceId, userId } = req.params;
    // 允许同时更新终端权限和文件管理权限
    const { terminalPermission, fileManagement } = req.body;

    // 验证终端权限
    if (terminalPermission !== undefined && !['read-only', 'read-write', 'read-write-ops', 'full-control', null, 'remove'].includes(terminalPermission)) {
        return res.status(400).json({ message: 'server.invalid_terminal_permission_level' });
    }
    // 验证文件管理权限
    if (fileManagement !== undefined && typeof fileManagement !== 'boolean') {
        return res.status(400).json({ message: 'server.invalid_file_management_value' });
    }

    // 必须提供至少一个权限更新
    if (terminalPermission === undefined && fileManagement === undefined) {
        return res.status(400).json({ message: 'server.no_permission_data_provided' });
    }

    const instances = readDb(INSTANCES_DB_PATH, []);
    const instanceIndex = instances.findIndex(i => i.id === instanceId);
    if (instanceIndex === -1) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }

    const users = readDb(USERS_DB_PATH, []);
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
        return res.status(404).json({ message: 'server.user_not_found' });
    }

    // Ensure the instance has a permissions object
    if (!instances[instanceIndex].permissions) {
        instances[instanceIndex].permissions = {};
    }

    // 确保实例有一个 permissions 对象
    if (!instances[instanceIndex].permissions) {
        instances[instanceIndex].permissions = {};
    }

    // 获取当前用户对此实例的权限设置
    const currentUserPermissions = instances[instanceIndex].permissions[userId] || { terminal: null, fileManagement: false };

    if (terminalPermission !== undefined) {
        if (terminalPermission === 'remove' || terminalPermission === null) {
            currentUserPermissions.terminal = null; // 显式设置为 null 表示没有终端权限
        } else {
            currentUserPermissions.terminal = terminalPermission;
        }
    }

    if (fileManagement !== undefined) {
        currentUserPermissions.fileManagement = fileManagement;
    }

    // 如果所有权限都为 null 或 false，则从实例中移除该用户的所有权限记录
    if (currentUserPermissions.terminal === null && currentUserPermissions.fileManagement === false) {
        delete instances[instanceIndex].permissions[userId];
    } else {
        instances[instanceIndex].permissions[userId] = currentUserPermissions;
    }

    writeDb(INSTANCES_DB_PATH, instances);
    broadcast({ type: 'event', event: 'instance-updated', instance: instances[instanceIndex] });
    res.json({ message: 'Instance permissions updated successfully.', instance: instances[instanceIndex] });
});

app.get('/api/instances/:instanceId/permissions', isAuthenticated, isAdmin, (req, res) => {
    const { instanceId } = req.params;
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);
    if (!instance) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }
    res.json(instance.permissions || {});
});

// API to check if an admin user exists (for setup.html)
app.get('/api/users/check', (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    res.json({ adminExists: users.some(u => u.role === 'admin') });
});


// 权限检查辅助函数
function checkUserInstancePermission(user, instanceId, requiredTerminalPermission = 'read-only', checkFileManagement = false) {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) {
        return false; // 实例不存在
    }

    if (user.role === 'admin') {
        return true; // 管理员有所有权限 (包括文件管理)
    }

    const userPermissions = instance.permissions?.[user.id];
    if (!userPermissions) {
        return false; // 没有为该用户设置任何权限
    }

    // 检查文件管理权限
    if (checkFileManagement) {
        if (userPermissions.fileManagement !== true) {
            return false;
        }
    }

    // 检查终端权限 (如果指定了 requiredTerminalPermission 并且不是 null)
    if (requiredTerminalPermission !== null) {
        const terminalPermission = userPermissions.terminal;
        if (!terminalPermission) {
            return false; // 没有终端权限
        }

        // 定义权限等级
        const permissionLevels = {
            'read-only': 1,
            'read-write': 2,
            'read-write-ops': 3,
            'full-control': 4
        };

        if (permissionLevels[terminalPermission] < permissionLevels[requiredTerminalPermission]) {
            return false; // 终端权限不足
        }
    }

    return true; // 权限通过
}


// =================================================================
// 统一 WebSocket 端点
// =================================================================
app.ws('/ws', (ws, req) => {
    sessionParser(req, {}, async () => { // 标记为 async
        if (!req.session.user) {
            return ws.close();
        }
        ws.user = req.session.user;
        clients.add(ws);

        ws.on('message', async (msg) => { // 标记为 async
            try {
                const message = JSON.parse(msg);
                let instance;
                // 对于实例相关的消息，检查实例是否存在
                if (message.id) {
                    instance = activeInstances.get(message.id);
                }

                switch (message.type) {
                    case 'subscribe':
                        if (instance) {
                            // 检查用户是否有权限订阅此实例 (终端只读权限)
                            if (!checkUserInstancePermission(ws.user, message.id, 'read-only', false)) {
                                send(ws, { type: 'error', message: 'server.permission_denied_subscribe_instance' });
                                return;
                            }
                            ws.subscribedInstanceId = message.id;
                            instance.listeners.add(ws);
                            send(ws, { type: 'output', id: message.id, data: instance.history });
                        }
                        break;
                    case 'unsubscribe':
                        if (instance) instance.listeners.delete(ws);
                        ws.subscribedInstanceId = null;
                        break;
                    case 'input':
                        if (instance) {
                            // 检查用户是否有写权限 (终端读写权限)
                            if (!checkUserInstancePermission(ws.user, message.id, 'read-write', false)) {
                                send(ws, { type: 'error', message: 'server.permission_denied_input_instance' });
                                return;
                            }
                            instance.pty.write(message.data);
                        }
                        break;
                    case 'resize':
                        if (instance) {
                            // 检查用户是否有读权限 (调整窗口大小通常不需要更高权限)
                            if (!checkUserInstancePermission(ws.user, message.id, 'read-only', false)) {
                                send(ws, { type: 'error', message: 'server.permission_denied_resize_instance' });
                                return;
                            }
                            instance.pty.resize(message.cols, message.rows);
                        }
                        break;
                    case 'subscribe-file-edit':
                        const { instanceId, filePath } = message;
                        try {
                            // 验证权限：需要文件管理权限
                            if (!checkUserInstancePermission(ws.user, instanceId, null, true)) { // null 表示不检查终端权限
                                send(ws, { type: 'error', message: 'server.permission_denied_edit_file' });
                                return;
                            }
                            const absolutePath = getFileAbsolutePath(instanceId, filePath);

                            editingFiles.set(filePath, { instanceId, absolutePath, wsClient: ws });
                            editingFileClients.add(ws); // 将此客户端加入到文件编辑客户端集合

                            const content = await fs.readFile(absolutePath, 'utf8');
                            send(ws, { type: 'file-content-updated', filePath: filePath, content: content });
                        } catch (error) {
                            console.error(i18n.t('server.subscribe_file_edit_failed_log', { instanceId: instanceId, filePath: filePath, error: error.message }));
                            send(ws, { type: 'error', message: 'server.subscribe_file_edit_failed' });
                            // 订阅失败则关闭连接，因为前端需要成功订阅才能工作
                            ws.close();
                        }
                        break;
                    case 'save-file':
                        const { instanceId: saveInstanceId, filePath: saveFilePath, content: fileContent, closeEditor } = message;
                        try {
                            // 验证权限：需要文件管理权限
                            if (!checkUserInstancePermission(ws.user, saveInstanceId, null, true)) {
                                send(ws, { type: 'error', message: 'server.permission_denied_save_file' });
                                return;
                            }
                            const absolutePathToSave = getFileAbsolutePath(saveInstanceId, saveFilePath);
                            await fs.writeFile(absolutePathToSave, fileContent, 'utf8');
                            send(ws, { type: 'file-saved-notification', filePath: saveFilePath, message: 'server.file_saved', closeEditor: closeEditor });
                        } catch (error) {
                            console.error(i18n.t('server.save_file_failed_log', { instanceId: saveInstanceId, filePath: saveFilePath, error: error.message }));
                            send(ws, { type: 'error', message: 'server.save_file_failed' });
                        }
                        break;
                    // file-content-change 消息不再需要后端实时处理，前端已改为定时保存
                    case 'file-content-change':
                        break;
                }
            } catch (e) {
                console.error(i18n.t('server.websocket_message_failed_log', { error: e.message }));
                if (ws.readyState === 1) {
                    send(ws, { type: 'error', message: e.message });
                }
            }
        });

        ws.on('close', () => {
            activeInstances.forEach(instance => instance.listeners.delete(ws));
            clients.delete(ws);
            editingFileClients.delete(ws); // 从文件编辑客户端集合中移除

            // 如果此 wsClient 正在编辑某个文件，则从 editingFiles 中移除
            editingFiles.forEach((value, key) => {
                if (value.wsClient === ws) {
                    editingFiles.delete(key);
                }
            });
        });
    });
});

// =================================================================
// 性能监控
// =================================================================
// 系统全局监控
setInterval(() => {
    try {
        osUtils.cpuUsage(cpuPercent => {
            const excludeClients = new Set();
            // 排除订阅了终端的客户端
            activeInstances.forEach(instance => {
                instance.listeners.forEach(client => excludeClients.add(client));
            });
            // 排除订阅了文件的客户端
            editingFileClients.forEach(client => excludeClients.add(client));

            broadcast({
                type: 'system-stats',
                cpu: (cpuPercent * 100).toFixed(2),
                mem: ((osUtils.totalmem() - osUtils.freemem()) / 1024).toFixed(2),
                totalMem: (osUtils.totalmem() / 1024).toFixed(2),
            }, excludeClients);
        });
    } catch (error) {
        console.error(i18n.t('server.system_stats_error', { error: error.message }));
    }
}, 2000);

// 单个实例监控 (包括 Docker 和非 Docker)
setInterval(() => {
    try {
        activeInstances.forEach(async (session) => {
            const instanceConfig = readDb(INSTANCES_DB_PATH).find(i => i.id === session.id);
            if (!instanceConfig) return;

            let cpu = '--';
            let memory = '--';

            if (instanceConfig.type === 'docker' && instanceConfig.dockerContainerId) {
                try {
                    const container = docker.getContainer(instanceConfig.dockerContainerId);
                    const statsStream = await container.stats({ stream: false }); // Get a single stats snapshot
                    const stats = statsStream; // statsStream is already the stats object when stream:false

                    if (stats) {
                        cpu = calculateCpuUsage(stats);
                        memory = calculateMemoryUsage(stats);
                    }
                } catch (err) {
                    console.warn(i18n.t('server.docker_container_stats_failed', { containerId: instanceConfig.dockerContainerId, error: err.message }));
                }
            } else {
                // 非 Docker 实例 (或 Docker 但没有 containerId 的情况)
                psTree(session.pty.pid, (err, children) => {
                    if (err) {
                        console.error(i18n.t('server.get_process_tree_failed', { pid: session.pty.pid, error: err.message }));
                        return;
                    }
                    const pids = [session.pty.pid, ...children.map(p => p.PID)];
                    pidusage(pids, (err, stats) => {
                        if (err) {
                            // 进程可能已经退出，但我们还没有收到 exit 事件
                            if (!err.message.includes('No matching process')) {
                                console.error(i18n.t('server.get_pidusage_stats_failed', { pids: pids.join(', '), error: err.message }));
                            }
                            return;
                        }
                        const totalStats = Object.values(stats).reduce((acc, current) => {
                            acc.cpu += current.cpu;
                            acc.memory += current.memory;
                            return acc;
                        }, { cpu: 0, memory: 0 });

                        cpu = totalStats.cpu.toFixed(2);
                        memory = (totalStats.memory / 1024 / 1024).toFixed(2);

                        const data = {
                            type: 'instance-stats',
                            id: session.id,
                            cpu: cpu,
                            memory: memory,
                        };
                        session.listeners.forEach(ws => send(ws, data));
                    });
                });
                // 对于非 Docker 实例，数据会在 psTree 的回调中发送
                return;
            }

            const data = {
                type: 'instance-stats',
                id: session.id,
                cpu: cpu,
                memory: memory,
            };
            session.listeners.forEach(ws => send(ws, data));
        });
    } catch (error) {
        console.error(i18n.t('server.instance_stats_error', { error: error.message }));
    }
}, 2000);

// =================================================================
// 服务器启动
// =================================================================
// 启动时自动运行实例
const instances = readDb(INSTANCES_DB_PATH, []);
(async () => {
    for (const instance of instances) {
        if (instance.autoStartOnBoot) {
            try {
                await startInstance(instance);
            } catch {}
        }
    }
})();

app.get('/setup.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('*', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const lang = process.env.PANEL_LANG || 'en';
i18n.setLang(lang);

server.listen(PORT, () => {
    console.log(i18n.t('server.server_running', { port: PORT }));
    if (readDb(USERS_DB_PATH, []).length === 0) {
        console.log(i18n.t('server.setup_admin_account_warn', { url: `http://localhost:${PORT}/setup.html` }));
    }
    initializeInstancesState();
});