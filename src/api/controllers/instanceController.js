import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb } from '../../data/db.js';
import { INSTANCES_DB_PATH, USERS_DB_PATH, WORKSPACES_PATH } from '../../config.js';
import * as instanceManager from '../../core/instanceManager.js';
import { broadcast } from '../../websocket/handler.js';
import path from 'path';
import fs from 'fs-extra';

export const getAllInstances = (req, res) => {
    const instances = readDb(INSTANCES_DB_PATH, []);
    const user = req.session.user;

    let viewableInstances = (user.role === 'admin')
        ? instances
        : instances.filter(i => i.permissions && i.permissions[user.id]);

    const result = viewableInstances.map(i => ({
        ...i,
        status: instanceManager.activeInstances.has(i.id) ? 'running' : 'stopped'
    }));
    res.json(result);
};

export const createInstance = (req, res) => {
    const { name, command, cwd, type, autoStartOnBoot, autoDeleteOnExit, autoRestart, env, dockerConfig, dockerComposeContent } = req.body;
    if (!command && type !== 'docker' && type !== 'docker_compose') return res.status(400).json({ message: 'server.command_required' });
    if (type === 'docker' && !dockerConfig?.image) return res.status(400).json({ message: 'server.image_required' });
    if (type === 'docker_compose' && !dockerComposeContent) return res.status(400).json({ message: 'server.docker_compose_not_found' });

    const id = uuidv4();
    const finalCwd = cwd || path.join(WORKSPACES_PATH, id);

    try {
        fs.ensureDirSync(finalCwd);
    } catch (error) {
        return res.status(500).json({ message: 'server.failed_to_create_file', error: error.message });
    }

    if (type === 'docker_compose') {
        try {
            fs.writeFileSync(path.join(finalCwd, 'docker-compose.yml'), dockerComposeContent);
        } catch (error) {
            return res.status(500).json({ message: 'server.failed_to_create_file', error: error.message });
        }
    }

    const newInstance = {
        id,
        name: name || id.substring(0, 8),
        type: type || 'shell',
        command,
        cwd: finalCwd,
        autoStartOnBoot: !!autoStartOnBoot,
        autoDeleteOnExit: !!autoDeleteOnExit,
        autoRestart: !!autoRestart,
        env: env || {},
        dockerConfig: dockerConfig || {},
        permissions: { [req.session.user.id]: { terminal: 'full-control', fileManagement: true } }
    };

    const instances = readDb(INSTANCES_DB_PATH, []);
    instances.push(newInstance);
    writeDb(INSTANCES_DB_PATH, instances);
    
    broadcast({ type: 'event', event: 'instance-created', instance: { ...newInstance, status: 'stopped' } });
    res.status(201).json(newInstance);
};

export const updateInstance = (req, res) => {
    const { id } = req.params;
    const { permissions, dockerComposeContent, ...updates } = req.body; // 禁止通过此 API 更新权限
    
    const instances = readDb(INSTANCES_DB_PATH, []);
    const instanceIndex = instances.findIndex(i => i.id === id);
    if (instanceIndex === -1) return res.status(404).json({ message: 'server.instance_not_found' });
    
    // 只有管理员可以更新某些敏感字段
    if (req.session.user.role !== 'admin') {
        const disallowedUpdates = ['autoStartOnBoot', 'autoDeleteOnExit', 'autoRestart', 'type', 'command', 'dockerConfig', 'env', 'dockerComposeContent'];
        for (const field of disallowedUpdates) {
             // check if updates has it (dockerComposeContent is extracted, so check variable)
            if ((field === 'dockerComposeContent' && dockerComposeContent !== undefined) || (updates[field] !== undefined && updates[field] !== instances[instanceIndex][field])) {
                return res.status(403).json({ message: 'server.no_field_perms' });
            }
        }
    }

    const currentInstance = instances[instanceIndex];
    const effectiveType = updates.type || currentInstance.type;
    const effectiveCwd = updates.cwd || currentInstance.cwd;

    if (effectiveType === 'docker_compose' && dockerComposeContent !== undefined) {
         try {
            fs.ensureDirSync(effectiveCwd);
            fs.writeFileSync(path.join(effectiveCwd, 'docker-compose.yml'), dockerComposeContent);
        } catch (error) {
            return res.status(500).json({ message: 'server.docker_compose_config_save_failed', error: error.message });
        }
    }

    instances[instanceIndex] = { ...instances[instanceIndex], ...updates };
    writeDb(INSTANCES_DB_PATH, instances);

    broadcast({ type: 'event', event: 'instance-updated', instance: instances[instanceIndex] });
    res.json(instances[instanceIndex]);
};

