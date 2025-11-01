import osUtils from 'os-utils';
import pidusage from 'pidusage';
import psTree from 'ps-tree';
import Docker from 'dockerode';
import { readDb } from '../data/db.js';
import { INSTANCES_DB_PATH } from '../config.js';
import { activeInstances } from './instanceManager.js';
import { calculateCpuUsage, calculateMemoryUsage } from './dockerManager.js';
import { broadcast, getEditingFileClients, send } from '../websocket/handler.js';
import i18n from '../utils/i18n.js';

const docker = new Docker();

function monitorSystemStats() {
    try {
        osUtils.cpuUsage(cpuPercent => {
            const excludeClients = new Set();
            const editingFileClients = getEditingFileClients();

            // 排除订阅了终端和文件的客户端
            activeInstances.forEach(instance => {
                instance.listeners.forEach(client => excludeClients.add(client));
            });
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
}

function monitorInstanceStats() {
    try {
        const instancesConfig = readDb(INSTANCES_DB_PATH);

        activeInstances.forEach(async (session) => {
            const instanceConfig = instancesConfig.find(i => i.id === session.id);
            if (!instanceConfig) return;

            let cpu = '--';
            let memory = '--';

            if (instanceConfig.type === 'docker' && instanceConfig.dockerContainerId) {
                try {
                    const container = docker.getContainer(instanceConfig.dockerContainerId);
                    const statsStream = await container.stats({ stream: false });
                    const stats = statsStream;

                    if (stats) {
                        cpu = calculateCpuUsage(stats);
                        memory = calculateMemoryUsage(stats);
                    }
                } catch (err) {
                    console.warn(i18n.t('server.docker_container_stats_failed', { containerId: instanceConfig.dockerContainerId, error: err.message }));
                }
            } else {
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
                return; // 数据在回调中发送
            }

            const data = { type: 'instance-stats', id: session.id, cpu, memory };
            session.listeners.forEach(ws => {
                if (ws.readyState === 1) ws.send(JSON.stringify(data));
            });
        });
    } catch (error) {
        console.error(i18n.t('server.instance_stats_error', { error: error.message }));
    }
}

/**
 * 启动所有性能监控任务。
 */
export function startMonitoring() {
    setInterval(monitorSystemStats, 2000);
    setInterval(monitorInstanceStats, 2000);
    console.log("Performance monitoring started.");
}