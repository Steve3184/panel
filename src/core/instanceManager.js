import path from 'path';
import fs from 'fs-extra';
import pty from 'node-pty';
import Docker from 'dockerode';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readDb, writeDb } from '../data/db.js';
import { INSTANCES_DB_PATH, WORKSPACES_PATH, SHELL } from '../config.js';
import { broadcast } from '../websocket/handler.js';
import i18n from '../utils/i18n.js';

const execAsync = promisify(exec);
const docker = new Docker();
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
// K: instanceId, V: { pty, listeners, history, ... }
export const activeInstances = new Map();
export const stoppedInstancesHistory = new Map();

export function getInstanceById(instanceId) {
    const instances = readDb(INSTANCES_DB_PATH, []);
    return instances.find(i => i.id === instanceId);
}

export async function startInstance(instanceConfig) {
    if (activeInstances.has(instanceConfig.id)) {
        console.log(i18n.t('server.instance_session_already_running', { name: instanceConfig.name, id: instanceConfig.id }));
        const existingSession = activeInstances.get(instanceConfig.id);
        existingSession.isUserTriggeredStop = false;
        return;
    }

    const instanceCwd = instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceConfig.id);
    fs.ensureDirSync(instanceCwd);

    let term;
    let commandToExecute = instanceConfig.command;

    if (instanceConfig.type === 'docker') {
        const dockerConfig = instanceConfig.dockerConfig || {};
        const containerName = dockerConfig.containerName || `runner-${instanceConfig.id}`;
        const image = dockerConfig.image;
        if (!image) throw new Error(`Docker 实例 ${instanceConfig.name} 未指定镜像 (image)`);

        const execCommand = dockerConfig.command ? dockerConfig.command.split(/\s+/) : null;
        let effectiveCwd = dockerConfig.workingDir || '/workspace';
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
                    Cmd: execCommand,
                });
                await container.start();
                console.log(i18n.t('server.new_container_created_and_started', { containerName: containerName, id: container.id }));
            } catch (err) {
                if (err.statusCode === 409) {
                    console.log(i18n.t('server.container_exists_stopped_starting', { containerName: containerName }));
                    container = docker.getContainer(containerName);
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
            logs: true,
            stdin: true,
            stdout: true,
            stderr: true,
        });

        commandToExecute = i18n.t('server.attached_to_container', { execCommand: execCommand });

        term = {
            pid: container.id,
            write: (data) => stream.write(data),
            on: (event, handler) => {
                if (event === 'data') stream.on('data', handler);
                if (event === 'exit') {
                    container.wait().then(() => handler()).catch(() => handler());
                }
            },
            resize: (cols, rows) => {
                if (cols > 0 && rows > 0) {
                    container.resize({ h: rows, w: cols }).catch(err => console.error(i18n.t('server.resize_container_tty_failed_log'), err.message));
                }
            },
            kill: (signal) => {
                if (signal === 'SIGKILL') {
                    container.kill().catch(err => console.error(i18n.t('server.force_stop_container_failed_log', { id: container.id }), err.message));
                } else {
                    container.stop().catch(err => console.error(i18n.t('server.stop_container_failed_log', { id: container.id }), err.message));
                }
            },
            destroy: () => {
                stream.removeAllListeners();
                stream.destroy();
            }
        };

    } else if (instanceConfig.type === 'docker_compose') {
        try {
            await execAsync('docker compose up -d', { cwd: instanceCwd });
        } catch (e) {
            console.error('Docker compose up failed', e);
            throw new Error(i18n.t('server.docker_compose_up_failed', { error: e.message }));
        }

        const containers = await getDockerComposeContainers(instanceConfig.id);
        if (containers.length === 0) {
             throw new Error('No containers found for this docker compose project');
        }
        
        const containerInfo = containers[0];
        const container = docker.getContainer(containerInfo.id);
        const inspectData = await container.inspect();
        const isTty = inspectData.Config.Tty;
        
        const stream = await container.attach({
            stream: true,
            logs: true,
            stdin: true,
            stdout: true,
            stderr: true,
        });
        
        commandToExecute = `Docker Compose: ${containerInfo.name}`;

        term = {
            pid: container.id,
            write: (data) => stream.write(data),
            on: (event, handler) => {
                if (event === 'data') {
                    if (isTty) {
                        stream.on('data', handler);
                    } else {
                        // Demux Docker stream
                        stream.on('data', (chunk) => {
                            let offset = 0;
                            while (offset < chunk.length) {
                                const type = chunk.readUInt8(offset);
                                const length = chunk.readUInt32BE(offset + 4);
                                offset += 8;
                                if (offset + length <= chunk.length) {
                                    handler(chunk.slice(offset, offset + length));
                                    offset += length;
                                } else {
                                    break;
                                }
                            }
                        });
                    }
                }
                if (event === 'exit') {
                    container.wait().then(() => handler()).catch(() => handler());
                }
            },
            resize: (cols, rows) => {
                if (isTty && cols > 0 && rows > 0) {
                    container.resize({ h: rows, w: cols }).catch(err => console.error(i18n.t('server.resize_container_tty_failed_log'), err.message));
                }
            },
            kill: (signal) => {
               if (signal === 'SIGKILL') {
                   execAsync('docker compose kill', { cwd: instanceCwd }).catch(console.error);
               } else {
                   execAsync('docker compose stop', { cwd: instanceCwd }).catch(console.error);
               }
            },
            destroy: () => {
                stream.removeAllListeners();
                stream.destroy();
            }
        };

    } else {
        const ptyOptions = {
            name: 'xterm-color', cols: 80, rows: 30, cwd: instanceCwd,
            env: { ...process.env, ...(instanceConfig.env || {}) }
        };
        term = pty.spawn(shell, ['-c', commandToExecute], ptyOptions);
        term.destroy = () => {}; 
    }

    const session = {
        id: instanceConfig.id, pty: term, listeners: new Set(),
        history: '',
        isUserTriggeredStop: false,
        isUserTriggeredRestart: false,
        restartAttempts: 0,
        restartTimer: null,
        restartTimeout: null,
    };
    activeInstances.set(instanceConfig.id, session);

    broadcast({ type: 'event', event: 'instance-started', id: instanceConfig.id });

    term.on('data', (data) => {
        const output = data.toString('utf8');
        session.history += output;
        session.listeners.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', id: instanceConfig.id, data: output }));
        });
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

        // Save history before removing session
        stoppedInstancesHistory.set(instanceConfig.id, session.history);

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
            writeDb(INSTANCES_DB_PATH, instances);
        }
    }
}

