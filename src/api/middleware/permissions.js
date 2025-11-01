import { readDb } from '../../data/db.js';
import { INSTANCES_DB_PATH } from '../../config.js';

/**
 * 检查实例操作权限的中间件。
 */
export const checkInstancePermission = (req, res, next) => {
    const { id } = req.params;
    const user = req.session.user;
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === id);

    if (!instance) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }

    // 管理员始终拥有完全控制权
    if (user.role === 'admin') {
        req.instanceConfig = instance; // 将实例配置附加到请求对象
        req.instancePermission = 'full-control'; // 简化管理员权限表示
        return next();
    }

    const permission = instance.permissions?.[user.id]?.terminal; // 获取终端权限

    if (!permission) {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    req.instanceConfig = instance;
    req.instancePermission = permission;
    next();
};

/**
 * 文件管理权限检查中间件。
 */
export const checkFileManagerPermission = (req, res, next) => {
    const { instanceId } = req.params;
    const user = req.session.user;
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }

    if (user.role === 'admin') {
        req.instanceConfig = instance;
        req.instancePermission = { terminal: 'full-control', fileManagement: true };
        return next();
    }

    const userPermissions = instance.permissions?.[user.id];

    if (!userPermissions || userPermissions.fileManagement !== true) {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    req.instanceConfig = instance;
    req.instancePermission = userPermissions;
    next();
};


/**
 * 权限检查辅助函数（非中间件），用于 WebSocket 和其他内部逻辑。
 * @param {object} user 用户对象
 * @param {string} instanceId 实例ID
 * @param {'read-only'|'read-write'|'read-write-ops'|'full-control'|null} requiredTerminalPermission 所需的最低终端权限, null 表示不检查
 * @param {boolean} checkFileManagement 是否需要文件管理权限
 * @returns {boolean} 是否拥有权限
 */
export function checkUserInstancePermission(user, instanceId, requiredTerminalPermission = 'read-only', checkFileManagement = false) {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) return false;
    if (user.role === 'admin') return true;

    const userPermissions = instance.permissions?.[user.id];
    if (!userPermissions) return false;

    if (checkFileManagement && userPermissions.fileManagement !== true) {
        return false;
    }
    
    if (requiredTerminalPermission !== null) {
        const terminalPermission = userPermissions.terminal;
        if (!terminalPermission) return false;
        
        const permissionLevels = {
            'read-only': 1,
            'read-write': 2,
            'read-write-ops': 3,
            'full-control': 4
        };
        
        if (permissionLevels[terminalPermission] < permissionLevels[requiredTerminalPermission]) {
            return false;
        }
    }

    return true;
}