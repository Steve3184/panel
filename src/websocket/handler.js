import fs from 'fs-extra';
import { activeInstances } from '../core/instanceManager.js';
import { getFileAbsolutePath } from '../core/fileManager.js';
import { checkUserInstancePermission } from '../api/middleware/permissions.js';
import i18n from '../utils/i18n.js';

const clients = new Set(); // 所有连接的 WebSocket 客户端
const editingFileClients = new Set(); // 正在进行文件编辑的 WebSocket 客户端
// K: filePath, V: { instanceId, absolutePath, wsClient }
const editingFiles = new Map(); // 存储正在编辑的文件及其关联的 WebSocket 客户端

/**
 * 向单个 WebSocket 客户端发送数据。
 * @param {WebSocket} ws 客户端实例
 * @param {object} data 要发送的数据对象
 */
export function send(ws, data) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

/**
 * 广播数据给所有（或部分）客户端。
 * @param {object} data 要广播的数据对象
 * @param {Set<WebSocket>} [excludeClients=new Set()] 要排除的客户端集合
 */
export function broadcast(data, excludeClients = new Set()) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === 1 && !excludeClients.has(client)) {
            client.send(message);
        }
    });
}

export function getEditingFileClients() {
    return editingFileClients;
}

async function handleMessage(ws, messageData) {
    try {
        const message = JSON.parse(messageData);
        let instance;
        if (message.id || message.instanceId) {
            instance = activeInstances.get(message.id || message.instanceId);
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
            case 'unsubscribe-file-edit':
                // 从 editingFiles 中移除此客户端对该文件的订阅
                for (let [key, value] of editingFiles.entries()) {
                    if (value.wsClient === ws && value.filePath === message.filePath) {
                        editingFiles.delete(key);
                        break;
                    }
                }
                editingFileClients.delete(ws);
                break;
        }
    } catch (e) {
        console.error(i18n.t('server.websocket_message_failed_log', { error: e.message }));
        send(ws, { type: 'error', message: e.message });
    }
}

/**
 * 设置 WebSocket 端点和事件监听器。
 * @param {object} app Express 应用实例
 * @param {function} sessionParser session 中间件
 */
export function setupWebSocket(app, sessionParser) {
    app.ws('/ws', (ws, req) => {
        sessionParser(req, {}, () => {
            if (!req.session.user) {
                return ws.close();
            }
            ws.user = req.session.user;
            clients.add(ws);

            ws.on('message', (msg) => handleMessage(ws, msg));

            ws.on('close', () => {
                activeInstances.forEach(instance => instance.listeners.delete(ws));
                clients.delete(ws);
                editingFileClients.delete(ws);
                // 清理 editingFiles 映射
                for (let [key, value] of editingFiles.entries()) {
                    if (value.wsClient === ws) {
                        editingFiles.delete(key);
                    }
                }
            });
        });
    });
}