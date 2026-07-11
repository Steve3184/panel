import fs from 'fs-extra';
import path from 'path';
import { readDb } from '../data/db.js';
import { INSTANCES_DB_PATH, WORKSPACES_PATH } from '../config.js';

export const activeUploads = new Map();

function isWithinRoot(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function getInstance(instanceId) {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instance = instances.find(item => item.id === instanceId);
    if (!instance) throw new Error('Instance not found');
    return instance;
}

export function getInstanceRootPath(instanceId) {
    const instance = getInstance(instanceId);
    return path.resolve(instance.cwd || path.join(WORKSPACES_PATH, instanceId));
}

export async function resolvePathWithinRoot(configuredRoot, relativePath = '', { allowMissing = false } = {}) {
    if (typeof relativePath !== 'string' || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
        throw new Error('Access denied: Invalid instance-relative path.');
    }

    const canonicalRoot = await fs.realpath(path.resolve(configuredRoot));
    const targetPath = path.resolve(canonicalRoot, relativePath || '.');

    if (!isWithinRoot(canonicalRoot, targetPath)) {
        throw new Error('Access denied: Path outside of instance working directory.');
    }

    const segments = path.relative(canonicalRoot, targetPath).split(path.sep).filter(Boolean);
    let currentPath = canonicalRoot;
    for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        try {
            const stats = await fs.lstat(currentPath);
            if (stats.isSymbolicLink()) {
                throw new Error('Access denied: Symbolic links are not allowed in managed paths.');
            }
        } catch (error) {
            if (error.code === 'ENOENT' && allowMissing) break;
            throw error;
        }
    }

    return targetPath;
}

/**
 * Resolve an instance-relative path and reject traversal and symlink escapes.
 * Missing path segments are allowed only for create/write destinations.
 */
export async function getFileAbsolutePath(instanceId, relativePath = '', { allowMissing = false } = {}) {
    const configuredRoot = getInstanceRootPath(instanceId);
    return resolvePathWithinRoot(configuredRoot, relativePath, { allowMissing });
}

export function isPathWithinRoot(rootPath, targetPath) {
    return isWithinRoot(path.resolve(rootPath), path.resolve(targetPath));
}
