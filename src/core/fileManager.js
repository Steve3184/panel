import path from 'path';
import { readDb } from '../data/db.js';
import { INSTANCES_DB_PATH, WORKSPACES_PATH } from '../config.js';

// K: uploadId, V: { ...upload_details }
export const activeUploads = new Map();

/**
 * 获取实例工作目录内的绝对路径，并防止路径遍历攻击。
 * @param {string} instanceId 实例ID
 * @param {string} relativePath 相对于实例工作目录的路径
 * @returns {string} 绝对路径
 * @throws {Error} 如果实例未找到或路径越界
 */
export function getFileAbsolutePath(instanceId, relativePath = '') {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(i => i.id === instanceId);

    if (!instance) {
        throw new Error('Instance not found');
    }

    const instanceCwd = instance.cwd || path.join(WORKSPACES_PATH, instanceId);
    const absolutePath = path.join(instanceCwd, relativePath);

    if (!absolutePath.startsWith(instanceCwd)) {
        throw new Error('Access denied: Path outside of instance working directory.');
    }

    return absolutePath;
}