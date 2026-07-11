import { v2 as webdav, HTTPCodes } from 'webdav-server/lib/index.js';
import { join } from 'path';
import { readDb } from '../../data/db.js';
import { INSTANCES_DB_PATH, WORKSPACES_PATH, USERS_DB_PATH } from '../../config.js';
import { checkUserInstancePermission } from '../middleware/permissions.js';
import i18n from '../../utils/i18n.js';
import bcrypt from 'bcrypt';
import { getFileAbsolutePath } from '../../core/fileManager.js';

// WebDAV 服务器实例映射
const webdavServers = new Map();

/**
 * 获取或创建指定实例的 WebDAV 服务器。
 * @param {string} instanceId - 实例 ID。
 * @param {string} instancePath - 实例的工作目录路径。
 * @returns {webdav.WebDAVServer} WebDAV 服务器实例。
 */
function getOrCreateWebDAVServer(instanceId, instancePath) {
    if (webdavServers.has(instanceId)) {
        return webdavServers.get(instanceId);
    }

    const server = new webdav.WebDAVServer();
    server.setFileSystem('/' + instanceId + '/', new webdav.PhysicalFileSystem(instancePath));

    webdavServers.set(instanceId, server);
    return server;
}


/**
 * WebDAV 控制器。
 */
export const handleWebDAV = (req, res, next) => {
    const { instanceId } = req.params;
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) {
        return res.status(HTTPCodes.NotFound).json({ message: i18n.t('server.instance_not_found') });
    }

    const instancePath = instance.cwd || join(WORKSPACES_PATH, instanceId);
    const server = getOrCreateWebDAVServer(instanceId, instancePath);

    server.executeRequest(req, res, req.baseUrl);
}

export const webdavPathSafetyMiddleware = async (req, res, next) => {
    try {
        const wildcardPath = Array.isArray(req.params.path) ? req.params.path.join('/') : (req.params.path || '');
        await getFileAbsolutePath(req.params.instanceId, wildcardPath, { allowMissing: true });
        const destinationPath = getWebDavRelativeDestination(req);
        if (destinationPath !== null) {
            await getFileAbsolutePath(req.params.instanceId, destinationPath, { allowMissing: true });
        }
        next();
    } catch (error) {
        return res.status(HTTPCodes.Forbidden).send(i18n.t('server.no_perms'));
    }
};

export function getWebDavRelativeDestination(req) {
    if (!['COPY', 'MOVE'].includes(req.method)) return null;
    const destination = req.headers.destination;
    if (!destination || typeof destination !== 'string') throw new Error('Missing WebDAV destination.');

    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const destinationUrl = new URL(destination, requestOrigin);
    if (destinationUrl.origin !== new URL(requestOrigin).origin || destinationUrl.search || destinationUrl.hash) {
        throw new Error('Invalid WebDAV destination origin.');
    }

    const destinationPath = decodeURIComponent(destinationUrl.pathname);
    const instanceMountPath = `${req.baseUrl}/${req.params.instanceId}`.replace(/\/$/, '');
    if (destinationPath === instanceMountPath) return '';
    if (!destinationPath.startsWith(`${instanceMountPath}/`)) {
        throw new Error('WebDAV destination must remain inside the same instance.');
    }
    return destinationPath.slice(instanceMountPath.length + 1);
}

/**
 * WebDAV HTTP Basic 认证中间件
 */
export const webdavAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.status(HTTPCodes.Unauthorized).send(i18n.t('server.webdav_invalid_credentials'));
    }

    const [scheme, credentials] = authHeader.split(' ');
    if (scheme !== 'Basic' || !credentials) {
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.status(HTTPCodes.Unauthorized).send(i18n.t('server.webdav_invalid_credentials'));
    }

    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

    if (!username || !password) {
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.status(HTTPCodes.Unauthorized).send(i18n.t('server.webdav_invalid_credentials'));
    }

    const users = readDb(USERS_DB_PATH, []);
    const user = users.find(u => u.username === username);

    if (!user) {
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.status(HTTPCodes.Unauthorized).send(i18n.t('server.webdav_invalid_credentials'));
    }

    if (!password || !await bcrypt.compare(password, user.passwordHash)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.status(HTTPCodes.Unauthorized).send(i18n.t('server.webdav_invalid_credentials'));
    }

    // 检查用户是否具有访问该实例的权限
    const { instanceId } = req.params;

    if (!instanceId) {
        return res.status(HTTPCodes.BadRequest).send(i18n.t('server.instance_not_found'));
    }

    if (!checkUserInstancePermission(user, instanceId, null, true)) {
        return res.status(HTTPCodes.Forbidden).send(i18n.t('server.no_perms'));
    }

    // 认证成功，删除 Authorization 头
    delete req.headers.authorization;
    next();
};
