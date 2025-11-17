import { v2 as webdav, HTTPCodes } from 'webdav-server/lib/index.js';
import { join } from 'path';
import { readDb } from '../../data/db.js';
import { INSTANCES_DB_PATH, WORKSPACES_PATH, USERS_DB_PATH } from '../../config.js';
import { checkUserInstancePermission } from '../middleware/permissions.js';
import i18n from '../../utils/i18n.js';
import bcrypt from 'bcrypt';

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

    server.executeRequest(req, res, '/');
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
    const [username, password] = decoded.split(':');

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

    if (!password || !bcrypt.compareSync(password, user.passwordHash)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.status(HTTPCodes.Unauthorized).send(i18n.t('server.webdav_invalid_credentials'));
    }

    // 检查用户是否具有访问该实例的权限
    const urlParts = req.url.split('/');
    const instanceId = urlParts[1];

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