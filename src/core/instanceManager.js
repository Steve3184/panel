import path from 'path';
import fs from 'fs-extra';
import pty from 'node-pty';
import Docker from 'dockerode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { PassThrough } from 'stream';
import { readDb, writeDb } from '../data/db.js';
import { INSTANCES_DB_PATH, WORKSPACES_PATH } from '../config.js';
import { broadcastToInstance } from '../websocket/handler.js';
import { isPathWithinRoot } from './fileManager.js';
import { appendTerminalHistory, buildShellLaunch, truncateTerminalOutput } from './terminalSecurity.js';
import { containerBelongsToComposeInstance } from './dockerSecurity.js';
import i18n from '../utils/i18n.js';

const execAsync = promisify(exec);
const docker = new Docker();

/**
 * Run a `docker compose` sub-command with real-time output streaming and a
 * hard timeout.  Never resolves until the process exits (or is killed).
 *
 * @param {string[]} args       e.g. ['up', '-d'] or ['stop', '--timeout', '10']
 * @param {string}   cwd        Directory containing docker-compose.yml
 * @param {function} [onOutput] Called with each stdout/stderr chunk as a string
 * @param {number}   [timeoutMs=300_000]  Kill the process after this many ms
 */
function spawnDockerCompose(args, cwd, onOutput, timeoutMs = 300_000) {
    return new Promise((resolve, reject) => {
        const proc = spawn('docker', ['compose', ...args], { cwd });
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGKILL');
            reject(new Error(`docker compose ${args[0]} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        proc.stdout.on('data', (data) => onOutput?.(data.toString('utf8')));
        proc.stderr.on('data', (data) => onOutput?.(data.toString('utf8')));

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) return;
            if (code === 0 || code === null) resolve();
            else reject(new Error(`docker compose ${args[0]} exited with code ${code}`));
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            if (!timedOut) reject(err);
        });
    });
}

/**
 * Stop or kill all containers belonging to a docker_compose instance using the
 * Docker API (no shell required).  Falls back to the CLI only if the container
 * list is empty (e.g. labels are missing on an older project).
 *
 * @param {string} instanceId
 * @param {string} instanceCwd  Resolved working directory (never undefined)
 * @param {string} signal       'SIGKILL' | anything else → graceful stop
 */
async function stopDockerComposeContainers(instanceId, instanceCwd, signal) {
    try {
        const containers = await getDockerComposeContainers(instanceId);
        if (containers.length > 0) {
            await Promise.all(containers.map(async ({ id }) => {
                try {
                    const c = docker.getContainer(id);
                    if (signal === 'SIGKILL') {
                        await c.kill();
                    } else {
                        await c.stop({ t: 10 });
                    }
                } catch (err) {
                    // 304 = already stopped, 404 = already removed — both are fine
                    if (err.statusCode !== 304 && err.statusCode !== 404) {
                        console.error(`Failed to stop compose container ${id}:`, err.message);
                    }
                }
            }));
            return;
        }
    } catch (err) {
        console.warn('Dockerode compose stop failed, falling back to CLI:', err.message);
    }
    // Fallback: container list empty or lookup failed — use the CLI with a 60s timeout
    const subCmd = signal === 'SIGKILL' ? ['kill'] : ['stop', '--timeout', '10'];
    await spawnDockerCompose(subCmd, instanceCwd, null, 60_000).catch(console.error);
}

/**
 * Clean up docker compose startup output for display in xterm.js history.
 *
 * `docker compose up` emits interactive progress via `\r` (carriage return) to
 * overwrite the current line, optionally preceded by spaces to clear the previous
 * text.  When stored verbatim and replayed in xterm.js, this produces staircase
 * indentation.  This function:
 *   1. Strips ANSI/VT100 escape sequences (colours, cursor movement, etc.)
 *   2. Simulates carriage return: when a `\r` is encountered, the buffered line is
 *      discarded so the next write wins (mimicking a real terminal overwrite).
 *   3. Drops blank lines that result from cleared progress lines.
 */
function cleanComposeOutput(raw) {
    // Strip all ANSI escape sequences (CSI, OSC, single-char, etc.)
    const stripped = raw
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')   // CSI sequences (colours, cursor)
        .replace(/\x1B[()][AB0-3]/g, '')           // Character-set designations
        .replace(/\x1B[=>]/g, '')                  // Application/normal keypad
        .replace(/\x1B./g, '');                    // Any remaining two-char escapes

    const lines = [];
    let cur = '';
    for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i];
        if (ch === '\n') {
            lines.push(cur);
            cur = '';
        } else if (ch === '\r') {
            // Discard buffered content — the next write starts from column 0
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur) lines.push(cur);

    return lines
        .filter(l => l.trim().length > 0)
        .join('\n') + '\n';
}
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
    // Startup output captured for docker_compose; prepended to session history.
    let composeStartupOutput = '';

    if (instanceConfig.type === 'docker') {
        const dockerConfig = instanceConfig.dockerConfig || {};
        const containerName = dockerConfig.containerName || `runner-${instanceConfig.id}`;
        const image = dockerConfig.image;
        if (!image) throw new Error(`Docker 实例 ${instanceConfig.name} 未指定镜像 (image)`);

        const execCommand = dockerConfig.command ? dockerConfig.command.split(/\s+/) : null;
        const effectiveCwd = dockerConfig.workingDir || null;
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
                portBindings[`${containerPort || hostPort}/${containerProtocol ? 'udp' : 'tcp'}`] = [{ HostIP: '127.0.0.1', HostPort: hostPort || '' }];
                exposedPorts[`${containerPort || hostPort}/${containerProtocol ? 'udp' : 'tcp'}`] = {};
            });

            const binds = [];
            if (effectiveCwd) binds.push(`${instanceCwd}:${effectiveCwd}`);
            (dockerConfig.volumes || []).forEach(volume => binds.push(volume));

            const createOpts = {
                Image: image,
                name: containerName,
                Tty: true,
                OpenStdin: true,
                HostConfig: { Binds: binds, PortBindings: portBindings, AutoRemove: true },
                ExposedPorts: exposedPorts,
                Env: Object.entries(instanceConfig.env || {}).map(([key, value]) => `${key}=${value}`),
                Cmd: execCommand,
            };
            if (effectiveCwd) createOpts.WorkingDir = effectiveCwd;

            try {
                container = await docker.createContainer(createOpts);
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
        // Check whether the project's containers are already running. If they
        // are, we skip `docker compose up` and go straight to attach — this
        // makes startInstance idempotent and avoids exit-code-1 failures on
        // server restart when containers were left running from a previous
        // session.
        const preExistingContainers = await getDockerComposeContainers(instanceConfig.id);
        const alreadyRunning = preExistingContainers.some(c => c.state === 'running');

        if (!alreadyRunning) {
            // Stream `docker compose up` output so the user can see what happened.
            // --progress=plain suppresses the interactive spinner/cursor-movement
            // output that would produce garbled text when replayed in xterm.js.
            try {
                await spawnDockerCompose(['--progress', 'plain', 'up', '-d'], instanceCwd,
                    (chunk) => { composeStartupOutput += chunk; });
            } catch (e) {
                if (composeStartupOutput) {
                    console.error('docker compose up output:\n', composeStartupOutput);
                }
                console.error('Docker compose up failed', e);
                throw new Error(i18n.t('server.docker_compose_up_failed', { error: e.message }));
            }
            // Clean up interactive progress output so it renders correctly in xterm.js.
            composeStartupOutput = cleanComposeOutput(composeStartupOutput);
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

        const normalizeOutput = (data) => {
            let str = data.toString('utf8');
            str = str.replace(/\r(?!\n)/g, '\r\n');
            return Buffer.from(str, 'utf8');
        };

        term = {
            pid: container.id,
            write: (data) => stream.write(data),
            on: (event, handler) => {
                if (event === 'data') {
                    if (isTty) {
                        stream.on('data', handler);
                    } else {
                        const stdout = new PassThrough();
                        const stderr = new PassThrough();
                        docker.modem.demuxStream(stream, stdout, stderr);
                        stdout.on('data', data => handler(normalizeOutput(data)));
                        stderr.on('data', data => handler(normalizeOutput(data)));
                    }
                }
                if (event === 'exit') {
                    container.wait()
                        .then(() => handler())
                        .catch(() => handler());
                }
            },
            resize: (cols, rows) => {
                if (isTty && cols > 0 && rows > 0) {
                    container.resize({ h: rows, w: cols }).catch(err => console.error(i18n.t('server.resize_container_tty_failed_log'), err.message));
                }
            },
            kill: (signal) => {
                stopDockerComposeContainers(instanceConfig.id, instanceCwd, signal);
            },
            destroy: () => {
                stream.removeAllListeners();
                stream.destroy();
            }
        };

    } else {
        const launch = buildShellLaunch(
            instanceCwd,
            commandToExecute,
            instanceConfig.env,
            instanceConfig.sandboxEnabled !== false,
            instanceConfig.sandboxAllowedPaths,
            instanceConfig.sandboxPreserveWorkspacePath === true
        );
        if (instanceConfig.sandboxEnabled !== false && !launch.sandboxed) {
            console.warn(`Shell sandbox unavailable for instance ${instanceConfig.id}: ${launch.sandboxReason || 'disabled'}`);
        }
        const ptyOptions = {
            name: 'xterm-color', cols: 80, rows: 30, cwd: instanceCwd,
            env: launch.env
        };
        term = pty.spawn(launch.file, launch.args, ptyOptions);
        term.destroy = () => {}; 
    }

    const session = {
        id: instanceConfig.id, pty: term, listeners: new Set(),
        history: composeStartupOutput,
        isUserTriggeredStop: false,
        isUserTriggeredRestart: false,
        restartAttempts: 0,
        restartTimer: null,
        restartTimeout: null,
    };
    activeInstances.set(instanceConfig.id, session);

    broadcastToInstance(instanceConfig.id, { type: 'event', event: 'instance-started', id: instanceConfig.id });

    term.on('data', (data) => {
        const output = data.toString('utf8');
        session.history = appendTerminalHistory(session.history, output);
        const truncatedOutput = truncateTerminalOutput(output);
        session.listeners.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', id: instanceConfig.id, data: truncatedOutput }));
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

        // Ensure active session is removed
        activeInstances.delete(instanceConfig.id);
        broadcastToInstance(instanceConfig.id, { type: 'event', event: 'instance-stopped', id: instanceConfig.id });

        const instances = readDb(INSTANCES_DB_PATH);
        const currentInstanceIndex = instances.findIndex(i => i.id === instanceConfig.id);
        if (currentInstanceIndex !== -1) {
            stoppedInstancesHistory.set(instanceConfig.id, session.history);
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
                // User-triggered restarts should not accumulate delay — reset the counter first.
                if (session.isUserTriggeredRestart) {
                    session.restartAttempts = 0;
                }
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

        if (instanceToDelete.type === 'docker_compose') {
            const composeCwd = instanceToDelete.cwd || path.join(WORKSPACES_PATH, instanceId);
            try {
                // Remove all containers (including stopped ones) that belong to this project
                const allContainers = await docker.listContainers({
                    all: true,
                    filters: { label: ['com.docker.compose.project.working_dir'] }
                });
                const projectContainers = allContainers.filter(c =>
                    containerBelongsToComposeInstance(instanceToDelete, { Config: { Labels: c.Labels } })
                );
                await Promise.all(projectContainers.map(c =>
                    docker.getContainer(c.Id).remove({ force: true }).catch(err => {
                        if (err.statusCode !== 404) console.error(`Failed to remove compose container ${c.Id}:`, err.message);
                    })
                ));

                // Remove compose-created networks
                const allNetworks = await docker.listNetworks({
                    filters: { label: ['com.docker.compose.project.working_dir'] }
                });
                const projectNetworks = allNetworks.filter(n =>
                    n.Labels?.['com.docker.compose.project.working_dir'] === composeCwd
                );
                await Promise.all(projectNetworks.map(n =>
                    docker.getNetwork(n.Id).remove().catch(err => {
                        if (err.statusCode !== 404) console.error(`Failed to remove compose network ${n.Id}:`, err.message);
                    })
                ));

                console.log(`Cleaned up Docker Compose resources for instance ${instanceId}`);
            } catch (err) {
                console.error(`Failed to clean up Docker Compose resources for ${instanceId}:`, err.message);
            }
        }

        if (deleteData) {
            const cwd = instanceToDelete.cwd || path.join(WORKSPACES_PATH, instanceId);
            if (path.resolve(cwd) !== path.resolve(WORKSPACES_PATH) && isPathWithinRoot(WORKSPACES_PATH, cwd)) {
                fs.removeSync(cwd);
                console.log(i18n.t('server.instance_working_directory_deleted', { instanceId: instanceId }));
            }
        }

        broadcastToInstance(instanceId, { type: 'event', event: 'instance-deleted', id: instanceId });
        instances = instances.filter(i => i.id !== instanceId);
        writeDb(INSTANCES_DB_PATH, instances);
        stoppedInstancesHistory.delete(instanceId);
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

        if (instance.type === 'docker_compose' && !activeInstances.has(instance.id)) {
            try {
                const containers = await getDockerComposeContainers(instance.id);
                if (containers.some(c => c.state === 'running')) {
                    console.log(`Detected running Docker Compose project: ${instance.name}, re-attaching...`);
                    await startInstance(instance);
                }
            } catch (error) {
                console.error(`Error re-attaching docker_compose instance ${instance.name}:`, error.message);
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
    
    try {
        const containers = await docker.listContainers({
            filters: {
                label: ['com.docker.compose.project.working_dir']
            }
        });
        
        return containers.filter(c => containerBelongsToComposeInstance(instance, { Config: { Labels: c.Labels } })).map(c => ({
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

    // Resolved cwd — same calculation as startInstance
    const instanceCwd = instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceConfig.id);

    try {
        if (typeof containerName !== 'string' || !containerName) throw new Error('Invalid container name');
        const container = docker.getContainer(containerName);
        const inspectData = await container.inspect();
        if (!containerBelongsToComposeInstance(instanceConfig, inspectData)) {
            throw new Error('Container does not belong to this Compose instance');
        }

        // Detach and destroy the old stream before attaching to the new one
        if (session.pty.destroy) {
            session.pty.destroy();
        }

        const isTty = inspectData.Config.Tty;

        const stream = await container.attach({
            stream: true,
            logs: true,
            stdin: true,
            stdout: true,
            stderr: true,
        });

        const switchMsg = `\r\n\x1b[33m--- Switched to container: ${containerName} ---\x1b[0m\r\n`;
        session.history = appendTerminalHistory(session.history, switchMsg);
        session.listeners.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', id: instanceId, data: switchMsg }));
        });

        const normalizeOutput = (data) => {
            let str = data.toString('utf8');
            str = str.replace(/\r(?!\n)/g, '\r\n');
            return Buffer.from(str, 'utf8');
        };

        const term = {
            pid: container.id,
            write: (data) => stream.write(data),
            on: (event, handler) => {
                if (event === 'data') {
                    if (isTty) {
                        stream.on('data', handler);
                    } else {
                        // Use docker.modem.demuxStream to correctly handle TCP-fragmented chunks
                        const stdout = new PassThrough();
                        const stderr = new PassThrough();
                        docker.modem.demuxStream(stream, stdout, stderr);
                        stdout.on('data', data => handler(normalizeOutput(data)));
                        stderr.on('data', data => handler(normalizeOutput(data)));
                    }
                }
                // The compose project lifecycle is managed at the instance level;
                // individual container exits are not used to drive restarts here.
            },
            resize: (cols, rows) => {
                if (cols > 0 && rows > 0) {
                    container.resize({ h: rows, w: cols }).catch(err => console.error(i18n.t('server.resize_container_tty_failed_log'), err.message));
                }
            },
            kill: (signal) => {
                stopDockerComposeContainers(instanceId, instanceCwd, signal);
            },
            destroy: () => {
                stream.removeAllListeners();
                stream.destroy();
            }
        };

        // Re-bind data listener on the new term
        term.on('data', (data) => {
            const output = data.toString('utf8');
            session.history = appendTerminalHistory(session.history, output);
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
