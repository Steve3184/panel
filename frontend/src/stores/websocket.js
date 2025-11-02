import { defineStore } from 'pinia';
import { useInstancesStore } from './instances';
import { useFileManagerStore } from './fileManager';
import { useUiStore } from './ui';
import { useI18n } from '../composables/useI18n';

let socket = null;
let reconnectInterval = null;
const messageHandlers = new Map(); // 用于存储消息处理器的 Map

export const useWebSocketStore = defineStore('websocket', () => {
    const instancesStore = useInstancesStore();
    const fileManagerStore = useFileManagerStore();
    const uiStore = useUiStore();
    const { t } = useI18n();

    function connect() {
        if (socket && socket.readyState === WebSocket.OPEN) {
            return;
        }

        const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
        socket = new WebSocket(`${protocol}${location.host}/ws`);

        socket.onopen = () => {
            console.log(t('websocket.connection.established'));
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
        };

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            
            // Route message to appropriate store
            switch (msg.type) {
                case 'event':
                    handleEvent(msg.event, msg);
                    break;
                case 'system-stats':
                    instancesStore.handleSystemStats(msg);
                    break;
                case 'instance-stats':
                    instancesStore.handleInstanceStats(msg);
                    break;
                // Terminal and file editor output are handled by components directly
                case 'output':
                case 'file-content-updated':
                case 'file-saved-notification':
                    // 遍历并调用注册的处理器
                    if (messageHandlers.has(msg.type)) {
                        messageHandlers.get(msg.type).forEach(handler => handler(msg));
                    }
                    break;
                // File manager progress/status
                case 'file-change':
                case 'upload-complete-notification':
                    fileManagerStore.handleFileChange(msg);
                    break;
                case 'file-extract-progress':
                case 'file-compress-progress':
                    uiStore.updateProgressToast(msg);
                    break;
                case 'file-extract-status':
                case 'file-compress-status':
                    uiStore.updateStatusToast(msg);
                    fileManagerStore.handleFileChange(msg); // Also refresh file list
                    break;
            }
        };

        socket.onclose = () => {
            console.log(t('websocket.connection.closed'));
            uiStore.showToast(t('websocket.connection.lost'), 'danger');
            socket = null;
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    connect();
                }, 5000);
            }
        };

        socket.onerror = (error) => {
            console.error(t('websocket.error'), error);
        };
    }

    function handleEvent(eventName, data) {
        switch (eventName) {
            case 'instance-created':
                instancesStore.handleInstanceCreated(data);
                break;
            case 'instance-deleted':
                instancesStore.handleInstanceDeleted(data);
                break;
            case 'instance-updated':
                instancesStore.handleInstanceUpdated(data);
                break;
            case 'instance-started':
                instancesStore.handleInstanceStatusChange(data.id, 'running');
                break;
            case 'instance-stopped':
                instancesStore.handleInstanceStatusChange(data.id, 'stopped');
                break;
        }
    }

    function sendMessage(message) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }
    
    // Function to get the raw socket for components that need direct access (Terminal, FileEditor)
    function getSocket() {
        return socket;
    }

    // 注册消息处理器
    function onMessage(type, handler) {
        if (!messageHandlers.has(type)) {
            messageHandlers.set(type, new Set());
        }
        messageHandlers.get(type).add(handler);
    }

    // 注销消息处理器
    function offMessage(type, handler) {
        if (messageHandlers.has(type)) {
            messageHandlers.get(type).delete(handler);
        }
    }

    return { connect, sendMessage, getSocket, onMessage, offMessage };
});