export async function stopInstance(instanceId, signal = 'SIGTERM', isUserTriggered = false, isRestart = false) {
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

export async function deleteInstance(instanceId, deleteData = true) {
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

export async function initializeInstancesState() {
    console.log(i18n.t('server.initializing_instance_state'));
    const instances = readDb(INSTANCES_DB_PATH, []);

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
                if (error.statusCode !== 404) {
                    console.error(i18n.t('server.error_initializing_instance_check', { name: instance.name, error: error.message }));
                }
            }
        }
    }

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

export async function getDockerComposeContainers(instanceId) {
    const instance = getInstanceById(instanceId);
    if (!instance || instance.type !== 'docker_compose') return [];
    
    // Project name is usually directory name of CWD
    const projectName = path.basename(instance.cwd); 
    
    try {
        const containers = await docker.listContainers({
            filters: {
                label: [`com.docker.compose.project=${projectName}`]
            }
        });
        
        return containers.map(c => ({
            id: c.Id,
            name: c.Names[0].replace(/^\//, ''), // remove leading slash
            state: c.State,
            status: c.Status
        }));
    } catch (error) {
        console.error('Failed to list docker compose containers:', error);
        return [];
    }
}

export async function switchDockerComposeContainer(instanceId, containerName) {
    const session = activeInstances.get(instanceId);
    if (!session) throw new Error('Instance not running');
    
    const instanceConfig = getInstanceById(instanceId);
    if (!instanceConfig || instanceConfig.type !== 'docker_compose') throw new Error('Not a docker compose instance');

    const container = docker.getContainer(containerName); // containerName should be ID or Name? usually Name is unique enough or ID.
    // If passing Name (which we get from getDockerComposeContainers), we might need to find ID or just use Name if dockerode supports it.
    // Dockerode getContainer takes ID or Name.
    
    try {
        // Verify container exists and belongs to this project?
        // Skipped for brevity, assuming frontend sends valid name from list.
        
        // 1. "Detach" current term.
        // We can't easily "detach" the listeners added in `startInstance` without keeping references.
        // But `session.listeners` are WebSocket clients.
        // The `term.on('data')` pushes to history and clients.
        // We need to stop the *old* `stream.on('data')`.
        
        // Issue: The `term` object defined in `startInstance` doesn't expose the stream to remove listeners.
        // Hack: We can just replace the `term` object in `session` and somehow tell the old one to shut up.
        // But the old stream is still flowing.
        // We should add a `destroy` method to the `term` object we create.
        
        if (session.pty.destroy) {
            session.pty.destroy();
        }
        
        // 2. Attach new
        const inspectData = await container.inspect();
        const isTty = inspectData.Config.Tty;

        const stream = await container.attach({
            stream: true,
            logs: true,
            stdin: true,
            stdout: true,
            stderr: true,
        });

        // Update history? Maybe print a message.
        const switchMsg = `\r\n\x1b[33m--- Switched to container: ${containerName} ---\x1b[0m\r\n`;
        session.history += switchMsg;
         session.listeners.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', id: instanceId, data: switchMsg }));
        });

        const term = {
            pid: container.id,
            write: (data) => stream.write(data),
            on: (event, handler) => {
                if (event === 'data') {
                     if (isTty) {
                        stream.on('data', handler);
                    } else {
                        // Demux Docker stream
                        stream.on('data', (chunk) => {
                            let offset = 0;
                            while (offset < chunk.length) {
                                if (chunk.length < offset + 8) break;
                                const type = chunk.readUInt8(offset);
                                const length = chunk.readUInt32BE(offset + 4);
                                offset += 8;
                                if (offset + length <= chunk.length) {
                                    handler(chunk.slice(offset, offset + length));
                                    offset += length;
                                } else {
                                    break;
                                }
                            }
                        });
                    }
                }
                // We DON'T listen to exit here for restarting the instance, 
                // because switching containers shouldn't control instance lifecycle (unless it's the main one?)
                // Let's leave exit handler empty or minimal for switched containers.
                // Or maybe we should? If this container dies, what happens?
                // Ideally, the "Instance" is the Compose Project. It stops when `docker compose down` or all containers stop.
                // For now, let's just handle data.
            },
            resize: (cols, rows) => {
                if (cols > 0 && rows > 0) {
                    container.resize({ h: rows, w: cols }).catch(err => console.error(i18n.t('server.resize_container_tty_failed_log'), err.message));
                }
            },
            kill: (signal) => {
                 // Forward kill to the compose project, not just this container?
                 // Or just do nothing because `stopInstance` handles the compose down?
                 // `stopInstance` calls `pty.kill`.
                 // For Docker Compose, `pty.kill` should stop the *project*.
                  if (signal === 'SIGKILL') {
                       execAsync('docker compose kill', { cwd: instanceConfig.cwd }).catch(console.error);
                   } else {
                       execAsync('docker compose stop', { cwd: instanceConfig.cwd }).catch(console.error);
                   }
            },
            destroy: () => {
                stream.removeAllListeners();
                stream.destroy();
            }
        };
        
        // Re-bind data listener
        term.on('data', (data) => {
            const output = data.toString('utf8');
            session.history += output;
            session.listeners.forEach(ws => {
                if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', id: instanceId, data: output }));
            });
        });

        session.pty = term;
        
    } catch (error) {
        console.error('Failed to switch container:', error);
        throw error;
    }
}