export const deleteInstanceController = async (req, res) => {
    const { id } = req.params;
    const { deleteData } = req.query;
    
    // 权限检查
    if (req.session.user.role !== 'admin' && req.instancePermission !== 'full-control') {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    await instanceManager.deleteInstance(id, deleteData === 'true');
    res.status(204).send();
};

export const handleInstanceAction = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    const instanceConfig = req.instanceConfig;
    
    const allowedActions = { 'read-write-ops': ['start', 'stop', 'restart'], 'full-control': ['start', 'stop', 'restart', 'interrupt', 'terminate', 'force-restart'] };
    if (req.session.user.role !== 'admin' && !allowedActions[req.instancePermission]?.includes(action)) {
        return res.status(403).json({ message: 'server.no_action_perms' });
    }
    
    try {
        switch (action) {
            case 'start': await instanceManager.startInstance(instanceConfig); break;
            case 'stop': await instanceManager.stopInstance(id, 'SIGTERM', true); break;
            case 'restart': await instanceManager.stopInstance(id, 'SIGTERM', false, true); break;
            case 'terminate': await instanceManager.stopInstance(id, 'SIGKILL', true); break;
            case 'force-restart': 
                await instanceManager.stopInstance(id, 'SIGKILL', true);
                await new Promise(resolve => setTimeout(resolve, 1000));
                await instanceManager.startInstance(instanceConfig);
                break;
            case 'interrupt':
                const session = instanceManager.activeInstances.get(id);
                if (session) session.pty.write('\x03');
                break;
            default: return res.status(400).json({ message: 'server.invalid_action' });
        }
        res.json({ message: 'server.action_initiated' });
    } catch (e) {
        console.error("Action failed:", e);
        res.status(500).json({ message: 'server.action_failed', error: e.message });
    }
};

export const updateInstancePermissions = (req, res) => {
    const { instanceId, userId } = req.params;
    const { terminal, fileManagement } = req.body;
    
    let instances = readDb(INSTANCES_DB_PATH, []);
    const instanceIndex = instances.findIndex(i => i.id === instanceId);
    if (instanceIndex === -1) return res.status(404).json({ message: 'server.instance_not_found' });
    
    const users = readDb(USERS_DB_PATH, []);
    if (!users.some(u => u.id === userId)) return res.status(404).json({ message: 'server.user_not_found' });

    const instance = instances[instanceIndex];
    if (!instance.permissions) instance.permissions = {};
    
    const currentUserPermissions = instance.permissions[userId] || {};
    if (terminal !== undefined) currentUserPermissions.terminal = terminal;
    if (fileManagement !== undefined) currentUserPermissions.fileManagement = fileManagement;
    
    if (currentUserPermissions.terminal === null && !currentUserPermissions.fileManagement) {
        delete instance.permissions[userId];
    } else {
        instance.permissions[userId] = currentUserPermissions;
    }
    
    writeDb(INSTANCES_DB_PATH, instances);
    broadcast({ type: 'event', event: 'instance-updated', instance });
    res.json({ message: 'Permissions updated', instance });
};

export const getInstancePermissions = (req, res) => {
    const instance = req.instanceConfig; // 从中间件获取
    res.json(instance.permissions || {});
};

export const getComposeContainers = async (req, res) => {
    try {
        const containers = await instanceManager.getDockerComposeContainers(req.params.id);
        res.json(containers);
    } catch (error) {
        console.error('Failed to get compose containers:', error);
        res.status(500).json({ message: 'server.docker_compose_ps_failed', error: error.message });
    }
};
